import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { flagString, type ParsedArgs } from "./args";
import {
  cacheDir as cacheDirPath,
  currentProfile,
  redactedConfig,
  resolveApiBaseUrl,
  resolveWebBaseUrl,
  writeConfig,
  type OneframeConfig,
  type StoredProfile,
} from "./config";
import { buildDeeplink } from "./deeplinks";
import { CliError, usageError } from "./errors";
import { EXIT } from "./exit-codes";
import { ApiClient } from "./http";
import { readLedger, removeEntry, writeLedger } from "./ledger";
import type { BuiltinName, CommandSpec } from "./registry";
import { COMMANDS, GROUP_ORDER } from "./registry";
import { createClient, type Runtime } from "./runtime";
import { listFilesRecursive, SKILL_PKG_NAME, skillRootDir } from "./skill";
import { CLI_VERSION } from "./version";

/**
 * 纯客户端命令实现（登录/配置/工作流/等待/账本/深链）。
 *
 * 这些命令在竞品里同样是客户端实现：`workflow resume` 的本地记录
 * （`commands/workflow.md:153`）、幂等账本（`commands/ledger.md:5`）、深链
 * （`commands/deeplink.md:4`）都不在服务端。唯一例外是阶段判定——竞品放在 CLI
 * （`commands/workflow.md:5`），我方下沉到 `GET /workflow/detect`，CLI 只渲染，
 * 避免客户端各自实现一套口径。
 */

export interface BuiltinContext {
  runtime: Runtime;
  parsed: ParsedArgs;
  /** 去掉「组 + 子命令」后的位置参数 */
  args: string[];
  config: OneframeConfig;
  spec: CommandSpec;
}

export interface BuiltinResult {
  data: unknown;
  links?: Record<string, string>;
}

const TASK_TERMINAL = new Set([3, 4, 5, 7]);
const WORKFLOW_STAGES = ["project", "script", "asset", "storyboard", "render"] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

function saveConfig(runtime: Runtime, config: OneframeConfig): void {
  writeConfig(runtime.dir, config);
}

function requireProfile(config: OneframeConfig): StoredProfile {
  const profile = currentProfile(config);
  if (!profile) {
    throw new CliError("auth", "未登录：请先运行 `oneframe login`", { exitCode: EXIT.AUTH });
  }
  return profile;
}

const maskPhone = (phone: string): string =>
  phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "***";

