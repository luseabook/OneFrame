/**
 * 下载一个 HTTP(S) 资源并**强制上限**：总时长与总字节数。
 *
 * 为什么需要一个统一实现（第 119 批）：
 * - `fetch()` 自己没有任何超时，`res.arrayBuffer()` 也没有任何大小上限 —— 供应商 CDN
 *   只要「连上但不发完」或「发 4GB」，调用方就会一直挂着 / 直接 OOM；
 * - 仓库里已有三套各自正确的上限（canvas 200MiB 流式、storage 三层超时、executor
 *   5 分钟），worker 的导出与 CLI 的下载却漏在外面 —— 同一个语义写了四遍还漏两处。
 *
 * 行为约定：
 * - 先看 `content-length`：声明就超限 → 不读 body，直接 cancel；
 * - 没有 `content-length`（chunked）→ 边读边计数，**超限那一块就 cancel**，绝不读完；
 * - 非 2xx → 不读错误页（可能很大/含配额信息），cancel 后抛 `http_status`；
 * - 到点（含 body 读到一半）→ `AbortSignal.timeout` 触发，映射成 `timeout`；
 * - 任何提前退出都必须 `cancel()` body，否则 undici 会把 socket 挂到 GC。
 */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** 单个产物上限：与 worker `label.ts` 的 256MiB 对齐（导出侧要整块进内存，不设上限必 OOM） */
export const DEFAULT_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

export type DownloadFailReason = "timeout" | "aborted" | "too_large" | "http_status" | "network" | "bad_options";

export interface DownloadBoundErrorExtra {
  status?: number;
  maxBytes?: number;
  timeoutMs?: number;
  /** 底层错误信息（网络类），不包含响应体内容 */
  causeMessage?: string;
}

export class DownloadBoundError extends Error {
  readonly reason: DownloadFailReason;
  readonly status: number | undefined;
  readonly maxBytes: number | undefined;
  readonly timeoutMs: number | undefined;
  readonly causeMessage: string | undefined;

  constructor(reason: DownloadFailReason, message: string, extra: DownloadBoundErrorExtra = {}) {
    super(message);
    this.name = "DownloadBoundError";
    this.reason = reason;
    this.status = extra.status;
    this.maxBytes = extra.maxBytes;
    this.timeoutMs = extra.timeoutMs;
    this.causeMessage = extra.causeMessage;
  }
}

export interface BoundedDownloadOptions {
  /** 总时长上限（毫秒）；必须 > 0 —— 传 0 视为误用而不是「不限」 */
  timeoutMs?: number;
  /** 总字节上限；必须 > 0 */
  maxBytes?: number;
  /** 调用方的取消信号（进程关停等）；与超时信号取并集 */
  signal?: AbortSignal;
  /** 测试注入点；生产一律用全局 fetch */
  fetchImpl?: typeof fetch;
}

function mapAbort(error: unknown, timeoutMs: number, callerSignal: AbortSignal | undefined): unknown {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") {
    return new DownloadBoundError("timeout", `download timed out after ${timeoutMs} ms`, { timeoutMs });
  }
  if (name === "AbortError") {
    if (callerSignal?.aborted) return new DownloadBoundError("aborted", "download aborted by caller");
    return new DownloadBoundError("timeout", `download aborted after ${timeoutMs} ms`, { timeoutMs });
  }
  return error;
}

async function cancelQuietly(body: ReadableStream<Uint8Array> | null | undefined): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // 取消失败不影响拒绝结论
  }
}

export async function downloadBounded(url: string, options: BoundedDownloadOptions = {}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES;
  if (!(timeoutMs > 0) || !(maxBytes > 0)) {
    throw new DownloadBoundError("bad_options", "downloadBounded requires positive timeoutMs and maxBytes", {
      timeoutMs,
      maxBytes,
    });
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;

  let res: Response;
  try {
    res = await (options.fetchImpl ?? globalThis.fetch)(url, { signal, redirect: "follow" });
  } catch (error) {
    throw mapAbort(error, timeoutMs, options.signal);
  }

  if (!res.ok) {
    // 错误页不读：可能很大，也可能带厂商配额/账号细节
    await cancelQuietly(res.body);
    throw new DownloadBoundError("http_status", `download failed: HTTP ${res.status}`, { status: res.status });
  }

  const lengthHeader = res.headers.get("content-length");
  const declared = lengthHeader === null ? null : Number(lengthHeader);
  if (declared !== null && Number.isFinite(declared) && declared > maxBytes) {
    await cancelQuietly(res.body);
    throw new DownloadBoundError("too_large", `download exceeds ${maxBytes} bytes (content-length ${declared})`, {
      maxBytes,
    });
  }

  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new DownloadBoundError(
          "too_large",
          `download exceeds ${maxBytes} bytes (read ${total} before cancel)`,
          { maxBytes },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw mapAbort(error, timeoutMs, options.signal);
  }

  return Buffer.concat(chunks);
}