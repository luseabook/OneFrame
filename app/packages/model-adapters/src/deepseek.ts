import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  VendorError,
  vendorParamError,
  vendorProtocolError,
} from "./errors";
import type { ModelAdapter, NormalizedGenRequest } from "./types";

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
        if (!isRetryableVendorError(err) || attempt === this.maxRetries) break;
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
    const operation = "POST /chat/completions";
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
        // 统一错误映射（401/403→auth_error、402→quota_exceeded、429→rate_limited 可重试、
        // 5xx→可重试、其他 4xx→invalid_param/vendor_error 不重试）；
        // messagePrefix 保持既有 `deepseek http <status>:` 文案，避免破坏日志/告警匹配
        throw classifyVendorHttpError(res.status, body, {
          vendor: "deepseek",
          operation,
          messagePrefix: "deepseek http ",
        });
      }
      let data: ChatResponse;
      try {
        data = (await res.json()) as ChatResponse;
      } catch {
        throw vendorProtocolError("deepseek response is not valid json", {
          vendor: "deepseek",
          operation,
          status: res.status,
        });
      }
      const choice = data.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") {
        // 结构错误重试无益（已计费的调用多半也不会变），显式失败便于上层告警
        throw vendorProtocolError("deepseek response missing choices[0].message.content", {
          vendor: "deepseek",
          operation,
          status: res.status,
        });
      }
      return { text, usage: data.usage ?? null };
    } catch (err) {
      if (err instanceof VendorError) throw err;
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError")) {
        throw classifyVendorNetworkError(err, { vendor: "deepseek" });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async submit(req: NormalizedGenRequest) {
    const prompt = req.request.input.prompt;
    if (!prompt) {
      throw vendorParamError("deepseek adapter requires input.prompt", {
        vendor: "deepseek",
        operation: "POST /chat/completions",
      });
    }
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
