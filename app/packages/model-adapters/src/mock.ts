import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

export interface MockAdapterOptions {
  delayMs?: number;
  behavior?: "success" | "fail" | "review_rejected";
}

// 本地/CI 用适配器：模拟异步提交与轮询，不访问网络。
// 通过 ADAPTER_MODE=mock 启用；真实供应商接入后只需替换 registry 解析。
export class MockAdapter implements ModelAdapter {
  readonly vendor = "mock";
  private readonly jobs = new Map<string, { at: number; taskId: string; mode: string; count: number }>();

  constructor(private readonly options: MockAdapterOptions = {}) {}

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id: string }> {
    const id = `mock-${req.task_id}`;
    this.jobs.set(id, {
      at: Date.now(),
      taskId: req.task_id,
      mode: req.request.mode,
      count: Math.max(1, Math.min(req.request.options.count ?? 1, 4)),
    });
    return { vendor_task_id: id };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    const job = this.jobs.get(vendorTaskId);
    if (!job) return { status: "failed", error: { code: "mock_not_found", message: "mock job not found" } };
    const elapsed = Date.now() - job.at;
    if (elapsed < (this.options.delayMs ?? 1200)) return { status: "running" };
    this.jobs.delete(vendorTaskId);

    const behavior = this.options.behavior ?? "success";
    if (behavior === "fail") {
      return { status: "failed", error: { code: "mock_failed", message: "mock vendor failure" } };
    }
    if (behavior === "review_rejected") {
      return { status: "review_rejected", error: { code: "mock_review", message: "mock review rejected" } };
    }

    const results: GenResult[] = Array.from({ length: job.count }, (_, index) => ({
      uri: job.count === 1 ? `mock://results/${job.taskId}.mp4` : `mock://results/${job.taskId}-${index}.mp4`,
      preview_uri: `mock://results/${job.taskId}-${index}.jpg`,
      duration_s: 5,
      width: 720,
      height: 1280,
      meta: { mock: true, mode: job.mode, candidate_index: index },
    }));
    return { status: "succeeded", results };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    this.jobs.delete(vendorTaskId);
  }
}
