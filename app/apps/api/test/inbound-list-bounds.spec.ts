import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * 门禁：入站「列表形」参数**每一处都要有项数上限**（第 120 批）。
 *
 * 为什么需要它（先量的事实）：
 * - 同一个语义的列表字段，在正文入口封了顶、在 query 入口没封。`knowledge` 正文
 *   `tags` 是 `z.array(...).max(20)`，而同一字段的 query 入口是裸
 *   `z.union([z.string(), z.array(z.string())])`，逐项 `.max(40)` 只限单项长度；
 *   `main.ts` 的 `bodyLimit: 48 * 1024 * 1024` 意味着 `?tags=a&tags=b&...` 能塞进
 *   几十万项，逐项 `BigInt()` / `Number()` 都在同一个请求里跑完 —— 一个请求就能把
 *   事件循环占满。语法完全合法，类型检查 / lint / 构建 / 总闸都不会红。
 * - 仓库里**已有的正确做法**分散在各处（`page_size .max(100)`、正文 `tags .max(20)`、
 *   画布 7 个 pin 槽、切片 50 段），说明尺度本来就存在，缺的是「以后每个入口都记得」。
 *
 * 做法：TypeScript AST 静态扫描（不启动服务、不连库）——
 *   1. 覆盖 `apps/api/src` 全部生产 `.ts`（跳过 `.spec.ts`），用 AST 而不是正则，
 *      注释与字符串里的示例天然不会被误判；
 *   2. `z.array(...)`：沿「调用 / 属性链」向上找 `.max(...)`；**只认数组自身的链**，
 *      `z.array(z.string().max(40))` 里那个 40 是单项长度，不算项数上限（自测钉住）；
 *   3. `z.union([...])`：实参文本里出现 `z.array(` 即登记。这个形状只允许出现在
 *      `common/list-param.ts` 的 `csvListRaw`，别处出现就红（防止绕过 helper 新造一个）；
 *   4. `csvListRaw` 的使用点（引用不导入）必须处在 `.optional().transform(...)` 链上，
 *      且链内同时出现 `splitCsvList(` 与 `tooManyListItems(` —— 三者缺一即「裸 union」；
 *   5. `modules/**` 里不再允许手写 `.split(",")`：入站 CSV 一律走 helper。当前仅剩两处
 *      **启动期配置**解析（见 `MODULE_CSV_SPLIT_FILES`），不是请求参数；
 *   6. `@Query(...)` 直收 `string | string[]` 的裸参数只剩登记过的 4 处，任何新增
 *      都必须先在 `RAW_QUERY_PARAM_SITES_BY_FILE` 里登记 —— 让「又加了一个列表参数」
 *      成为一次可见的评审决定。
 *
 * 覆盖边界（诚实说明）：
 * - 只保证「有 `.max(`」，不校验上限值是否合理（`.max(1000000)` 也算通过）；值是否
 *   与既有业务尺度一致，由下面「上限常量」与 11 处入口的文本核对盯住。
 * - 不覆盖 `z.string().max(40)` 后接 `transform(s => s.split(...))` 的自制列表、
 *   也不覆盖非逗号分隔（`split(/\s+/)` 等）；当前仓库没有这类入站参数。
 * - 不覆盖非 `z` 前缀的等价写法（`zod.array` 等），也不覆盖 body 里「对象数量」类
 *   上限（本批只管列表形字段的**项数**）。
 * - `rawQueryParams` 只看 `string | string[]` 这一种联合形状；`string[]` 单写或
 *   `unknown` 交给 zod 的入口不在本断言内（后者由第 2、3 条兜住）。
 */

const APP_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOT = "apps/api/src";
/** 唯一允许出现「无 `.max` 的 `z.array`」与「union 内嵌 array」的文件 */
const HELPER_FILE = "apps/api/src/common/list-param.ts";

/**
 * `z.array` 站点分布（第 120 批定版）。数字变了就说明新增 / 挪动了数组字段，
 * 必须在这里显式登记 —— 与第 119 批的出站 fetch 登记表同一条纪律。
 *
 * 总计 95 处：94 处自带 `.max(...)`，唯一的例外是 helper 里的 `csvListRaw`
 * （它本身不封顶，封顶在 `csvListQuery` / 使用点的 transform 里补）。
 */
