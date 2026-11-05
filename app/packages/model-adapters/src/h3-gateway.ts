import { vendorParamError, vendorProtocolError } from "./errors";
import { VendorHttpClient } from "./vendor-http";
import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

/**
 * 自建视频网关（H3 · 自带 GPU）适配器。
 *
 * 与 `http-video` 的差别（不是重复实现，是协议不同）：
 * 1. 请求要带 `variant`（fl2va / ref2va）、`seed`、`steps`、`priority` 与分角色的参考素材；
 * 2. 响应是**排队中**语义：`queued + queue_position + est_wait_s`，轮询间隔应 ≥3s，
 *    且总等待要允许到 45 分钟（GPU 池可能正在开机，见 docs/02-architecture/autodl-integration.md）；
 * 3. 结果 `key` 是我们自己的对象存储 key（已由网关预分配），不是供应商 URL——
 *    上层"转存"步骤应走 HEAD + CopyObject，而不是下载重传（ADR-005 的自建分支）。
 */
/** 自建 H3（H3-Base）的画布天花板：1344×768；2K 档（Regenerate-2K）是 API-only */
export const H3_LOCAL_MAX_SHORT_SIDE = 768;
/** Ref2VA 最多 3 条音频参考（音色/氛围条件） */
export const H3_AUDIO_REF_MAX = 3;

/**
 * 把档位写法解析成「短边像素」。覆盖目录里常见的三类写法：
 * `1080p` / `720p`（具名）、`2K` / `4K`（像素档）、`1920x1080`（显式像素）。
 * 解析不出来就返回 undefined —— 未知写法交给网关判，不在适配器里猜。
 */
function h3ShortSide(resolution: string): number | undefined {
  const pixels = /^(\d{3,5})\s*[x*×]\s*(\d{3,5})$/.exec(resolution);
  if (pixels) return Math.min(Number(pixels[1]), Number(pixels[2]));
  const named = /^(\d{3,4})p$/.exec(resolution);
  if (named) return Number(named[1]);
  // 1K 及以上：短边必然超过 768（H3-Base 天花板），无需精确像素
  if (/^\d{1,2}k$/.test(resolution)) return 2_000;
  return undefined;
}

/**
 * 把业务档位收敛到本地可用，越界**显式失败**。
 *
 * 为什么不是 clamp：H3 自建最高 768p，静默返回 768p 会让「用户选 2K、拿到 768p」
 * 变成一个不可见的账实不符。任务失败会解冻积分、把问题暴露给运营，比悄悄降级好。
 */
export function assertH3LocalResolution(resolution: string | undefined): string {
  const res = String(resolution ?? "768p").toLowerCase().trim();
  const shortSide = h3ShortSide(res);
  // 未知写法（如 "hd"）交给网关判：我们只拦「能解析出短边、且超过 768」的那些
  if (shortSide != null && shortSide > H3_LOCAL_MAX_SHORT_SIDE) {
    throw vendorParamError(
      `h3 local gateway caps at ${H3_LOCAL_MAX_SHORT_SIDE}p (H3-Base); requested ${res} — use the API channel for 1080p/2K, or set the catalog tier to 768P`,
      { vendor: "h3-gateway", operation: "POST /v1/videos/generations" },
    );
  }
  return res;
}

export interface H3GatewayConfig {
  baseUrl: string;
  apiKey?: string;
  /** 我方模型名 → 网关模型名；未命中原样发送 */
  modelMap?: Record<string, string>;
  submitPath?: string;
  pollPath?: string;
  cancelPath?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  /**
   * 允许把超出本地能力的档位交给网关自行降级（默认 false）。
   *
   * 默认拒绝的理由见 `assertH3LocalResolution`：用户按 2K 付钱拿到 768p 是账实不符。
   * 只在「明确把这条路由当草稿/试镜通道、并且前端已标注本地档」时才打开。
   */
  allowResolutionDowngrade?: boolean;
}

type Json = Record<string, unknown>;

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Json;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** 从 options 取音频参考（最多 3 条）；非字符串/空串一律丢弃，不猜 */
export function audioReferences(options: Record<string, unknown>): string[] {
  const raw = options.audio_uris;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, H3_AUDIO_REF_MAX);
}

/** 统一到上层状态；`review_rejected` 必须先于其它分支识别（否则会无限轮询） */
export function normalizeH3Status(raw: unknown): VendorTaskState["status"] {
  const value = String(raw ?? "").toLowerCase();
  if (["queued", "pending", "submitted", "provisioning", "booting", "loading"].includes(value)) return "pending";
  if (["running", "processing", "sampling", "uploading", "in_progress"].includes(value)) return "running";
  if (["succeeded", "success", "completed", "done"].includes(value)) return "succeeded";
  if (["review_rejected", "rejected", "audit_failed"].includes(value)) return "review_rejected";
  if (["failed", "error", "cancelled", "canceled", "timeout"].includes(value)) return "failed";
  return "running";
}

