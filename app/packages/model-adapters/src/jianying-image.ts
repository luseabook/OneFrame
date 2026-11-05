import { vendorParamError, vendorProtocolError } from "./errors";
import { classifyVendorPayloadError, VendorHttpClient } from "./vendor-http";
import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

type Json = Record<string, unknown>;

/** 剪影生图网关（FastAPI，OpenAI 兼容）同步出图接口 */
export const JIANYING_IMAGE_PATH = "/v1/images/generations";

const VENDOR = "jianying";
/** 单次同步出图 10–25s/张，n=4 时网关内部并行；超时要留够余量 */
const DEFAULT_TIMEOUT_MS = 180_000;
/** 网关 n 的硬上限（schemas.ImageGenerationRequest: ge=1, le=4） */
const MAX_IMAGES = 4;

export interface JianyingImageConfig {
  /** 网关地址（例 http://127.0.0.1:8788）；不设默认值，缺了由 registry 硬失败 */
  baseUrl: string;
  /** 网关自身访问控制（网关侧 API_KEY），可选 */
  apiKey?: string;
  /** 我方模型名 → 网关模型名；未命中原样发送 */
  modelMap?: Record<string, string>;
  /** 单次 HTTP 超时，默认 180s（同步 10–25s/张，n=4 并行） */
  timeoutMs?: number;
  /** 仅 429/5xx/超时/网络重试次数；默认 1（网关内部已有 3 次重试，别叠乘） */
  maxRetries?: number;
  /** 指数退避基础毫秒 */
  retryBaseMs?: number;
  /** 默认 url（推荐：worker 转存自有 OSS，ADR-005）；b64_json 仅调试用 */
  responseFormat?: "url" | "b64_json";
  /** 上游画布贴合方式：crop / pad / stretch，默认 crop */
  fit?: "crop" | "pad" | "stretch";
  /**
   * 是否让网关擦除上游烧录的 AI 水印（`watermark: "remove"`）。
   * 默认 false = 发 `watermark: "keep"`：去水印属于合规敏感项，必须显式开启，绝不默认替用户剥标。
   */
  removeUpstreamWatermark?: boolean;
}

/** 文生图/图生图：参考图（首帧优先 + 参考图），去重保序（与 ark-image 同口径） */
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

/** 业务 ratio 归一化：认得 `1:1` / `4x3` / 全角冒号；认不出就不下发（网关有 size 兜底） */
function normalizeRatio(ratio?: string | null): string | undefined {
  const raw = String(ratio ?? "").trim().toLowerCase().replace(/：/g, ":").replace(/[x*×]/g, ":");
  return /^\d{1,2}:\d{1,2}$/.test(raw) ? raw : undefined;
}

/**
 * 业务 resolution → 网关 `resolution`。
 *
 * 网关只认 `1k` / `2k` / 长边像素（如 `1536`）；`720p` 是视频档位语义，
 * 原样下发会被上游当成非法分辨率。因此这里做白名单收敛，未知档位直接省略走网关默认，
 * 避免把视频 resolution 语义塞进图片接口（同 ark-image 的 mapArkImageSize 动机）。
 */