const ARRAY_SITES_BY_FILE: Record<string, number> = {
  "apps/api/src/modules/ad/ad.constants.ts": 6,
  "apps/api/src/modules/admin/admin-providers.controller.ts": 1,
  "apps/api/src/modules/admin/admin.controller.ts": 3,
  "apps/api/src/modules/agent/agent-conversations.controller.ts": 1,
  "apps/api/src/modules/agent/agent-reply.service.ts": 1,
  "apps/api/src/modules/agent/agent.controller.ts": 2,
  "apps/api/src/modules/agent/canvas-chat.controller.ts": 2,
  "apps/api/src/modules/assets/assets.controller.ts": 1,
  "apps/api/src/modules/canvas/canvas-download.controller.ts": 1,
  "apps/api/src/modules/canvas/canvas-group.controller.ts": 2,
  "apps/api/src/modules/canvas/canvas-material.controller.ts": 3,
  "apps/api/src/modules/canvas/canvas-node-tasks.controller.ts": 5,
  "apps/api/src/modules/canvas/canvas.controller.ts": 10,
  "apps/api/src/modules/credits/credits.controller.ts": 1,
  "apps/api/src/modules/extraction/extraction.controller.ts": 2,
  "apps/api/src/modules/film/film.controller.ts": 3,
  "apps/api/src/modules/generations/generations.controller.ts": 1,
  "apps/api/src/modules/knowledge/knowledge.controller.ts": 8,
  "apps/api/src/modules/novel/novel-llm.service.ts": 3,
  "apps/api/src/modules/novel/novel.schemas.ts": 2,
  "apps/api/src/modules/op/op.controller.ts": 3,
  "apps/api/src/modules/redraw/redraw.controller.ts": 3,
  "apps/api/src/modules/script/script.controller.ts": 9,
  "apps/api/src/modules/script/timeline.schema.ts": 1,
  "apps/api/src/modules/subjects/subjects.controller.ts": 10,
  "apps/api/src/modules/tasks/tasks.controller.ts": 3,
  "apps/api/src/modules/team/team.controller.ts": 5,
  "apps/api/src/common/list-param.ts": 1,
};

/**
 * `@Query(...)` 直收 `string | string[]` 的裸参数（第 120 批定版）。
 * 这 4 处的封顶分别在：`tasks` → `parseListParam(ids, …)`；
 * `auth` → `settingsKeys` → `parseListParam(raw, "keys", …)`；
 * `team` 两处 → `listMembers` / `exportMembers` → `parseListParam(extra.role_ids, …)`。
 * 新增一处就必须先在这里登记，并按同样方式接上 helper。
 */
const RAW_QUERY_PARAM_SITES_BY_FILE: Record<string, number> = {
  "apps/api/src/modules/auth/auth.controller.ts": 1,
  "apps/api/src/modules/tasks/tasks.controller.ts": 1,
  "apps/api/src/modules/team/team.controller.ts": 2,
};

/** `modules/**` 里允许的 `.split(",")`：两处都是**启动期配置**解析，不是入站参数 */
const MODULE_CSV_SPLIT_FILES = [
  // CANVAS_DOWNLOAD_HOST_ALLOWLIST（`*.example.com` 白名单）
  "apps/api/src/modules/canvas/canvas-download.guard.ts",
  // MODERATION_WORDS（内置词 + 环境变量扩展）
  "apps/api/src/modules/moderation/moderation.service.ts",
];

interface ListSite {
  line: number;
  /** `z.array` 的链上是否有 `.max(...)`；`z.union` 恒为 false（不适用） */
  bounded: boolean;
}

interface CsvRawUse {
  line: number;
  /** 从 `csvListRaw` 到链顶的源码原文（不含注释以外的东西，AST 取文本） */
  chain: string;
}

interface FileScan {
  file: string;
  arrays: ListSite[];
  unions: ListSite[];
  csvRawUses: CsvRawUse[];
  /** `.split(",")` 次数（只认字面量逗号） */
  commaSplits: number;
  /** `@Query(...) x?: string | string[]` 参数个数 */
  rawQueryParams: number;
}

const isZCall = (node: ts.Node, name: string): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "z" &&
  node.expression.name.text === name;

/** 参数类型恰好是 `string | string[]`（两种顺序都认） */
function isStringOrStringArray(type: ts.TypeNode): boolean {
  if (!ts.isUnionTypeNode(type) || type.types.length !== 2) return false;
  const isString = (t: ts.TypeNode): boolean => t.kind === ts.SyntaxKind.StringKeyword;
  const isStringArray = (t: ts.TypeNode): boolean =>
    ts.isArrayTypeNode(t) && isString(t.elementType);
  return (isString(type.types[0]!) && isStringArray(type.types[1]!)) ||
    (isStringArray(type.types[0]!) && isString(type.types[1]!));
}

