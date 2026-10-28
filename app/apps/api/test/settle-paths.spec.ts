import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const API_SRC = join(__dirname, "..", "src");
const WORKER_SRC = join(__dirname, "..", "..", "worker", "src");

/** 把注释剥掉（保留行号），避免注释里的字符串被当成代码 —— 第 100 批踩过的坑 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      if (s.includes("*/")) {
        s = s.slice(s.indexOf("*/") + 2);
        inBlock = false;
      } else {
        out.push("");
        continue;
      }
    }
    if (s.includes("/*")) {
      const before = s.slice(0, s.indexOf("/*"));
      const after = s.slice(s.indexOf("/*") + 2);
      if (after.includes("*/")) {
        s = before + after.slice(after.indexOf("*/") + 2);
      } else {
        s = before;
        inBlock = true;
      }
    }
    if (s.includes("//")) s = s.slice(0, s.indexOf("//"));
    out.push(s);
  }
  return out.join("\n");
}

function walk(dir: string, suffix = ".ts"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...walk(p, suffix));
    } else if (name.endsWith(suffix)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 第 101 批：**双重结算的隐式约定**必须有守卫。
 *
 * 背景：`settleCredits` 有两个调用点，代表两条互斥的结算路径：
 *   1. worker `executor.ts` —— 消费队列里的任务，成功后按 `tasks.creditsFrozen` 结算；
 *   2. `ad-drama.service.ts` —— 在 API 进程内**同步**跑完并结算。
 *
 * 两者不会重复结算，靠的是**一个隐式约定**：
 *   - 会进队列的任务，建的时候 status = `PENDING(1)`，由 worker 结算；
 *   - ad-drama 的任务 status = `RUNNING(2)` 且**从不入队**，由自己结算。
 *
 * 这个约定此前**没有任何断言**。如果哪天有人把 ad-drama 改成 `PENDING`（看起来更"标准"），
 * 或者给它加一句 `enqueueTask`，就会出现「同一笔冻结被结算两次」——
 * 表现为 `settleCredits` 的 `frozen balance underflow` 或账目对不上，
 * 而这在单测里很难自然暴露（需要 worker 与 API 同时跑）。
 */
describe("结算路径互斥：PENDING+入队 vs RUNNING+不同步结算（第 101 批守卫）", () => {
  const apiFiles = walk(API_SRC);
  const workerFiles = walk(WORKER_SRC).filter((p) => !p.endsWith(".spec.ts"));

  const read = (p: string) => stripComments(readFileSync(p, "utf8"));

  it("ad-drama 的生成任务必须是 RUNNING 且**不入队**（否则会与 worker 双重结算）", () => {
    const adPath = apiFiles.find((p) => p.endsWith("ad-drama.service.ts"));
    expect(adPath, "ad-drama.service.ts not found").toBeTruthy();
    const ad = read(adPath!);

    // 1) 建任务时 status 必须是 RUNNING(2)，不是 PENDING(1)
    expect(ad).toMatch(/status:\s*TASK_STATUS\.RUNNING/);
    expect(ad).not.toMatch(/status:\s*TASK_STATUS\.PENDING/);

    // 2) 它自己 settle（同步路径），证明它是「自己负责结算」的那一类
    expect(ad).toMatch(/\bsettleCredits\s*\(/);

    // 3) 它**绝不能**把任务塞进队列 —— 一旦入队，worker 也会去结算同一个 task
    expect(ad).not.toMatch(/enqueueTask\s*\(/);
    expect(ad).not.toMatch(/submitQueue\s*\.\s*add\s*\(/);
  });

  it("走队列的链路必须是 PENDING + 入队（worker 只认队列，不扫表）", () => {
    // 抽样两条主链：generations / 分镜批量
    //
    // 注意各链路写法不同：`generations` 写成字面量 `status: 1`，
    // `script` 分镜批量写成 `TaskStatus.PENDING` —— 两者都是 PENDING(1)。
    // 断言必须两种都认，否则会把「写法差异」误判成「约定被破坏」。
    const genPath = apiFiles.find((p) => p.endsWith("generations.service.ts"));
    expect(genPath).toBeTruthy();
    const gen = read(genPath!);
    expect(gen).toMatch(/status:\s*(1|TaskStatus\.PENDING)\b/);
    expect(gen).toMatch(/enqueueTask\s*\(/);

    const scriptPath = apiFiles.find((p) => p.endsWith("script.service.ts"));
    expect(scriptPath).toBeTruthy();
    const script = read(scriptPath!);
    // 分镜批量里建的是 PENDING，并在事务外入队
    expect(script).toMatch(/status:\s*(1|TaskStatus\.PENDING)\b[\s\S]{0,400}?creditsFrozen/);
    expect(script).toMatch(/enqueueTask\s*\(/);
  });

  it("worker 侧不按 status 扫表取任务（只消费队列）", () => {
    // 若 worker 改成「扫 PENDING 表」，ad-drama 的 RUNNING 任务虽仍安全，
    // 但 generations 的任务可能被队列与扫描各领一次 —— 这条断言钉住「只吃队列」
    const executor = workerFiles.find((p) => p.endsWith("executor.ts"));
    expect(executor).toBeTruthy();
    const ex = read(executor!);
    // executor 里对 tasks 的查询只用于行锁与更新，不应带 `status = PENDING` 的拾取语义
    expect(ex).not.toMatch(/eq\(tasks\.status,\s*TaskStatus\.PENDING\)/);
  });

  it("settleCredits 的调用点只有两处（worker + ad-drama），新增时必须同步本守卫", () => {
    const settlleSites: string[] = [];
    for (const p of [...apiFiles, ...workerFiles]) {
      const code = read(p);
      const n = (code.match(/\bsettleCredits\s*\(/g) ?? []).length;
      for (let i = 0; i < n; i += 1) settlleSites.push(p.split(/[\\/]/).pop()!);
    }
    // 两条结算路径 = 两个文件各 1 处；新增第三条路径意味着要重新论证互斥性
    expect(settlleSites.sort()).toEqual(["ad-drama.service.ts", "executor.ts"]);
  });
});
