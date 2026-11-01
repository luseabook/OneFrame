import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, models, spaces, taskEvents, tasks, users } from "@app/db";
import type { ModelAdapter } from "@app/model-adapters";
import { LocalStorage } from "@app/storage";
import { newId, TaskStatus } from "@app/shared";
import { claimTaskForRun, runGenerationTask, type ExecutorDeps } from "../src/executor";

/**
 * 第 113 批：任务恢复与整条流水线心跳的回归。
 *
 * 1. **重投续接**：BullMQ 会把中断的 job 重投回来。旧实现只要任务还在
 *    PENDING/RUNNING 就重新 `adapter.submit`——供应商侧多出一个任务（重复计费），
 *    旧任务的结果永远没人取。现在 RUNNING + 已落 `vendorTaskId` 直接续接轮询。
 * 2. **结算竞态**：旧事务只挡 CANCELED 且不把结论传回外层，取消后照样 submit。
 *    现在 `claimTaskForRun` 的结论决定外层行为，三个终态都挡。
 * 3. **流水线心跳**：心跳从「只在轮询循环里」改成覆盖 submit → 轮询 → 转存 →
 *    标识 → 结算整条链路；同时下载必须有上限，否则被心跳续命的挂死任务永远 RUNNING。
 *
 * 这里用真库（与其他 worker 集成用例同口径），适配器与 fetch 是假的：
 * 断言的是「谁被调用 / 状态与事件最终是什么」，不断言供应商。
 */
const LABELS_OFF = { enabled: false, text: "" } as const;

