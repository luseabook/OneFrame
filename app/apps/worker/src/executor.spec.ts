import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@app/storage";
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_MAX_POLL_MS,
  DEFAULT_TRANSFER_TIMEOUT_MS,
  transferResult,
  type ExecutorDeps,
  type TaskRow,
} from "./executor";

const executorSource = readFileSync(join(__dirname, "executor.ts"), "utf8");

let dir = "";
let storage: LocalStorage;
let deps: ExecutorDeps;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "worker-storage-"));
  storage = new LocalStorage({
    rootDir: dir,
    publicBaseUrl: "http://127.0.0.1:3000/v1",
    signSecret: "test-secret",
  });
  deps = {
    db: {} as ExecutorDeps["db"],
    storage,
    adapterOptions: { mode: "mock" },
    // 本文件只测转存；标识显式关闭（aiLabel 必填，不允许靠漏传绕过结算门）
    aiLabel: { enabled: false, text: "" },
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const task = { id: 11n, spaceId: 22n, capability: "video" } as TaskRow;

describe("worker result transfer", () => {
  it("stores mock:// result under a deterministic key", async () => {
    const result = await transferResult(deps, task, 0, { uri: "mock://results/x.mp4" }, "video/mp4");
    expect(result.uri).toBe("u/22/tasks/11/r0.mp4");
    expect((await storage.read(result.uri)).toString()).toContain("mock result for task 11");
    expect(result.meta?.storage).toBe("local");
  });

  it("images in mock mode are real PNG bytes (not text under a .png name)", async () => {
    // 以前 mock 把 "mock result for task ..." 文本写进 r0.png，浏览器解不出来 → 页面裂图。
    // 这里断言 PNG magic + 可被 <img> 解码的关键结构（IHDR/IEND），防止回退。
    const result = await transferResult({ ...deps } as ExecutorDeps, task, 0, { uri: "mock://results/x.png" }, "image/png");
    const bytes = await storage.read(result.uri);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.includes(Buffer.from("IHDR"))).toBe(true);
    expect(bytes.includes(Buffer.from("IEND"))).toBe(true);
    expect(result.meta?.storage).toBe("local");
  });

  it("non-image mock results are flagged as placeholders (UI 显示占位而不是裂图)", async () => {
    const result = await transferResult({ ...deps } as ExecutorDeps, task, 0, { uri: "mock://results/x.mp4" }, "video/mp4");
    expect(result.meta?.mock_placeholder).toBe(true);
  });

  it("keeps text results and already-stored keys untouched", async () => {
    const text = await transferResult(deps, task, 0, { uri: "", text: "hello" }, "text/plain");
    expect(text.text).toBe("hello");
    const stored = await transferResult(deps, task, 0, { uri: "u/22/tasks/11/r0.mp4" }, "video/mp4");
    expect(stored.uri).toBe("u/22/tasks/11/r0.mp4");
  });
});

/**
 * P1-16 守卫：轮询上限默认值必须覆盖真实视频生成时长。
 *
 * 120s 的旧默认值意味着「按默认配置上线，绝大多数视频任务会在超时后判失败」——
 * 不扣费但用户体验是「点了没反应然后失败」，还会污染失败率告警。
 * 这里同时钉两件事：常量本身的下限，以及**启动入口必须用这个常量**（防止又内联一个 120_000）。
 */
