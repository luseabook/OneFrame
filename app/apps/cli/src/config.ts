import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * 本地配置与凭据。
 *
 * 契约来源：
 * - 凭据落盘位置与不外泄：`SKILL.md:43`、`manual/error-codes.md:23`、`commands/login.md:70`
 * - `REELMATE_CONFIG_DIR` 语义（我方对应 `ONEFRAME_CONFIG_DIR`）：`commands/workspace.md:158,194`
 * - 作用域优先级「显式 flag > 环境变量 > 项目绑定 > 用户级绑定 > 凭据空间」：
 *   `commands/workspace.md:193`
 *
 * 安全约定：配置文件按 **0600** 语义写入（POSIX 上 chmod 生效；Windows 上 mode 只是
 * 提示位，因此额外采用「先写临时文件再 rename」的原子替换，避免半截文件导致凭据损坏）。
 * 只有读取侧（`readConfig`）能拿到明文 token；任何输出路径都必须先过 `redact` 或
 * `redactedConfig`。
 */

export interface StoredProfile {
  uid: string;
  space_id: string;
  space_name?: string;
  /** 仅存本地文件，不出现在任何 stdout/stderr */
  access_token: string;
  refresh_token?: string;
  signed_in_at: string;
}

export interface WorkflowRecord {
  stage: string;
  updated_at: string;
}

export interface OneframeConfig {
  version: 1;
  api_base_url?: string;
  web_base_url?: string;
  current_uid: string | null;
  profiles: Record<string, StoredProfile>;
  bindings: { workspace_id?: string; canvas_id?: string };
  /** `workflow status/resume` 的本地备忘；**不参与**阶段判定（workflow.md:157） */
  workflow_records: Record<string, WorkflowRecord>;
}

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000/v1";
export const DEFAULT_WEB_BASE_URL = "http://127.0.0.1:3000";

export function emptyConfig(): OneframeConfig {
  return {
    version: 1,
    current_uid: null,
    profiles: {},
    bindings: {},
    workflow_records: {},
  };
}

/** 配置目录：`ONEFRAME_CONFIG_DIR` > `~/.oneframe`（0600 语义，见文件头） */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ONEFRAME_CONFIG_DIR?.trim();
  if (explicit) return explicit;
  return join(homedir(), ".oneframe");
}

export const configFile = (dir: string): string => join(dir, "config.json");
export const ledgerFile = (dir: string): string => join(dir, "state", "idempotency.json");
export const cacheDir = (dir: string): string => join(dir, "cache");

function ensureDir(path: string): void {
  const target = path.endsWith(".json") ? dirname(path) : path;
  mkdirSync(target, { recursive: true, mode: 0o700 });
}

export function readConfig(dir: string = configDir()): OneframeConfig {
  const file = configFile(dir);
  if (!existsSync(file)) return emptyConfig();
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as Partial<OneframeConfig>;
  return {
    version: 1,
    api_base_url: parsed.api_base_url,
    web_base_url: parsed.web_base_url,
    current_uid: parsed.current_uid ?? null,
    profiles: parsed.profiles ?? {},
    bindings: parsed.bindings ?? {},
    workflow_records: parsed.workflow_records ?? {},
  };
}

/** 原子写 + 0600：先写 `<file>.tmp` 再 rename，进程被中断也不会留下半截配置 */
export function writeConfig(dir: string, config: OneframeConfig): void {
  const file = configFile(dir);
  ensureDir(file);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows 上 chmod 是弱语义，失败不影响正确性（文件仍原子替换）
  }
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // 同上
  }
}

/** 作用域优先级见 workspace.md:193：显式 flag > env > 本地绑定 */
export function resolveApiBaseUrl(
  config: OneframeConfig,
  env: NodeJS.ProcessEnv = process.env,
  explicit?: string,
): string {
  return (
    explicit?.trim() ||
    env.ONEFRAME_API_URL?.trim() ||
    config.api_base_url?.trim() ||
    DEFAULT_API_BASE_URL
  );
}

export function resolveWebBaseUrl(
  config: OneframeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.ONEFRAME_WEB_BASE_URL?.trim() || config.web_base_url?.trim() || DEFAULT_WEB_BASE_URL;
}

export function currentProfile(config: OneframeConfig): StoredProfile | null {
  if (!config.current_uid) return null;
  return config.profiles[config.current_uid] ?? null;
}

/** 输出用的配置视图：**永远**不含 token/refresh_token */
export function redactedConfig(config: OneframeConfig): Record<string, unknown> {
  const current = currentProfile(config);
  return {
    current_uid: config.current_uid,
    profiles: Object.values(config.profiles).map((profile) => ({
      uid: profile.uid,
      space_id: profile.space_id,
      space_name: profile.space_name ?? null,
      signed_in_at: profile.signed_in_at,
    })),
    current: current
      ? { uid: current.uid, space_id: current.space_id, space_name: current.space_name ?? null }
      : null,
    bindings: config.bindings,
    api_base_url: config.api_base_url ?? DEFAULT_API_BASE_URL,
    web_base_url: config.web_base_url ?? DEFAULT_WEB_BASE_URL,
  };
}
