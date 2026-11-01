import { createInterface } from "node:readline";
import {
  configDir as defaultConfigDir,
  DEFAULT_API_BASE_URL,
  readConfig,
  type OneframeConfig,
} from "./config";
import { ApiClient, fetchTransport, type Transport, type TransportRequest } from "./http";

/** 一条 SSE 长连接的句柄（`agent enter`/`run` 消费事件用） */
export interface StreamHandle {
  status: number;
  /** 逐块产出**已解码**的文本；调用方负责按 SSE 帧语法切分 */
  chunks: AsyncIterable<string>;
  /**
   * 主动切断底层连接。
   *
   * 为什么必须提供：SSE 响应体永不结束，拿到终态（或超时）后如果只是「不再读」，
   * 那条 socket 上的 read 会一直挂着，Node 进程就不退出 —— 表现为「信封已经打到
   * stdout 了，命令却迟迟不回 shell」。第 78 批实测踩到：`agent run --follow` 在
   * 拿到 `agent_message` 后进程仍存活。
   */
  cancel?: () => void;
}

/**
 * 打开裸字节流的注入点。
 *
 * 为什么不能复用 {@link Transport}：传输层刻意只回 `{status, body:string}`（一次读完、
 * 能安全 JSON.parse），而 SSE 是「一条连接 + 持续增量」，两者语义相反。硬塞进同一个
 * 接口会让「进度条卡住直到整轮结束」——那正是本批要修的问题。
 */
export type StreamOpener = (req: TransportRequest) => Promise<StreamHandle>;

const nodeOpenStream: StreamOpener = async (req) => {
  // 用一个可 abort 的控制器：终态/超时后由调用方 `cancel()` 切断，避免挂起的 read 拖住进程
  const controller = new AbortController();
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: controller.signal,
  });
  const body = res.body;
  async function* iterate(): AsyncGenerator<string> {
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield decoder.decode(value, { stream: true });
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } catch {
      // 主动 abort 会让 read 抛 AbortError：这是正常收尾，不是错误
    } finally {
      reader.releaseLock();
    }
  }
  return { status: res.status, chunks: iterate(), cancel: () => controller.abort() };
};

/**
 * 默认的「读一行」：交互式 REPL 用。
 *
 * 惰性创建 readline 接口（测试注入时不会碰真实 stdin）；`crlfDelay: Infinity`
 * 让 Windows 的 `\r\n` 被当成一个换行，避免每行末尾带一个 `\r` 进请求体。
 */
let stdinLines: AsyncIterator<string> | null = null;
const nodeReadLine = async (): Promise<string | null> => {
  if (!stdinLines) {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    stdinLines = rl[Symbol.asyncIterator]();
  }
  const next = await stdinLines.next();
  return next.done ? null : next.value;
};

/**
 * 运行时依赖注入点。
 *
 * 为什么把 io / transport / 时钟 / 配置目录都做成可注入：CLI 的绝大部分行为是
 * 「把输入翻译成请求」和「把响应翻译成退出码」，这两件事必须能脱离网络与真实
 * HOME 目录做单测（见 test/*.spec.ts）。真实入口 `index.ts` 用默认值。
 */
