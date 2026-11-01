import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 连接池「只有一个入口」静态守卫（第 121 批）。
 *
 * ## 为什么需要它
 * 四道闸（`client.ts` 的 `DB_LIMITS`）只对**经由 `createDb` 建出来的池**生效。
 * 只要有人在别处 `new Pool(...)`、或直接 `import { Pool } from "pg"` 自己建连接，
 * 那几条路径就重新变成「无限等」，而且类型检查 / lint / 构建 / 总闸全绿——
 * 与第 120 批「同一语义两个入口两个尺度」是同一类缺陷。这里把入口数量钉死：
 * - 全仓生产代码里 `new Pool(` / `new Client(` 只能出现在 `packages/db/src/client.ts`；
 * - `pg` 与 `drizzle-orm/node-postgres` 的 import 也只能出现在该文件；
 * - `createDb(` 的调用点只能有两个运行时入口（api `database.ts`、worker `main.ts`），
 *   新增者必须来这张登记表报到，而不是自己开池。
 *
 * ## 诚实边界
 * - 只看 `apps/<app>/src` 与 `packages/<pkg>/src` 下的 `.ts`（跳过 `*.spec.ts` 与 `dist/`），
 *   所以测试里自建池不受约束；`scripts/`、`docs/` 不在扫描面内（它们不是运行时）。
 * - 是文本匹配，不是 AST：注释里写 `new Pool(` 会误报（当前仓库没有）；
 *   别名导入（`import { Pool as P } from "pg"`）也躲不过规则 2，因为规则 2 只认 `from "pg"`。
 * - 不证明池「配置正确」，只证明「入口唯一」；数值正确性由 `db-limits.spec.ts` 的整对象
 *   相等断言负责，真实服务端行为由 `apps/api/test/db-limits.spec.ts` 的 `pg_settings` 证明。
 */
const REPO_MARKER = join("apps", "api", "drizzle", "meta", "_journal.json");

function findRepoRoot(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, REPO_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `找不到 ${REPO_MARKER}（从 ${process.cwd()} 向上 8 层）；静态守卫无法定位仓库根`,
  );
}

const ROOT = findRepoRoot();

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(ROOT, group), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, group, e.name, "src")))
    .flatMap((e) => walk(join(ROOT, group, e.name, "src"))),
);

const rel = (file: string): string => relative(ROOT, file).split("\\").join("/");
const read = (file: string): string => readFileSync(file, "utf8");

/** 每个文件里匹配次数 > 0 的分布（与第 120 批同风格：逐文件分布，不是总数） */
function distribution(pattern: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of SOURCE_FILES) {
    const hits = read(file).match(pattern)?.length ?? 0;
    if (hits > 0) found[rel(file)] = hits;
  }
  return found;
}

const POOL_SITES = /\bnew\s+(?:pg\.)?(?:Pool|Client)\s*\(/g;
const PG_IMPORTS = /\bfrom\s+["']pg["']|\brequire\(\s*["']pg["']\s*\)/g;
const DRIZZLE_PG_IMPORTS = /\bfrom\s+["']drizzle-orm\/node-postgres["']/g;
const CREATE_DB_CALLS = /\bcreateDb\s*\(/g;
const CREATE_DB_DECL = /\bfunction\s+createDb\s*\(/g;

describe("连接池唯一入口（静态）", () => {
  it("扫描面非空：apps/*/src + packages/*/src 的 .ts（不含 *.spec.ts）", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(250);
    const paths = SOURCE_FILES.map(rel);
    expect(paths).toContain("packages/db/src/client.ts");
    expect(paths.every((p) => p.endsWith(".ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".spec.ts"))).toBe(false);
    expect(paths.some((p) => p.includes("/dist/"))).toBe(false);
  });

  it("new Pool( / new Client( 只允许出现在 packages/db/src/client.ts", () => {
    expect(distribution(POOL_SITES)).toEqual({ "packages/db/src/client.ts": 1 });
  });

  it("pg 只允许被 packages/db/src/client.ts 导入（否则可绕过四道闸）", () => {
    expect(distribution(PG_IMPORTS)).toEqual({ "packages/db/src/client.ts": 1 });
  });

  it("drizzle-orm/node-postgres 只允许出现在 packages/db/src/client.ts", () => {
    expect(distribution(DRIZZLE_PG_IMPORTS)).toEqual({ "packages/db/src/client.ts": 1 });
  });

  it("createDb( 的运行时调用点只有两个入口（新入口必须来登记）", () => {
    const calls: Record<string, number> = {};
    for (const file of SOURCE_FILES) {
      const text = read(file);
      const total = text.match(CREATE_DB_CALLS)?.length ?? 0;
      const declarations = text.match(CREATE_DB_DECL)?.length ?? 0;
      const used = total - declarations;
      if (used > 0) calls[rel(file)] = used;
    }
    expect(calls).toEqual({
      "apps/api/src/db/database.ts": 1,
      "apps/worker/src/main.ts": 1,
    });
  });

  it("两个运行时入口都从 @app/db 取 createDb（不是同名本地函数）", () => {
    for (const file of ["apps/api/src/db/database.ts", "apps/worker/src/main.ts"]) {
      expect(read(join(ROOT, file))).toMatch(/import\s*\{[^}]*\bcreateDb\b[^}]*\}\s*from\s*["']@app\/db["']/s);
    }
  });
});

describe("扫描器自测", () => {
  const count = (pattern: RegExp, text: string): number => text.match(pattern)?.length ?? 0;

  it("认得 new Pool( / new pg.Pool( / new Client(", () => {
    const text = "const a = new Pool({}); const b = new pg.Pool({}); const c = new Client({});";
    expect(count(POOL_SITES, text)).toBe(3);
  });

  it("不会把 new PoolBuilder( 之类误认成连接池", () => {
    expect(count(POOL_SITES, "new PoolBuilder(); new ClientPool();")).toBe(0);
  });

  it("认得 from \"pg\" 与 require('pg')，但不认 from \"pg-pool\"", () => {
    const text = `import { Pool } from "pg"; const p = require('pg'); import x from "pg-pool";`;
    expect(count(PG_IMPORTS, text)).toBe(2);
  });

  it("声明行不会被算成调用点", () => {
    const text = "export function createDb(a: string) { return a; }\nconst x = createDb(dsn);";
    expect(count(CREATE_DB_CALLS, text) - count(CREATE_DB_DECL, text)).toBe(1);
  });
});