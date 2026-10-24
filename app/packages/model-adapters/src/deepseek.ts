import type { ModelAdapter, NormalizedGenRequest } from "./types";
import { RetryableVendorError } from "./ark-video";

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** 网络/5xx/429 重试次数 */
  maxRetries?: number;
  retryBaseMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: Record<string, unknown>;
}

// DeepSeek（OpenAI 兼容）LLM 适配器：用于大纲/角色/分镜等同步文本步骤。
// 注意：模型/参数映射集中在此，便于按供应商版本调整。
export class DeepSeekChatAdapter implements ModelAdapter {
  readonly vendor = "deepseek";
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly config: DeepSeekConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  async chat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.chatOnce(messages, options);
      } catch (err) {
        lastError = err;
        if (!(err instanceof RetryableVendorError) || attempt === this.maxRetries) break;
        await new Promise((r) => setTimeout(r, this.retryBaseMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private async chatOnce(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number },
  ): Promise<{ text: string; usage: Record<string, unknown> | null }> {
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
        const message = `deepseek http ${res.status}: ${body.slice(0, 300)}`;
        // 429 限流与 5xx 可重试；4xx（鉴权/参数）不重试
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableVendorError(message, res.status);
        }
        throw new Error(message);
      }
      const data = (await res.json()) as ChatResponse;
      const choice = data.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") throw new Error("deepseek response missing choices[0].message.content");
      return { text, usage: data.usage ?? null };
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TypeError")) {
        throw new RetryableVendorError(`deepseek network error: ${err.message}`);
      }
      throw err;
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