describe("executor task recovery (第 113 批)", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let spaceId: bigint;
  let userId: bigint;
  let modelId: bigint;
  let storage: LocalStorage;
  let dir = "";

  beforeAll(async () => {
    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);
    await db.insert(users).values({ id: userId, nickname: `recovery-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    modelId = model.id;

    dir = await mkdtemp(join(tmpdir(), "executor-recovery-"));
    storage = new LocalStorage({ rootDir: dir, publicBaseUrl: "https://cdn.test/v1", signSecret: "test-secret" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await db.execute(sql`delete from task_events where task_id in (select id from tasks where space_id = ${spaceId})`);
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  async function createTask(opts: {
    status?: number;
    vendorTaskId?: string;
    input?: Record<string, unknown>;
  }): Promise<bigint> {
    const id = newId();
    await db.insert(tasks).values({
      id,
      spaceId,
      userId,
      capability: "video",
      mode: "text2video",
      modelId,
      input: opts.input ?? { prompt: "recovery" },
      options: {},
      status: opts.status ?? TaskStatus.PENDING,
      vendorTaskId: opts.vendorTaskId ?? null,
      creditsFrozen: 0,
    });
    return id;
  }

  async function readTask(id: bigint) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    return row;
  }

  async function readEvents(id: bigint) {
    const rows = await db.select().from(taskEvents).where(eq(taskEvents.taskId, id));
    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async function makeStale(id: bigint): Promise<Date> {
    const stale = new Date(Date.now() - 60 * 60_000);
    await db.update(tasks).set({ updatedAt: stale }).where(eq(tasks.id, id));
    return stale;
  }

  function makeDeps(adapter: ModelAdapter, overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
    return {
      db,
      storage,
      adapterOptions: { mode: "mock" },
      aiLabel: LABELS_OFF,
      log: () => {},
      resolveAdapter: () => adapter,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
      ...overrides,
    };
  }

  function frozenAdapter(submit = vi.fn(async () => ({ vendor_task_id: "unused" }))): ModelAdapter {
    return {
      vendor: "fake",
      submit,
      poll: async () => ({ status: "failed" as const }),
      cancel: async () => {},
    };
  }

  describe("claimTaskForRun（执行判定）", () => {
    it("三个终态一律 skip：不写状态、不写事件、外层不 submit", async () => {
      for (const status of [TaskStatus.CANCELED, TaskStatus.SUCCEEDED, TaskStatus.FAILED]) {
        const taskId = await createTask({ status });
        const claim = await claimTaskForRun(makeDeps(frozenAdapter()), taskId, "fake");
        expect(claim, `status=${status}`).toEqual({ action: "skip" });
        expect((await readTask(taskId))?.status).toBe(status);
        expect(await readEvents(taskId)).toHaveLength(0);
      }
    });

    it("RUNNING 且已落 vendorTaskId：resume 续接，写 task.resumed，不写 task.running", async () => {
      const taskId = await createTask({
        status: TaskStatus.RUNNING,
        vendorTaskId: "vendor-resume-9",
      });

      const claim = await claimTaskForRun(makeDeps(frozenAdapter()), taskId, "fake");

      expect(claim).toEqual({ action: "resume", vendorTaskId: "vendor-resume-9" });
      // 状态保持 RUNNING（续接不是新的开始），vendorTaskId 不被改写
      const row = await readTask(taskId);
      expect(row?.status).toBe(TaskStatus.RUNNING);
      expect(row?.vendorTaskId).toBe("vendor-resume-9");
      const events = await readEvents(taskId);
      expect(events.map((event) => event.type)).toEqual(["task.resumed"]);
      expect(events[0]?.payload).toEqual({ vendor_task_id: "vendor-resume-9" });
    });

    it("PENDING 与「RUNNING 但还没拿到 vendor id」都走 submit，并把 previousStatus 传回", async () => {
      const pendingId = await createTask({ status: TaskStatus.PENDING });
      const pendingClaim = await claimTaskForRun(makeDeps(frozenAdapter()), pendingId, "fake");
      expect(pendingClaim).toEqual({ action: "submit", previousStatus: TaskStatus.PENDING });

      const runningId = await createTask({ status: TaskStatus.RUNNING });
      const runningClaim = await claimTaskForRun(makeDeps(frozenAdapter()), runningId, "fake");
      expect(runningClaim).toEqual({ action: "submit", previousStatus: TaskStatus.RUNNING });

      for (const id of [pendingId, runningId]) {
        const row = await readTask(id);
        expect(row?.status).toBe(TaskStatus.RUNNING);
        expect(row?.progress).toBe(10);
        const events = await readEvents(id);
        expect(events.map((event) => event.type)).toEqual(["task.running"]);
        expect(events[0]?.payload).toEqual({ adapter: "fake" });
      }
    });
  });

  describe("runGenerationTask（重投续接）", () => {
    it("已落 vendorTaskId 的重投直接续接原轮询，绝不重新 submit", async () => {
      const taskId = await createTask({
        status: TaskStatus.RUNNING,
        vendorTaskId: "vendor-resume-1",
      });
      await makeStale(taskId);

      const submit = vi.fn(async () => {
        throw new Error("resumed task must never be resubmitted");
      });
      const poll = vi.fn(async () => ({
        status: "succeeded" as const,
        results: [{ uri: "mock://results/resumed.mp4" }],
      }));
      const adapter: ModelAdapter = { vendor: "fake", submit, poll, cancel: async () => {} };

      await runGenerationTask(String(taskId), makeDeps(adapter, { heartbeatMs: 1 }));

      expect(submit).not.toHaveBeenCalled();
      expect(poll).toHaveBeenCalledWith("vendor-resume-1");
      const row = await readTask(taskId);
      expect(row?.status).toBe(TaskStatus.SUCCEEDED);
      const types = (await readEvents(taskId)).map((event) => event.type);
      expect(types).toContain("task.resumed");
      expect(types).toContain("task.succeeded");
      // 续接不是新执行：不应该再有第二条 task.running
      expect(types.filter((type) => type === "task.running")).toHaveLength(0);
    });

    it("已被取消的重投不 submit、不复活终态", async () => {
      const taskId = await createTask({ status: TaskStatus.CANCELED });
      const submit = vi.fn(async () => ({ vendor_task_id: "vendor-canceled" }));
      await runGenerationTask(String(taskId), makeDeps(frozenAdapter(submit)));

      expect(submit).not.toHaveBeenCalled();
      expect((await readTask(taskId))?.status).toBe(TaskStatus.CANCELED);
      expect(await readEvents(taskId)).toHaveLength(0);
    });
  });

  describe("整条流水线心跳与转存上限", () => {
    it("转存期间心跳继续续期：上一次心跳之后再长的时间也不会被看门狗误杀", async () => {
      const taskId = await createTask({ status: TaskStatus.PENDING });
      const staleAt = new Date(Date.now() - 60 * 60_000);

      let statusDuringTransfer: number | undefined;
      let updatedAtDuringTransfer: Date | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          // 把 updatedAt 拨回 1 小时前：此刻任务看起来"已经卡死"，只有转存期间的心跳能救它
          await db.update(tasks).set({ updatedAt: staleAt }).where(eq(tasks.id, taskId));
          await new Promise((resolve) => setTimeout(resolve, 40)); // heartbeatMs=1，足够跳很多次
          const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
          statusDuringTransfer = row?.status;
          updatedAtDuringTransfer = row?.updatedAt;
          return new Response(Buffer.from("video-bytes"), { status: 200 });
        }),
      );

      const adapter: ModelAdapter = {
        vendor: "fake",
        submit: async () => ({ sync_results: [{ uri: "https://vendor.example/slow.mp4" }] }),
        poll: async () => ({ status: "failed" as const }),
        cancel: async () => {},
      };

      await runGenerationTask(String(taskId), makeDeps(adapter, { heartbeatMs: 1 }));

      expect(statusDuringTransfer).toBe(TaskStatus.RUNNING);
      expect(updatedAtDuringTransfer!.getTime()).toBeGreaterThan(staleAt.getTime());
      const row = await readTask(taskId);
      expect(row?.status).toBe(TaskStatus.SUCCEEDED);
      expect((await readEvents(taskId)).some((event) => event.type === "task.succeeded")).toBe(true);
    });

    it("挂住的下载到上限即中止：按 ADR-005 降级保留原 URI，不无限续命", async () => {
      const taskId = await createTask({ status: TaskStatus.PENDING });
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
            );
          });
        }),
      );

      const adapter: ModelAdapter = {
        vendor: "fake",
        submit: async () => ({ sync_results: [{ uri: "https://vendor.example/hung.mp4" }] }),
        poll: async () => ({ status: "failed" as const }),
        cancel: async () => {},
      };

      await runGenerationTask(String(taskId), makeDeps(adapter, { transferTimeoutMs: 10, heartbeatMs: 5 }));

      expect(signal).toBeInstanceOf(AbortSignal);
      // 下载挂了不算任务失败：降级交付供应商原 URI，交人工补转
      const row = await readTask(taskId);
      expect(row?.status).toBe(TaskStatus.SUCCEEDED);
      const results = row?.results as Array<{ uri: string; meta?: { transfer_failed?: boolean } }>;
      expect(results[0]?.uri).toBe("https://vendor.example/hung.mp4");
      expect(results[0]?.meta?.transfer_failed).toBe(true);
    });
  });
});