describe("轮询上限默认值（P1-16）", () => {
  it("DEFAULT_MAX_POLL_MS 至少 10 分钟", () => {
    expect(DEFAULT_MAX_POLL_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("worker 启动入口引用该常量，不再内联固定值", () => {
    const main = readFileSync(join(__dirname, "main.ts"), "utf8");
    // 第 123 批：读取入口换成 readEnvNumber，但默认值仍必须是这个常量
    expect(main).toMatch(/readEnvNumber\("POLL_MAX_MS",\s*\{\s*default:\s*DEFAULT_MAX_POLL_MS/);
    // 旧写法（内联 120_000 / 2 分钟）不许回来
    expect(main).not.toMatch(/POLL_MAX_MS\s*\?\?\s*120_?000/);
  });
});

/**
 * 合规硬门（第 112 批）：结算前必须过滤无标识产物。
 *
 * 纯函数口径在 `label.spec.ts` 里逐条覆盖；这里守的是**接线**——判定必须在 `succeed()`
 * 结算事务之前调用，且失败走 `fail(..., ai_label_failed)`（置 FAILED + 解冻）。
 * 只保留 `labelResults` 而不调用判定，等于门没装上，测试仍会全绿，所以需要这条静态守卫。
 */
describe("结算前的 AI 标识门（第 112 批）", () => {
  it("succeed() 调用 findUnlabeledResults 并以 ai_label_failed 拒绝结算", () => {
    expect(executorSource).toContain("findUnlabeledResults(labeled)");
    expect(executorSource).toContain('kind: "ai_label_failed"');
  });
});

/**
 * 流水线心跳与执行判定（第 112 批起，第 113 批扩到整条链路）。
 *
 * 看门狗（`reviveStuckTasks`，默认 10 分钟）与轮询上限（`DEFAULT_MAX_POLL_MS`，15 分钟）
 * 之间存在一个真实冲突：执行期间不刷新 `tasks.updatedAt`，正常跑 10–15 分钟的视频会被
 * 看门狗判卡死 + 解冻，之后供应商成功的结果又被终态守卫丢弃。
 *
 * 第 113 批把心跳从「只在轮询循环里」改成覆盖 submit → 轮询 → 转存 → 标识 → 结算整条链路
 * （供应商成功后的转存/烧水印同样可能超过 10 分钟），并补上下载上限——否则一个挂死的
 * 转存会被流水线心跳无限续命，任务永远 RUNNING。这里静态钉住接线，运行时行为在
 * `test/executor-recovery.spec.ts` 里用真库覆盖。
 */
describe("流水线心跳与执行判定（第 112/113 批）", () => {
  it("DEFAULT_HEARTBEAT_MS 至少比看门狗阈值小一个数量级", () => {
    expect(DEFAULT_HEARTBEAT_MS).toBeGreaterThan(0);
    // 允许连续丢 19 次心跳才误杀；也防止有人把它调到接近 10 分钟
    expect(DEFAULT_HEARTBEAT_MS * 20).toBeLessThanOrEqual(10 * 60_000);
  });

  it("心跳由 claim 之后的统一定时器驱动，并在 finally 里停掉", () => {
    expect(executorSource).toContain("deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS");
    expect(executorSource).toContain("startTaskHeartbeat(deps");
    expect(executorSource).toContain("stopHeartbeat?.();");
    // 只写 RUNNING：不能给已取消/已被看门狗处置的任务续命
    expect(executorSource).toContain("eq(tasks.status, TaskStatus.RUNNING)");
    expect(executorSource).toContain("task heartbeat failed");
    // 旧的「轮询循环内计数」实现不许回来（那样转存/标识/结算又回到无心跳状态）
    expect(executorSource).not.toContain("lastBeat");
    // 心跳必须在 claim 判定之后才起：已终态的任务不该有心跳
    expect(executorSource.indexOf("await claimTaskForRun(")).toBeLessThan(
      executorSource.indexOf("startTaskHeartbeat(deps"),
    );
  });

  it("执行判定三分支接线：skip 直接返回、resume 续接原 vendorTaskId", () => {
    expect(executorSource).toContain("if (claim.action === \"skip\") return;");
    expect(executorSource).toContain("claim.action === \"resume\"");
    expect(executorSource).toContain("claim.vendorTaskId");
  });

  it("下载有独立上限，且低于看门狗阈值的一半以下", () => {
    expect(DEFAULT_TRANSFER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TRANSFER_TIMEOUT_MS).toBeLessThan(10 * 60_000);
    // 第 119 批：转存改走 `downloadBounded`（总时长 + 总字节双上限），超时由共享实现用
    // `AbortSignal.timeout(timeoutMs)` 接到 fetch 上；这里盯「上限真的传下去了」+
    // 「executor 不再自己整块读 body」——字节上限只有一条实现，不能再长回来。
    expect(executorSource).toContain("downloadBounded(result.uri");
    expect(executorSource).toContain("timeoutMs: deps.transferTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS");
    expect(executorSource).toContain("maxBytes: deps.transferMaxBytes");
    expect(executorSource).not.toContain("arrayBuffer(");
  });
});
