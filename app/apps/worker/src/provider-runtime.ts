import { eq } from "drizzle-orm";
import { modelProviders, type Db } from "@app/db";
import type { AdapterRuntimeOptions } from "@app/model-adapters";
import { decryptProviderSecret } from "@app/shared";
import type { TaskRow } from "./executor";

export type ProviderDbResolveMode = "off" | "fallback" | "on";

export interface ProviderRouteSnapshot {
  route_id: string;
  provider_id: string;
  protocol: string;
  base_url: string;
  remote_model_id: string;
  auth_type: string;
  auth_header: string;
  provider_options: Record<string, unknown>;
  route_options: Record<string, unknown>;
}

interface RuntimeModel {
  name: string;
  capability: string;
  adapterCode: string;
}

function stringOption(
  route: Record<string, unknown>,
  provider: Record<string, unknown>,
  key: string,
): string | undefined {
  const routeValue = route[key];
  if (typeof routeValue === "string" && routeValue.trim()) return routeValue.trim();
  const providerValue = provider[key];
  return typeof providerValue === "string" && providerValue.trim() ? providerValue.trim() : undefined;
}

function numberOption(
  route: Record<string, unknown>,
  provider: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = route[key] ?? provider[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 供应商附加请求头（`provider_options.headers` / `route_options.headers`）。
 *
 * 只接受「非空字符串值」的字符串键：供应商 JSON 里塞数字/对象时宁可丢掉也不要断言失败
 * —— 这类头是通道私有要求（如 `x-opencode-session`），坏值应该表现为供应商 4xx，而不是
 * worker 启动崩。
 */
function headersOption(
  route: Record<string, unknown>,
  provider: Record<string, unknown>,
): Record<string, string> | undefined {
  const raw = route.headers ?? provider.headers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!key.trim() || !value.trim()) continue;
    out[key.trim()] = value.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 把数据库路由快照翻译成现有 AdapterRuntimeOptions。
 * 纯函数、不含 DB/解密，便于单测；unknown protocol 显式失败，不静默 mock。
 */
export function buildProviderAdapterOptions(
  base: AdapterRuntimeOptions,
  snapshot: ProviderRouteSnapshot,
  secret: string,
  model: RuntimeModel,
  /**
   * 会话上下文（用于供应商要求的 `x-opencode-session` 之类）。
   * 必须**跨请求稳定**：供应商用它做路由与 prompt cache，一次一换等于把 cache 全废。
   */
  sessionContext?: string,
): AdapterRuntimeOptions {
  const next: AdapterRuntimeOptions = { ...base };
  const providerOptions = snapshot.provider_options ?? {};
  const routeOptions = snapshot.route_options ?? {};
  const modelMap = { [model.name]: snapshot.remote_model_id };

  if (snapshot.protocol === "ark") {
    const common = {
      apiKey: secret,
      baseUrl: snapshot.base_url,
      modelMap,
      ...(numberOption(routeOptions, providerOptions, "timeout_ms")
        ? { timeoutMs: numberOption(routeOptions, providerOptions, "timeout_ms") }
        : {}),
    };
    next.ark = common;
    next.adapterHint = "ark";
    if (model.capability === "image") {
      next.arkImage = {
        ...common,
        responseFormat: stringOption(routeOptions, providerOptions, "response_format") === "b64_json" ? "b64_json" : "url",
      };
      next.adapterHint = "ark-image";
    }
    return next;
  }

  // 自建 H3 网关（自带 GPU 路线）。网关是「提交 → 排队 → 轮询 → 直传 OSS」协议，
  // 与 http-video 的差别见 packages/model-adapters/src/h3-gateway.ts 的注释。
  if (snapshot.protocol === "h3") {
    next.ark = undefined; // 路由协议优先：别让全局 Ark Key 抢走
    next.httpVideo = undefined;
    next.h3 = {
      baseUrl: snapshot.base_url,
      apiKey: secret,
      modelMap,
      ...(numberOption(routeOptions, providerOptions, "timeout_ms")
        ? { timeoutMs: numberOption(routeOptions, providerOptions, "timeout_ms") }
        : {}),
    };
    next.adapterHint = "h3";
    return next;
  }

  // 剪影生图网关：OpenAI 兼容外形，但**同步**出图且只有 image 能力（见
  // docs/02-architecture/jianying-gateway-integration.md §3）。不复用 openai-compatible 分支：
  // 那条分支按 capability 分 text/video，且依赖 GET /models 发现，套上去会走错路径。
  if (snapshot.protocol === "jianying") {
    next.ark = undefined; // 路由协议优先：别让全局 Ark Key 抢走（同 h3 口径）
    next.h3 = undefined;
    next.httpVideo = undefined;
    next.jianyingImage = {
      baseUrl: snapshot.base_url,
      apiKey: secret,
      modelMap,
      ...(numberOption(routeOptions, providerOptions, "timeout_ms")
        ? { timeoutMs: numberOption(routeOptions, providerOptions, "timeout_ms") }
        : {}),
    };
    next.adapterHint = "jianying-image";
    return next;
  }

  if (snapshot.protocol === "openai-compatible") {
    if (model.capability === "text" || model.adapterCode === "deepseek:chat") {
      // 通用 OpenAI Chat 兼容通道。供应商私有的头在这里注入，code 里不写死任何一家：
      // - `headers`：静态头（含客户端自报 UA）；
      // - `session_header`：需要「每会话稳定」的活值（OpenCode Zen Go 的 x-opencode-session），
      //   值取任务的 space_id —— 同一空间内所有会话共用一个会话键，稳定且能吃到 prompt cache。
      const headers = headersOption(routeOptions, providerOptions);
      const sessionHeader = stringOption(routeOptions, providerOptions, "session_header");
      if (sessionHeader) {
        // 供应商明确要求会话头：没有上下文时**不能静默省略**——那样只会得到
        // 难查的上游 4xx 或路由/cache 错乱（供应商的报错文案通常不会提到缺头）。
        if (!sessionContext) {
          throw new Error(
            `provider requires "${sessionHeader}" but no session context is available (task space is missing)`,
          );
        }
        Object.assign(headers ?? {}, { [sessionHeader]: sessionContext });
      }
      next.deepseek = {
        apiKey: secret,
        baseUrl: snapshot.base_url,
        model: snapshot.remote_model_id,
        ...(headers ? { extraHeaders: headers } : {}),
      };
      next.adapterHint = "deepseek";
      return next;
    }
    if (model.capability === "video") {
      next.ark = undefined;
      next.h3 = undefined;
      next.httpVideo = {
        apiKey: secret,
        baseUrl: snapshot.base_url,
        modelMap,
        submitPath: stringOption(routeOptions, providerOptions, "submit_path"),
        pollPath: stringOption(routeOptions, providerOptions, "poll_path"),
        cancelPath: stringOption(routeOptions, providerOptions, "cancel_path"),
      };
      next.adapterHint = "http-video";
      return next;
    }
    throw new Error(
      `provider protocol openai-compatible does not support capability ${model.capability} in current adapter registry`,
    );
  }

  if (snapshot.protocol === "http-video") {
    next.ark = undefined;
    next.h3 = undefined;
    next.httpVideo = {
      apiKey: secret,
      baseUrl: snapshot.base_url,
      modelMap,
      submitPath: stringOption(routeOptions, providerOptions, "submit_path"),
      pollPath: stringOption(routeOptions, providerOptions, "poll_path"),
      cancelPath: stringOption(routeOptions, providerOptions, "cancel_path"),
      ...(numberOption(routeOptions, providerOptions, "timeout_ms")
        ? { timeoutMs: numberOption(routeOptions, providerOptions, "timeout_ms") }
        : {}),
    };
    next.adapterHint = "http-video";
    return next;
  }

  throw new Error(`unsupported provider protocol: ${snapshot.protocol}`);
}

function snapshotOf(task: TaskRow): ProviderRouteSnapshot | undefined {
  const raw = task.routeSnapshot;
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.provider_id !== "string" || typeof record.base_url !== "string") return undefined;
  return {
    route_id: typeof record.route_id === "string" ? record.route_id : "",
    provider_id: record.provider_id,
    protocol: typeof record.protocol === "string" ? record.protocol : "",
    base_url: record.base_url,
    remote_model_id: typeof record.remote_model_id === "string" ? record.remote_model_id : "",
    auth_type: typeof record.auth_type === "string" ? record.auth_type : "bearer",
    auth_header: typeof record.auth_header === "string" ? record.auth_header : "Authorization",
    provider_options:
      record.provider_options && typeof record.provider_options === "object"
        ? (record.provider_options as Record<string, unknown>)
        : {},
    route_options:
      record.route_options && typeof record.route_options === "object"
        ? (record.route_options as Record<string, unknown>)
        : {},
  };
}

/**
 * 任务执行前解析供应商配置。轮询阶段不调用本函数：
 * worker 只在 submit 前解析一次，并把 base_url/remote_model_id 固化在 tasks.route_snapshot。
 */
export async function resolveTaskAdapterOptions(args: {
  db: Db;
  task: TaskRow;
  model: RuntimeModel;
  base: AdapterRuntimeOptions;
  mode: ProviderDbResolveMode;
  secretKey: Buffer;
}): Promise<AdapterRuntimeOptions> {
  if (args.mode === "off") return args.base;
  const snapshot = snapshotOf(args.task);
  if (!snapshot) {
    if (args.mode === "on") {
      throw new Error("invalid provider config: task has no route snapshot and PROVIDER_DB_RESOLVE=on");
    }
    return args.base;
  }

  let providerId: bigint;
  try {
    providerId = BigInt(snapshot.provider_id);
  } catch {
    throw new Error("invalid provider config: route snapshot has invalid provider_id");
  }
  const [provider] = await args.db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.id, providerId))
    .limit(1);
  if (!provider) throw new Error("invalid provider config: provider no longer exists");

  const aad = `provider:${provider.id}:v${provider.credentialVersion}`;
  let secret: string;
  try {
    secret = decryptProviderSecret(provider.credentialsCiphertext, aad, args.secretKey);
  } catch {
    throw new Error("invalid provider config: credential decrypt failed");
  }
  // 会话键取 space_id：同空间稳定（prompt cache 有效），不会因为一次一换而退化
  return buildProviderAdapterOptions(
    args.base,
    snapshot,
    secret,
    args.model,
    args.task.spaceId == null ? undefined : String(args.task.spaceId),
  );
}
