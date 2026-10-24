import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

export interface ArkVideoConfig {
  apiKey: string;
  baseUrl?: string;
  /** 我方模型名 → Ark 模型/接入点 ID（如 ep-xxxx / doubao-seedance-...） */
  modelMap?: Record<string, string>;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

// 火山方舟（Ark）内容生成任务协议：
// POST /api/v3/contents/generations/tasks  {model, content:[text, image_url...]}
// GET  /api/v3/contents/generations/tasks/{id}
// 参考：docs.volcengine.com/docs/ark/create-video-generation-task-api
export class ArkVideoAdapter implements ModelAdapter {
  readonly vendor = "volcengine-ark";
  private readonly baseUrl: string;

  constructor(
    private readonly config: ArkVideoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (config.baseUrl ?? "https://ark.cn-beijing.volces.com").replace(/\/$/, "");
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
    if (!id) throw new Error("ark response missing task id");
    return { vendor_task_id: id };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const data = await this.request(
      "GET",
      `/api/v3/contents/generations/tasks/${encodeURIComponent(vendorTaskId)}`,
    );
    const rawStatus = String(data.status ?? "").toLowerCase();
    const status: VendorTaskState["status"] =
      rawStatus === "queued" || rawStatus === "pending"
        ? "pending"
        : rawStatus === "running" || rawStatus === "processing"
          ? "running"
          : rawStatus === "succeeded" || rawStatus === "success"
            ? "succeeded"
            : rawStatus === "failed" || rawStatus === "error"
              ? "failed"
              : "running";

    if (status === "failed") {
      const error = data.error as { message?: string } | undefined;
      return { status, error: { code: "ark_failed", message: error?.message ?? "ark task failed" }, raw: data };
    }
    if (status !== "succeeded") return { status, raw: data };

    const content = data.content as Json | Json[] | undefined;
    const first = Array.isArray(content) ? content[0] : content;
    const videoUrl =
      (first?.video_url as string | undefined) ??
      (data.video_url as string | undefined) ??
      ((data.output as Json | undefined)?.video_url as string | undefined);
    if (!videoUrl) return { status: "failed", error: { code: "ark_no_result", message: "ark succeeded without video_url" } };
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

  private async request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000);
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
        throw new Error(`ark ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as Json;
    } finally {
      clearTimeout(timer);
    }
  }
}
