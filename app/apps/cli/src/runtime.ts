import {
  configDir as defaultConfigDir,
  DEFAULT_API_BASE_URL,
  readConfig,
  type OneframeConfig,
} from "./config";
import { ApiClient, fetchTransport, type Transport } from "./http";

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
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export interface RuntimeOverrides extends Partial<Runtime> {
  env?: NodeJS.ProcessEnv;
}

const nodeFetchBinary = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

export function createRuntime(overrides: RuntimeOverrides = {}): Runtime {
  const env = overrides.env ?? process.env;
  return {
    env,
    cwd: overrides.cwd ?? process.cwd(),
    dir: overrides.dir ?? defaultConfigDir(env),
    transport: overrides.transport ?? fetchTransport(),
    fetchBinary: overrides.fetchBinary ?? nodeFetchBinary,
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
