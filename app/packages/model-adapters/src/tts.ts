import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, pickNumber, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 常用音色（火山/MiniMax 风格命名；供应商真实清单由 voice/list 端点给，这里只兜底默认值） */
export const TTS_VOICES = [
  "zh_female_shuangkuaisisi",
  "zh_female_tianmeixiaoyuan",
  "zh_male_yuanboxiaoshu",
  "zh_male_jieshuoxingger",
  "en_female_sarah",
] as const;

export const TTS_DEFAULT_VOICE = "zh_female_shuangkuaisisi";
export const TTS_DEFAULT_SPEED = 1.0;
/** 语速边界（火山 TTS 支持 0.25~4.0；取保守区间，越界在提交前就拦住） */
export const TTS_SPEED_MIN = 0.25;
export const TTS_SPEED_MAX = 4.0;

export type TtsConfig = PostprocessHttpConfig;

/**
 * TTS 文生语音适配器。
 *
 * 协议形状（火山/MiniMax 共有的那一套）：
 *   POST {base}/v1/tts/tasks   {model, text, voice, speed, format, sample_rate}
 *   GET  {base}/v1/tts/tasks/{id}
 *   → data.audios[].audio_url
 *
 * 为什么不走 `SpeechMode` 的同步实现：TTS 长文本（整集台词）耗时可达数十秒，
 * 同步 HTTP 会被网关超时腰斩，且失败无法重试单条。统一走任务系统才能复用
 * 「冻结→轮询→结算/退冻」这条既有脊柱（ADR-003：不新增端点，只扩适配器分派）。
 */
export class TtsAdapter extends HttpPostprocessAdapter {
  readonly vendor = "tts";
  protected readonly resultMedia: ResultMedia = "audio";

  constructor(config: TtsConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/tts/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/tts/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["audios", "audio", "results", "outputs"],
      mediaKeys: ["audio_url", "url", "uri", "download_url", "file_url"],
    };
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requirePrompt(req);
    const speed = pickNumber(this.providerOptions(req), ["speed"]);
    if (speed !== undefined && (speed < TTS_SPEED_MIN || speed > TTS_SPEED_MAX)) {
      throw vendorParamError(
        `tts speed ${speed} out of range (${TTS_SPEED_MIN}~${TTS_SPEED_MAX})`,
        { vendor: this.vendor, operation: "POST /v1/tts/tasks" },
      );
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const options = this.providerOptions(req);
    const text = this.requirePrompt(req);
    return {
      model: this.modelFor(req),
      text,
      voice: typeof options.voice === "string" && options.voice.length > 0 ? options.voice : TTS_DEFAULT_VOICE,
      speed: typeof options.speed === "number" ? options.speed : TTS_DEFAULT_SPEED,
      format: typeof options.format === "string" ? options.format : "mp3",
      sample_rate: typeof options.sample_rate === "number" ? options.sample_rate : 24_000,
      // 一次请求只产出一条音轨；count>1 在文本类能力上没有语义，显式忽略而不是静默多扣费
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    // 时长由字数估：中文约 5 字/秒（只为让 mock 的 duration_s 稳定可断言，
    // 不参与真实计价——TTS 真实按字符/次计价，见 owner 的价目表）
    const chars = (req.request.input.prompt ?? "").length;
    return { ext: "mp3", count: 1, durationS: Math.max(1, Math.round(chars / 5)) };
  }
}
