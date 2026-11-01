import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * 门禁：数值环境变量只许走 `readEnvNumber`（第 123 批）。
 *
 * 为什么需要它（先量的事实，`_acceptance/d123`）：
 * - `Number(process.env.X ?? d)` 对空白给 0（`Number("") === 0`）——「留空」变成 0ms 轮询；
 *   对 `"30s"` / `"5m"` 给 NaN —— 而 `NaN <= 0` 为 false，worker `schedule()` 的
 *   「停用」闸直接放行，`setInterval(fn, NaN)` 被 Node 夹到 1ms，对账 / 看门狗 / 清理
 *   任务从「5 分钟一次」变成「几乎不停」。
 * - 停机定时器更直接：`SHUTDOWN_TIMEOUT_MS=30s` 下强制退出 0ms 开火，在途请求没
 *   drain 完就 `exit(1)`（`shutdown-child.cjs`：坏值 / 空白 EXIT=1，合法值 EXIT=0）。
 *
 * 这层只盯「入口」：生产源码里不允许出现对 `process.env.*` 的直接数值解析。
 * 数值本身是否合理由 `readEnvNumber` 的 spec 与各调用点的 min/max 负责。
 *
 * 静态守卫只认四种写法：`Number(` / `parseInt(` / `parseFloat(` / `BigInt(` 的直接调用，
 * 以及 `+process.env.X` / `-process.env.X` 一元数值转换；`process.env.X` 允许写成
 * `process.env["X"]`。先解构 `const { X } = process.env` 再 `Number(X)` 不会被认出
 * （当前仓库没有这种写法）。
 */
interface DirectParse {
  file: string;
  line: number;
  shape: string;
}

const APP_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOTS = ["apps", "packages"] as const;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".next"]);
const PARSERS = new Set(["Number", "parseInt", "parseFloat", "BigInt"]);

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
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
}

function isProcessEnv(node: ts.Node, sf: ts.SourceFile): boolean {
  const target = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined;
  if (!target || !ts.isPropertyAccessExpression(target)) return false;
  return target.expression.getText(sf) === "process" && target.name.text === "env";
}

/**
 * 真正的写法是 `Number(process.env.X ?? 默认值)` —— 传进去的是二元表达式，
 * 不是一个裸的属性访问。只看参数顶层会漏掉 14/15 个站点（第一次跑红就发生了）。
 */
function containsProcessEnv(node: ts.Node, sf: ts.SourceFile): boolean {
  if (isProcessEnv(node, sf)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && containsProcessEnv(child, sf)) found = true;
  });
  return found;
}

/** `Number.parseInt(...)` / `globalThis.parseFloat(...)` 也是同一个入口问题 */
function numericParserName(expr: ts.Expression, sf: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(expr)) return PARSERS.has(expr.text) ? expr.text : undefined;
  if (ts.isPropertyAccessExpression(expr) && PARSERS.has(expr.name.text)) {
    const owner = expr.expression.getText(sf);
    if (owner === "globalThis" || owner === "Number") return expr.name.text;
  }
  return undefined;
}

