import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_OPERATION_TIMEOUT_MS, LocalStorage } from "./local";

let dir = "";
let storage: LocalStorage;

const baseOptions = () => ({
  rootDir: dir,
  publicBaseUrl: "http://127.0.0.1:3000/v1",
  signSecret: "test-secret",
});

/** 真实的 fs 组合：注入替身时只覆盖需要挂住的那一个 */
const realFs = { mkdir, readFile, writeFile, rename, unlink };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "app-storage-"));
  storage = new LocalStorage(baseOptions());
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("puts/reads bytes and returns an internal key", async () => {
    const stored = await storage.put("u/1/tasks/2/r0.mp4", Buffer.from("hello"), "video/mp4");
    expect(stored.key).toBe("u/1/tasks/2/r0.mp4");
    expect((await storage.read(stored.key)).toString()).toBe("hello");
  });

  it("signs download URLs and verifies signature + expiry", async () => {
    const url = new URL(await storage.signDownload("u/1/r0.mp4", 60));
    expect(url.pathname).toBe("/v1/files/local");
    const key = url.searchParams.get("key")!;
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("sig")!;
    expect(storage.verify(key, expires, sig)).toBe(true);
    expect(storage.verify(key, expires, "bad")).toBe(false);
    expect(storage.verify(key, Math.floor(Date.now() / 1000) - 1, sig)).toBe(false);
  });

  it("rejects traversal keys", async () => {
    await expect(storage.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow(/invalid storage key/);
  });
});

const localSource = readFileSync(join(__dirname, "local.ts"), "utf8");

/**
 * 第 115 批：local 驱动的 fs 调用不能无限挂起。
 *
 * 背景与 S3（第 114 批）同源：流水线心跳只证明 worker 活着，不证明存储调用会返回。
 * `STORAGE_DIR` 落在 NFS/网络盘、挂载点卡死时，旧的 `await readFile/writeFile` 会让转存
 * 永远不返回，任务永远 RUNNING。这里用注入的 fs 替身把每个阶段分别钉住——真去挂一块
 * 坏盘不现实，但"Promise 永不落定"就是挂死的等价形态。
 */
describe("LocalStorage 操作上限（第 115 批）", () => {
  it("负上限与 NaN 构造即抛，不静默退化成「无上限」", () => {
    const make = (patch: { operationTimeoutMs: number }) => () =>
      new LocalStorage({ ...baseOptions(), ...patch });
    expect(make({ operationTimeoutMs: -1 })).toThrow(/invalid local operationTimeoutMs/);
    expect(make({ operationTimeoutMs: Number.NaN })).toThrow(/invalid local operationTimeoutMs/);
  });

  it("默认上限是安全网：不少于 1 分钟，且不超过 worker 的 5 分钟转存上限", () => {
    expect(DEFAULT_OPERATION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(DEFAULT_OPERATION_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("read 遇到永不返回的 fs：在上限内失败，错误是 TimeoutError", async () => {
    const hung = new LocalStorage({
      ...baseOptions(),
      operationTimeoutMs: 100,
      fs: { ...realFs, readFile: (() => new Promise(() => {})) as unknown as typeof readFile },
    });

    const started = Date.now();
    const error = await hung.read("u/1/tasks/2/r0.mp4").then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error?.name).toBe("TimeoutError");
    expect(error?.message).toMatch(/local read timed out after 100 ms: u\/1\/tasks\/2\/r0\.mp4/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("mkdir 卡死也受同一上限约束（fs API 没有 signal，只能靠 deadline 放手）", async () => {
    const hung = new LocalStorage({
      ...baseOptions(),
      operationTimeoutMs: 100,
      fs: { ...realFs, mkdir: (() => new Promise(() => {})) as unknown as typeof mkdir },
    });

    const started = Date.now();
    await expect(
      hung.put("u/1/tasks/2/r0.mp4", Buffer.from("bytes"), "video/mp4"),
    ).rejects.toThrow(/local put timed out after 100 ms/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("写超时不会把半截数据写成正式 key（临时文件 + rename 保原子可见）", async () => {
    const slow = new LocalStorage({
      ...baseOptions(),
      operationTimeoutMs: 100,
      fs: {
        ...realFs,
        // 真实写入临时文件后拖 300ms 才 resolve：若实现直接写目标文件，正式 key 此刻已可读
        writeFile: (async (path: string, data: Buffer) => {
          await writeFile(path, data);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }) as unknown as typeof writeFile,
      },
    });

    await expect(
      slow.put("u/7/tasks/8/r0.bin", Buffer.from("payload"), "application/octet-stream"),
    ).rejects.toThrow(/local put timed out after 100 ms/);
    // 目标 key 从未出现：读者要么看到旧对象，要么什么都没有，不会读到半截文件
    await expect(access(join(dir, "u/7/tasks/8/r0.bin"))).rejects.toThrow();
  });

  it("接线守卫：put 三步都在 deadline 内，读写都带 signal，写入走临时文件 + rename", () => {
    expect(localSource).toContain("AbortSignal.timeout(this.limits.operationTimeoutMs)");
    expect(localSource).toContain("withinDeadline(");
    // mkdir / writeFile / rename 三步都不能绕过上限
    expect(localSource.match(/this\.withinDeadline\("put"/g)).toHaveLength(3);
    expect(localSource).toContain("const tmp = `${target}.tmp-${randomUUID()}`");
    expect(localSource).toContain("this.fs.rename(tmp, target)");
    // readFile 与 writeFile 必须把同一个 signal 交给 fs 层，而不只是自己竞速
    expect(localSource.match(/signal \? \{ signal \} : undefined/g)).toHaveLength(2);
  });
});