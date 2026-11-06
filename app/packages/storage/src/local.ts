import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageDriver, StoredObject } from "./types";
import { assertStorageKey } from "./key";

/** 单次 fs 操作总上限（毫秒）：安全网，不是交付约束——256 MiB 在 ~0.9 MB/s 的盘上也够传 */
export const DEFAULT_OPERATION_TIMEOUT_MS = 5 * 60_000;

/** 只取用得到的几个 fs 能力；测试可注入替身，生产一律用 node:fs/promises */
type LocalFs = Pick<
  typeof import("node:fs/promises"),
  "mkdir" | "readFile" | "writeFile" | "rename" | "unlink"
>;

const defaultFs: LocalFs = { mkdir, readFile, writeFile, rename, unlink };

function readOperationTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `invalid local operationTimeoutMs: ${String(value)}（需为非负毫秒数，0 = 不设上限）`,
    );
  }
  return value;
}

function timeoutError(action: "put" | "read", timeoutMs: number, key: string): Error {
  return Object.assign(new Error(`local ${action} timed out after ${timeoutMs} ms: ${key}`), {
    name: "TimeoutError",
  });
}

/**
 * 本地存储驱动：dev/CI 用；生产替换为 OSS/S3 驱动（ADR-005 仍需转存自有桶）。
 *
 * 为什么要有操作上限（第 115 批）：流水线心跳（第 113 批）会在转存/标识期间持续刷新
 * `tasks.updatedAt`。心跳只解决"worker 没死"，不解决"存储调用永远不返回"——旧实现直接
 * `await readFile/writeFile`，`STORAGE_DIR` 指向 NFS/网络盘且挂载点卡死时，任务会永远
 * RUNNING，看门狗也不会处置。S3 驱动在第 114 批已封住同类路径，这里补齐 local。
 *
 * 边界（必须诚实说清）：
 * 1. 上限只能让**调用方不再等待**。`readFile`/`writeFile` 会因 `signal` 提前 reject，但
 *    已进入 libuv 线程池的 syscall 无法收回——盘恢复前，线程池槽位可能仍被这次调用占着。
 *    本批解决的是"任务挂死被心跳无限续命"，不是"坏盘期间不消耗线程"。
 * 2. `mkdir`/`rename` 不支持 signal（Node 的 fs API 没给），它们只能靠 deadline 竞速放手，
 *    底层调用仍会跑完。
 * 3. `put` 先写同目录临时文件再 `rename`：读者只会看到完整的旧对象或完整的新对象，
 *    超时不会把半截数据落成正式 key。代价是失败路径可能留下 `.tmp-<uuid>` 孤儿文件；
 *    清理是 fire-and-forget（`unlink` 自己也可能挂在同一块坏盘上），且若底层写晚于
 *    清理完成，临时文件会被重新写出来——宁可留下垃圾，也不能让失败的上传拖住调用方。
 */
export class LocalStorage implements StorageDriver {
  readonly driver = "local" as const;
  private readonly root: string;
  private readonly limits: { operationTimeoutMs: number };
  private readonly fs: LocalFs;

  constructor(
    private readonly options: {
      rootDir: string;
      /** 预签名下载 URL 的前缀（通常为 API 公网地址 + /v1） */
      publicBaseUrl: string;
      signSecret: string;
      /** 单次 fs 操作总上限（毫秒，0 = 不设上限，默认 DEFAULT_OPERATION_TIMEOUT_MS） */
      operationTimeoutMs?: number;
      /** 仅供测试注入；生产不传 */
      fs?: LocalFs;
    },
  ) {
    this.root = resolve(options.rootDir);
    this.limits = { operationTimeoutMs: readOperationTimeout(options.operationTimeoutMs) };
    this.fs = options.fs ?? defaultFs;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    // 驱动内部自校验（纵深防御）：与 S3 驱动同口径，不能只靠调用方
    key = assertStorageKey(key);
    const target = this.resolveKey(key);
    const signal = this.operationSignal();
    // 同目录临时文件：rename 在同一目录内是原子的（Windows 的 MoveFileEx 也覆盖已存在目标）
    const tmp = `${target}.tmp-${randomUUID()}`;
    try {
      await this.withinDeadline("put", key, signal, () =>
        this.fs.mkdir(dirname(target), { recursive: true }),
      );
      await this.withinDeadline("put", key, signal, () =>
        this.fs.writeFile(tmp, data, signal ? { signal } : undefined),
      );
      await this.withinDeadline("put", key, signal, () => this.fs.rename(tmp, target));
    } catch (error) {
      // 不 await：清理失败（坏盘上 unlink 同样会挂）不能把超时重新变成挂死
      void this.fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
    return { key, uri: key, content_type: contentType, bytes: data.byteLength };
  }

  async read(key: string): Promise<Buffer> {
    key = assertStorageKey(key);
    const signal = this.operationSignal();
    return this.withinDeadline("read", key, signal, () =>
      this.fs.readFile(this.resolveKey(key), signal ? { signal } : undefined),
    );
  }

  async signDownload(key: string, ttlSeconds: number): Promise<string> {
    key = assertStorageKey(key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, expires);
    const base = this.options.publicBaseUrl.replace(/\/$/, "");
    return `${base}/files/local?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sig}`;
  }

  verify(key: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.options.signSecret).update(`${key}:${expires}`).digest("hex");
  }

  /** 单次操作的总上限；0 表示部署方显式关闭（与 S3 驱动的 0 = 不设上限一致） */
  private operationSignal(): AbortSignal | undefined {
    return this.limits.operationTimeoutMs > 0
      ? AbortSignal.timeout(this.limits.operationTimeoutMs)
      : undefined;
  }

  /**
   * 在总上限内执行一次 fs 调用。
   *
   * deadline 是兜底：`mkdir`/`rename` 没有 signal，`readFile`/`writeFile` 虽有 signal 但
   * 也走同一条竞速路径，保证任何一步挂住都只会有一种失败形态（`TimeoutError`）。
   * 竞速落败后底层 Promise 仍可能稍后落定，补 no-op catch 避免 unhandled rejection。
   */
  private async withinDeadline<T>(
    action: "put" | "read",
    key: string,
    signal: AbortSignal | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    if (!signal) return call();
    const pending = call();
    pending.catch(() => undefined);

    let onAbort: (() => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(timeoutError(action, this.limits.operationTimeoutMs, key));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      // fs 层因 signal 中止时会抛 AbortError；统一成可读的 TimeoutError，原始错误挂 cause
      if (signal.aborted && (error as Error | undefined)?.name !== "TimeoutError") {
        throw Object.assign(
          timeoutError(action, this.limits.operationTimeoutMs, key),
          { cause: error },
        );
      }
      throw error;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private resolveKey(key: string): string {
    const target = resolve(this.root, key);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error("invalid storage key");
    }
    return target;
  }
}