import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `.env.example` 可见性守卫（第 117 批）。
 *
 * ## 为什么需要它
 * 第 117 批用新审计类（「幽灵开关」：有声明/有文档、却没人读，或反之）扫了一遍，
 * 结论是**没有**真正的死开关，但发现了一个更隐蔽的自相矛盾：
 * `apps/api/src/config/env.ts` 对 OAUTH_* / CAPTCHA_ENFORCE / FILM_NOTIFY_* 明写
 * 「此处登记只为可发现性」，而运维真正会复制的那份 `apps/api/.env.example` 里
 * 一个都没有；worker 的 10 个运维旋钮（并发/轮询/看门狗/停机）同样只存在于代码默认值。
 * 「代码里有」不等于「运维能发现」—— 后者才是这份文件存在的理由。
 *
 * ## 断什么
 * 1. `apps/api/.env.example` 覆盖 `envSchema` 的**全部键**（schema 是 API 的配置契约）；
 * 2. 每个有 `src` 且读 `process.env` 的 app，其读取的每个变量都在**自己**的示例文件里；
 * 3. `packages/*` 的读取（雪花位、存储等共享配置）至少在某个示例文件里可见；
 * 4. 扫描器**会读注释行**——示例文件几乎全是 `# VAR=value`，只匹配裸赋值会得到一堆假阳性；
 * 5. 豁免名单不腐化：名单里的变量必须「仍未被写入示例文件」且「仍被生产代码读取」。
 *
 * ## 不做什么（诚实边界）
 * - 只看**键是否出现**，不看说明写得对不对、默认值是否与代码一致；
 * - 不覆盖 web 的 `import.meta.env.VITE_*`（构建期注入，与 node 进程的 env 语义不同）；
 * - 不校验动态键（`process.env[key]`）—— 这种写法本身就是配置可发现性的敌人。
 */

const APP_ROOT = join(__dirname, "..", "..", "..");
const API_EXAMPLE = join(APP_ROOT, "apps", "api", ".env.example");
const ENV_TS = join(APP_ROOT, "apps", "api", "src", "config", "env.ts");

/** 点号与方括号两种读法都算 */
const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;

/**
 * 仅测试夹具使用、**故意**不写进示例文件的变量。
 * 正常应保持为空：测试专用变量应留在 `*.spec.ts` 里（本守卫已排除 spec 文件），
 * 一旦有人往这里加，下面的「不腐化」用例会拦住过期条目。
 */
const ALLOWED_UNDOCUMENTED: ReadonlySet<string> = new Set([]);

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 递归收集生产源码（跳过 node_modules/dist，排除 spec/test/声明文件） */
function collectSources(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      found.push(...collectSources(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !/\.(spec|test)\.ts$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }
  return found;
}

/** 每个变量 → 读取它的源文件（失败信息里要能直接指到人） */
function readEnvNames(files: readonly string[]): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(ENV_READ)) {
      const name = match[1] ?? match[2];
      const where = reads.get(name) ?? [];
      if (!where.includes(file)) where.push(file);
      reads.set(name, where);
    }
  }
  return reads;
}

/**
 * 示例文件里「登记」过的变量名。
 *
 * 必须先剥掉行首注释：仓库里的示例几乎全部写成 `# VAR=value`（只写默认值不写实例值），
 * 直接用 `/^([A-Z_]+)=/` 会把 100+ 个已登记变量误判成缺口。
 */
