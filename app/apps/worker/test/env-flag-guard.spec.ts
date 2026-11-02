import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * 门禁：布尔 / 枚举环境变量只许走 `readEnvFlag` / `readEnvEnum`（第 124 批）。
 *
 * 为什么需要它（先量的事实，`_acceptance/d124/flag-probe.log`）：
 * 直接拿原始字符串比字面量的判据，写法差一个字母不会报错、类型检查也过，行为却悄悄
 * 落到另一侧 —— 实测 15 种错误拼写 **15 种全部静默错向**：
 * - `AI_LABEL_ENABLED=0` / `=off` 被 `!== "false"` 判成 true：想关的合规开关没关上；
 * - `ADAPTER_MODE=Real` 在生产被主程序读成 mock、被启动守卫读成「不是 real」，
 *   同一变量两个读者给出相反结论；
 * - `STORAGE_DRIVER=S3` 被裸转换 `as "local" | "s3"` 当未知驱动，报错却是
 *   「s3 storage requires s3 config」，排查方向整个跑偏；
 * - `OAUTH_MOCK=true` / `CAPTCHA_ENFORCE=true` 被 `=== "1"` 判成关：联调拿不到 mock，
 *   行为验证码入口直接放行。
 *
 * 这层只盯「决策」：生产源码里不允许出现对 `process.env.*` 的字面量比较、
 * `switch (process.env.*)`、把 `process.env.*` 断言成字面量类型，或自造的
 * `.includes(...)` 接受表。取值本身是否合理由 spec 与各调用点的默认值负责。
 *
 * 静态守卫只认这四种写法，且 `process.env.X` 允许写成 `process.env["X"]`：
 * 不做的事（诚实边界）——
 * - 逗号表达式 / 三目 / `if (process.env.X)` 的**真值判断**不看：那可能是密钥
 *   「配没配」的存在性判断（例如 OAuth 凭据），并不等价于布尔开关；
 * - 先解构 `const { X } = process.env` 再比较不会被认出（当前仓库没有这种写法）；
 * - `=== null` / `=== undefined` 不看：这是存在性判断，不是取值判定。
 * - `NODE_ENV` 豁免：它由运行时注入、取值为 development/test/production，
 *   与「配置写错一个字母」不是同一类事故（本仓库 2 处直接比较，均为安全边界）。
 */
interface DirectFlagDecision {
  file: string;
  line: number;
  shape: string;
}

const APP_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOTS = ["apps", "packages"] as const;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".next"]);
/** 运行时注入的环境判定，不走「配置接受表」 */
const RUNTIME_KEYS = new Set(["NODE_ENV"]);
const EQUALITY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
/** 自造的接受表：`[...].includes(process.env.X)` / `process.env.X.includes("true")` */
const HAND_ROLLED_LOOKUPS = new Set(["includes", "indexOf"]);

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
}

/** `process.env.X` / `process.env["X"]` → "X"；其余（含 `process.env` 本身）→ undefined */
function envKeyOf(node: ts.Node): string | undefined {
  const base = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined;
  if (!base || !ts.isPropertyAccessExpression(base)) return undefined;
  if (!ts.isIdentifier(base.expression) || base.expression.text !== "process") return undefined;
  if (base.name.text !== "env") return undefined;

  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const arg = (node as ts.ElementAccessExpression).argumentExpression;
  return ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/** 收集一棵子树里出现的全部 `process.env.<键>`（`String(process.env.X ?? "0")` 也算） */
function collectProcessEnvKeys(node: ts.Node, out: string[] = []): string[] {
  const key = envKeyOf(node);
  if (key !== undefined) {
    out.push(key);
    return out;
  }
  node.forEachChild((child) => {
    collectProcessEnvKeys(child, out);
  });
  return out;
}

function involvesConfigEnv(node: ts.Node): boolean {
  return collectProcessEnvKeys(node).some((key) => !RUNTIME_KEYS.has(key));
}

function isLiteralValue(node: ts.Node): boolean {
  return ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
}

/** `as "local" | "s3"`：字面量类型或字面量联合 —— 裸转换把未知取值原样传下去 */
function isLiteralType(type: ts.TypeNode): boolean {
  return ts.isLiteralTypeNode(type) || (ts.isUnionTypeNode(type) && type.types.every((member) => ts.isLiteralTypeNode(member)));
}

/** call 的 callee 是 `includes` / `indexOf`（`.includes` 的接收者或实参沾了 process.env） */
function handRolledLookup(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !HAND_ROLLED_LOOKUPS.has(callee.name.text)) return false;
  return involvesConfigEnv(callee.expression) || node.arguments.some((arg) => involvesConfigEnv(arg));
}

