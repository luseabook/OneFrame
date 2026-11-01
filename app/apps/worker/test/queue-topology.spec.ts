import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HANDLED_QUEUES, QUEUES, RESERVED_QUEUES } from "../src/queues";

/**
 * 队列拓扑守卫（第 112 批，§5.6 C「队列孤儿消息」审计的落点）。
 *
 * 为什么是静态检查而不是集成测试：这些约束是**代码结构约束**——名字表在 API 与 worker
 * 各有一份、构造了哪些 Queue、给哪些队列建了 Worker、后台面板报了哪几个。起 Redis 跑一遍
 * 只能证明"此刻没消息"，证明不了"以后不会有人加一个没有处理器的队列"。这里读源码断言拓扑，
 * 任何一边改动而另一边没跟上，CI 立刻失败。
 *
 * 背景缺陷（修复前）：worker 对 7 个名字全部建 Worker，3 个没有生产者的名字落到兜底
 * `return { ok: true }`，误入消息被静默完成并删除。本用例锁死修复后的形状。
 */
function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const apiQueueSource = readSource("../../api/src/queue/queue.service.ts");
const workerMainSource = readSource("../src/main.ts");
const adminSource = readSource("../../api/src/modules/admin/admin.service.ts");

/** 从 API 侧 `export const QUEUES = {...} as const` 抽出 名字 → 值 */
function parseApiCatalog(source: string): Record<string, string> {
  const block = /export const QUEUES = \{([\s\S]*?)\} as const;/.exec(source)?.[1];
  if (block === undefined) throw new Error("API QUEUES catalog not found");
  const entries: Record<string, string> = {};
  for (const match of block.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    entries[match[1]!] = match[2]!;
  }
  return entries;
}

const apiCatalog = parseApiCatalog(apiQueueSource);
const workerCatalog = Object.fromEntries(Object.entries(QUEUES));

const allNames = Object.values(QUEUES);
const handled = new Set<string>(HANDLED_QUEUES);
const reserved = new Set<string>(RESERVED_QUEUES);

/** API 侧构造的 Queue 实例：字段名 → 常量名 */
function parseApiQueues(source: string): Array<{ field: string; key: string }> {
  return [...source.matchAll(/this\.(\w+) = new Queue\(QUEUES\.(\w+)/g)].map((match) => ({
    field: match[1]!,
    key: match[2]!,
  }));
}

const apiQueues = parseApiQueues(apiQueueSource);

describe("queue topology: catalog", () => {
  it("API 与 worker 的队列名表逐键一致（值也一致）", () => {
    expect(apiCatalog).toEqual(workerCatalog);
  });

  it("没有重复值（BullMQ 队列名即 Redis key，重名会串队列）", () => {
    expect(new Set(allNames).size).toBe(allNames.length);
  });
});

describe("queue topology: handled / reserved partition", () => {
  it("HANDLED ∪ RESERVED 恰好覆盖全部名字，且两组不相交", () => {
    expect(HANDLED_QUEUES.length + RESERVED_QUEUES.length).toBe(allNames.length);
    const union = new Set([...HANDLED_QUEUES, ...RESERVED_QUEUES]);
    expect(union.size).toBe(allNames.length);
    for (const name of allNames) expect(union.has(name)).toBe(true);
    for (const name of HANDLED_QUEUES) expect(reserved.has(name)).toBe(false);
  });

  it("API 只构造 HANDLED 里的队列，且每个构造出的队列都有生产者（.add）", () => {
    expect(apiQueues.length).toBeGreaterThan(0);
    const constructed = new Set<string>();
    for (const { field, key } of apiQueues) {
      const value = apiCatalog[key];
      expect(value, `QUEUES.${key} 不在 API 名字表里`).toBeDefined();
      expect(handled.has(value!), `API 构造了非 HANDLED 队列 ${value}`).toBe(true);
      constructed.add(value!);
      // 构造了却没有入队方法 = 只读句柄（本目录里唯一合理的只读句柄是看门狗，
      // 它在 worker 侧且另有生产者），API 侧不允许
      expect(apiQueueSource.includes(`this.${field}.add(`), `队列 ${value} 没有生产者`).toBe(true);
    }
    expect(constructed).toEqual(handled);
  });

  it("API 从不构造、也从不向 RESERVED 队列入队", () => {
    for (const value of RESERVED_QUEUES) {
      expect(apiQueueSource.includes(`"${value}"`)).toBe(true); // 名字表里保留
      expect(apiQueueSource.includes(`new Queue("${value}"`)).toBe(false);
      expect(new RegExp(`\\.add\\([\\s\\S]{0,120}?"${value}"`).test(apiQueueSource)).toBe(false);
    }
  });
});

describe("queue topology: worker wiring", () => {
  it("Worker 只从 HANDLED_QUEUES 构建，处理器表逐一覆盖", () => {
    expect(workerMainSource).toContain("HANDLED_QUEUES.map(");
    for (const key of ["GEN_SUBMIT", "EXPORT", "TIMELINE_EXPORT", "PUBLISH_TRANSCODE"]) {
      expect(workerMainSource.includes(`[QUEUES.${key}]:`), `缺少处理器 ${key}`).toBe(true);
    }
    for (const key of ["GEN_POLL", "RESULT_TRANSFER", "NOTIFY"]) {
      expect(workerMainSource.includes(`[QUEUES.${key}]:`), `RESERVED 不应有处理器 ${key}`).toBe(false);
    }
  });

  it("不再有 Object.values(QUEUES) 扇出，也没有兜底 no-op（静默吞消息）", () => {
    expect(workerMainSource.includes("Object.values(QUEUES)")).toBe(false);
    expect(workerMainSource.includes("(no-op)")).toBe(false);
    expect(/return \{ ok: true \};/.test(workerMainSource)).toBe(false);
  });

  it("publish.transcode 的看门狗重投仍然指向真实处理器", () => {
    expect(workerMainSource).toContain("QUEUES.PUBLISH_TRANSCODE");
    expect(workerMainSource).toContain("publishTranscodeQueue.add(");
  });
});

describe("queue topology: admin observability", () => {
  it("后台队列面板覆盖全部 HANDLED 队列", () => {
    for (const value of HANDLED_QUEUES) {
      expect(adminSource.includes(`"${value}"`), `后台漏报活队列 ${value}`).toBe(true);
    }
  });

  it("后台队列面板不报 RESERVED 名字（无生产者，恒为 0 只会误导）", () => {
    for (const value of RESERVED_QUEUES) {
      expect(adminSource.includes(`"${value}"`), `后台误报预留队列 ${value}`).toBe(false);
    }
  });
});