function hasQueryDecorator(param: ts.ParameterDeclaration): boolean {
  const decorators = ts.canHaveDecorators(param) ? ts.getDecorators(param) : undefined;
  return (decorators ?? []).some((d) => {
    const expr = d.expression;
    return (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "Query"
    );
  });
}

/** 扫描一段源码里的列表形入站形状；纯函数，自测与真树扫描共用 */
function scanSource(file: string, source: string): FileScan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  /** 沿调用 / 属性链向上，判断链上有没有 `.max(...)` */
  const chainHasMax = (node: ts.Node): boolean => {
    let cur = node;
    for (let i = 0; i < 40; i += 1) {
      const parent = cur.parent as ts.Node | undefined;
      if (!parent) return false;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === cur) {
        if (parent.name.text === "max") return true;
        cur = parent;
        continue;
      }
      if (ts.isCallExpression(parent) && parent.expression === cur) {
        cur = parent;
        continue;
      }
      return false;
    }
    return false;
  };

  /** 从当前节点走到链顶（调用 / 属性），返回链的源码原文 */
  const chainText = (node: ts.Node): string => {
    let cur = node;
    for (let i = 0; i < 40; i += 1) {
      const parent = cur.parent as ts.Node | undefined;
      if (!parent) break;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === cur) {
        cur = parent;
        continue;
      }
      if (ts.isCallExpression(parent) && parent.expression === cur) {
        cur = parent;
        continue;
      }
      break;
    }
    return cur.getText(sf);
  };

  const scan: FileScan = {
    file,
    arrays: [],
    unions: [],
    csvRawUses: [],
    commaSplits: 0,
    rawQueryParams: 0,
  };

  const visit = (node: ts.Node): void => {
    if (isZCall(node, "array")) {
      scan.arrays.push({ line: lineOf(node), bounded: chainHasMax(node) });
    }
    if (isZCall(node, "union")) {
      const args = node.arguments[0]?.getText(sf) ?? "";
      if (args.includes("z.array(")) scan.unions.push({ line: lineOf(node), bounded: false });
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "csvListRaw" &&
      !ts.isImportSpecifier(node.parent as ts.Node)
    ) {
      scan.csvRawUses.push({ line: lineOf(node), chain: chainText(node) });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "split" &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      node.arguments[0]!.text === ","
    ) {
      scan.commaSplits += 1;
    }
    if (ts.isParameter(node) && node.type && isStringOrStringArray(node.type) && hasQueryDecorator(node)) {
      scan.rawQueryParams += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return scan;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function scanTree(): FileScan[] {
  return walk(join(APP_ROOT, SCAN_ROOT)).map((full) =>
    scanSource(relative(APP_ROOT, full).replaceAll("\\", "/"), readFileSync(full, "utf8")),
  );
}

/** 无 `.max` 的 `z.array`（helper 豁免）：`file:line` 列表 */
function unboundedArraySites(scan: FileScan): string[] {
  if (scan.file === HELPER_FILE) return [];
  return scan.arrays
    .filter((site) => !site.bounded)
    .map((site) => `${scan.file}:${site.line}`);
}

/** `z.union` 内嵌 `z.array`（helper 豁免） */
function foreignUnionSites(scan: FileScan): string[] {
  if (scan.file === HELPER_FILE) return [];
  return scan.unions.map((site) => `${scan.file}:${site.line}`);
}

/** `csvListRaw` 使用点缺 `.optional().transform` / `splitCsvList` / `tooManyListItems` 的（helper 豁免） */
function foreignCsvRawUses(scan: FileScan): string[] {
  if (scan.file === HELPER_FILE) return [];
  return scan.csvRawUses
    .filter(
      (use) =>
        !/\.optional\(\)\s*\.transform\(/.test(use.chain) ||
        !use.chain.includes("splitCsvList(") ||
        !use.chain.includes("tooManyListItems("),
    )
    .map((use) => `${scan.file}:${use.line}`);
}

describe("入站列表上限门禁（第 120 批）", () => {
  describe("扫描器自测（合成源码，不碰真实树）", () => {
    it("裸 z.array 判为无上限，并给出准确行号", () => {
      const scan = scanSource("mod.ts", 'const a = z.object({\n  tags: z.array(z.string()),\n});\n');
      expect(scan.arrays).toHaveLength(1);
      expect(scan.arrays[0]?.line).toBe(2);
      expect(scan.arrays[0]?.bounded).toBe(false);
    });

    it("数组自身的 .max 才算项数上限（单项长度的 .max 不算）", () => {
      expect(scanSource("mod.ts", "const a = z.array(z.string()).max(20);").arrays[0]?.bounded).toBe(true);
      expect(scanSource("mod.ts", "const a = z.array(z.string()).min(1).max(20).optional();").arrays[0]?.bounded).toBe(true);
      // 这一条是本扫描最容易犯的错：内层字符串的 40 是单项长度，不是项数
      expect(scanSource("mod.ts", "const a = z.array(z.string().max(40));").arrays[0]?.bounded).toBe(false);
    });

    it("z.union 只登记内嵌 z.array 的形状", () => {
      expect(scanSource("mod.ts", "const q = z.union([z.string(), z.array(z.string())]);").unions).toHaveLength(1);
      expect(scanSource("mod.ts", "const q = z.union([z.string(), z.number()]);").unions).toHaveLength(0);
    });

    it("csvListRaw 必须落在 .optional().transform 里，且链内补齐 splitCsvList + tooManyListItems", () => {
      const good = scanSource(
        "mod.ts",
        [
          "const q = csvListRaw",
          "  .optional()",
          "  .transform((v, ctx) => {",
          "    const parts = splitCsvList(v);",
          "    if (parts.length > 2) ctx.addIssue({ message: tooManyListItems(\"x\", 2) });",
          "    return parts;",
          "  });",
        ].join("\n"),
      );
      expect(good.csvRawUses).toHaveLength(1);
      expect(foreignCsvRawUses(good)).toEqual([]);

      // 只有 optional 没 transform：无上限
      expect(foreignCsvRawUses(scanSource("mod.ts", "const q = csvListRaw.optional();"))).toHaveLength(1);
      // 有 transform 但没 tooManyListItems：仍是裸 union
      const noCap = scanSource(
        "mod.ts",
        "const q = csvListRaw.optional().transform((v) => splitCsvList(v));",
      );
      expect(foreignCsvRawUses(noCap)).toHaveLength(1);
    });

    it("只认字面量逗号的 split(\",\")；其它分隔符与注释里的示例都不算", () => {
      expect(scanSource("mod.ts", 'const parts = raw.split(",");').commaSplits).toBe(1);
      expect(scanSource("mod.ts", 'const lines = raw.split("\\n");').commaSplits).toBe(0);
      expect(scanSource("mod.ts", '// raw.split(",") 的示例\nconst s = "raw.split(\',\')";').commaSplits).toBe(0);
    });

    it("@Query 直收 string | string[] 才计入裸参数（无装饰器 / 单 string 都不算）", () => {
      expect(
        scanSource("mod.ts", 'class A { m(@Query("ids") ids?: string | string[]) {} }').rawQueryParams,
      ).toBe(1);
      expect(
        scanSource("mod.ts", 'class A { m(@Query("ids") ids?: string) {} }').rawQueryParams,
      ).toBe(0);
      expect(scanSource("mod.ts", "class A { m(ids?: string | string[]) {} }").rawQueryParams).toBe(0);
    });

    it("helper 文件是唯一豁免点：同样的源码放进 modules 就要红", () => {
      const source = 'const u = z.union([z.string(), z.array(z.string())]);\nconst q = csvListRaw;';
      const helper = scanSource(HELPER_FILE, source);
      expect(unboundedArraySites(helper)).toEqual([]);
      expect(foreignUnionSites(helper)).toEqual([]);
      expect(foreignCsvRawUses(helper)).toEqual([]);

      const foreign = scanSource("apps/api/src/modules/x.ts", source);
      expect(unboundedArraySites(foreign)).toEqual(["apps/api/src/modules/x.ts:1"]);
      expect(foreignUnionSites(foreign)).toEqual(["apps/api/src/modules/x.ts:1"]);
      expect(foreignCsvRawUses(foreign)).toEqual(["apps/api/src/modules/x.ts:2"]);
    });
  });

  describe("真实树", () => {
    const scans = scanTree();
    const totalArrays = scans.reduce((sum, scan) => sum + scan.arrays.length, 0);

    it("扫描覆盖面：至少 200 个生产 .ts 文件（少扫 = 门禁失效）", () => {
      expect(scans.length).toBeGreaterThanOrEqual(200);
    });

    it("每一处 z.array 都有 .max 上限（helper 除外，逐处报文件:行）", () => {
      const offenders = scans.flatMap(unboundedArraySites);
      expect(offenders).toEqual([]);
    });

    it("z.array 站点总数与逐文件分布与登记表一致（新增/挪动必须显式登记）", () => {
      const actual: Record<string, number> = {};
      for (const scan of scans) {
        if (scan.arrays.length > 0) actual[scan.file] = scan.arrays.length;
      }
      expect(actual).toEqual(ARRAY_SITES_BY_FILE);
      expect(totalArrays).toBe(93);
    });

    it("z.union 内嵌 z.array 全局只剩 helper 一处（别处出现 = 绕过 helper 裸造列表）", () => {
      expect(scans.flatMap(foreignUnionSites)).toEqual([]);
      const helper = scans.find((scan) => scan.file === HELPER_FILE);
      expect(helper?.unions).toHaveLength(1);
    });

    it("csvListRaw 的每个使用点都在 transform 里补齐了上限", () => {
      expect(scans.flatMap(foreignCsvRawUses)).toEqual([]);
      const knowledge = scans.find((scan) => scan.file.endsWith("knowledge.controller.ts"));
      expect(knowledge?.csvRawUses).toHaveLength(1);
    });

    it("modules/** 里不再有手写 split(\",\")，只剩两处启动期配置解析", () => {
      const offenders = scans
        .filter((scan) => scan.file.startsWith("apps/api/src/modules/") && scan.commaSplits > 0)
        .map((scan) => scan.file);
      expect(offenders.sort()).toEqual([...MODULE_CSV_SPLIT_FILES].sort());
    });

    it("@Query 直收 string | string[] 的裸参数只剩登记过的 3 个文件 4 处", () => {
      const actual: Record<string, number> = {};
      for (const scan of scans) {
        if (scan.rawQueryParams > 0) actual[scan.file] = scan.rawQueryParams;
      }
      expect(actual).toEqual(RAW_QUERY_PARAM_SITES_BY_FILE);
      expect(Object.values(actual).reduce((a, b) => a + b, 0)).toBe(4);
    });

    it("各入口确实接到了封顶（逐处文本核对，改一处必须改这里）", () => {
      const wiring: Array<{ file: string; expect: string[] }> = [
        {
          file: "apps/api/src/modules/tasks/tasks.controller.ts",
          expect: ['parseListParam(ids, "ids", MAX_ID_ITEMS)'],
        },
        {
          file: "apps/api/src/modules/team/team.service.ts",
          expect: ['parseListParam(extra.role_ids, "role_ids", MAX_ID_ITEMS)'],
        },
        {
          file: "apps/api/src/modules/auth/auth.service.ts",
          expect: ['parseListParam(raw, "keys", MAX_TAG_ITEMS)'],
        },
        {
          file: "apps/api/src/modules/script/script.controller.ts",
          expect: ['parseListParam(q.project_categories, "project_categories", MAX_TAG_ITEMS)'],
        },
        {
          file: "apps/api/src/modules/knowledge/knowledge.controller.ts",
          expect: [
            'csvListQuery("tags", MAX_TAG_ITEMS)',
            "csvListRaw",
            'tooManyListItems("sp_type", MAX_TAG_ITEMS)',
          ],
        },
        {
          file: "apps/api/src/modules/op/op.controller.ts",
          expect: ['csvListQuery("experiment_keys", MAX_TAG_ITEMS)'],
        },
        {
          file: "apps/api/src/modules/canvas/canvas-group.controller.ts",
          expect: [".max(MAX_PIN_SLOTS)"],
        },
        {
          file: "apps/api/src/modules/canvas/canvas.controller.ts",
          expect: [".max(MAX_PIN_SLOTS)"],
        },
        {
          file: "apps/api/src/modules/generations/generations.controller.ts",
          expect: [".max(SLICE_COUNT_MAX)"],
        },
      ];
      for (const { file, expect: snippets } of wiring) {
        const source = readFileSync(join(APP_ROOT, file), "utf8");
        for (const snippet of snippets) {
          expect(source, `${file} 缺 ${snippet}`).toContain(snippet);
        }
      }
    });

    it("上限值与仓库既有业务尺度一致（20 / 100 / 7 / 50）", () => {
      const helper = readFileSync(join(APP_ROOT, HELPER_FILE), "utf8");
      expect(helper).toContain("export const MAX_TAG_ITEMS = 20;");
      expect(helper).toContain("export const MAX_ID_ITEMS = 100;");

      const canvasGroup = readFileSync(
        join(APP_ROOT, "apps/api/src/modules/canvas/canvas-group.service.ts"),
        "utf8",
      );
      expect(canvasGroup).toContain("export const MAX_PIN_SLOTS = 7;");

      const slicing = readFileSync(join(APP_ROOT, "packages/model-adapters/src/slicing.ts"), "utf8");
      expect(slicing).toContain("export const SLICE_COUNT_MAX = 50;");
    });
  });
});