/** `--timeout 2h|30m|90s|1500ms` → 毫秒；未给时用 fallback（task.md:85：默认无超时） */
export function parseDuration(raw: string | undefined, fallbackMs: number): number {
  if (!raw) return fallbackMs;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(raw.trim());
  if (!match) {
    throw usageError(`--timeout 格式不支持：${raw}（支持 30s / 5m / 2h / 1500ms）`, { flag: "timeout" });
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return Math.round(amount * factor);
}

/** 登录：三条无浏览器路径（commands/login.md:56-63）；浏览器 handoff 未实现 */
async function login(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, parsed, config } = ctx;
  const apiUrl = flagString(parsed, "api-url");
  const baseUrl = resolveApiBaseUrl(config, runtime.env, apiUrl);
  const anon = (token?: string): ApiClient =>
    new ApiClient({ baseUrl, transport: runtime.transport, token });

  const tokenFile = flagString(parsed, "token-file");
  const phone =
    flagString(parsed, "phone") ?? (typeof parsed.sets.phone === "string" ? parsed.sets.phone : undefined);
  const code =
    flagString(parsed, "code") ??
    (parsed.sets.code === undefined ? undefined : String(parsed.sets.code));

  let accessToken: string;
  let spaceId: string | undefined;
  let uid: string | undefined;

  // `--handoff`：浏览器 handoff（本机 loopback 收一次性 token）
  if (parsed.flags.handoff === true) {
    return loginViaHandoff(ctx);
  }

  if (tokenFile) {
    const raw = tokenFile === "-" ? readFileSync(0, "utf8") : readFileSync(tokenFile, "utf8");
    let token = raw.trim();
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      token = String(payload.access_token ?? payload.token ?? "").trim();
      spaceId = payload.space_id === undefined ? undefined : String(payload.space_id);
      uid = payload.uid === undefined ? undefined : String(payload.uid);
    } catch {
      // 纯 token 文本形式
    }
    if (!token) throw usageError("--token-file 内容为空或不含 access_token");
    accessToken = token;
  } else if (phone) {
    if (!code) {
      // 第一步：发验证码。非生产环境服务端回 debug_code（auth.controller.ts:28）
      const sent = await anon().call<Record<string, unknown>>({
        method: "POST",
        path: "/auth/sms-code",
        body: { phone },
      });
      return {
        data: {
          step: "sms_sent",
          phone: maskPhone(phone),
          debug_code: sent.debug_code ?? null,
          next: "oneframe login --phone <PHONE> --code <CODE>",
        },
      };
    }
    const result = await anon().call<Record<string, unknown>>({
      method: "POST",
      path: "/auth/login",
      body: { phone, code, age_confirmed: true },
    });
    accessToken = String(result.access_token ?? "");
    spaceId = result.space_id === undefined ? undefined : String(result.space_id);
    uid = String(asRecord(result.user).id ?? "");
    if (!accessToken) throw new CliError("auth", "登录响应缺少 access_token");
  } else {
    throw usageError(
      "登录方式：oneframe login --phone <PHONE> --code <CODE> · 或 --token-file <PATH|->（浏览器 handoff 未实现，见 README 未做清单）",
    );
  }

  // token 里的 sid 已够用（AuthGuard 从 token 取 space），但 --json 要给 uid/space
  const me = await anon(accessToken)
    .call<Record<string, unknown>>({ method: "GET", path: "/me" })
    .catch(() => null);
  if (me) {
    spaceId = spaceId ?? String(asRecord(me.space).id ?? "");
    uid = uid ?? String(asRecord(me.user).id ?? "");
  }
  if (!uid) throw new CliError("auth", "无法从凭据解析 uid（--token-file 需要 user_data 载荷或服务端可达）");

  const profile: StoredProfile = {
    uid,
    space_id: spaceId ?? "",
    access_token: accessToken,
    signed_in_at: runtime.now().toISOString(),
  };
  config.profiles[profile.uid] = profile;
  config.current_uid = profile.uid;
  saveConfig(runtime, config);
  return {
    data: { uid: profile.uid, space_id: profile.space_id, credential_store: "file", config_dir: runtime.dir },
  };
}

/**
 * 浏览器 handoff 登录（`login --handoff`）。
 *
 * 做法：CLI 在 **127.0.0.1** 起一个一次性回环服务，把带 nonce 的 URL 打到 stderr；
 * 用户在浏览器登录后，Web 页面把凭据 POST 回该端口（`state` 必须与 nonce 一致）。
 *
 * 为什么是 loopback 而不是"轮询服务端设备码"：服务端目前**没有** CLI 设备码/回调端点
 * （`auth.controller` 只有 sms-code/login/refresh/logout/me/oauth）。按本批约束
 * 「若需新端点写进回报、不要自己加」，这里选了不依赖新端点的方案。
 *
 * ⚠️ 端到端还需 Web 侧 ~5 行（不在本批写权限内，已登记 report「受限」）：
 * 登录页读 `?cli_handoff=<port>&state=<nonce>`，成功后
 * `fetch('http://127.0.0.1:<port>/token', {method:'POST', headers:{'content-type':'application/json'},
 *   body: JSON.stringify({ access_token, uid, space_id, state })})`。
 *
 * 安全：只监听回环；nonce 一次性且校验；默认 120s 超时后立刻关端口；收到即关闭。
 */
