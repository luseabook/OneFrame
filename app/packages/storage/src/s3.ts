import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { StorageDriver, StoredObject } from "./types";

/** 建连上限（毫秒）：连不上的 endpoint 不该让一次 put/read 挂到天荒地老 */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
/** 单次 socket 空闲上限（毫秒）：连续这么久没有任何字节流动即中止（挂死连接的主要探测器） */
export const DEFAULT_SOCKET_TIMEOUT_MS = 60_000;
/** 单次操作总上限（毫秒，含响应体读取）：安全网，不是交付约束——慢但持续有字节的传输不该被杀 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60_000;
/** SDK 最大尝试次数（含首次）：重试会成倍放大上面的上限 */
export const DEFAULT_MAX_ATTEMPTS = 3;

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  /** 预签名 URL 使用的对外 endpoint（内网 SDK + 公网下载分离） */
  publicEndpoint?: string;
  forcePathStyle?: boolean;
  /** 建连上限（毫秒，0 = 不设上限，默认 DEFAULT_CONNECTION_TIMEOUT_MS） */
  connectionTimeoutMs?: number;
  /** socket 空闲上限（毫秒，0 = 不设上限，默认 DEFAULT_SOCKET_TIMEOUT_MS） */
  socketTimeoutMs?: number;
  /** 单次操作总上限（毫秒，0 = 不设上限，默认 DEFAULT_REQUEST_TIMEOUT_MS） */
  requestTimeoutMs?: number;
  /** 最大尝试次数（含首次，默认 DEFAULT_MAX_ATTEMPTS） */
  maxAttempts?: number;
}

interface S3Limits {
  connectionTimeoutMs: number;
  socketTimeoutMs: number;
  requestTimeoutMs: number;
  maxAttempts: number;
}

/** 响应体只需这两个能力：读完，以及超时后能销毁（Node 的 IncomingMessage/Readable 都有） */
interface S3ResponseBody {
  transformToByteArray: () => Promise<Uint8Array>;
  destroy?: (error?: Error) => unknown;
}

function readLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid s3 ${name}: ${String(value)}（需为非负毫秒数，0 = 不设上限）`);
  }
  return value;
}

function timeoutError(message: string): Error {
  return Object.assign(new Error(message), { name: "TimeoutError" });
}

/**
 * 读完响应体，同时受同一个总上限约束。
 *
 * 为什么只配 requestHandler 不够：smithy 在**响应头到达时**就 resolve 并清掉了
 * requestTimeout 的定时器（`resolve()` → `clearTimeouts()`），此后
 * `transformToByteArray()` 读响应体不再有任何时限——一个先回 200 头、再挂住连接的
 * 存储会让 `read` 永远不返回。这里用同一个 AbortSignal 继续守响应体，超时后显式
 * `destroy()` 流，避免留下悬空连接。
 */
async function readBodyWithin(
  body: S3ResponseBody,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  key: string,
): Promise<Uint8Array> {
  const reading = body.transformToByteArray();
  if (!signal) return reading;
  // 竞速落败后 reading 仍可能稍后拒绝；补一个 no-op catch，避免 unhandled rejection
  reading.catch(() => undefined);

  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      body.destroy?.(timeoutError(`s3 read body timed out after ${timeoutMs} ms: ${key}`));
      reject(timeoutError(`s3 read timed out after ${timeoutMs} ms: ${key}`));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reading, deadline]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// S3 兼容（AWS S3 / 阿里云 OSS S3 兼容端点 / MinIO）驱动。
// 结果 URL 一律预签名，不暴露 bucket 公网权限（ADR-005）。
export class S3Storage implements StorageDriver {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly signClient: S3Client;
  private readonly limits: S3Limits;

  constructor(private readonly config: S3Config) {
    this.limits = {
      connectionTimeoutMs: readLimit(config.connectionTimeoutMs, DEFAULT_CONNECTION_TIMEOUT_MS, "connectionTimeoutMs"),
      socketTimeoutMs: readLimit(config.socketTimeoutMs, DEFAULT_SOCKET_TIMEOUT_MS, "socketTimeoutMs"),
      requestTimeoutMs: readLimit(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs"),
      maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    };
    if (!Number.isFinite(this.limits.maxAttempts) || this.limits.maxAttempts < 1) {
      throw new Error(`invalid s3 maxAttempts: ${String(config.maxAttempts)}（至少 1 次）`);
    }

    const base = {
      region: config.region,
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: this.limits.maxAttempts,
      requestHandler: this.createHandler(),
    };
    this.client = new S3Client({
      ...base,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    // 预签名必须使用浏览器/客户端可访问的地址（生产为 CDN 或公网 OSS endpoint）
    this.signClient = new S3Client({
      ...base,
      requestHandler: this.createHandler(),
      ...(config.publicEndpoint ?? config.endpoint
        ? { endpoint: config.publicEndpoint ?? config.endpoint }
        : {}),
    });
  }

  /**
   * 每次构造独立的 handler：两个 client 各自持有 agent 池，销毁其一不影响另一个。
   * `throwOnRequestTimeout` 必须显式打开——smithy 的默认行为只是打一条 warning，
   * 到点的请求会继续挂着，等于没设上限。
   */
  private createHandler(): NodeHttpHandler {
    return new NodeHttpHandler({
      connectionTimeout: this.limits.connectionTimeoutMs,
      requestTimeout: this.limits.requestTimeoutMs,
      socketTimeout: this.limits.socketTimeoutMs,
      throwOnRequestTimeout: true,
    });
  }

  /** 单次操作的总上限；0 表示部署方显式关闭（与 requestHandler 的 0 = 不设上限一致） */
  private requestSignal(): AbortSignal | undefined {
    return this.limits.requestTimeoutMs > 0
      ? AbortSignal.timeout(this.limits.requestTimeoutMs)
      : undefined;
  }

  /**
   * 把「到点被中止」统一成可读的超时错误。
   *
   * 同一时刻有两个定时器（AbortSignal 与 handler 的 requestTimeout），谁先到都可能：
   * 直接透传的话调用方只会看到 `AbortError: Request aborted`，既说不清是哪种失败，
   * 也无法与真正的取消区分。这里按信号状态判定，原始错误挂在 cause 上不丢。
   */
  private async bounded<T>(
    action: "put" | "read",
    key: string,
    signal: AbortSignal | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (signal?.aborted) {
        throw Object.assign(
          new Error(`s3 ${action} timed out after ${this.limits.requestTimeoutMs} ms: ${key}`, {
            cause: error,
          }),
          { name: "TimeoutError" },
        );
      }
      throw error;
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const signal = this.requestSignal();
    await this.bounded("put", key, signal, () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
        }),
        signal ? { abortSignal: signal } : undefined,
      ),
    );
    return { key, uri: key, content_type: contentType, bytes: data.byteLength };
  }

  async read(key: string): Promise<Buffer> {
    const signal = this.requestSignal();
    const res = await this.bounded("read", key, signal, () =>
      this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        signal ? { abortSignal: signal } : undefined,
      ),
    );
    if (!res.Body) throw new Error(`s3 object body missing: ${key}`);
    const bytes = await readBodyWithin(
      res.Body,
      signal,
      this.limits.requestTimeoutMs,
      key,
    );
    return Buffer.from(bytes);
  }

  async signDownload(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signClient,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}