function scanDirectNumericEnv(file: string, source: string): DirectParse[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: DirectParse[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const record = (node: ts.Node, shape: string): void => {
    found.push({ file: toPosix(relative(APP_ROOT, file)), line: lineOf(node), shape });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const parser = numericParserName(node.expression, sf);
      if (parser && containsProcessEnv(node.arguments[0]!, sf)) {
        record(node, `${parser}(process.env…)`);
      }
    }
    if (
      ts.isUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken) &&
      containsProcessEnv(node.operand, sf)
    ) {
      record(node, `${node.operator === ts.SyntaxKind.PlusToken ? "+" : "-"}process.env…`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** 文件里所有 `readEnvNumber("NAME", …)` 的变量名（用于证明已知站点已改道） */
function readEnvNumberNames(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "readEnvNumber" &&
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

function scanProductionTree(): DirectParse[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(APP_ROOT, root), files);
  }
  const sites: DirectParse[] = [];
  for (const file of files.sort()) {
    sites.push(...scanDirectNumericEnv(file, readFileSync(file, "utf8")));
  }
  return sites;
}

const WORKER_MAIN = join(APP_ROOT, "apps/worker/src/main.ts");
const API_MAIN = join(APP_ROOT, "apps/api/src/main.ts");
const SNOWFLAKE = join(APP_ROOT, "packages/shared/src/snowflake.ts");
const TOKEN_SERVICE = join(APP_ROOT, "apps/api/src/modules/auth/token.service.ts");

describe("静态守卫：数值环境变量只有一个入口", () => {
  it("识别四种直接数值解析与一元转换（含 process.env['X'] 写法）", () => {
    const source = `
      const a = Number(process.env.A ?? 1);
      const b = Number.parseInt(process.env.B, 10);
      const c = parseFloat(process.env.C);
      const d = BigInt(process.env.D);
      const e = +process.env.E;
      const f = -process.env.F;
      const g = Number(process.env["G"] ?? 1);
    `;
    expect(scanDirectNumericEnv("synthetic.ts", source)).toHaveLength(7);
  });

  it("注释与字符串里的同样文本不算（AST 说话）", () => {
    const source = `
      // Number(process.env.A ?? 1)
      /* +process.env.B */
      const note = "Number(process.env.C ?? 2)";
    `;
    expect(scanDirectNumericEnv("synthetic.ts", source)).toHaveLength(0);
  });

  it("别的对象 / 已走 helper 的读取不算", () => {
    const source = `
      const a = Number(env.X);
      const b = Number(other.Y);
      const c = readEnvNumber("X", { default: 1 });
      const d = Number(process.envValue);
    `;
    expect(scanDirectNumericEnv("synthetic.ts", source)).toHaveLength(0);
  });

  it("生产源码（apps/*/src + packages/*/src）零直接解析", () => {
    expect(scanProductionTree().map((s) => `${s.file}:${s.line} ${s.shape}`)).toEqual([]);
  });

  it("已知 15 个站点全部改道 readEnvNumber；MASTER_TTL_S 走 env.ts", () => {
    expect(readEnvNumberNames(WORKER_MAIN)).toEqual(
      expect.arrayContaining([
        "ARK_IMAGE_TIMEOUT_MS",
        "POLL_INTERVAL_MS",
        "POLL_MAX_MS",
        "ADAPTER_URI_TTL_SECONDS",
        "ORDERS_RECONCILE_INTERVAL_MS",
        "TASKS_WATCHDOG_INTERVAL_MS",
        "PUBLICATIONS_WATCHDOG_INTERVAL_MS",
        "SHARES_EXPIRE_INTERVAL_MS",
        "FLOWS_AUDIT_INTERVAL_MS",
        "MAINTENANCE_INTERVAL_MS",
        "WORKER_CONCURRENCY",
        "SHUTDOWN_TIMEOUT_MS",
      ]),
    );
    expect(readEnvNumberNames(API_MAIN)).toEqual(expect.arrayContaining(["SHUTDOWN_TIMEOUT_MS"]));
    expect(readEnvNumberNames(SNOWFLAKE)).toEqual(expect.arrayContaining(["WORKER_ID"]));

    // token.service：不再自己解析 MASTER_TTL_S，改读 env.ts 里已校验的那一份
    const tokenSource = readFileSync(TOKEN_SERVICE, "utf8");
    expect(readEnvNumberNames(TOKEN_SERVICE)).toEqual([]);
    expect(tokenSource).toContain("env.MASTER_TTL_S");
    expect(tokenSource).not.toContain("MASTER_TTL_DEFAULT_S");
  });

  it("shared 包把 helper 从入口导出（别的包才 import 得到）", () => {
    expect(readFileSync(join(APP_ROOT, "packages/shared/src/index.ts"), "utf8")).toContain('export * from "./env-number";');
  });
});