/** 结果项：网关返回 { key, width, height, duration_s, has_audio } */
export function extractH3Results(payload: unknown): GenResult[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Json;
  const list = (record.results ?? (record.data as Json | undefined)?.results) as unknown;
  if (!Array.isArray(list)) return [];
  const out: GenResult[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ uri: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const obj = item as Json;
    const uri = pickString(obj, ["key", "uri", "url"]);
    if (!uri) continue;
    out.push({
      uri,
      preview_uri: pickString(obj, ["preview_key", "preview_uri"]),
      duration_s: typeof obj.duration_s === "number" ? obj.duration_s : undefined,
      width: typeof obj.width === "number" ? obj.width : undefined,
      height: typeof obj.height === "number" ? obj.height : undefined,
      meta: { has_audio: obj.has_audio === true, sha256: obj.sha256 },
    });
  }
  return out;
}

export class H3GatewayAdapter implements ModelAdapter {
  readonly vendor = "h3-gateway";
  private readonly http: VendorHttpClient;
  private readonly submitPath: string;
  private readonly pollPath: string;

  constructor(private readonly config: H3GatewayConfig, fetchImpl: typeof fetch = fetch) {
    this.submitPath = config.submitPath ?? "/v1/videos/generations";
    this.pollPath = config.pollPath ?? "/v1/videos/generations/{id}";
    this.http = new VendorHttpClient({
      vendor: this.vendor,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs ?? 30_000,
      apiKey: config.apiKey,
      maxRetries: config.maxRetries ?? 2,
      retryBaseMs: config.retryBaseMs ?? 400,
      messagePrefix: "h3 gateway ",
      fetchImpl,
    });
  }

  /** 由 mode 推导 checkpoint：参考驱动 → ref2va；其余 → fl2va */
  static variantFor(mode: string): "fl2va" | "ref2va" {
    return mode === "universal_reference" || mode === "storyboard_reference_video" ? "ref2va" : "fl2va";
  }

  /**
   * 档位收敛：默认对超出本地能力的档位**报错**；只有运营显式打开
   * `allowResolutionDowngrade` 时才放行（该路由必须被当作草稿通道）。
   */
  private resolveResolution(resolution: string | undefined): string {
    if (this.config.allowResolutionDowngrade) return String(resolution ?? "768p").toLowerCase();
    return assertH3LocalResolution(resolution);
  }

  private buildBody(req: NormalizedGenRequest): Json {
    const input = req.request.input;
    const options = req.request.options;
    const images = [input.first_frame_uri, input.last_frame_uri, ...(input.reference_uris ?? [])]
      .filter((uri): uri is string => typeof uri === "string" && uri.length > 0)
      .slice(0, 9);
    return {
      client_task_id: req.task_id, // 幂等键：网关按它去重
      model: this.config.modelMap?.[req.model.name] ?? req.model.name,
      variant: H3GatewayAdapter.variantFor(req.request.mode),
      prompt: input.prompt ?? "",
      resolution: this.resolveResolution(options.resolution),
      aspect_ratio: options.ratio,
      duration_s: options.duration,
      // 音效开关必须真下发：之前 `enable_audio` 全仓没有适配器读过，
      // 面板上关掉音轨时 H3 照样出带音轨的视频（多花算力且用户改不了）。
      audio: options.enable_audio ?? true,
      seed: options.seed ?? undefined,
      // 自建档默认 8 步（蒸馏档）；运营可按模型覆盖
      steps: Number((req.request.options as unknown as Json).steps ?? 8),
      priority: "interactive",
      // Ref2VA 的音频参考槽（音色/氛围条件）以前硬编码空数组，等于把这条能力关掉了。
      // 只有 options.audio_uris 显式给了才填，最多 3 条（网关侧上限）。
      refs: { images, videos: [], audios: audioReferences(options) },
    };
  }

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    const data = await this.http.request("POST", this.submitPath, this.buildBody(req));
    const id =
      pickString(data, ["job_id", "id", "task_id"]) ??
      pickString(data.data, ["job_id", "id"]);
    if (!id) {
      throw vendorProtocolError("h3 gateway response missing job id", {
        vendor: this.vendor,
        operation: `POST ${this.submitPath}`,
        status: 200,
      });
    }
    return { vendor_task_id: id };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const path = this.pollPath.replace("{id}", encodeURIComponent(vendorTaskId));
    const data = await this.http.request("GET", path);
    const inner = (data.data && typeof data.data === "object" ? data.data : data) as Json;
    const status = normalizeH3Status(inner.status ?? data.status);
    const results = extractH3Results(data);
    const message = pickString(inner, ["error_message", "message"]) ?? pickString(data, ["error", "message"]);
    return {
      status,
      ...(results.length > 0 ? { results } : {}),
      ...(status === "review_rejected"
        ? { error: { code: "output_rejected", message: message ?? "content review rejected" } }
        : status === "failed"
          ? { error: { code: "vendor_error", message: message ?? "h3 job failed" } }
          : {}),
      raw: data,
    };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    if (!this.config.cancelPath) return;
    const path = this.config.cancelPath.replace("{id}", encodeURIComponent(vendorTaskId));
    await this.http.request("POST", path, {});
  }
}