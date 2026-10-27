import { flagBool, flagString, parseArgv, type ParsedArgs } from "./args";
import { runBuiltin } from "./builtins";
import { currentProfile, readConfig, resolveWebBaseUrl, type OneframeConfig } from "./config";
import { failure, success, type CliOutput } from "./envelope";
import { CliError, isCliError } from "./errors";
import { EXIT, KIND_EXIT, type ExitCode } from "./exit-codes";
import { commandHelp, groupHelp, resolveCommand, topLevelHelp, type Resolved } from "./help";
import { assertWritable, decideWrite, readLedger, removeEntry, upsertEntry, writeLedger } from "./ledger";
import { redact } from "./redact";
import { buildBody, buildQuery, buildUploadBody, fillPath, resolvePathParams } from "./resolve";
import { isWriteCommand } from "./registry";
import { renderHuman } from "./render";
import { createClient, createRuntime, type Runtime, type RuntimeOverrides } from "./runtime";
import { applyTransform } from "./transforms";
import { CLI_VERSION } from "./version";

/**
 * 命令执行主流程。
 *
 * 分流规则（对应 brief 的实现要点）：
 * 1. `--help` / `--version` / 无参数 → 纯文本打 stdout，退出 0；
 * 2. 纯客户端命令（`impl`）→ builtins.ts；
 * 3. 其余 → 解析路径/查询/请求体 → `--dry-run` 短路 → 幂等账本判定 → 发请求 → 整形。
 *
 * stdout 永远只写一个 envelope（envelope.ts）；进度与人类可读摘要走 stderr。
 */
export async function run(argv: readonly string[], overrides: RuntimeOverrides = {}): Promise<ExitCode> {
  const runtime = createRuntime(overrides);
  const json = argv.includes("--json");

  try {
    const parsed = parseArgv(argv);

    // 顶层帮助 / 版本：纯文本，不需要 envelope（竞品 `--version` 也是单行，version.md:31）
    if (argv.length === 0) {
      runtime.stdout(topLevelHelp());
      return EXIT.OK;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      runtime.stdout(`${CLI_VERSION}\n`);
      return EXIT.OK;
    }
    if (parsed.help) {
      runtime.stdout(renderHelp(parsed));
      return EXIT.OK;
    }

    const config = readConfig(runtime.dir);
    const resolved = resolveCommand(parsed.positionals, parsed);
    const spec = resolved.spec;

    if (!spec.ready) {
      throw new CliError(
        "unsupported",
        `${spec.group}${spec.cmd ? ` ${spec.cmd}` : ""} 尚未接入：${spec.reason ?? "依赖批次未落地"}`,
        { raw: { group: spec.group, cmd: spec.cmd, reason: spec.reason } },
      );
    }

    if (spec.impl) {
      const result = await runBuiltin(spec.impl, {
        runtime,
        parsed,
        args: resolved.args,
        config,
        spec,
      });
      return emit(runtime, success(result.data, result.links ?? {}), json);
    }

    return await runHttp(runtime, parsed, resolved, config, json);
  } catch (error) {
    const cliError = toCliError(error);
    const output = failure(cliError.kind, cliError.message, {
      raw: cliError.raw === undefined ? undefined : redact(cliError.raw),
      retryable: cliError.retryable,
    });
    return emit(runtime, output, json, exitCodeOf(cliError));
  }
}

function exitCodeOf(error: CliError): ExitCode {
  return error.exitCode ?? KIND_EXIT[error.kind] ?? EXIT.FAILURE;
}

