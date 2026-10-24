import type { ModelAdapter, NormalizedGenRequest, GenResult, VendorTaskState } from "./types";

export interface HttpVideoConfig {
  baseUrl: string;
  apiKey?: string;
  submitPath?: string;
  pollPath?: string;
  cancelPath?: string;
  /** 我方模型名 → 供应商模型名；未命中则原样发送 */
  modelMap?: Record<string, string>;
  timeoutMs?: number;
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

function normalizeStatus(raw: unknown): VendorTaskState["status"] {
  if (typeof raw === "number") {
    return ({ 0: "pending", 1: "running", 2: "succeeded", 3: "failed", 4: "review_rejected" } as const)[raw] ?? "running";
  }
  const value = String(raw ?? "").toLowerCase();
  if (["pending", "queued", "submitted", "created"].includes(value)) return "pending";
  if (["running", "processing", "in_progress", "generating"].includes(value)) return "running";
  if (["succeeded", "success", "completed", "done", "finished"].includes(value)) return "succeeded";
  if (["review_rejected", "rejected", "audit_failed"].includes(value)) return "review_rejected";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  return "running";
}

function extractResults(payload: unknown): GenResult[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Json;
  const candidates = [record.results, record.videos, record.outputs, (record.data as Json | undefined)?.results];
  const list = candidates.find((item) => Array.isArray(item)) as unknown[] | undefined;
  if (!list) return [];
  const results: GenResult[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      results.push({ uri: item });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Json;
      const uri = pickString(obj, ["uri", "url", "video_url", "download_url", "file_url"]);
      if (!uri) continue;
      results.push({
        uri,
        preview_uri: pickString(obj, ["preview_uri", "cover_url", "poster_url", "thumbnail_url"]),
        duration_s: typeof obj.duration === "number" ? obj.duration : undefined,
        width: typeof obj.width === "number" ? obj.width : undefined,
        height: typeof obj.height === "number" ? obj.height : undefined,
      });
    }
  }
  return results;
}

// 通用 HTTP 视频供应商适配器：适配“提交→轮询→取结果 URL”的常见异步协议。
// 真实供应商差异集中在 env 的 path/model 映射；Key 到位后仅改配置，不改任务/结算/转存链路。
export class HttpVideoAdapter implements ModelAdapter {
  readonly vendor = "http-video";
  private readonly submitPath: string;
  private readonly pollPath: string;

  constructor(
    private readonly config: HttpVideoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.submitPath = config.submitPath ?? "/v1/video/tasks";
    this.pollPath = config.pollPath ?? "/v1/video/tasks/{id}";
  }

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    const body: Json = {
      model: this.config.modelMap?.[req.model.name] ?? req.model.name,
      prompt: req.request.input.prompt ?? "",
      image: req.request.input.first_frame_uri ?? req.request.input.reference_uris[0],
      reference_images: req.request.input.reference_uris,
      duration: req.request.options.duration,
      ratio: req.request.options.ratio,
      resolution: req.request.options.resolution,
      count: req.request.options.count,
      client_task_id: req.task_id,
    };
    const data = await this.request("POST", this.submitPath, body);
    const vendorTaskId =
      pickString(data, ["task_id", "id", "taskId"]) ??
      pickString(data.data, ["task_id", "id"]) ??
      pickString(data.task, ["id"]);
    const syncResults = extractResults(data);
    if (!vendorTaskId && syncResults.length > 0) return { sync_results: syncResults };
    if (!vendorTaskId) throw new Error("http vendor response missing task id");
    return { vendor_task_id: vendorTaskId };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const path = this.pollPath.replace("{id}", encodeURIComponent(vendorTaskId));
    const data = await this.request("GET", path);
    const inner = (data.data && typeof data.data === "object" ? data.data : data) as Json;
    const status = normalizeStatus(inner.status ?? data.status ?? inner.state ?? data.state);
    const results = extractResults(data);
    const errorMessage = pickString(inner, ["error_message", "message"]) ?? pickString(data, ["error", "message"]);
    return {
      status,
      ...(results.length > 0 ? { results } : {}),
      ...(status === "review_rejected"
        ? { error: { code: "output_rejected", message: errorMessage ?? "content review rejected" } }
        : status === "failed"
          ? { error: { code: "vendor_error", message: errorMessage ?? "vendor task failed" } }
          : {}),
      raw: data,
    };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    if (!this.config.cancelPath) return;
    const path = this.config.cancelPath.replace("{id}", encodeURIComponent(vendorTaskId));
    await this.request("POST", path, {});
  }

  private async request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`http vendor ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as Json;
    } finally {
      clearTimeout(timer);
    }
  }
}