async function loginViaHandoff(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config, parsed } = ctx;
  const timeoutMs = parseDuration(flagString(parsed, "timeout"), 120_000);
  const nonce = randomBytes(16).toString("base64url");
  const webBase = resolveWebBaseUrl(config, runtime.env).replace(/\/+$/, "");

  let settle: ((value: Record<string, unknown>) => void) | undefined;
  const received = new Promise<Record<string, unknown>>((resolve) => {
    settle = resolve;
  });

  const server = createServer((req, res) => {
    // 浏览器从 Web 源跨端口 POST 到 127.0.0.1 必须放行（含预检）
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    const url = req.url ?? "";
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET" && url.startsWith("/health")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, state: nonce }));
      return;
    }
    if (req.method === "POST" && url.startsWith("/token")) {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          body = {};
        }
        if (body.state !== nonce) {
          res.statusCode = 403;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "state_mismatch" }));
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        settle?.(body);
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("cannot bind loopback port"));
        return;
      }
      resolve(address.port);
    });
  });

  const handoffUrl = `${webBase}/login?cli_handoff=${port}&state=${encodeURIComponent(nonce)}`;
  // URL 属于"人读信息" → stderr（`--json` 时 stdout 仍只有一个 envelope）
  runtime.stderr(`[handoff] 在浏览器打开：${handoffUrl}\n`);
  runtime.stderr(`[handoff] 等待回调（最多 ${Math.round(timeoutMs / 1000)}s），完成后凭据自动落盘\n`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    received,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  server.close();

  if (!outcome) {
    throw new CliError("timeout", `handoff 超时（${Math.round(timeoutMs / 1000)}s）：未收到浏览器回调`, {
      exitCode: EXIT.TIMEOUT,
      retryable: false,
      raw: {
        handoff_url: handoffUrl,
        hint: "Web 侧回调未接通时，改用 `login --phone <PHONE> --code <CODE>` 或 `login --token-file -`",
      },
    });
  }

  const token = String(outcome.access_token ?? outcome.token ?? "").trim();
  if (!token) throw new CliError("auth", "handoff 回调缺少 access_token");
  const baseUrl = resolveApiBaseUrl(config, runtime.env, flagString(parsed, "api-url"));
  const me = await new ApiClient({ baseUrl, transport: runtime.transport, token })
    .call<Record<string, unknown>>({ method: "GET", path: "/me" })
    .catch(() => null);
  const uid = String(outcome.uid ?? (me ? asRecord(me.user).id : "") ?? "");
  const spaceId = String(outcome.space_id ?? (me ? asRecord(me.space).id : "") ?? "");
  if (!uid) throw new CliError("auth", "handoff 回调无法解析 uid（服务端不可达？）");

  config.profiles[uid] = {
    uid,
    space_id: spaceId,
    access_token: token,
    signed_in_at: runtime.now().toISOString(),
  };
  config.current_uid = uid;
  saveConfig(runtime, config);
  return {
    data: { uid, space_id: spaceId, credential_store: "file", via: "handoff", handoff_url: handoffUrl },
  };
}

async function logout(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config } = ctx;
  const profile = currentProfile(config);
  if (!profile) return { data: { ok: true, removed: false, note: "本地无凭据" } };
  let remote = "ok";
  try {
    await createClient({ runtime, config }).call({ method: "POST", path: "/auth/logout" });
  } catch {
    // 竞品明确：网络注销失败时仍删除本地凭据（commands/logout.md:43）
    remote = "failed_local_cleared";
  }
  delete config.profiles[profile.uid];
  if (config.current_uid === profile.uid) config.current_uid = Object.keys(config.profiles)[0] ?? null;
  saveConfig(runtime, config);
  return { data: { ok: true, removed: true, uid: profile.uid, remote } };
}

async function accountInfo(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config } = ctx;
  const profile = requireProfile(config);
  const client = createClient({ runtime, config });
  const me = await client.call<Record<string, unknown>>({ method: "GET", path: "/me" });
  let permission: Record<string, unknown> | null = null;
  let permissionReady = true;
  try {
    permission = await client.call<Record<string, unknown>>({ method: "GET", path: "/cam/permission/user" });
  } catch {
    // 权限接口失败仍退出 0，只标记未就绪（commands/account.md:38）
    permissionReady = false;
  }
  return {
    data: {
      ...redactedConfig(config),
      uid: profile.uid,
      credentialStore: "file",
      account: me,
      permission_ready: permissionReady,
      permission,
    },
  };
}

function accountUse(ctx: BuiltinContext): BuiltinResult {
  const { runtime, config, args } = ctx;
  const uid = args[0];
  if (!uid) throw usageError("account use 需要 UID");
  const profile = config.profiles[uid];
  if (!profile) throw new CliError("not_found", `本地没有该账号：${uid}`, { raw: { uid } });
  config.current_uid = uid;
  saveConfig(runtime, config);
  return { data: { uid, space_id: profile.space_id, switched: true } };
}