function toCliError(error: unknown): CliError {
  if (isCliError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliError("internal", message);
}

/** stdout 只写一个 envelope；非 --json 时把人类可读摘要写 stderr */
function emit(runtime: Runtime, output: CliOutput, json: boolean, exit: ExitCode = EXIT.OK): ExitCode {
  const text = json ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  runtime.stdout(`${text}\n`);
  if (!json) runtime.stderr(renderHuman(output));
  return output.ok ? EXIT.OK : exit;
}

function renderHelp(parsed: ParsedArgs): string {
  const positionals = parsed.positionals;
  if (positionals.length === 0) return topLevelHelp();
  const group = positionals[0];
  try {
    const resolved = resolveCommand(positionals, parsed);
    return commandHelp(resolved.spec);
  } catch {
    // `--help` 不该因为缺子命令而报错，退化成组帮助
    return groupHelp(group);
  }
}

/** 请求相关链接（envelope 的 `links`）：方便调用方直接给人看网页入口 */
function buildLinks(config: OneframeConfig, env: NodeJS.ProcessEnv, params: Record<string, string>): Record<string, string> {
  const web = resolveWebBaseUrl(config, env).replace(/\/+$/, "");
  const links: Record<string, string> = {};
  if (params.project_id) links.project = `${web}/projects/${params.project_id}`;
  if (params.canvas_id) links.canvas = `${web}/canvas/${params.canvas_id}`;
  if (params.task_id) links.task = `${web}/tasks?task_id=${params.task_id}`;
  return links;
}

async function runHttp(
  runtime: ReturnType<typeof createRuntime>,
  parsed: ParsedArgs,
  resolved: Resolved,
  config: OneframeConfig,
  json: boolean,
): Promise<ExitCode> {
  const spec = resolved.spec;
  const warnings: string[] = [];
  const context = { args: resolved.args, parsed, config, cwd: runtime.cwd };

  const { params } = resolvePathParams(spec, context);
  const path = fillPath(spec.path ?? "", params);
  const pathLabel = path.startsWith("/") ? path : `/${path}`;
  const write = isWriteCommand(spec);
  const dryRun = write && flagBool(parsed, "dry-run");
  const idempotencyKey = flagString(parsed, "idempotency-key");

  let body: unknown;
  if (write) {
    body = spec.group === "upload" ? buildUploadBody(context) : buildBody(spec, context);
  }
  const query = buildQuery(spec, parsed, warnings);

  const client = createClient({
    runtime,
    config,
    apiUrl: flagString(parsed, "api-url"),
    spaceId: flagString(parsed, "space"),
  });

  // ── dry-run：只打印将发送的请求，不发请求（material.md:26 / workflow/_stage-machine.md:101）
  if (dryRun) {
    const description = client.describe({
      method: spec.method ?? "GET",
      path,
      query,
      body,
      idempotencyKey,
    });
    for (const warning of warnings) runtime.stderr(`[warn] ${warning}\n`);
    return emit(
      runtime,
      success({
        dry_run: true,
        ...description,
        credits_estimate: spec.paid
          ? {
              source: "unavailable",
              reason:
                "dry-run 不发任何请求（含报价）；需要精确试算请用 `oneframe credits estimate`",
            }
          : null,
      }),
      json,
    );
  }

  // ── 鉴权：HTTP 命令都需要登录（impl 命令自行判定）
  const profile = currentProfile(config);
  if (!profile) {
    throw new CliError("auth", "未登录：请先运行 `oneframe login`", { exitCode: EXIT.AUTH });
  }

  // ── 幂等账本三态判定（ledger.md:5-16）
  let entries = readLedger(runtime.dir);
  const forceReplay = flagString(parsed, "force-replay");
  if (write && idempotencyKey) {
    const decision = decideWrite(entries, idempotencyKey, { forceReplay });
    if (decision.action === "replay") {
      runtime.stderr(`[idempotent] 幂等键 ${idempotencyKey} 已 applied，按重放短路返回上次结果\n`);
      return emit(runtime, success(decision.entry.data ?? null, {}), json);
    }
    assertWritable(decision);
    entries = upsertEntry(entries, {
      key: idempotencyKey,
      state: "pending",
      endpoint: `${spec.method ?? "GET"} ${pathLabel}`,
      item_count: 1,
      at: runtime.now().toISOString(),
    });
    writeLedger(runtime.dir, entries);
  }

  if (!json) {
    for (const warning of warnings) runtime.stderr(`[warn] ${warning}\n`);
    runtime.stderr(`→ ${spec.method} ${pathLabel}${idempotencyKey ? ` (idempotency-key: ${idempotencyKey})` : ""}\n`);
  }

  let data: unknown;
  try {
    data = await client.call({
      method: spec.method ?? "GET",
      path,
      query,
      body,
      idempotencyKey,
    });
  } catch (error) {
    if (write && idempotencyKey) {
      const cliError = toCliError(error);
      const inDoubt = cliError.kind === "network" || cliError.kind === "timeout" || cliError.kind === "server";
      const next = inDoubt
        ? upsertEntry(entries, {
            key: idempotencyKey,
            state: "in_doubt",
            endpoint: `${spec.method ?? "GET"} ${pathLabel}`,
            item_count: 1,
            at: runtime.now().toISOString(),
            note: cliError.message,
          })
        : removeEntry(entries, idempotencyKey);
      writeLedger(runtime.dir, next);
    }
    throw error;
  }

  if (write && idempotencyKey) {
    entries = upsertEntry(entries, {
      key: idempotencyKey,
      state: "applied",
      endpoint: `${spec.method ?? "GET"} ${pathLabel}`,
      item_count: 1,
      at: runtime.now().toISOString(),
      data,
    });
    writeLedger(runtime.dir, entries);
  }

  const shaped = applyTransform(spec.transform, data, {
    nodeId: flagString(parsed, "node") ?? resolved.args[0],
    keyword: resolved.args[0],
    modelName: resolved.args[1],
    storyboardId: resolved.args[1],
  });
  const links = buildLinks(config, runtime.env, params);
  return emit(runtime, success(shaped, links), json);
}
