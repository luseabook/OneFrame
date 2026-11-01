import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOWNLOAD_MAX_BYTES,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DownloadBoundError,
  downloadBounded,
} from "./http-bounded";

const encoder = new TextEncoder();

/** 拉取式流：`pull` 才发下一块，因此「消费方提前关闭」会真的走到 underlying `cancel` */
function pullStream(chunks: string[], onCancel: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
    cancel() {
      onCancel();
    },
  });
}

function jsonResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  return new Response(pullStream(chunks, () => undefined), { headers });
}

/** 永不结束的响应：只有 abort 信号能让 read 结束（模拟「连上了但不发完」） */
const hangingFetch: typeof fetch = async (_url, init) => {
  const signal = init?.signal ?? undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  );
};

const catchError = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as DownloadBoundError,
  );

/**
 * 第 119 批：worker 的导出与 CLI 的下载此前是裸 `fetch()` + `arrayBuffer()` ——
 * 既没有超时也没有字节上限。这里把「超时 / 声明超限 / 流式超限 / 非 2xx / 调用方取消 /
 * 网络错误 / 边界恰好 / 拒绝无上限参数」九条钉死，全部用注入的 fetch 替身，不联网。
 */
describe("downloadBounded（第 119 批）", () => {
  it("正常下载：拼接全部块，并把带信号的 init 传给 fetch", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return jsonResponse(["hello ", "world"]);
    }) as typeof fetch;

    const bytes = await downloadBounded("https://cdn.test/a.bin", { fetchImpl });

    expect(bytes.toString("utf8")).toBe("hello world");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(seen?.redirect).toBe("follow");
  });

  it("默认上限是 5 分钟 / 256MiB", () => {
    expect(DEFAULT_DOWNLOAD_TIMEOUT_MS).toBe(5 * 60_000);
    expect(DEFAULT_DOWNLOAD_MAX_BYTES).toBe(256 * 1024 * 1024);
  });

  it("content-length 声明超限：不读 body，直接 cancel", async () => {
    let cancelled = false;
    const fetchImpl = (async () =>
      new Response(pullStream(["x"], () => {
        cancelled = true;
      }), { headers: { "content-length": "2048" } })) as typeof fetch;

    const error = await catchError(downloadBounded("https://cdn.test/big.bin", { fetchImpl, maxBytes: 1024 }));

    expect(error?.reason).toBe("too_large");
    expect(error?.maxBytes).toBe(1024);
    expect(cancelled).toBe(true);
  });

  it("chunked 流式超限：超限那一块就停，cancel 后不再读完", async () => {
    let cancelled = false;
    let pulled = 0;
    const fetchImpl = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(encoder.encode("0123456789"));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream);
    }) as typeof fetch;

    const error = await catchError(downloadBounded("https://cdn.test/stream.bin", { fetchImpl, maxBytes: 25 }));

    expect(error?.reason).toBe("too_large");
    expect(cancelled).toBe(true);
    // 10 + 10 + 10 > 25 时立刻停：流可能预取一块（pull 调度是实现的自由），
    // 但绝不会读完 —— 这个流是无限的，真读完的话用例会挂住。
    expect(pulled).toBeLessThanOrEqual(4);
    expect(pulled).toBeGreaterThanOrEqual(3);
  });

  it("非 2xx：不读错误页，cancel 后抛 http_status（保留状态码）", async () => {
    let cancelled = false;
    const fetchImpl = (async () =>
      new Response(pullStream(["quota exceeded for account x"], () => {
        cancelled = true;
      }), { status: 429 })) as typeof fetch;

    const error = await catchError(downloadBounded("https://cdn.test/a.mp4", { fetchImpl }));

    expect(error?.reason).toBe("http_status");
    expect(error?.status).toBe(429);
    expect(error?.message).toContain("429");
    expect(error?.message).not.toContain("quota exceeded");
    expect(cancelled).toBe(true);
  });

  it("超时：body 读到一半也会被 AbortSignal.timeout 掐断", async () => {
    const started = Date.now();
    const error = await catchError(downloadBounded("https://cdn.test/hang.mp4", { fetchImpl: hangingFetch, timeoutMs: 30 }));

    expect(error?.reason).toBe("timeout");
    expect(error?.timeoutMs).toBe(30);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("调用方取消：与超时区分开（reason=aborted）", async () => {
    const controller = new AbortController();
    const pending = downloadBounded("https://cdn.test/hang.mp4", {
      fetchImpl: hangingFetch,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    const error = await catchError(pending);

    expect(error?.reason).toBe("aborted");
  });

  it("网络错误原样抛出（不被误判成超时）", async () => {
    const network = new TypeError("fetch failed");
    const fetchImpl = (async () => {
      throw network;
    }) as typeof fetch;

    const error = await catchError(downloadBounded("https://cdn.test/a.bin", { fetchImpl }));

    expect(error).toBe(network);
  });

  it("恰好等于上限不算超限；空 body 返回空 Buffer", async () => {
    const exact = (async () => jsonResponse(["12345"])) as typeof fetch;
    const empty = (async () => new Response(null, { status: 204 })) as typeof fetch;

    expect((await downloadBounded("https://cdn.test/a", { fetchImpl: exact, maxBytes: 5 })).toString()).toBe("12345");
    expect((await downloadBounded("https://cdn.test/b", { fetchImpl: empty })).byteLength).toBe(0);
  });

  it("拒绝「无上限」参数：0 是误用，不是关闭上限", async () => {
    const fetchImpl = (async () => jsonResponse(["x"])) as typeof fetch;

    for (const options of [{ maxBytes: 0 }, { timeoutMs: 0 }, { timeoutMs: -1 }, { maxBytes: Number.NaN }]) {
      const error = await catchError(downloadBounded("https://cdn.test/a", { fetchImpl, ...options }));
      expect(error?.reason, JSON.stringify(options)).toBe("bad_options");
    }
    expect(fetchImpl).toBeTypeOf("function");
  });
});