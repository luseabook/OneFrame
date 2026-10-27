import { Injectable, Logger } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { decodeBase64Upload } from "../../common/base64";

/**
 * 语音转写（STT）通道 —— 竞品 `GET /web/v1/agent/stt-token`（`routes.txt:126`）。
 *
 * 竞品语义（**推断**：只有路由，响应体未取证）：给浏览器发一个短期凭据，
 * 前端录音后直接拿它调云端 ASR。我方**不**这么做：把云厂商 key 交给浏览器，
 * 等于把账单与配额交给用户。因此：
 *
 * - `available=false` → 前端优雅降级（回落到浏览器内置识别 / 手打），**不报 500**；
 * - `available=true` → 下发**自有短时效中继令牌**（`aud=agent-stt`，120s），
 *   前端把音频 POST 到 `POST /agent/stt/transcribe`，由服务端替它调 ASR，
 *   厂商 Key 永远不出服务端。
 *
 * Provider 取值由 `config/env.ts` 的 `AGENT_STT_PROVIDER` 决定（Lead 已收口）：
 * - `browser`（默认）：不走服务端转写，`available:false` + `fallback:"browser"`；
 * - `custom`：OpenAI 兼容 `/audio/transcriptions`（自建网关也走这条），可用；
 * - `volc` / `minimax`：需要各自的签名与 token 交换，**本批未接**（待取证），
 *   返回 `available:false + reason:"stt_provider_unsupported:<id>"`，不假装可用。
 */

const STT_TOKEN_TTL_S = 120;
const STT_AUDIENCE = "agent-stt";
/** 录音上传上限：60s 的 opus/webm 一般 < 1MB，8MB 与其它上传入口保持一致 */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 25_000;

/** 可真实转写的 provider（其余一律按"未接入"处理） */
const RELAY_PROVIDERS: Record<string, { name: string; defaultBaseUrl: string; defaultModel: string }> = {
  custom: { name: "OpenAI 兼容转写", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "whisper-1" },
};

export interface SttProviderInfo {
  id: string;
  name: string;
  /** 音频走我方中继，不下发厂商 Key */
  mode: "relay";
  model: string;
}

export interface SttTokenResult {
  available: boolean;
  provider: SttProviderInfo | null;
  token: string | null;
  expires_at: string | null;
  ttl_s: number;
  transcribe_path: string | null;
  /** 不可用时的可读原因（前端据此给降级提示，而不是弹错误） */
  reason: string | null;
  /** 降级建议 */
  fallback: "browser" | null;
}

/** 配置切片：便于单测直接构造，不必改全局 env */
export interface SttSettings {
  provider: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
}

/** 纯函数：把配置解析成"可用 / 不可用 + 原因"，不含任何 IO */
export function resolveSttCapability(settings: SttSettings):
  | { ok: true; provider: SttProviderInfo; apiKey: string; baseUrl: string }
  | { ok: false; reason: string } {
  const provider = (settings.provider || "browser").trim().toLowerCase();
  if (provider === "browser") return { ok: false, reason: "stt_provider_browser" };
  const relay = RELAY_PROVIDERS[provider];
  if (!relay) return { ok: false, reason: `stt_provider_unsupported:${provider}` };
  const apiKey = (settings.apiKey ?? "").trim();
  if (!apiKey) return { ok: false, reason: "stt_provider_not_configured" };
  const baseUrl = (settings.baseUrl ?? relay.defaultBaseUrl).trim().replace(/\/+$/, "");
  return {
    ok: true,
    provider: { id: provider, name: relay.name, mode: "relay", model: (settings.model ?? relay.defaultModel).trim() },
    apiKey,
    baseUrl,
  };
}

@Injectable()
export class AgentSttService {
  private readonly logger = new Logger("agent.stt");

  private settings(): SttSettings {
    return {
      provider: env.AGENT_STT_PROVIDER,
      apiKey: env.AGENT_STT_API_KEY,
      baseUrl: env.AGENT_STT_BASE_URL,
      model: env.AGENT_STT_MODEL,
    };
  }

