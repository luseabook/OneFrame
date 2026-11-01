import { vendorParamError, vendorProtocolError } from "./errors";
import { VendorHttpClient } from "./vendor-http";
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

const VENDOR = "deepseek";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const CHAT_PATH = "/chat/completions";

// DeepSeek（OpenAI 兼容）LLM 适配器：用于大纲/角色/分镜等同步文本步骤。
// 传输层（重试/超时/错误分类/响应封顶）统一走 VendorHttpClient；
// 本文件只保留「请求体怎么拼、响应怎么解释」。model/参数映射集中在此，便于按供应商版本调整。
export class DeepSeekChatAdapter implements ModelAdapter {
  readonly vendor = VENDOR;
  private readonly http: VendorHttpClient;
  private readonly model: string;

  constructor(config: DeepSeekConfig, fetchImpl: typeof fetch = fetch) {
    this.model = config.model ?? "deepseek-chat";
    this.http = new VendorHttpClient({
      vendor: VENDOR,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: config.timeoutMs ?? 30_000,
      apiKey: config.apiKey,
      maxRetries: config.maxRetries ?? 2,
      retryBaseMs: config.retryBaseMs ?? 500,
      // 既有对外文案是 `deepseek http <status>: …`（日志/告警按它匹配），不走默认前缀
      messagePrefix: "deepseek http ",
      invalidJsonMessage: "deepseek response is not valid json",
      // 网络错误文案保持不带 operation（既有文案 `deepseek timeout: …`）
      networkErrorOperation: false,
      fetchImpl,
    });
  }

  async chat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}) {
    const body = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.3,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };
    const data = await this.http.request<ChatResponse>("POST", CHAT_PATH, body);
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string") {
      // 结构错误重试无益（已计费的调用多半也不会变），显式失败便于上层告警
      throw vendorProtocolError("deepseek response missing choices[0].message.content", {
        vendor: VENDOR,
        operation: `POST ${CHAT_PATH}`,
        status: 200,
      });
    }
    return { text, usage: data.usage ?? null };
  }

  async submit(req: NormalizedGenRequest) {
    const prompt = req.request.input.prompt;
    if (!prompt) {
      throw vendorParamError("deepseek adapter requires input.prompt", {
        vendor: VENDOR,
        operation: `POST ${CHAT_PATH}`,
      });
    }
    const { text, usage } = await this.chat([{ role: "user", content: prompt }]);
    return {
      sync_results: [{ uri: "", text, meta: { model: this.model, usage } }],
    };
  }

  async poll(): Promise<never> {
    throw new Error("deepseek is synchronous; poll not supported");
  }

  async cancel(): Promise<void> {
    // 同步调用无取消语义
  }
}