export function mapJianyingResolution(resolution?: string | null): string | undefined {
  const raw = String(resolution ?? "").trim().toLowerCase();
  if (/^[124]k$/.test(raw)) return raw;
  if (/^\d{3,5}$/.test(raw)) return raw;
  if (raw === "1080p") return "2k";
  return undefined;
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

/** `options.style` 宽松读取：网关接受单值或数组（预设风格 id，见 GET /v1/styles） */
function pickStyle(options: unknown): string | string[] | undefined {
  if (!options || typeof options !== "object") return undefined;
  const value = (options as Json).style;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    const list = value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

function parseSize(size?: string): { width?: number; height?: number } {
  if (!size) return {};
  const match = /^(\d+)\s*x\s*(\d+)$/.exec(size.trim());
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** 结果项：网关返回 { url?, b64_json?, revised_prompt, size?, watermark_removed? } */
function parseImageItem(item: unknown): GenResult | undefined {
  if (typeof item === "string") return item.length > 0 ? { uri: item } : undefined;
  if (!item || typeof item !== "object") return undefined;
  const record = item as Json;
  const url = pickString(record, ["url"]);
  const b64 = pickString(record, ["b64_json"]);
  const size = pickString(record, ["size"]);
  const meta: Record<string, unknown> = { vendor: VENDOR };
  if (size) meta.size = size;
  if (typeof record.watermark_removed === "boolean") meta.watermark_removed = record.watermark_removed;
  if (url) return { uri: url, ...parseSize(size), meta };
  if (b64) {
    // 兼容 b64 直返：转成 data URI。默认 response_format=url，此路径仅兜底（同 ark-image 口径）
    return { uri: `data:image/png;base64,${b64}`, ...parseSize(size), meta: { ...meta, inline_base64: true } };
  }
  return undefined;
}

function parseImageResults(data: Json): GenResult[] {
  const items = Array.isArray(data.data) ? data.data : [];
  const results: GenResult[] = [];
  for (const item of items) {
    const parsed = parseImageItem(item);
    if (parsed) results.push(parsed);
  }
  return results;
}

/**
 * 剪影生图网关适配器（OpenAI 兼容 images API 的同步扩展）：
 * POST {base}/v1/images/generations     文生图 / 图生图（风格迁移），**同步**返回产物。
 *
 * 协议依据：gateway 源码 app/schemas.py + app/main.py（v1.2.0）：
 *   · 请求字段：prompt(≤3000)、n(1–4)、size / aspect_ratio、resolution、fit、
 *     style(string|string[])、negative_prompt、response_format、watermark、
 *     reference_image(公网 http(s))、mask(data URL)、effect、model；
 *   · 图生图的「风格迁移」与「参考图」走**同一个 JSON 接口**——`reference_image` + `effect`
 *     即切换上游 edit 分支，不需要 multipart /v1/images/edits；
 *   · 成功体 `{ created, data: [...] }`；错误体 `{ error: { message, type, param, code } }`，
 *     type 取值 upstream_error / upstream_unavailable / invalid_request_error / authentication_error。
 *
 * 错误经 src/errors.ts 统一映射：401→auth_error、400→invalid_param、502/503→vendor_error（可重试）、
 * 审核类文案→output_rejected、200 但无图→vendor_error。
 */
export class JianyingImageAdapter implements ModelAdapter {
  readonly vendor = "jianying";
  private readonly http: VendorHttpClient;

  constructor(
    private readonly config: JianyingImageConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.http = new VendorHttpClient({
      vendor: VENDOR,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      apiKey: config.apiKey,
      // 网关内部已对上游重试 3 次：这里再叠乘会变成 1+3×N 次，用户等不到图还挨双倍上游费用
      // 默认**不额外重试**：网关内部已有 3 次指数退避（实测上游不可达时整条请求 18s 才回 502），
      // 适配器再叠 1 次就是 ~36s 白等，而 502 已归一为不可重试的 vendor_error，重试没有收益。
      // 只有在网关放到上游前面做了快速失败（例如自家前置代理）时，才需要把它调大。
      maxRetries: config.maxRetries ?? 0,
      retryBaseMs: config.retryBaseMs ?? 400,
      fetchImpl,
    });
  }

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    const body = this.buildRequestBody(req);
    const operation = `POST ${JIANYING_IMAGE_PATH}`;
    const data = await this.http.request<Json>("POST", JIANYING_IMAGE_PATH, body);

    // 1) 同步出图：一次调用即终态，绝不返回 vendor_task_id（网关没有任务概念）
    const results = parseImageResults(data);
    if (results.length > 0) return { sync_results: results };

    // 2) 200 但响应体带 error（上游报错被网关包成 200，或鉴权在 body 层提示）
    if (data.error) {
      throw classifyVendorPayloadError(data, { vendor: VENDOR, operation });
    }

    throw vendorProtocolError("jianying image gateway returned no image data", {
      vendor: VENDOR,
      operation,
      status: 200,
    });
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    // 守卫：本协议是同步的。若被误配进轮询路径（例如路由表把 jianying:image 当任务型），
    // 这里必须立刻炸掉，否则会对着不存在的任务无限轮询、积分永久冻结。
    throw vendorProtocolError("jianying image gateway is synchronous; poll is not supported", {
      vendor: VENDOR,
      operation: `poll ${vendorTaskId}`,
    });
  }

  async cancel(vendorTaskId: string): Promise<void> {
    // 同步接口没有取消语义：请求发出即已在上游出图，取消只会产生「用户已退款但图照出」的账实不符。
    // 保留空实现是为了满足 ModelAdapter 接口，worker 侧不需要为它开特例。
    void vendorTaskId;
  }

  private buildRequestBody(req: NormalizedGenRequest): Json {
    const options = req.request.options;
    const operation = `POST ${JIANYING_IMAGE_PATH}`;
    const prompt = (req.request.input.prompt ?? "").trim();
    const references = imageReferences(req);
    // 网关只接受单张 reference_image：取第一张（首帧优先，与 ark-image 的 imageReferences 一致）
    const reference = references[0];
    if (!prompt && !reference) {
      throw vendorParamError("jianying image adapter requires input.prompt or reference image", {
        vendor: VENDOR,
        operation,
      });
    }

    // `reference_uris[1]` 在我方既有约定里是「蒙版位」（`pages/create/brush-repaint.vue` →
// `image-inpaint`）。本批蒙版未接线，静默只用第一张会变成「用户以为局部重绘、实际整图重绘」，
// 还照样计费 —— 所以这一格有值就显式拒绝（目录侧同时把 media_limits.image 压到 1）。
// 注意与「首帧 + 1 张参考图」区分：那两个只是"优先取谁"（取首帧），不是蒙版语义，不拦。
    const extraRefs = req.request.input.reference_uris ?? [];
    if (extraRefs.length > 1) {
      throw vendorParamError(
        "jianying image adapter accepts exactly 1 reference image; reference_uris[1] is reserved for the mask, which is not wired in this batch",
        { vendor: VENDOR, operation },
      );
    }

    // mask 本批未接线：网关要的是 data URL（白色/透明=编辑区），我们手上只有 URI 字符串。
    // 静默丢弃会让用户「涂了遮罩却整图重绘」——照样计费，必须显式拒绝。
    const maskUri = pickString(options, ["mask_uri"]);
    if (maskUri) {
      throw vendorParamError(
        "jianying mask requires a data URL and is not wired in this batch (see docs/02-architecture/jianying-gateway-integration.md)",
        { vendor: VENDOR, operation },
      );
    }

    const body: Json = {
      model: this.config.modelMap?.[req.model.name] ?? req.model.name,
      prompt,
      // 网关 n 上限 4；越界会 400，这里夹住而不是把用户的选择原样打回去
      n: Math.max(1, Math.min(options.count ?? 1, MAX_IMAGES)),
      response_format: this.config.responseFormat ?? "url",
      fit: this.config.fit ?? "crop",
      // 缺省必须 keep：去水印是合规敏感项，只在配置显式打开时才发 remove
      watermark: this.config.removeUpstreamWatermark ? "remove" : "keep",
    };

    const aspectRatio = normalizeRatio(options.ratio);
    if (aspectRatio) body.aspect_ratio = aspectRatio;
    const resolution = mapJianyingResolution(options.resolution);
    if (resolution) body.resolution = resolution;

    // options.seed 不下发：网关 schema 收 seed，但上游剪影接口不消费，
    // 下发只会让人误以为结果可复现（同 ark-image 只在确有支持时才发 guidance_scale）。

    if (reference) {
      body.reference_image = reference;
      // 有参考图 = 上游走 edit/风格迁移分支。effect 缺省会被网关回落 settings.default_effect
      // （默认「3D 童话」），把用户照片静默改成童话风还照常计费——这条护栏是本次接入的核心约束。
      const effect = pickString(options, ["effect", "effect_id"]);
      if (!effect) {
        throw vendorParamError(
          "jianying image2image requires options.effect (effect id, see GET /v1/effects); the gateway otherwise falls back to its default “3D fairy tale” style and silently restyles the reference photo",
          { vendor: VENDOR, operation },
        );
      }
      body.effect = effect;
    }

    // 预设风格（string | string[]）：与 effect 正交——effect 决定上游编辑算子，style 决定提示词预设
    const style = pickStyle(options);
    if (style) body.style = style;

    return body;
  }
}