async function workflowDetect(
  ctx: BuiltinContext,
  mode: "detect" | "status" | "resume",
): Promise<BuiltinResult> {
  const { runtime, config, parsed } = ctx;
  requireProfile(config);
  // 先做本地参数校验再发网络请求：--from 非法属于 usage（退出 2），不该先打远端
  let resumeStage: { from: string; index: number } | null = null;
  if (mode === "resume") {
    const from = flagString(parsed, "from");
    if (!from) {
      throw usageError("workflow resume 需要 --from STAGE（project|script|asset|storyboard|render）");
    }
    const index = (WORKFLOW_STAGES as readonly string[]).indexOf(from);
    if (index < 0) {
      throw usageError(`--from 只支持 ${WORKFLOW_STAGES.join("|")}`, { flag: "from" });
    }
    resumeStage = { from, index };
  }
  const scope = (flagString(parsed, "scope") ?? "studio").trim();
  if (scope !== "studio" && scope !== "canvas") {
    throw usageError("--scope 只支持 studio|canvas（workflow.md:33）", { flag: "scope" });
  }
  const projectId = flagString(parsed, "workspace") ?? config.bindings.workspace_id;
  const canvasId = flagString(parsed, "canvas") ?? config.bindings.canvas_id;
  const query: Record<string, unknown> = { scope };
  if (scope === "studio" && projectId) query.project_id = projectId;
  if (scope === "canvas" && canvasId) query.canvas_id = canvasId;

  const detection = await createClient({ runtime, config }).call<Record<string, unknown>>({
    method: "GET",
    path: "/workflow/detect",
    query,
  });
  if (mode === "detect") return { data: detection };

  const name = flagString(parsed, "name") ?? "default";
  if (mode === "status") {
    return {
      data: {
        ...detection,
        // local_record 不参与阶段判定（commands/workflow.md:157）
        local_record: config.workflow_records[name] ?? null,
      },
    };
  }

  if (!resumeStage) throw usageError("workflow resume 需要 --from STAGE");
  const { from, index } = resumeStage;
  config.workflow_records[name] = { stage: from, updated_at: runtime.now().toISOString() };
  saveConfig(runtime, config);
  const remoteIndex = (WORKFLOW_STAGES as readonly string[]).indexOf(String(detection.stage ?? ""));
  const warnings: string[] = [];
  if (remoteIndex > index) {
    // 远端已前进时不得拉回旧阶段（_stage-machine.md:105）
    warnings.push(`远端进度已到 ${String(detection.stage)}，高于 --from ${from}；按远端阶段续跑，未回退`);
  }
  return {
    data: {
      ...detection,
      from_stage: from,
      pending_from: WORKFLOW_STAGES.slice(index),
      local_record: config.workflow_records[name],
      warnings,
    },
  };
}

async function taskWait(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config, parsed, args } = ctx;
  requireProfile(config);
  const ids = args.filter((arg) => arg && !arg.startsWith("--"));
  if (ids.length === 0) throw usageError("task wait 需要至少一个 TASK_ID");
  const client = createClient({ runtime, config });
  const timeoutMs = parseDuration(flagString(parsed, "timeout"), 0);
  const deadline = timeoutMs > 0 ? runtime.now().getTime() + timeoutMs : Number.POSITIVE_INFINITY;
  const intervalMs = 2000;

  let latest: Record<string, unknown>[] = [];
  for (;;) {
    const rows = await client.call<unknown>({
      method: "GET",
      path: "/tasks",
      query: { ids: ids.join(",") },
    });
    latest = (Array.isArray(rows) ? rows : []).map((row) => asRecord(row));
    const pending = latest.filter((row) => !TASK_TERMINAL.has(Number(row.status)));
    if (parsed.json !== true) runtime.stderr(`[wait] ${latest.length - pending.length}/${ids.length} 已终态\n`);
    if (pending.length === 0) break;
    if (runtime.now().getTime() >= deadline) {
      throw new CliError(
        "timeout",
        `等待超时（${timeoutMs}ms），仍在跑：${pending.map((p) => String(p.id)).join(",")}`,
        { exitCode: EXIT.TIMEOUT, retryable: false, raw: { tasks: pending } },
      );
    }
    await runtime.sleep(intervalMs);
  }

  const failed = latest.filter((row) => Number(row.status) === 4);
  const canceled = latest.filter((row) => Number(row.status) === 5);
  const rejected = latest.filter((row) => Number(row.status) === 7);
  if (rejected.length > 0) {
    throw new CliError("moderation", `任务审核未通过：${rejected.map((r) => String(r.id)).join(",")}`, {
      exitCode: EXIT.MODERATION_REJECTED,
      raw: { tasks: rejected },
    });
  }
  if (failed.length > 0) {
    throw new CliError("task_failed", `任务失败：${failed.map((r) => String(r.id)).join(",")}`, {
      exitCode: EXIT.TASK_FAILED,
      retryable: true,
      raw: { tasks: failed },
    });
  }
  if (canceled.length > 0) {
    throw new CliError("canceled", `任务已取消：${canceled.map((r) => String(r.id)).join(",")}`, {
      exitCode: EXIT.CANCELED,
      raw: { tasks: canceled },
    });
  }
  return { data: { tasks: latest } };
}

