import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  looksLikeContentRejection,
  readVendorJson,
  VendorError,
  vendorParamError,
  vendorProtocolError,
} from "./errors";
import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

type Json = Record<string, unknown>;

/** 火山方舟图片生成（Seedream）同步接口 */
export const ARK_IMAGE_PATH = "/api/v3/images/generations";
/** 异步任务接口（若供应商返回 task id 时轮询） */
export const ARK_IMAGE_TASK_PATH = "/api/v3/contents/generations/tasks";

const VENDOR = "ark";
const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com";

export interface ArkImageConfig {
  /** ARK_API_KEY（火山方舟 Bearer Token） */
  apiKey: string;
  baseUrl?: string;
  /** 我方模型名 → Ark 模型/接入点 ID（如 doubao-seedream-3-0-t2i-250415 / ep-xxxx） */
  modelMap?: Record<string, string>;
  /** 单次 HTTP 超时（图片生成慢，默认 120s） */
  timeoutMs?: number;
  /** 仅 429/5xx/超时/网络重试次数（不含 4xx 业务错误） */
  maxRetries?: number;
  /** 指数退避基础毫秒 */
  retryBaseMs?: number;
  /** 默认 url（推荐：worker 转存自有 OSS，ADR-005）；b64_json 仅调试用 */
  responseFormat?: "url" | "b64_json";
  /** 显式水印（AI 标识合规），默认开启 */
  watermark?: boolean;
  /** 可选 guidance_scale（模型支持时按需配置） */
  guidanceScale?: number;
}

/** 文生图/图生图：参考图（首帧优先 + 参考图），去重保序 */
function imageReferences(req: NormalizedGenRequest): string[] {
  const candidates: Array<string | null | undefined> = [
    req.request.input.first_frame_uri,
    ...(req.request.input.reference_uris ?? []),
  ];
  const uris: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0 && !uris.includes(candidate)) uris.push(candidate);
  }
  return uris;
}

// Seedream 3.0 支持的像素尺寸（官方 size 枚举）；720p/1080p 等业务档位映射到这些值，
// 避免把视频 resolution 语义（720p）直接发给图片接口导致 400。
const SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "9:16": "720x1280",
  "16:9": "1280x720",
  "3:4": "864x1152",
  "4:3": "1152x864",
  "2:3": "832x1248",
  "3:2": "1248x832",
  "21:9": "1512x648",
};

const DEFAULT_IMAGE_SIZE = "1024x1024";

function normalizeRatio(ratio?: string | null): string {
  const raw = String(ratio ?? "").trim().toLowerCase().replace(/：/g, ":").replace(/[x*×]/g, ":");
  return /^\d{1,2}:\d{1,2}$/.test(raw) ? raw : "";
}

/**
 * 业务 options（resolution/ratio）→ Ark `size`。
 * - 显式像素尺寸（1024x1536）直通；
 * - 1K/2K/4K 档位直通（Seedream 4.x）；
 * - 1080p → 2K；
 * - 720p / 缺省 → 按比例映射到 Seedream 3.0 支持的尺寸，未知比例回落 1024x1024。
 */
export function mapArkImageSize(ratio?: string | null, resolution?: string | null): string {
  const res = String(resolution ?? "").trim().toLowerCase();
  const pixels = /^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/.exec(res);
  if (pixels) return `${pixels[1]}x${pixels[2]}`;
  if (/^[124]k$/.test(res)) return res.toUpperCase();
  if (res === "1080p") return "2K";
  return SIZE_BY_RATIO[normalizeRatio(ratio)] ?? DEFAULT_IMAGE_SIZE;
}

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Json;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseSize(size?: string): { width?: number; height?: number } {
  if (!size) return {};
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(size.trim());
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** 收集响应里可能出现的图片数组（同步 data[].url / 异步 content[].image_url 等形态） */
function collectImageItems(data: Json): unknown[] {
  const items: unknown[] = [];
  const append = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      items.push(...candidate);
      return;
    }
    if (candidate && typeof candidate === "object") {
      const record = candidate as Json;
      if (Array.isArray(record.data)) items.push(...record.data);
      else if (Array.isArray(record.images)) items.push(...record.images);
      else if (Array.isArray(record.content)) items.push(...record.content);
      else items.push(candidate);
    }
  };
  append(data.data);
  append(data.images);
  append(data.content);
  append(data.output);
  append(data.result);
  return items;
}

