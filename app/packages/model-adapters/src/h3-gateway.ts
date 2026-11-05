import { vendorProtocolError } from "./errors";
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
      resolution: (options.resolution ?? "768p").toLowerCase(),
      aspect_ratio: options.ratio,
      duration_s: options.duration,
      seed: options.seed ?? undefined,
      // 自建档默认 8 步（蒸馏档）；运营可按模型覆盖
      steps: Number((req.request.options as unknown as Json).steps ?? 8),
      priority: "interactive",
      refs: { images, videos: [], audios: [] },
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