export interface Runtime {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** 配置目录（默认 `~/.oneframe`，可用 ONEFRAME_CONFIG_DIR 覆盖） */
  dir: string;
  transport: Transport;
  /** 二进制下载（`task download` 落盘用；与 JSON transport 分开，测试可独立注入） */
  fetchBinary: (url: string) => Promise<Buffer>;
  /** SSE 裸流（`agent enter`/`run`；见 {@link StreamOpener}） */
  openStream: StreamOpener;
  /** 交互式输入一行；EOF 返回 null（`agent enter` 的 REPL 用） */
  readLine: () => Promise<string | null>;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export interface RuntimeOverrides extends Partial<Runtime> {
  env?: NodeJS.ProcessEnv;
}

/**
 * 第 119 批：`task download` 拉的是供应商签名 URL —— 原来裸 `fetch()` + `arrayBuffer()`，
 * 既没有超时（CDN 连上不发完就永远挂着，Ctrl-C 之外没有出路）也没有字节上限（发 4GB 直接 OOM）。
 *
 * 为什么不复用 `@app/shared` 的 `downloadBounded`：CLI 是**零运行时依赖**包（见 http.ts 顶部
 * 的说明：Node 20+ 自带 fetch），引入 workspace 依赖会把整棵共享包拖进分发产物；这里保持
 * 同样的双上限语义，实现留在本文件内，并由静态守卫 `outbound-fetch-bounds.spec.ts` 盯住。
 */
const CLI_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const CLI_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

const isAbortLike = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

const cancelBodyQuietly = async (body: ReadableStream<Uint8Array> | null | undefined): Promise<void> => {
  try {
    await body?.cancel();
  } catch {
    // 取消失败不影响拒绝结论
  }
};

const nodeFetchBinary = async (url: string): Promise<Buffer> => {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(CLI_DOWNLOAD_TIMEOUT_MS), redirect: "follow" });
  } catch (error) {
    if (isAbortLike(error)) throw new Error(`download timed out after ${CLI_DOWNLOAD_TIMEOUT_MS} ms`);
    throw error;
  }
  if (!res.ok) {
    // 错误页不读（可能很大，也可能带厂商配额信息）
    await cancelBodyQuietly(res.body);
    throw new Error(`download failed: HTTP ${res.status}`);
  }

  const lengthHeader = res.headers.get("content-length");
  const declared = lengthHeader === null ? null : Number(lengthHeader);
  if (declared !== null && Number.isFinite(declared) && declared > CLI_DOWNLOAD_MAX_BYTES) {
    await cancelBodyQuietly(res.body);
    throw new Error(`download exceeds ${CLI_DOWNLOAD_MAX_BYTES} bytes (content-length ${declared})`);
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
      if (total > CLI_DOWNLOAD_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`download exceeds ${CLI_DOWNLOAD_MAX_BYTES} bytes (read ${total} before cancel)`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isAbortLike(error)) throw new Error(`download timed out after ${CLI_DOWNLOAD_TIMEOUT_MS} ms`);
    throw error;
  }
  return Buffer.concat(chunks);
};

export function createRuntime(overrides: RuntimeOverrides = {}): Runtime {
  const env = overrides.env ?? process.env;
  return {
    env,
    cwd: overrides.cwd ?? process.cwd(),
    dir: overrides.dir ?? defaultConfigDir(env),
    transport: overrides.transport ?? fetchTransport(),
    fetchBinary: overrides.fetchBinary ?? nodeFetchBinary,
    openStream: overrides.openStream ?? nodeOpenStream,
    readLine: overrides.readLine ?? nodeReadLine,
    stdout: overrides.stdout ?? ((chunk) => process.stdout.write(chunk)),
    stderr: overrides.stderr ?? ((chunk) => process.stderr.write(chunk)),
    now: overrides.now ?? (() => new Date()),
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export interface ClientOptions {
  runtime: Runtime;
  config: OneframeConfig;
  /** 显式 --api-url（优先级最高） */
  apiUrl?: string;
  /** 显式 --space（覆盖凭据里的空间） */
  spaceId?: string;
  /** 是否带上凭据（登录类命令不需要） */
  authenticated?: boolean;
}

/** 从配置解析出带凭据的客户端（作用域优先级见 workspace.md:193） */
export function createClient(opts: ClientOptions): ApiClient {
  const { runtime, config } = opts;
  const explicit =
    opts.apiUrl ??
    (typeof runtime.env.ONEFRAME_API_URL === "string" ? runtime.env.ONEFRAME_API_URL : undefined);
  const baseUrl = explicit?.trim() || config.api_base_url?.trim() || DEFAULT_API_BASE_URL;
  const profile = config.current_uid ? config.profiles[config.current_uid] : undefined;
  const authenticated = opts.authenticated !== false;
  return new ApiClient({
    baseUrl,
    transport: runtime.transport,
    token: authenticated ? profile?.access_token : undefined,
    spaceId: opts.spaceId ?? (authenticated ? profile?.space_id : undefined),
  });
}

export function requireProfile(config: OneframeConfig) {
  const profile = config.current_uid ? config.profiles[config.current_uid] : undefined;
  return profile ?? null;
}

export const readRuntimeConfig = (runtime: Runtime): OneframeConfig => readConfig(runtime.dir);