function parseImageItem(item: unknown, usage?: Record<string, unknown>): GenResult | undefined {
  if (typeof item === "string") return item.length > 0 ? { uri: item } : undefined;
  if (!item || typeof item !== "object") return undefined;
  const record = item as Json;
  const imageUrl = record.image_url;
  const nested = asRecord(imageUrl);
  const url = pickString(record, ["url", "uri", "image_url", "download_url"]) ?? (nested ? pickString(nested, ["url", "uri"]) : undefined);
  const b64 = pickString(record, ["b64_json"]);
  const size = pickString(record, ["size"]);
  const meta: Record<string, unknown> = { vendor: "volcengine-ark" };
  if (size) meta.size = size;
  if (usage) meta.usage = usage;
  if (url) return { uri: url, ...parseSize(size), meta };
  if (b64) {
    // 兼容 b64 直返：转成 data URI。默认 response_format=url，此路径仅兜底（见 deliverable 已知限制）
    return { uri: `data:image/png;base64,${b64}`, ...parseSize(size), meta: { ...meta, inline_base64: true } };
  }
  return undefined;
}

function parseImageResults(data: Json): GenResult[] {
  const usage = asRecord(data.usage);
  const results: GenResult[] = [];
  for (const item of collectImageItems(data)) {
    const parsed = parseImageItem(item, results.length === 0 ? usage : undefined);
    if (parsed) results.push(parsed);
  }
  return results;
}

function pickErrorCode(data: Json): string | undefined {
  const nested = asRecord(data.error);
  return pickString(nested, ["code"]) ?? pickString(data, ["code"]);
}

function pickErrorMessage(data: Json): string | undefined {
  const nested = asRecord(data.error);
  return pickString(nested, ["message"]) ?? pickString(data, ["message", "msg"]);
}

/**
 * 火山方舟图像生成适配器（Seedream）：
 * POST {base}/api/v3/images/generations     文生图 / 图生图（同步）
 * GET  {base}/api/v3/contents/generations/tasks/{id}   异步任务兜底（同步返回 task id 时）
 *
 * 协议依据：火山方舟「图片生成 API」（v3 images/generations），字段见 deliverable 文档。
 * 错误经 src/errors.ts 统一映射：401/403→auth_error、429→rate_limited（重试）、
 * 400/404/422→invalid_param、5xx/超时/网络→可重试、审核→output_rejected、无图→vendor_error。
 */
