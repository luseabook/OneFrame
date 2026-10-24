import type { GenerationRequest } from "@app/shared";

// 供应商适配器统一接口（docs/02-architecture/system-design.md §4.1）
// 结果一律转存自有 OSS（ADR-005），适配器只暴露归一化状态，不透传供应商 URL 语义
export interface ModelMeta {
  name: string;
  vendor: string;
  adapter_code: string;
}

export interface NormalizedGenRequest {
  task_id: string;
  request: GenerationRequest;
  model: ModelMeta;
}

export interface GenResult {
  uri: string;
  /** 同步文本结果（LLM 步骤）；媒体结果用 uri */
  text?: string;
  preview_uri?: string;
  duration_s?: number;
  width?: number;
  height?: number;
  meta?: Record<string, unknown>;
}

export type VendorTaskState = {
  status: "pending" | "running" | "succeeded" | "failed" | "review_rejected";
  results?: GenResult[];
  error?: { code?: string; message: string };
  raw?: unknown;
};

export interface ModelAdapter {
  vendor: string;
  /** 提交生成；返回供应商任务号（异步模型）或同步结果（同步模型） */
  submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }>;
  /** 轮询供应商侧状态并归一化 */
  poll(vendor_task_id: string): Promise<VendorTaskState>;
  cancel(vendor_task_id: string): Promise<void>;
}

export class NotImplementedError extends Error {
  constructor(vendor: string) {
    super(`${vendor} adapter not implemented (WBS P1/P2)`);
    this.name = "NotImplementedError";
  }
}
