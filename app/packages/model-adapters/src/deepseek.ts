import type { ModelAdapter, NormalizedGenRequest } from "./types";

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Record<string, unknown>;
}

// DeepSeek（OpenAI 兼容）LLM 适配器：用于大纲/角色/分镜等同步文本步骤。
// 注意：模型/参数映射集中在此，便于按供应商版本调整。
export class DeepSeekChatAdapter implements ModelAdapter {
  readonly vendor = "deepseek";

  constructor(
    private readonly config: DeepSeekConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}) {
    const base = (this.config.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);
    try {
      const res = await this.fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model ?? "deepseek-chat",
          messages,
          temperature: options.temperature ?? 0.3,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`deepseek http ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as ChatResponse;
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("deepseek response missing choices[0].message.content");
      return { text, usage: data.usage ?? null };
    } finally {
      clearTimeout(timer);
    }
  }

  async submit(req: NormalizedGenRequest) {
    const prompt = req.request.input.prompt;
    if (!prompt) throw new Error("deepseek adapter requires input.prompt");
    const { text, usage } = await this.chat([{ role: "user", content: prompt }]);
    return {
      sync_results: [{ uri: "", text, meta: { model: this.config.model ?? "deepseek-chat", usage } }],
    };
  }

  async poll(): Promise<never> {
    throw new Error("deepseek is synchronous; poll not supported");
  }

  async cancel(): Promise<void> {
    // 同步调用无取消语义
  }
}