export class ArkImageAdapter implements ModelAdapter {
  readonly vendor = "volcengine-ark";
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly config: ArkImageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseMs = config.retryBaseMs ?? 400;
  }

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    const body = this.buildRequestBody(req);
    const data = await this.request("POST", ARK_IMAGE_PATH, body);

    // 1) 同步出图（Seedream 常规路径）
    const results = parseImageResults(data);
    if (results.length > 0) return { sync_results: results };

    // 2) 200 但响应体带 error（如审核拒绝在同步接口直接返回）
    if (data.error) {
      throw classifyVendorHttpError(200, JSON.stringify(data), {
        vendor: VENDOR,
        operation: `POST ${ARK_IMAGE_PATH}`,
      });
    }

    // 3) 异步任务形态：返回 task id 后走 poll
    const taskId = pickString(data, ["id", "task_id"]);
    if (taskId) return { vendor_task_id: taskId };

    throw vendorProtocolError("ark image response has no image data", {
      vendor: VENDOR,
      operation: `POST ${ARK_IMAGE_PATH}`,
      status: 200,
    });
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const path = `${ARK_IMAGE_TASK_PATH}/${encodeURIComponent(vendorTaskId)}`;
    const data = await this.request("GET", path);
    const rawStatus = String(data.status ?? "").toLowerCase();

    // 审核驳回必须单独识别（同视频）：否则落 running 造成无限轮询、积分永久冻结
    if (rawStatus === "rejected" || rawStatus === "review_rejected" || rawStatus === "audit_failed") {
      return {
        status: "review_rejected",
        error: { code: "output_rejected", message: pickErrorMessage(data) ?? "content review rejected" },
        raw: data,
      };
    }

    const status: VendorTaskState["status"] =
      rawStatus === "queued" || rawStatus === "pending"
        ? "pending"
        : rawStatus === "running" || rawStatus === "processing"
          ? "running"
          : rawStatus === "succeeded" || rawStatus === "success" || rawStatus === "completed"
            ? "succeeded"
            : rawStatus === "failed" || rawStatus === "error" || rawStatus === "cancelled"
              ? "failed"
              : "running";

    if (status === "failed") {
      const code = pickErrorCode(data);
      const message = pickErrorMessage(data) ?? "ark image task failed";
      if (looksLikeContentRejection(`${code ?? ""} ${message}`)) {
        return { status: "review_rejected", error: { code: "output_rejected", message }, raw: data };
      }
      return { status: "failed", error: { code: code ?? "vendor_error", message }, raw: data };
    }
    if (status !== "succeeded") return { status, raw: data };

    const results = parseImageResults(data);
    if (results.length === 0) {
      return {
        status: "failed",
        error: { code: "vendor_error", message: "ark image task succeeded without image data" },
        raw: data,
      };
    }
    return { status: "succeeded", results, raw: data };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    await this.request("POST", `${ARK_IMAGE_TASK_PATH}/${encodeURIComponent(vendorTaskId)}/cancel`, {}).catch(
      () => undefined,
    );
  }

  private buildRequestBody(req: NormalizedGenRequest): Json {
    const options = req.request.options;
    const prompt = (req.request.input.prompt ?? "").trim();
    const references = imageReferences(req);
    if (!prompt && references.length === 0) {
      throw vendorParamError("ark image adapter requires input.prompt or reference image", {
        vendor: VENDOR,
        operation: `POST ${ARK_IMAGE_PATH}`,
      });
    }

    const body: Json = {
      model: this.config.modelMap?.[req.model.name] ?? req.model.name,
      prompt,
      size: mapArkImageSize(options.ratio, options.resolution),
      response_format: this.config.responseFormat ?? "url",
      watermark: this.config.watermark ?? true,
    };
    // 图生图：单张传字符串，多张传数组（Seedream 支持多参考图）
    if (references.length === 1) body.image = references[0];
    else if (references.length > 1) body.image = references;
    if (typeof options.seed === "number") body.seed = options.seed;
    if (typeof this.config.guidanceScale === "number") body.guidance_scale = this.config.guidanceScale;

    const count = Math.max(1, Math.min(options.count ?? 1, 10));
    if (count > 1) {
      body.sequential_image_generation = "auto";
      body.sequential_image_generation_options = { max_images: count };
    }
    return body;
  }

  /** 指数退避重试：仅重试 VendorError.retryable（429/5xx/超时/网络） */
  private async request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(method, path, body);
      } catch (err) {
        lastError = err;
        if (!isRetryableVendorError(err) || attempt === this.maxRetries) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryBaseMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private async requestOnce(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120_000);
    const operation = `${method} ${path}`;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw classifyVendorHttpError(res.status, text, { vendor: VENDOR, operation });
      }
      return await readVendorJson(res, { vendor: VENDOR, operation });
    } catch (err) {
      if (err instanceof VendorError) throw err;
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError")) {
        throw classifyVendorNetworkError(err, { vendor: VENDOR, operation });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
