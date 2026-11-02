import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 门禁：生产代码里**每一处直写的 `fetch()` 都必须带时间上限**，且不得用
 * `res.arrayBuffer()` 无上限地读二进制 body（第 119 批）。
 *
 * 为什么需要它（先量的事实）：
 * - `fetch()` 自己没有超时。第 119 批之前有 3 处裸 `fetch(uri)` + `arrayBuffer()`：
 *   worker `export.ts`（整集导出读产物）、worker `timeline-export.ts`（读 clip 源）、
 *   CLI `runtime.ts`（`task download` 落盘）。供应商 CDN 只要「连上但不发完」，
 *   导出/下载就永远挂着；只要「发 4GB」，进程就 OOM —— 而类型检查、lint、构建、
 *   总闸都不会红，因为这三处语法完全合法、测试也没覆盖远程分支。
 * - 仓库里已有的正确处理分散在三处（canvas 200MiB 流式、storage 三层超时、
 *   executor 5 分钟），说明大家知道要设上限，缺的是「以后每一处都记得」的机械检查。
 *
 * 做法：只读扫描（不联网、不启动服务）——
 *   1. 覆盖 `apps/api/src`、`apps/worker/src`、`apps/cli/src`、`packages/{shared,
 *      model-adapters,storage,db}/src`，跳过 `node_modules` / `dist` / `*.spec.ts`；
 *   2. 先把注释与 `'` `"` `` ` `` 字面量抹成空格（保留换行，行号仍准），
 *      避免把注释里的示例、字符串里的 "fetch(" 当成调用点；
 *   3. 抓「前面不是字母/数字/`$`/`.` 的 `fetch(`」，按括号配平取出实参，判定上限：
 *      实参里有 `AbortSignal.timeout(` / `AbortSignal.any(`，或
 *      `signal: <ident>.signal` 且同文件里出现 `<ident>.abort(`（同文件是宽松的，
 *      但足以区分「传了信号」与「传了个永不会 abort 的控制器」）。
 *
 * 覆盖边界（诚实说明）：
 * - 只认裸 `fetch` 标识符。`client.fetch(` 这类成员调用由下面的
 *   「成员调用数 = 0」断言单独盯住（当前仓库为 0；将来出现会红，逼改用 `fetch` 或登记）。
 * - 只保证「有超时机制」，不校验超时值是否合理（10ms 与 10min 都算通过）；
 *   也不校验信号真的覆盖了 body 读取 —— 这一点由 `downloadBounded` 的单测覆盖，
 *   二进制下载另由「不得用 `arrayBuffer()`」断言兜底。
 * - 不覆盖模板字面量 `${...}` 里的调用（整体被抹空），也不覆盖动态 `import("node:http")`
 *   之类的手写请求；当前仓库没有这类代码（见 `http-video.ts`/`oauth.service.ts` 均走 fetch）。
 */

const APP_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "apps/cli/src",
  "packages/shared/src",
  "packages/model-adapters/src",
  "packages/storage/src",
  "packages/db/src",
];

/**
 * 调用点分布（第 119 批定版）。数字变了就说明新增/挪动了出站调用点，
 * 必须在这里显式登记 —— 这是本门禁的主要价值：让「又加了一处下载」成为一次可见的评审决定。
 *
 * 第 119 批改造后：
 *   - worker `export.ts` / `timeline-export.ts` / `executor.ts` 的下载改走
 *     `@app/shared` 的 `downloadBounded`（三处裸 fetch 消失）；
 *   - CLI `runtime.ts` 的 `task download` 内联同一套双上限（CLI 保持零运行时依赖，
 *     不能 import shared），仍是裸 fetch + `AbortSignal.timeout`；
 *   - 其余 6 处 API 调用原本就有超时；
 *   - 第 125 批：model-adapters 的 deepseek / ark-image / ark-video / postprocess / http-video
 *     五份手写传输收口到 `vendor-http.ts`，裸 fetch 从 5 处降到 1 处（且带 signal）。
 */
const SITES_BY_FILE: Record<string, number> = {
  "apps/api/src/modules/agent/agent-stt.service.ts": 1,
  "apps/api/src/modules/auth/apple-id-token.ts": 1,
  "apps/api/src/modules/auth/oauth.service.ts": 2,
  "apps/api/src/modules/canvas/canvas-download.guard.ts": 1,
  "apps/api/src/modules/film/film-notify.service.ts": 1,
  "apps/cli/src/runtime.ts": 2,
  "packages/model-adapters/src/vendor-http.ts": 1,
};

interface FetchSite {
  /** 1 起的行号（相对源文件） */
  line: number;
  /** 实参原文（已抹掉注释与字面量） */
  args: string;
  bounded: boolean;
  /** 命中的上限形式，便于红的时候直接看出缺什么 */
  how: string;
}

/** 把注释与字符串/模板字面量抹成空格；位置与原文一一对应（换行保留） */
function skeleton(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      blank(i, j);
      i = j;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

const ABORT_SIGNAL_CALL = /AbortSignal\.(?:timeout|any)\s*\(/;
const SIGNAL_PROP = /\bsignal\s*:\s*([A-Za-z_$][\w$]*)\s*\.\s*signal\b/;

/** 扫描一段源码里的裸 `fetch(` 调用点；纯函数，自测与真树扫描共用 */
function scanSource(source: string): FetchSite[] {
  const code = skeleton(source);
  const sites: FetchSite[] = [];
  const re = /(?<![\w$.])fetch\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code))) {
    const open = code.indexOf("(", match.index);
    let depth = 0;
    let k = open;
    for (; k < code.length; k += 1) {
      if (code[k] === "(") depth += 1;
      else if (code[k] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const args = code.slice(open + 1, k);
    let bounded = false;
    let how = "无上限";
    if (ABORT_SIGNAL_CALL.test(args)) {
      bounded = true;
      how = "AbortSignal";
    } else {
      const ctrl = SIGNAL_PROP.exec(args);
      if (ctrl && new RegExp(`\\b${ctrl[1]}\\s*\\.\\s*abort\\s*\\(`).test(code)) {
        bounded = true;
        how = `${ctrl[1]}.abort()`;
      }
    }
    sites.push({ line: source.slice(0, match.index).split("\n").length, args, bounded, how });
  }
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mts)$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

interface FileScan {
  file: string;
  sites: FetchSite[];
  /** 无上限地整块读二进制 body 的次数 */
  rawArrayBuffer: number;
  /** 成员风格的 fetch 调用（`x.fetch(`），当前应为 0 */
  memberFetch: number;
}

function scanTree(): FileScan[] {
  const results: FileScan[] = [];
  for (const rel of SCAN_ROOTS) {
    for (const full of walk(join(APP_ROOT, rel))) {
      const source = readFileSync(full, "utf8");
      const code = skeleton(source);
      results.push({
        file: relative(APP_ROOT, full).replaceAll("\\", "/"),
        sites: scanSource(source),
        rawArrayBuffer: (code.match(/\.\s*arrayBuffer\s*\(/g) ?? []).length,
        memberFetch: (code.match(/\.\s*fetch\s*\(/g) ?? []).length,
      });
    }
  }
  return results;
}

describe("出站 fetch 上限门禁（第 119 批）", () => {
  describe("扫描器自测（合成源码，不碰真实树）", () => {
    it("裸 fetch：判为无上限，并给出准确行号", () => {
      const sites = scanSource('const a = 1;\nconst res = await fetch("https://x.test/a");\n');
      expect(sites).toHaveLength(1);
      expect(sites[0]?.line).toBe(2);
      expect(sites[0]?.bounded).toBe(false);
      expect(sites[0]?.how).toBe("无上限");
    });

    it("AbortSignal.timeout / AbortSignal.any 视为有上限", () => {
      const timeoutSites = scanSource("fetch(url, { signal: AbortSignal.timeout(1000) });");
      expect(timeoutSites[0]?.bounded).toBe(true);
      expect(timeoutSites[0]?.how).toBe("AbortSignal");

      const anySites = scanSource("fetch(url, { signal: AbortSignal.any([a, b]) });");
      expect(anySites[0]?.bounded).toBe(true);
    });

    it("控制器信号：只有同文件里真的会 abort 才算有上限", () => {
      const real = scanSource(
        "const c = new AbortController();\nfetch(url, { signal: c.signal });\nsetTimeout(() => c.abort(), 10);",
      );
      expect(real[0]?.bounded).toBe(true);
      expect(real[0]?.how).toBe("c.abort()");

      const dead = scanSource("const c = new AbortController();\nfetch(url, { signal: c.signal });");
      expect(dead[0]?.bounded).toBe(false);
    });

    it("注释与字符串里的 fetch( 不算调用点（三种写法都要挡住）", () => {
      const sites = scanSource(
        ['// fetch("https://x")', "const s = 'fetch(' ;", "/* 这里写 fetch(u) 举例 */", "const t = `fetch(`;"].join("\n"),
      );
      expect(sites).toHaveLength(0);
    });

    it("只认裸 fetch：prefetch / refetch / 成员调用都不算", () => {
      const sites = scanSource("prefetch(url); refetch(url); client.fetch(url); globalThis.fetch)(url);");
      expect(sites).toHaveLength(0);
    });

    it("实参里的嵌套括号不会截断（取到的是完整实参）", () => {
      const sites = scanSource("fetch(join(base, `/${id}`), { signal: AbortSignal.timeout(5) });");
      expect(sites).toHaveLength(1);
      expect(sites[0]?.bounded).toBe(true);
    });
  });

  describe("真实树", () => {
    const scans = scanTree();
    const allSites = scans.flatMap((s) => s.sites.map((site) => ({ ...site, file: s.file })));

    it("每一处裸 fetch 都带时间上限（逐处报文件:行）", () => {
      const unbounded = allSites.filter((s) => !s.bounded).map((s) => `${s.file}:${s.line} 无上限`);
      expect(unbounded).toEqual([]);
    });

    it("调用点总数与分布与登记表一致（新增/挪动必须显式登记）", () => {
      const actual: Record<string, number> = {};
      for (const site of allSites) actual[site.file] = (actual[site.file] ?? 0) + 1;
      expect(actual).toEqual(SITES_BY_FILE);
      // 6 处 API + CLI 2 处 + model-adapters 1 处（provider 探测改用 pinned http/https，
      // worker 三处下载已改走 downloadBounded）
      expect(allSites).toHaveLength(9);
    });

    it("下载二进制不得用无上限的 arrayBuffer()（当前为 0）", () => {
      const offenders = scans.filter((s) => s.rawArrayBuffer > 0).map((s) => `${s.file} ×${s.rawArrayBuffer}`);
      expect(offenders).toEqual([]);
    });

    it("成员风格的 fetch 调用为 0（出现时请改用裸 fetch 或登记到本测试）", () => {
      const offenders = scans.filter((s) => s.memberFetch > 0).map((s) => `${s.file} ×${s.memberFetch}`);
      expect(offenders).toEqual([]);
    });

    it("共享下载实现本身自带双上限（不能自己漏了）", () => {
      const helper = readFileSync(join(APP_ROOT, "packages/shared/src/http-bounded.ts"), "utf8");
      const code = skeleton(helper);
      expect(code).toMatch(/AbortSignal\.timeout\s*\(/);
      expect(code).toMatch(/AbortSignal\.any\s*\(/);
      // 真正的调用必须把信号传下去，且只传一处（改这里要先过本测试）
      expect(code).toMatch(/globalThis\.fetch\)\(url,\s*\{\s*signal,/);
      expect(code).toMatch(/\bmaxBytes\b/);
    });
  });
});
