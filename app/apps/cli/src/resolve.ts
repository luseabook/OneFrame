import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { usageError } from "./errors";
import type { ParsedArgs } from "./args";
import { flagString } from "./args";
import type { OneframeConfig } from "./config";
import type { CommandSpec } from "./registry";

/**
 * 把「命令行输入」翻译成「要发出去的请求」——纯函数，不碰网络（单测直接断言）。
 *
 * 作用域解析优先级照竞品 `commands/workspace.md:193`：
 * 显式 flag > 环境变量 > 项目绑定 > 用户级绑定 > 凭据里的空间。
 * 这里实现前三档；环境变量在 cli.ts 里先并进 flags。
 */

/** 占位符 → 兜底 flag（`--workspace` 即 `--project_id`，对齐竞品 `--workspace SP_ID`） */
export const PLACEHOLDER_FLAGS: Record<string, string> = {
  project_id: "workspace",
  canvas_id: "canvas",
  episode_id: "episode",
  node_id: "node",
  task_id: "task-id",
  template_id: "template-id",
  session_id: "session-id",
  slot: "slot",
  group_id: "group",
  asset_id: "asset-id",
  storyboard_id: "storyboard",
  export_id: "export-id",
};

/** 占位符 → 本地绑定键（`workspace use` / `--global` 写入的绑定） */
const PLACEHOLDER_BINDINGS: Record<string, keyof OneframeConfig["bindings"]> = {
  project_id: "workspace_id",
  canvas_id: "canvas_id",
};

export interface ResolveContext {
  args: readonly string[];
  parsed: ParsedArgs;
  config: OneframeConfig;
  cwd: string;
}

export interface ResolvedRequest {
  params: Record<string, string>;
  /** 位置参数里没被路径消耗掉的部分（供 transform / 其它用途） */
  rest: string[];
}

export function resolvePathParams(spec: CommandSpec, ctx: ResolveContext): ResolvedRequest {
  const params: Record<string, string> = {};
  const slots = spec.slots ?? [];
  const args = [...ctx.args];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (!slot) continue;
    const value = args[i];
    if (value !== undefined && value !== "") params[slot] = value;
  }

  const template = spec.path ?? "";
  for (const match of template.matchAll(/\{([a-z_]+)\}/g)) {
    const key = match[1];
    if (params[key]) continue;
    const flagName = PLACEHOLDER_FLAGS[key];
    const fromFlag = flagName ? flagString(ctx.parsed, flagName) : undefined;
    const bindingKey = PLACEHOLDER_BINDINGS[key];
    const fromBinding = bindingKey ? ctx.config.bindings[bindingKey] : undefined;
    const value = fromFlag ?? fromBinding;
    if (value) {
      params[key] = value;
      continue;
    }
    throw usageError(
      `missing ${key}：请传位置参数或 --${flagName ?? key.replace(/_/g, "-")}${bindingKey ? "（也可先 workspace use / canvas 绑定）" : ""}`,
      { missing: [key] },
    );
  }

  return { params, rest: args.slice(slots.filter(Boolean).length) };
}

/** 把 `{placeholders}` 替换成实参 */
export function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw usageError(`missing path parameter: ${key}`, { missing: [key] });
    return encodeURIComponent(value);
  });
}

/**
 * GET 查询串：`--set` 只在白名单内生效（避免把 `--set name=x` 之类的脏键发给服务端）。
 * 额外做两处竞品别名映射：
 * - `model list --type image|text` → `capability`（`text` 是 `file` 的别名，model.md:33）
 * - `--sp-type` 我方模型表无该维度 → 不发送，由调用方在 stderr 看到提示
 */
export function buildQuery(
  spec: CommandSpec,
  parsed: ParsedArgs,
  warnings?: string[],
): Record<string, unknown> {
  const query: Record<string, unknown> = { ...(spec.fixedQuery ?? {}) };
  if (spec.write === true) {
    // 写命令的 `--set` 全部进 body（见 buildBody），这里既不收 query，也不该报
    // 「不接受 --set」——那条警告是给 GET 命令防脏键用的，写命令上它是错的提示。
    return query;
  }
  if (spec.queryKeys === undefined) {
    // 没有声明白名单的 GET（如 node get）不收 --set，避免把脏键发给服务端
    if (Object.keys(parsed.sets).length > 0) {
      warnings?.push(`该命令不接受 --set（已忽略：${Object.keys(parsed.sets).join(",")}）`);
    }
    return query;
  }
  for (const key of spec.queryKeys) {
    if (parsed.sets[key] !== undefined) query[key] = parsed.sets[key];
    if (parsed.updates[key] !== undefined) query[key] = parsed.updates[key];
  }

  if (spec.group === "model") {
    const type = flagString(parsed, "type") ?? (typeof query.capability === "string" ? query.capability : undefined);
    if (type) {
      const normalized = type === "text" || type === "文本" ? "file" : type;
      query.capability = normalized;
    }
    if (flagString(parsed, "sp-type")) {
      warnings?.push("--sp-type 在我方模型表中没有对应维度（模型表不分 2D/真人），已忽略");
    }
    if (parsed.flags["offline-models"] === true) {
      warnings?.push("--offline-models 不适用：我方模型目录只来自服务端 GET /models，无本地静态目录");
    }
  }
  return query;
}

/** 写命令请求体：`--set`/`--update` + 位置参数映射 + flag 映射 + 固定常量 */
export function buildBody(spec: CommandSpec, ctx: ResolveContext): unknown {
  // 固定常量放最前，`--set` 显式传值可覆盖（confirm 默认 status=2，但仍允许 `--set status=1`）
  const body: Record<string, unknown> = {
    ...(spec.fixedBody ?? {}),
    ...ctx.parsed.sets,
    ...ctx.parsed.updates,
  };

  for (const param of spec.bodyParams ?? []) {
    if (param.as === "array") {
      const values = ctx.args.slice(param.index).filter((v) => v !== "");
      if (values.length === 0) continue;
      body[param.key] = values;
      continue;
    }
    if (param.as === "reference_uri") {
      // 工具箱 `POST /generations` 的入参形状：`input.reference_uris: string[]`。
      // 位置参数只给一个 URI，这里包成数组，并保留 fixedBody/--set 可能写进 input 的其他字段。
      const value = ctx.args[param.index];
      if (value === undefined || value === "") continue;
      const current = (body[param.key] as Record<string, unknown> | undefined) ?? {};
      body[param.key] = { ...current, reference_uris: [value] };
      continue;
    }
    const value = ctx.args[param.index];
    if (value === undefined || value === "") continue;
    body[param.key] = param.as === "number" ? Number(value) : value;
  }

  for (const [flag, key] of Object.entries(spec.flagBody ?? {})) {
    const value = flagString(ctx.parsed, flag);
    if (value !== undefined) body[key] = value;
  }
  return body;
}

/** `upload PATH`：读文件转 base64（我方 POST /projects/parse-script 的既有入参形状） */
export function buildUploadBody(ctx: ResolveContext): unknown {
  const path = ctx.args[0];
  if (!path) throw usageError("upload 需要本地文件路径");
  const absolute = resolve(ctx.cwd, path);
  const buffer = readFileSync(absolute);
  return {
    file_name: basename(absolute),
    file_base64: buffer.toString("base64"),
  };
}