function documentedIn(examplePath: string): Set<string> {
  const names = new Set<string>();
  for (const line of readFileSync(examplePath, "utf8").split(/\r?\n/)) {
    const stripped = line.replace(/^\s*#+\s*/, "");
    for (const match of stripped.matchAll(/([A-Z][A-Z0-9_]*)=/g)) names.add(match[1]);
  }
  return names;
}

function examplePaths(): string[] {
  const paths: string[] = [];
  for (const group of ["apps", "packages"] as const) {
    for (const entry of readdirSync(join(APP_ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(APP_ROOT, group, entry.name, ".env.example");
      if (existsSync(candidate)) paths.push(candidate);
    }
  }
  return paths;
}

function schemaKeys(): string[] {
  const text = readFileSync(ENV_TS, "utf8");
  const start = text.indexOf("const envSchema = z.object({");
  expect(start, "env.ts 里找不到 envSchema 定义（解析器需要跟着重构）").toBeGreaterThan(-1);
  const end = text.indexOf("\n});", start);
  expect(end, "envSchema 块没有以行首 `});` 结束（解析器需要跟着重构）").toBeGreaterThan(start);
  return [...text.slice(start, end).matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

const format = (names: readonly string[], reads?: Map<string, string[]>) =>
  names
    .map((name) => {
      const where = reads?.get(name);
      return where ? `${name}（读于 ${where.map((f) => f.replace(APP_ROOT, "")).join(", ")}）` : name;
    })
    .join("\n  ");

describe(".env.example 可见性（第 117 批）", () => {
  it("apps/api/.env.example 覆盖 envSchema 的每个键", () => {
    const keys = schemaKeys();
    // 解析器自检：结构性失败会让下面的断言在空集合上无条件通过
    expect(keys.length).toBeGreaterThanOrEqual(50);

    const documented = documentedIn(API_EXAMPLE);
    const missing = keys.filter((key) => !documented.has(key)).sort();
    expect(missing, `schema 里声明但示例文件里看不到：\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("每个 app 读到的变量都在自己的示例文件里", () => {
    const apps = readdirSync(join(APP_ROOT, "apps"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const app of apps) {
      const reads = readEnvNames(collectSources(join(APP_ROOT, "apps", app, "src")));
      if (reads.size === 0) continue;

      const example = join(APP_ROOT, "apps", app, ".env.example");
      expect(existsSync(example), `${app} 读 ${reads.size} 个环境变量，却没有 .env.example`).toBe(
        true,
      );
      const documented = documentedIn(example);
      const missing = [...reads.keys()]
        .filter((name) => !documented.has(name) && !ALLOWED_UNDOCUMENTED.has(name))
        .sort();
      expect(missing, `${app} 未登记的变量：\n  ${format(missing, reads)}`).toEqual([]);
    }
  });

  it("packages/* 的读取至少在某个示例文件里可见", () => {
    const packages = readdirSync(join(APP_ROOT, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const reads = new Map<string, string[]>();
    for (const pkg of packages) {
      for (const [name, where] of readEnvNames(
        collectSources(join(APP_ROOT, "packages", pkg, "src")),
      )) {
        reads.set(name, [...(reads.get(name) ?? []), ...where]);
      }
    }

    const documented = new Set(examplePaths().flatMap((path) => [...documentedIn(path)]));
    const missing = [...reads.keys()]
      .filter((name) => !documented.has(name) && !ALLOWED_UNDOCUMENTED.has(name))
      .sort();
    expect(
      missing,
      `共享包读取但所有示例文件都没写（运维复制不到）：\n  ${format(missing, reads)}`,
    ).toEqual([]);
  });

  it("扫描器会读注释行里的占位（否则已登记会被误判成缺口）", () => {
    const worker = documentedIn(join(APP_ROOT, "apps", "worker", ".env.example"));
    // 这两项在仓库里只以注释形式出现过
    expect(worker.has("ARK_IMAGE_TIMEOUT_MS")).toBe(true);
    expect(documentedIn(API_EXAMPLE).has("OAUTH_APPLE_KEY_ID")).toBe(true);
    // 反向自检：不存在的名字不能被凭空扫出来
    expect(worker.has("NOT_A_REAL_ENV_VAR")).toBe(false);
  });

  it("豁免名单不腐化：每个豁免项都仍是真缺口", () => {
    const documented = new Set(examplePaths().flatMap((path) => [...documentedIn(path)]));
    const reads = new Set(readEnvNames(collectSources(join(APP_ROOT, "apps"))).keys());
    for (const pkg of readdirSync(join(APP_ROOT, "packages"), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const name of readEnvNames(
        collectSources(join(APP_ROOT, "packages", pkg.name, "src")),
      ).keys()) {
        reads.add(name);
      }
    }

    for (const name of ALLOWED_UNDOCUMENTED) {
      expect(documented.has(name), `${name} 已写进示例文件，可从豁免名单移除`).toBe(false);
      expect(reads.has(name), `${name} 已不再被读取，可从豁免名单移除`).toBe(true);
    }
  });
});