function ledgerList(ctx: BuiltinContext): BuiltinResult {
  const { runtime, parsed } = ctx;
  const all = readLedger(runtime.dir);
  const entries = parsed.flags["in-doubt"] === true ? all.filter((e) => e.state === "in_doubt") : all;
  return {
    data: {
      entries,
      total: entries.length,
      in_doubt_count: entries.filter((e) => e.state === "in_doubt").length,
    },
  };
}

function ledgerShow(ctx: BuiltinContext): BuiltinResult {
  const { runtime, args } = ctx;
  const key = args[0];
  if (!key) throw usageError("ledger show 需要 KEY");
  const entry = readLedger(runtime.dir).find((e) => e.key === key);
  if (!entry) throw new CliError("not_found", `账本里没有该键：${key}`, { raw: { key } });
  return { data: entry };
}

function ledgerResolve(ctx: BuiltinContext): BuiltinResult {
  const { runtime, parsed, args } = ctx;
  const key = args[0];
  if (!key) throw usageError("ledger resolve 需要 KEY");
  const entries = readLedger(runtime.dir);
  const entry = entries.find((e) => e.key === key);
  if (!entry) throw new CliError("not_found", `账本里没有该键：${key}`, { raw: { key } });
  // 只处理 in_doubt：applied 删了等于放开重放保护；pending 可能有并发（ledger.md:85-87）
  if (entry.state !== "in_doubt") {
    throw new CliError("usage", `只允许解除 in_doubt，当前是 ${entry.state}`, {
      raw: { key, state: entry.state },
    });
  }
  const dryRun = parsed.flags["dry-run"] === true;
  if (!dryRun) writeLedger(runtime.dir, removeEntry(entries, key));
  return { data: { key, state: entry.state, resolved: !dryRun, dry_run: dryRun } };
}

/**
 * `task download`：把任务产物落到 `<cwd>/outputs/`（文件名 `<task_id>-<n>.<ext>`）。
 *
 * 契约（竞品 `commands/task.md:165`）：读 `task_infos[].asset_info.file_id` 下载全部产物；
 * 我方对应链路是 `GET /tasks/:id`（results 数组）→ `GET /tasks/:id/results/:n/download-url`
 * （返回预签名 URL）→ 取字节写盘。
 *
 * 两条设计约束：
 * 1. **输出里不出现签名 URL**（`download-url` 的 URL 带时效签名，等于短期凭据，
 *    与 "日志/JSON 不得出现 token/cookie"（error-codes.md:23）同一条红线）——只回本地路径与字节数；
 * 2. **单个失败不阻断整包**（对齐 `batchDownload` 的"部分成功"语义），最后汇总 `failed[]`；
 *    全部失败才算失败（400102 语义）。
 */
