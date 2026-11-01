import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SOCKET_TIMEOUT_MS,
  S3Storage,
  type S3Config,
} from "./s3";

const storage = new S3Storage({
  bucket: "app-results",
  region: "cn-hangzhou",
  accessKeyId: "test-ak",
  secretAccessKey: "test-sk",
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
});

describe("S3Storage signing", () => {
  it("returns a presigned GET URL for an object key", async () => {
    const url = new URL(await storage.signDownload("u/1/tasks/2/r0.mp4", 3600));
    expect(url.pathname).toBe("/app-results/u/1/tasks/2/r0.mp4");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBe(3600);
  });

  it("uses path-style endpoint when configured (MinIO/OSS compatible)", async () => {
    const url = await storage.signDownload("u/1/file.png", 60);
    expect(url.startsWith("http://127.0.0.1:9000/app-results/")).toBe(true);
  });

  it("signs with public endpoint while SDK uses internal endpoint", async () => {
    const split = new S3Storage({
      bucket: "app-results",
      region: "us-east-1",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      endpoint: "http://minio:9000",
      publicEndpoint: "https://files.example.com",
      forcePathStyle: true,
    });
    const url = await split.signDownload("u/1/file.png", 60);
    expect(url.startsWith("https://files.example.com/app-results/u/1/file.png")).toBe(true);
  });
});

const s3Source = readFileSync(join(__dirname, "s3.ts"), "utf8");

const baseConfig: S3Config = {
  bucket: "app-results",
  region: "us-east-1",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  forcePathStyle: true,
};

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; endpoint: string }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { server, endpoint: `http://127.0.0.1:${port}` };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * 第 114 批：存储驱动不能无限挂起。
 *
 * 背景：流水线心跳（第 113 批）会在转存/标识期间持续刷新 `tasks.updatedAt`。如果存储
 * 客户端本身会永远挂着，心跳就等于给挂死任务无限续命——任务永远 RUNNING，看门狗也
 * 不会处置。旧实现的两个 `S3Client` 既没有 requestHandler 也没有 maxAttempts，
 * `put`/`read` 可以挂到进程重启为止。
 *
 * 这里用真的本地 HTTP 服务器把两个阶段分别钉住：
 * 1. 服务端收下请求、永不回应 → PUT 必须在上限内失败；
 * 2. 服务端先回 200 头、再挂住响应体 → smithy 的 requestTimeout 在响应头到达时就被
 *    清掉了，只有我们自己的响应体上限能救 `read`。
 */
describe("S3Storage 上限与重试（第 114 批）", () => {
  it("配置校验：负上限与 0 次重试直接拒绝，不静默退化成「无上限」", () => {
    const make = (patch: Partial<S3Config>) => () => new S3Storage({ ...baseConfig, ...patch });
    expect(make({ requestTimeoutMs: -1 })).toThrow(/invalid s3 requestTimeoutMs/);
    expect(make({ connectionTimeoutMs: Number.NaN })).toThrow(/invalid s3 connectionTimeoutMs/);
    expect(make({ maxAttempts: 0 })).toThrow(/invalid s3 maxAttempts/);
  });

  it("默认值有层次：建连 < 空闲 < 总时长，且总时长是安全网而非交付约束", () => {
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_SOCKET_TIMEOUT_MS).toBeGreaterThan(DEFAULT_CONNECTION_TIMEOUT_MS);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_SOCKET_TIMEOUT_MS);
    // 至少 10 分钟：256 MiB 结果在慢链路上要传很久，上限不能变成「大文件必失败」
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(DEFAULT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it("接线守卫：handler 与 maxAttempts 真的传进两个 S3Client，requestTimeout 会抛错", () => {
    expect(s3Source).toContain("requestHandler: this.createHandler()");
    expect(s3Source).toContain("maxAttempts: this.limits.maxAttempts");
    // smithy 默认只打 warning，到点的请求会继续挂着——必须显式打开
    expect(s3Source).toContain("throwOnRequestTimeout: true");
    // SDK client 与预签名 client 各持一个 handler，不许只接一个
    expect(s3Source.match(/requestHandler: this\.createHandler\(\)/g)).toHaveLength(2);
    expect(s3Source).toContain("readBodyWithin(");
    expect(s3Source).toContain("AbortSignal.timeout(this.limits.requestTimeoutMs)");
  });

  it("PUT 遇到永不回应的存储：在上限内失败，且不重试（maxAttempts 生效）", async () => {
    let requests = 0;
    const { server, endpoint } = await startServer(() => {
      // 收下请求，既不读 body 也不回应：模拟 endpoint 接受连接后业务侧挂死
      requests += 1;
    });
    const s3 = new S3Storage({
      ...baseConfig,
      endpoint,
      maxAttempts: 1,
      connectionTimeoutMs: 1_000,
      socketTimeoutMs: 0, // 关掉空闲探测，只留总上限
      requestTimeoutMs: 400,
    });

    const started = Date.now();
    await expect(
      s3.put("u/1/tasks/2/r0.mp4", Buffer.from("video-bytes"), "video/mp4"),
    ).rejects.toThrow(/s3 put timed out after 400 ms/);
    expect(Date.now() - started).toBeLessThan(5_000);
    // SDK 默认会重试超时；maxAttempts 没接上就会看到 3 次请求
    expect(requests).toBe(1);
    await stopServer(server);
  });

  it("GET 先回响应头再挂住响应体：read 仍在上限内失败，并销毁挂住的连接", async () => {
    let bodyClosed: Promise<void> | undefined;
    const { server, endpoint } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "1048576" });
      res.write(Buffer.alloc(16));
      // 之后一个字节都不再写、也不 end：请求头阶段的超时早已失效
      bodyClosed = new Promise<void>((resolve) => res.on("close", () => resolve()));
    });
    const s3 = new S3Storage({
      ...baseConfig,
      endpoint,
      maxAttempts: 1,
      socketTimeoutMs: 0, // 关掉空闲探测：能停下来的只可能是我们自己的响应体上限
      requestTimeoutMs: 400,
    });

    const started = Date.now();
    await expect(s3.read("u/1/tasks/2/r0.mp4")).rejects.toThrow(/s3 read timed out after 400 ms/);
    expect(Date.now() - started).toBeLessThan(5_000);

    // 超时必须把流销毁，否则这条连接会一直挂在 agent 池里
    let timer: NodeJS.Timeout | undefined;
    const closed = await Promise.race([
      bodyClosed!.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    clearTimeout(timer);
    expect(closed).toBe(true);
    await stopServer(server);
  });
});