import { TextMode } from "@app/shared";
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

  async submit(req: NormalizedGenRequest): Promise<{
    vendor_task_id?: string;
    sync_results?: GenResult[];
  }> {
    /**
     * 文本类（LLM）适配器本身是**同步**的（`deepseek:chat` 的 submit 直接返回
     * `sync_results`）。mock 必须照同一语义返回文本结果：
     * 否则本地/E2E 里"剧本优化"会拿到一个 `.mp4` 的 mock 结果——形状都是错的，
     * 前端要文本却收到视频 URI，看起来像"功能坏了"。
     */
    // 判据是**任务形态**（文本模式）而不是 adapter_code：同一个 LLM 适配器也可能
    // 被拿来跑别的形态，按 adapter 判会把媒体任务误判成同步文本
    if ((TextMode as readonly string[]).includes(req.request.mode)) {
      return {
        sync_results: [
          {
            uri: "",
            text: mockText(req),
            meta: { mock: true, mode: req.request.mode, adapter: "deepseek:chat" },
          },
        ],
      };
    }

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

/**
 * mock 模式下的确定性文本结果。
 *
 * 为什么按 mode 生成不同内容而不是一句固定话：画布的两个文本派生能力
 * （剧本优化 / 拆解分镜）消费结构完全不同，返回同一句会把"模式接线错了"
 * 这种问题掩盖掉。这里给出**可断言**的最小结构，便于 CI 校验。
 */
function mockText(req: NormalizedGenRequest): string {
  const prompt = req.request.input.prompt?.slice(0, 60) ?? "";
  if (req.request.mode === "script_optimization") {
    return [
      "【优化后的剧本片段（mock）】",
      `场景一 · 夜 · 内`,
      `（${prompt || "空输入"}）`,
      "林晚：这件事没有你想的那么简单。",
      "顾沉：那你就告诉我，真相到底是什么。",
      "（两人对视，镜头缓慢推近。）",
    ].join("\n");
  }
  if (req.request.mode === "storyboard_parse") {
    return [
      "【分镜清单（mock）】",
      "镜1 | 全景 | 夜色中的城市天际线，镜头缓慢下摇 | 5s | 9:16",
      "镜2 | 中景 | 人物动作推进第 2 个节拍，镜头跟随 | 5s | 9:16",
      "镜3 | 特写 | 主角眼神坚定，画面定格，字幕升起 | 5s | 9:16",
    ].join("\n");
  }
  if (req.request.mode === "asset_extraction") {
    // 必须是**合法 JSON**：前端按角色/场景/道具三个 tab 渲染，
    // mock 返回自由文本的话"解析失败"会盖住真正的链路问题
    return JSON.stringify({
      characters: [
        { name: "林晚", description: "主角，坚韧克制", prompt: "短剧角色肖像，林晚，冷色光影，清晰五官" },
        { name: "顾沉", description: "男主，隐瞒真相", prompt: "短剧角色肖像，顾沉，暖色光影，浅景深" },
      ],
      scenes: [{ name: "雨夜街头", description: "开场冲突发生地", prompt: "电影感场景，雨夜街头，霓虹反光" }],
      props: [{ name: "旧怀表", description: "推动真相的关键道具", prompt: "道具特写，旧怀表，浅景深" }],
    });
  }
  return `【mock 文本结果】${prompt}`;
}
