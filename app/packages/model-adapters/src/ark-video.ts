import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  looksLikeContentRejection,
  readVendorJson,
  VendorError,
  vendorProtocolError,
} from "./errors";
import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

export interface ArkVideoConfig {
  apiKey: string;
  baseUrl?: string;
  /** 我方模型名 → Ark 模型/接入点 ID（如 ep-xxxx / doubao-seedance-...） */
  modelMap?: Record<string, string>;
  timeoutMs?: number;
  /** 网络/5xx 重试次数（不含 4xx 业务错误） */
  maxRetries?: number;
  /** 重试基础退避（毫秒），按指数增长 */
  retryBaseMs?: number;
}

type Json = Record<string, unknown>;

const VENDOR = "ark";

// 统一错误类型从 errors.ts 提供；此处 re-export 保持既有对外导入路径兼容
export { RetryableVendorError } from "./errors";


// 火山方舟（Ark）内容生成任务协议：
// POST /api/v3/contents/generations/tasks  {model, content:[text, image_url...]}
// GET  /api/v3/contents/generations/tasks/{id}
// 参考：docs.volcengine.com/docs/ark/create-video-generation-task-api
export class ArkVideoAdapter implements ModelAdapter {
  readonly vendor = "volcengine-ark";
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly config: ArkVideoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (config.baseUrl ?? "https://ark.cn-beijing.volces.com").replace(/\/$/, "");
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseMs = config.retryBaseMs ?? 400;
  }

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    const content: Json[] = [
      {
        type: "text",
        text: this.promptWithParams(req),
      },
    ];
    const images = [
      ...(req.request.input.first_frame_uri ? [req.request.input.first_frame_uri] : []),
      ...req.request.input.reference_uris,
    ];
    for (const url of images) {
      content.push({ type: "image_url", image_url: { url } });
    }
    const body: Json = {
      model: this.config.modelMap?.[req.model.name] ?? req.model.name,
      content,
    };
    const data = await this.request("POST", "/api/v3/contents/generations/tasks", body);
    const id = typeof data.id === "string" ? data.id : typeof data.task_id === "string" ? data.task_id : undefined;
    if (!id) {
      throw vendorProtocolError("ark response missing task id", {
        vendor: VENDOR,
        operation: "POST /api/v3/contents/generations/tasks",
        status: 200,
      });
    }
    return { vendor_task_id: id };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const data = await this.request(
      "GET",
      `/api/v3/contents/generations/tasks/${encodeURIComponent(vendorTaskId)}`,
    );
    const rawStatus = String(data.status ?? "").toLowerCase();

    // 审核驳回必须单独识别：否则会落到 running 造成无限轮询、积分永久冻结
    if (rawStatus === "rejected" || rawStatus === "review_rejected" || rawStatus === "audit_failed") {
      const error = data.error as { message?: string } | undefined;
      return {
        status: "review_rejected",
        error: { code: "output_rejected", message: error?.message ?? "content review rejected" },
        raw: data,
      };
    }

    const status: VendorTaskState["status"] =
      rawStatus === "queued" || rawStatus === "pending"
        ? "pending"
        : rawStatus === "running" || rawStatus === "processing"
          ? "running"
          : rawStatus === "succeeded" || rawStatus === "success"
            ? "succeeded"
            : rawStatus === "failed" || rawStatus === "error" || rawStatus === "cancelled"
              ? "failed"
              : "running";

    if (status === "failed") {
      const error = data.error as { message?: string; code?: string } | undefined;
      const code = error?.code;
      const message = error?.message ?? "ark task failed";
      // 失败原因含审核信号（如 OutputImageSensitiveContentDetected）→ 按审核驳回处理，
      // 走 REVIEW_REJECTED（745802）而不是普通失败，前端才能提示「改提示词重试」
      if (looksLikeContentRejection(`${code ?? ""} ${message}`)) {
        return { status: "review_rejected", error: { code: "output_rejected", message }, raw: data };
      }
      return {
        status: "failed",
        // 错误码与全站口径统一（vendor_error）
        error: { code: code ?? "vendor_error", message },
        raw: data,
      };
    }
    if (status !== "succeeded") return { status, raw: data };

    const content = data.content as Json | Json[] | undefined;
    const first = Array.isArray(content) ? content[0] : content;
    const videoUrl =
      (first?.video_url as string | undefined) ??
      (data.video_url as string | undefined) ??
      ((data.output as Json | undefined)?.video_url as string | undefined);
    if (!videoUrl) {
      return { status: "failed", error: { code: "vendor_error", message: "ark succeeded without video_url" } };
    }
    const result: GenResult = {
      uri: videoUrl,
      preview_uri: (first?.cover_url as string | undefined) ?? undefined,
      duration_s: typeof first?.duration === "number" ? first.duration : undefined,
    };
    return { status: "succeeded", results: [result], raw: data };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    await this.request(
      "POST",
      `/api/v3/contents/generations/tasks/${encodeURIComponent(vendorTaskId)}/cancel`,
      {},
    ).catch(() => undefined);
  }

  private promptWithParams(req: NormalizedGenRequest): string {
    const prompt = req.request.input.prompt ?? "";
    const { resolution, ratio, duration } = req.request.options;
    const params = [resolution ? `--resolution ${resolution}` : "", ratio ? `--ratio ${ratio}` : "", duration ? `--duration ${duration}` : ""]
      .filter(Boolean)
      .join(" ");
    return params ? `${prompt} ${params}`.trim() : prompt;
  }

  /** 带指数退避重试：仅重试网络错误/超时/5xx/429 */
  private async request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(method, path, body);
      } catch (err) {
        lastError = err;
        if (!isRetryableVendorError(err) || attempt === this.maxRetries) break;
        await new Promise((r) => setTimeout(r, this.retryBaseMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private async requestOnce(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
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
        // 错误体（{error:{code,message}} / {code,message}）统一映射；4xx 不重试
        throw classifyVendorHttpError(res.status, text, { vendor: VENDOR, operation });
      }
      return await readVendorJson(res, { vendor: VENDOR, operation });
    } catch (err) {
      if (err instanceof VendorError) throw err;
      // 超时 / 网络层错误 → 可重试
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError")) {
        throw classifyVendorNetworkError(err, { vendor: VENDOR, operation });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
