import { ErrorCode } from "@app/shared";

/**
 * P10 出站素材 URI 解析（单一位置）
 *
 * 真实适配器（Ark/Kling/Vidu…）需要**公网可访问**的素材 URL；tasks.input 里存的可能是
 * storage key（如 `u/<space>/assets/<id>/orig.png`，无 scheme），直接发给供应商必然访问不到。
 * 因此在 worker 调用适配器前统一转换：
 *   - ADAPTER_MODE=mock：**完全保持现状**（raw key 原样透传，本地/CI 不依赖公网）
 *   - ADAPTER_MODE=real：
 *       · 无 scheme 的值视为 storage key → storage.signDownload(key, ttl)
 *       · 已是 http(s) 的值 → 原样透传（兼容历史数据/外部 URL）
 *       · 其它 scheme（mock://、ftp:// …）→ 明确报错（不可直接给真实供应商）
 *       · 签名后校验 URL 是否公网可达（拦截 loopback）→ 否则不调用供应商，任务失败并给出可行动提示
 *   - **只产出站 payload；tasks.input 落库仍是 raw key**（本模块不写 DB、不修改入参对象）
 */
export interface OutboundInput {
  prompt?: string;
  reference_uris?: string[];
  first_frame_uri?: string | null;
  last_frame_uri?: string | null;
  [key: string]: unknown;
}

export interface OutboundUriOptions {
  adapterMode: "mock" | "real";
  /** storage.signDownload 的适配器（注入便于单测） */
  sign: (key: string, ttlSeconds: number) => Promise<string>;
  /** 签名有效期（秒）；默认 6h，可用 ADAPTER_URI_TTL_SECONDS 覆盖，覆盖供应商长任务 */
  ttlSeconds?: number;
  logger?: (obj: Record<string, unknown>, msg: string) => void;
  /** 公网可达性判断（默认仅拦截 loopback；真实网络可达性无法静态证明） */
  isPublicUrl?: (url: string) => boolean;
}

export const DEFAULT_ADAPTER_URI_TTL_SECONDS = 21_600;

export const PUBLIC_STORAGE_HINT =
  "请配置 STORAGE_DRIVER=s3 或把 STORAGE_PUBLIC_BASE 设为公网地址";

/** 真实模式出站 URI 不可用（任务会按 VENDOR_ERROR 失败，worker 不崩） */
export class OutboundUriError extends Error {
  readonly code = ErrorCode.VENDOR_ERROR;
  readonly hint = PUBLIC_STORAGE_HINT;

  constructor(message: string) {
    super(message);
    this.name = "OutboundUriError";
  }
}

const HTTP_SCHEME = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 是否 http(s) URL（真实模式直接透传） */
export function isHttpUrl(value: string): boolean {
  return HTTP_SCHEME.test(value.trim());
}

/** 是否 loopback 主机（127.0.0.1 / localhost / 0.0.0.0 / ::1，含 *.localhost） */
export function isLoopbackUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

function originOf(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value.slice(0, 120);
  }
}

async function resolveOne(
  value: string | null | undefined,
  field: keyof OutboundInput,
  opts: OutboundUriOptions,
  ttlSeconds: number,
): Promise<string | null | undefined> {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  // 空串/空白：安全跳过（保持原值，由下游自行忽略）
  if (trimmed.length === 0) return value;

  let outbound: string;
  if (HTTP_SCHEME.test(trimmed)) {
    outbound = trimmed; // 已是公网/外链：透传，不重复签名
  } else if (ANY_SCHEME.test(trimmed)) {
    throw new OutboundUriError(
      `real 适配器无法访问非 http(s) 素材 URI（${String(field)}: ${trimmed.slice(0, 80)}）`,
    );
  } else {
    // 无 scheme → 视为 storage key，签成带时效的公网 URL
    outbound = await opts.sign(trimmed, ttlSeconds);
  }

  const publicOk = (opts.isPublicUrl ?? ((url: string) => !isLoopbackUrl(url)))(outbound);
  if (!publicOk) {
    const origin = originOf(outbound);
    opts.logger?.(
      { field, url: origin, hint: PUBLIC_STORAGE_HINT },
      "outbound uri is not publicly reachable for real adapter",
    );
    throw new OutboundUriError(
      `real 适配器需要公网可访问的存储：${PUBLIC_STORAGE_HINT}（当前 ${origin}）`,
    );
  }
  return outbound;
}

/**
 * 解析出站 input：仅 real 模式做签名/守卫；返回新对象（不修改入参，tasks.input 保持 raw key）。
 * 覆盖所有生成类任务（视频 reference/first/last frame 与 studio_asset_image 的参考图）。
 */
export async function resolveOutboundUris<T extends OutboundInput>(
  input: T,
  opts: OutboundUriOptions,
): Promise<T> {
  if (opts.adapterMode !== "real") return input; // mock：零改动
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_ADAPTER_URI_TTL_SECONDS;

  const referenceUris = Array.isArray(input.reference_uris)
    ? await Promise.all(
        input.reference_uris.map((uri) => resolveOne(uri, "reference_uris", opts, ttlSeconds)),
      )
    : input.reference_uris;
  const firstFrameUri = await resolveOne(input.first_frame_uri, "first_frame_uri", opts, ttlSeconds);
  const lastFrameUri = await resolveOne(input.last_frame_uri, "last_frame_uri", opts, ttlSeconds);

  return {
    ...input,
    ...(input.reference_uris !== undefined ? { reference_uris: referenceUris } : {}),
    ...(input.first_frame_uri !== undefined ? { first_frame_uri: firstFrameUri } : {}),
    ...(input.last_frame_uri !== undefined ? { last_frame_uri: lastFrameUri } : {}),
  };
}
