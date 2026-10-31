import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@app/storage";
import { DEFAULT_MAX_POLL_MS, transferResult, type ExecutorDeps, type TaskRow } from "./executor";

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
    expect(main).toMatch(/POLL_MAX_MS\s*\?\?\s*DEFAULT_MAX_POLL_MS/);
    // 旧写法（内联 120_000 / 2 分钟）不许回来
    expect(main).not.toMatch(/POLL_MAX_MS\s*\?\?\s*120_?000/);
  });
});