async function taskDownload(ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config, parsed, args } = ctx;
  requireProfile(config);
  const taskId = args[0] ?? flagString(parsed, "task-id");
  if (!taskId) throw usageError("task download 需要 TASK_ID");
  const client = createClient({ runtime, config });

  const detail = await client.call<Record<string, unknown>>({ method: "GET", path: `/tasks/${taskId}` });
  const results = Array.isArray(detail.results) ? (detail.results as Array<{ uri?: string }>) : [];
  if (results.length === 0) {
    throw new CliError("not_found", `任务 ${taskId} 没有产物（可能还在跑或已失败）`, {
      raw: { task_id: taskId, status: detail.status ?? null },
    });
  }

  const outDir = join(runtime.cwd, "outputs");
  mkdirSync(outDir, { recursive: true });

  const files: Array<{ n: number; path: string; bytes: number }> = [];
  const failed: Array<{ n: number; error: string }> = [];
  for (let index = 1; index <= results.length; index += 1) {
    try {
      const signed = await client.call<{ url?: string; filename?: string }>({
        method: "GET",
        path: `/tasks/${taskId}/results/${index}/download-url`,
      });
      if (!signed.url) throw new Error("download-url 缺少 url");
      const buffer = await runtime.fetchBinary(signed.url);
      const ext = pickExtension(signed.filename, results[index - 1]?.uri);
      const target = join(outDir, `${taskId}-${index}.${ext}`);
      writeFileSync(target, buffer);
      if (parsed.json !== true) runtime.stderr(`[download] ${target} (${buffer.length}B)\n`);
      files.push({ n: index, path: target, bytes: buffer.length });
    } catch (error) {
      failed.push({ n: index, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (files.length === 0) {
    throw new CliError("not_found", `任务 ${taskId} 的产物全部下载失败`, {
      raw: { task_id: taskId, failed },
    });
  }
  return {
    data: {
      task_id: taskId,
      dir: outDir,
      count: files.length,
      files,
      failed,
      // 明确说明：不输出签名 URL（时效凭据不进 stdout/stderr）
      url_exposed: false,
    },
  };
}

/** 扩展名优先取服务端 filename，其次取 uri，最后兜底 bin（清洗成 1~5 位字母数字） */
function pickExtension(filename: string | undefined, uri: string | undefined): string {
  const fromName = filename ? extname(filename).replace(/^\./, "") : "";
  const fromUri = uri && !uri.endsWith("/") ? extname(uri.split("?")[0]).replace(/^\./, "") : "";
  const candidate = (fromName || fromUri || "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(candidate) ? candidate : "bin";
}

function fileTreeInfo(dir: string): { entries: { name: string; files: number; bytes: number }[] } {  if (!existsSync(dir)) return { entries: [] };
  const rows = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(dir, entry.name);
      let files = 0;
      let bytes = 0;
      const walk = (target: string): void => {
        for (const child of readdirSync(target, { withFileTypes: true })) {
          const childPath = join(target, child.name);
          if (child.isDirectory()) walk(childPath);
          else {
            files += 1;
            bytes += statSync(childPath).size;
          }
        }
      };
      walk(path);
      return { name: entry.name, files, bytes };
    });
  return { entries: rows };
}

export async function runBuiltin(name: BuiltinName, ctx: BuiltinContext): Promise<BuiltinResult> {
  const { runtime, config, parsed, args, spec } = ctx;
  switch (name) {
    case "login":
      return login(ctx);
    case "logout":
      return logout(ctx);
    case "account-info":
      return accountInfo(ctx);
    case "account-use":
      return accountUse(ctx);
    case "env-info": {
      const profile = currentProfile(config);
      // 尽力而为：拿不到能力不影响 env info 的其余字段
      let media: unknown = null;
      let mediaError: string | null = null;
      try {
        const baseUrl = resolveApiBaseUrl(config, runtime.env, flagString(parsed, "api-url"));
        const res = await new ApiClient({ baseUrl, transport: runtime.transport }).call<{
          media?: unknown;
        }>({ method: "GET", path: "/meta/capabilities" });
        media = res?.media ?? null;
      } catch (error) {
        mediaError = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
      }
      return {
        data: {
          cli_version: CLI_VERSION,
          api_base_url: resolveApiBaseUrl(config, runtime.env, flagString(parsed, "api-url")),
          web_base_url: resolveWebBaseUrl(config, runtime.env),
          config_dir: runtime.dir,
          cache_dir: cacheDirPath(runtime.dir),
          uid: profile?.uid ?? null,
          space_id: profile?.space_id ?? null,
          scope: {
            workspace_id: flagString(parsed, "workspace") ?? config.bindings.workspace_id ?? null,
            canvas_id: flagString(parsed, "canvas") ?? config.bindings.canvas_id ?? null,
            source: flagString(parsed, "workspace")
              ? "flag"
              : config.bindings.workspace_id
                ? "binding"
                : "none",
          },
          env_overrides: {
            ONEFRAME_API_URL: runtime.env.ONEFRAME_API_URL ?? null,
            ONEFRAME_CONFIG_DIR: runtime.env.ONEFRAME_CONFIG_DIR ?? null,
          },
          /**
           * 服务端媒体能力（`GET /meta/capabilities`）。
           *
           * 为什么放进 `env info`：`ffmpeg` 决定"切片真裁剪 / 显式水印"能不能做，
           * 是**部署环境属性**。排障最常见的问题就是"为什么我的切片时长不对/没有水印"，
           * 答案往往在这台机器的 ffmpeg 上。直接透出，省一次翻日志。
           *
           * 探测失败**不影响命令成功**（`media:null` + `media_error`）：env info 是排障工具，
           * 不能因为一个可选能力探测失败就把整个命令打红。
           */
          media,
          media_error: mediaError,
        },
      };
    }
    case "cache-info": {
      const dir = cacheDirPath(runtime.dir);
      return { data: { cache_dir: dir, ...fileTreeInfo(dir) } };
    }
    case "cache-clear": {
      const scope = flagString(parsed, "scope");
      if (!scope) throw usageError("cache clear 需要 --scope models|env|uploads");
      if (!["models", "env", "uploads"].includes(scope)) {
        throw usageError("--scope 只支持 models|env|uploads（cache.md:44）", { flag: "scope" });
      }
      const target = join(cacheDirPath(runtime.dir), scope);
      const existed = existsSync(target);
      if (existed) rmSync(target, { recursive: true, force: true });
      return { data: { scope, cleared: existed, path: target } };
    }
    case "version":
      return { data: { name: "oneframe", version: CLI_VERSION, node: process.version } };
    case "version-check":
      // 我方无发布源清单端点 → 明确报「不可检测」，不假装是最新
      return {
        data: {
          current: CLI_VERSION,
          latest: null,
          update_available: null,
          source: "unavailable",
          reason: "我方无发布源清单端点（竞品读官网 Skill zip 的 INSTALL.md 钉死版本）；待取证",
        },
      };
    case "skill-path": {
      // 第 61 批：竞品 `INSTALL.md:17` —— 这条命令的**唯一**职责是打印「已安装包内」的
      // Skill 目录，让宿主整目录拷入/替换。所以这里不做安装、不做拷贝、不猜宿主目录
      // （`INSTALL.md:18` 明确「不要扫描其他工具的配置目录」）。
      const dir = skillRootDir();
      const files = listFilesRecursive(dir);
      const installed = files.includes("SKILL.md");
      return {
        data: {
          skill: SKILL_PKG_NAME,
          path: dir,
          installed,
          version: CLI_VERSION,
          groups: GROUP_ORDER.length,
          commands: COMMANDS.length,
          files: files.length,
          // 目录不完整时明确报出来，而不是让宿主拷走一个半成品
          note: installed
            ? "把该目录整份拷到宿主 Skill 目录；已有同名目录请先删除再拷（不要合并）"
            : "包内缺少 Skill 文件：先执行 `pnpm --filter @app/cli build` 重新生成 skills/",
        },
      };
    }
    case "workspace-use": {
      const id = args[0] ?? flagString(parsed, "workspace");
      if (!id) throw usageError("workspace use 需要 WORKSPACE_ID");
      config.bindings.workspace_id = id;
      saveConfig(runtime, config);
      return { data: { workspace_id: id, scope: parsed.flags.global === true ? "global" : "user" } };
    }
    case "workspace-show": {
      const profile = currentProfile(config);
      return {
        data: {
          workspace_id: flagString(parsed, "workspace") ?? config.bindings.workspace_id ?? null,
          canvas_id: flagString(parsed, "canvas") ?? config.bindings.canvas_id ?? null,
          space_id: profile?.space_id ?? null,
          uid: profile?.uid ?? null,
        },
      };
    }
    case "workflow-detect":
      return workflowDetect(ctx, "detect");
    case "workflow-status":
      return workflowDetect(ctx, "status");
    case "workflow-resume":
      return workflowDetect(ctx, "resume");
    case "task-wait":
      return taskWait(ctx);
    case "task-download":
      return taskDownload(ctx);
    case "ledger-list":
      return ledgerList(ctx);
    case "ledger-show":
      return ledgerShow(ctx);
    case "ledger-resolve":
      return ledgerResolve(ctx);
    case "deeplink": {
      const url = buildDeeplink(spec.cmd, {
        parsed,
        webBaseUrl: resolveWebBaseUrl(config, runtime.env),
      });
      return { data: { url }, links: { web: url } };
    }
  }
}