  /**
   * 能力位 + 短期令牌。
   *
   * `override` 只给单测用：`env` 在进程启动时定型，测试无法改真实配置，
   * 又不能用 `process.env` 直读（配置层必须单一入口）。
   */
  token(auth: { userId: string; spaceId: string }, override?: SttSettings): SttTokenResult {
    const capability = resolveSttCapability(override ?? this.settings());
    if (!capability.ok) {
      return {
        available: false,
        provider: null,
        token: null,
        expires_at: null,
        ttl_s: 0,
        transcribe_path: null,
        reason: capability.reason,
        fallback: "browser",
      };
    }
    const token = jwt.sign(
      { sub: auth.userId, sid: auth.spaceId, aud: STT_AUDIENCE },
      env.JWT_SECRET,
      { expiresIn: STT_TOKEN_TTL_S },
    );
    return {
      available: true,
      provider: capability.provider,
      token,
      expires_at: new Date(Date.now() + STT_TOKEN_TTL_S * 1000).toISOString(),
      ttl_s: STT_TOKEN_TTL_S,
      transcribe_path: "/v1/agent/stt/transcribe",
      reason: null,
      fallback: null,
    };
  }

  /** 中继令牌校验（中继端点自己验票：浏览器录音场景不带宽带 Bearer 的 access token） */
  verifyToken(raw: string | undefined): { userId: string; spaceId: string } {
    if (!raw) throw new AppError(ErrorCode.UNAUTHORIZED, "missing stt token");
    let decoded: unknown;
    try {
      decoded = jwt.verify(raw, env.JWT_SECRET, { audience: STT_AUDIENCE });
    } catch {
      throw new AppError(ErrorCode.UNAUTHORIZED, "invalid or expired stt token");
    }
    const value = decoded as { sub?: unknown; sid?: unknown };
    if (typeof value.sub !== "string" || typeof value.sid !== "string") {
      throw new AppError(ErrorCode.UNAUTHORIZED, "invalid stt token payload");
    }
    return { userId: value.sub, spaceId: value.sid };
  }

  /**
   * 转写（服务端中转）。
   * 不可用时返回 `400100 + details.reason=stt_unavailable`：前端拿到后回退手打，
   * 而不是把错误弹成"发送失败"。
   */
  async transcribe(
    auth: { userId: string; spaceId: string },
    input: { audioBase64: string; format?: string; language?: string },
    override?: SttSettings,
  ): Promise<{ text: string; provider: string; model: string }> {
    const capability = resolveSttCapability(override ?? this.settings());
    if (!capability.ok) {
      // 信封只回 {code,msg,data:null}（全站统一，details 不下发），所以原因必须写进 msg：
      // 前端拿 400100 就把录音结果丢掉、提示"改用文字"，不弹"发送失败"
      throw new AppError(ErrorCode.BAD_REQUEST, "语音转写未配置（已回退文字输入）", {
        reason: "stt_unavailable",
        detail: capability.reason,
      });
    }
    const audio = decodeBase64Upload(input.audioBase64, MAX_AUDIO_BYTES);
    const format = (input.format ?? "webm").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "webm";
    const mime =
      format === "webm" ? "audio/webm" : format === "mp4" ? "audio/mp4" : format === "wav" ? "audio/wav" : `audio/${format}`;

    const form = new FormData();
    form.append("file", new Blob([audio], { type: mime }), `audio.${format}`);
    form.append("model", capability.provider.model);
    if (input.language) form.append("language", input.language.slice(0, 8));

    let res: Response;
    try {
      res = await fetch(`${capability.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${capability.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "stt provider request failed",
      );
      throw new AppError(ErrorCode.BAD_REQUEST, "speech-to-text provider unreachable", {
        reason: "stt_provider_unreachable",
      });
    }
    if (!res.ok) {
      // 不把厂商响应体整段回传给前端（可能含配额/账号信息），只留状态码
      this.logger.warn({ status: res.status }, "stt provider rejected request");
      throw new AppError(ErrorCode.BAD_REQUEST, "speech-to-text failed", {
        reason: "stt_provider_error",
        status: res.status,
      });
    }
    const body = (await res.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) {
      throw new AppError(ErrorCode.BAD_REQUEST, "speech-to-text returned empty text", {
        reason: "stt_empty_result",
      });
    }
    // 只记长度不记内容：语音内容属于用户隐私，不落日志
    this.logger.debug({ chars: text.length, spaceId: auth.spaceId }, "stt transcribed");
    return { text, provider: capability.provider.id, model: capability.provider.model };
  }
}
