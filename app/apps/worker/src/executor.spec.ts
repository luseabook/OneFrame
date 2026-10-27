import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@app/storage";
import { transferResult, type ExecutorDeps, type TaskRow } from "./executor";

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
