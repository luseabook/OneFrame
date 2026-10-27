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
}

export function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "oneframe-cli-test-"));
}

export function withProfile(dir: string, overrides: Partial<OneframeConfig> = {}): void {
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
  return { code, stdout, output, stderr, calls, dir };
}