function scanDirectFlagDecisions(file: string, source: string): DirectFlagDecision[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: DirectFlagDecision[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const record = (node: ts.Node, shape: string): void => {
    found.push({ file: toPosix(relative(APP_ROOT, file)), line: lineOf(node), shape });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && EQUALITY_OPERATORS.has(node.operatorToken.kind)) {
      const envLeft = involvesConfigEnv(node.left);
      const envRight = involvesConfigEnv(node.right);
      if ((envLeft && isLiteralValue(node.right)) || (envRight && isLiteralValue(node.left))) {
        // 键从「沾了 process.env 的那一侧」里取第一个：`String(process.env.X ?? "0")` 也报 X
        const envSide = envLeft ? node.left : node.right;
        const key = envKeyOf(envSide) ?? collectProcessEnvKeys(envSide)[0] ?? "…";
        const literal = isLiteralValue(node.left) ? node.left.getText(sf) : node.right.getText(sf);
        record(node, `process.env.${key} ${node.operatorToken.getText(sf)} ${literal}`);
      }
    }
    if (ts.isSwitchStatement(node) && involvesConfigEnv(node.expression)) {
      record(node, "switch (process.env…)");
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && isLiteralType(node.type) && involvesConfigEnv(node.expression)) {
      record(node, `process.env… as ${node.type.getText(sf)}`);
    }
    if (ts.isCallExpression(node) && handRolledLookup(node)) {
      record(node, ".includes / .indexOf 自造接受表");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** 唯一入口的四个函数：读环境（read*）与纯解析（parse*，仅启动守卫为了回显原值而用） */
const FLAG_HELPERS = new Set(["readEnvFlag", "readEnvEnum", "parseEnvFlag", "parseEnvEnum"]);

/** 文件里所有 `readEnvFlag("NAME", …)` / `parseEnvEnum("NAME", …)` 的变量名 */
function readEnvCallNames(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      FLAG_HELPERS.has(node.expression.text) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      names.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function scanProductionTree(): DirectFlagDecision[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(APP_ROOT, root), files);
  }
  const sites: DirectFlagDecision[] = [];
  for (const file of files.sort()) {
    sites.push(...scanDirectFlagDecisions(file, readFileSync(file, "utf8")));
  }
  return sites;
}

const WORKER_MAIN = join(APP_ROOT, "apps/worker/src/main.ts");
const WORKER_ENV_GUARD = join(APP_ROOT, "apps/worker/src/env-guard.ts");
const WORKER_ENV_FLAGS = join(APP_ROOT, "apps/worker/src/env-flags.ts");
const API_ENV = join(APP_ROOT, "apps/api/src/config/env.ts");
const API_ENV_VALUES = join(APP_ROOT, "apps/api/src/config/env-values.ts");
const OAUTH_SERVICE = join(APP_ROOT, "apps/api/src/modules/auth/oauth.service.ts");
const AUTH_CONTROLLER = join(APP_ROOT, "apps/api/src/modules/auth/auth.controller.ts");
const TOOL_CATALOG = join(APP_ROOT, "apps/api/src/modules/generations/tool-catalog.ts");

describe("静态守卫：布尔 / 枚举环境变量只有一个入口", () => {
  it("识别字面量比较（两种方向、String 包裹、下标写法），放过存在性判断与 NODE_ENV", () => {
    const source = `
      const a = process.env.FLAG_A === "true";
      const b = "1" === process.env.FLAG_B;
      const c = String(process.env.FLAG_C ?? "0") !== "1";
      const d = process.env["FLAG_D"] == "yes";
      const e = process.env.FLAG_E !== undefined;
      const f = process.env.NODE_ENV !== "production";
      const g = env.FLAG_G === "true";
    `;
    expect(scanDirectFlagDecisions("synthetic.ts", source).map((s) => s.shape)).toEqual([
      'process.env.FLAG_A === "true"',
      'process.env.FLAG_B === "1"',
      'process.env.FLAG_C !== "1"',
      'process.env.FLAG_D == "yes"',
    ]);
  });

  it("识别 switch 判别式、字面量类型断言与自造接受表；放过宽化断言", () => {
    const source = `
      switch (process.env.FLAG_S) { case "true": break; default: break; }
      const x = process.env.STORAGE_DRIVER as "local" | "s3";
      const y = process.env.OTHER as string;
      const z = ["1", "true"].includes(process.env.FLAG_Z);
      const w = process.env.FLAG_W.includes("true");
    `;
    expect(scanDirectFlagDecisions("synthetic.ts", source).map((s) => s.shape)).toEqual([
      "switch (process.env…)",
      'process.env… as "local" | "s3"',
      ".includes / .indexOf 自造接受表",
      ".includes / .indexOf 自造接受表",
    ]);
  });

  it("注释与字符串里的同样文本不算（AST 说话）", () => {
    const source = `
      // process.env.FLAG_A === "true"
      /* process.env.STORAGE_DRIVER as "local" | "s3" */
      const note = 'process.env.FLAG_B !== "1"';
    `;
    expect(scanDirectFlagDecisions("synthetic.ts", source)).toHaveLength(0);
  });

  it("生产源码（apps/*/src + packages/*/src）零直接决策", () => {
    expect(scanProductionTree().map((s) => `${s.file}:${s.line} ${s.shape}`)).toEqual([]);
  });

  it("已知 10 个站点全部改道 readEnvFlag / readEnvEnum / env 快照", () => {
    // worker 6 处 + 启动守卫（同一张 ADAPTER_MODE 表，两个读者必须同结论）
    expect(readEnvCallNames(WORKER_MAIN)).toEqual(
      expect.arrayContaining([
        "STORAGE_DRIVER",
        "STORAGE_S3_FORCE_PATH_STYLE",
        "ADAPTER_MODE",
        "ARK_IMAGE_RESPONSE_FORMAT",
        "ARK_IMAGE_WATERMARK",
        "AI_LABEL_ENABLED",
      ]),
    );
    expect(readEnvCallNames(WORKER_ENV_GUARD)).toEqual(["ADAPTER_MODE", "PROVIDER_DB_RESOLVE"]);

    // api：两个调用时现场读的测试开关
    expect(readEnvCallNames(OAUTH_SERVICE)).toEqual(["OAUTH_MOCK"]);
    expect(readEnvCallNames(AUTH_CONTROLLER)).toEqual(["CAPTCHA_ENFORCE"]);

    // api 启动快照：schema 只做接线，接受表在 shared 与 env-values
    const envSource = readFileSync(API_ENV, "utf8");
    for (const entry of [
      'zEnvFlag("OAUTH_MOCK"',
      'zEnvFlag("CAPTCHA_ENFORCE"',
      'zEnvFlag("CATALOG_SYNC_TOOLS"',
      'zEnvFlag("MODERATION_ENABLED"',
      'zEnvEnum("STORAGE_DRIVER"',
      'zEnvFlag("STORAGE_S3_FORCE_PATH_STYLE"',
    ]) {
      expect(envSource).toContain(entry);
    }
    expect(envSource).toContain("from \"./env-values\"");

    // tool-catalog：每进程只同步一次，读启动快照即同一语义
    const catalogSource = readFileSync(TOOL_CATALOG, "utf8");
    expect(catalogSource).toContain("env.CATALOG_SYNC_TOOLS");
    expect(catalogSource).not.toContain("process.env.CATALOG_SYNC_TOOLS");
  });

  it("同一键共用同一张表：STORAGE_* 只有 shared 定义，api 与 worker 都 import 它", () => {
    const shared = readFileSync(join(APP_ROOT, "packages/shared/src/env-flag.ts"), "utf8");
    expect(shared).toContain("export const STORAGE_DRIVER_SPEC");
    expect(shared).toContain("export const STORAGE_S3_FORCE_PATH_STYLE_SPEC");
    for (const file of [API_ENV, WORKER_MAIN]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("STORAGE_DRIVER_SPEC");
      expect(source).toContain("STORAGE_S3_FORCE_PATH_STYLE_SPEC");
    }
    // spec 不在这两个文件里各自重定义（重定义 = 接受范围再次漂移）
    expect(readFileSync(API_ENV, "utf8")).not.toContain("STORAGE_DRIVER_SPEC =");
    expect(readFileSync(WORKER_ENV_FLAGS, "utf8")).not.toContain("STORAGE_DRIVER_SPEC =");
  });

  it("shared 包把两个 helper 从入口导出（别的包才 import 得到）", () => {
    expect(readFileSync(join(APP_ROOT, "packages/shared/src/index.ts"), "utf8")).toContain('export * from "./env-flag";');
  });
});
