import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig, type OneframeConfig } from "../src/config";
import { run } from "../src/cli";
import type { Transport, TransportRequest, TransportResponse } from "../src/http";

/**
 * 测试脚手架：用临时配置目录 + 可注入 transport 跑**真实**的 run() 主流程。
 *
 * 为什么不用 mock 掉 run 的内部：本批最容易回归的恰恰是「stdout 该只出什么」
 * 「dry-run 有没有真的不发请求」「幂等键有没有进 header」——这些都只能在
 * run() 层断言，mock 到内部函数就测不到了。
 */
export interface HarnessResult {
  code: number;
  stdout: string;
  /** stdout 解析后的 envelope（断言形状用） */
  output: Record<string, unknown>;
  stderr: string;
  /** 实际发出的请求（dry-run 场景应为空） */
  calls: TransportRequest[];
  /** 实际发生的二进制下载 URL（断言"没泄露签名 URL"时也能对照） */
  binaryCalls: string[];
  /** 实际打开的 SSE 流请求（断言 URL/头） */
  streamCalls: TransportRequest[];
  /** 被 cancel 的流数量（每条流收尾时必须 cancel，否则进程挂住） */
  streamCancels: number;
  dir: string;
}

export interface HarnessOptions {
  /** 有值时作为 transport 应答；缺省用「空成功」应答 */
  respond?: (req: TransportRequest) => TransportResponse | Promise<TransportResponse>;
  /** 预置配置（写入临时 dir） */
  config?: (dir: string) => OneframeConfig;
  /** 复用已有 dir（多次调用共享配置） */
  dir?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  cleanup?: boolean;
  /** 二进制下载注入（`task download` 落盘用）；缺省返回固定字节，测试可断言落盘内容 */
  fetchBinary?: (url: string) => Promise<Buffer>;
  /** SSE 裸流注入（`agent enter`/`run`）；缺省给一条空流（会立即 EOF） */
  stream?: (req: TransportRequest) => Promise<{ status: number; chunks: AsyncIterable<string> }>;
  /** 交互式输入注入（`agent enter` 的 REPL）；缺省视为 EOF */
  lines?: string[];
}

export function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "oneframe-cli-test-"));
}

export function withProfile(dir: string, overrides: Partial<OneframeConfig> = {}): OneframeConfig {
  const config: OneframeConfig = {
    version: 1,
    current_uid: "u-1",
    profiles: {
      "u-1": {
        uid: "u-1",
        space_id: "100",
        access_token: "test-token-should-never-leak",
        signed_in_at: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    workflow_records: {},
    ...overrides,
  };
  writeConfig(dir, config);
  // 返回同一份对象，便于 `harness(..., { config: withProfile })` 直接当注入函数用
  return config;
}

export async function harness(argv: string[], opts: HarnessOptions = {}): Promise<HarnessResult> {
  const dir = opts.dir ?? makeDir();
  if (opts.config) writeConfig(dir, opts.config(dir));
  const calls: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    if (opts.respond) return opts.respond(req);
    return { status: 200, body: JSON.stringify({ code: 0, msg: "", data: { ok: true } }) };
  };

  const binaryCalls: string[] = [];
  const fetchBinary =
    opts.fetchBinary ??
    // 默认给一段可识别字节：测试可验证"写盘的是下载到的内容"而不是占位
    (async (url: string) => Buffer.from(`binary:${url}`));

  const streamCalls: TransportRequest[] = [];
  let streamCancels = 0;
  const queue = [...(opts.lines ?? [])];
  const readLine = async (): Promise<string | null> => (queue.length > 0 ? queue.shift()! : null);

  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    dir,
    cwd: dir,
    env: {
      ONEFRAME_CONFIG_DIR: dir,
      ONEFRAME_API_URL: "http://api.test/v1",
      ONEFRAME_WEB_BASE_URL: "http://web.test",
    },
    transport,
    readLine,
    openStream: async (req) => {
      streamCalls.push(req);
      const handle = opts.stream
        ? await opts.stream(req)
        : {
            // 默认：一条立刻结束的空流（不阻塞、不假装有事件）
            status: 200,
            chunks: (async function* empty(): AsyncGenerator<string> {
              // 没有任何帧
            })(),
          };
      return {
        ...handle,
        // 包装一层：断言 CLI 在收尾时必须 cancel，否则真实环境里进程会挂着不退出
        cancel: () => {
          streamCancels += 1;
          handle.cancel?.();
        },
      };
    },
    fetchBinary: async (url: string) => {
      binaryCalls.push(url);
      return fetchBinary(url);
    },
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    now: opts.now,
    sleep: opts.sleep ?? (async () => undefined),
  });

  let output: Record<string, unknown> = {};
  try {
    output = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    output = { parse_error: true, raw: stdout };
  }

  if (opts.cleanup !== false && !opts.dir) rmSync(dir, { recursive: true, force: true });
  return { code, stdout, output, stderr, calls, dir, binaryCalls, streamCalls, streamCancels };
}
