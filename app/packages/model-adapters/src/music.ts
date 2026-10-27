import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, pickNumber, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 音乐/音效的子能力（竞品 `text-to-music` / `text-to-sfx` 两个端点，收敛到一个适配器） */
export const MUSIC_KINDS = ["text2music", "text2sfx"] as const;
export type MusicKind = (typeof MUSIC_KINDS)[number];

export const MUSIC_DEFAULT_DURATION_S = 30;
/** 音乐 5~300s；音效 0.5~30s（按各自业务面取值，越界提交前拦住） */
export const MUSIC_DURATION_RANGE: Record<MusicKind, [number, number]> = {
  text2music: [5, 300],
  text2sfx: [1, 30],
};

export type MusicConfig = PostprocessHttpConfig;

/**
 * 音乐 / 音效适配器（`text2music` 与 `text2sfx` 共用）。
 *
 * 为什么合成一个适配器而不是两个文件：两者协议完全相同（同一家供应商同一套任务接口），
 * 只差 `kind` 字段与时长上界。拆成两个会让 registry 里多一个 code、多一份重试逻辑，
 * 却没有任何行为差异。
 *
 * 协议形状：
 *   POST {base}/v1/music/tasks  {model, kind, prompt, duration, instrumental}
 *   GET  {base}/v1/music/tasks/{id}
 *   → data.results[].audio_url
 */
export class MusicAdapter extends HttpPostprocessAdapter {
  readonly vendor = "music";
  protected readonly resultMedia: ResultMedia = "audio";

  constructor(
    config: MusicConfig,
    private readonly kind: MusicKind = "text2music",
  ) {
    super(config);
    if (!MUSIC_KINDS.includes(kind)) {
      throw new Error(`unknown music kind: ${kind}`);
    }
  }

  /** 该实例服务的子能力（`text2music` / `text2sfx`） */
  get musicKind(): MusicKind {
    return this.kind;
  }

  protected defaultSubmitPath(): string {
    return this.kind === "text2sfx" ? "/v1/sfx/tasks" : "/v1/music/tasks";
  }

  protected defaultPollPath(): string {
    return this.kind === "text2sfx" ? "/v1/sfx/tasks/{id}" : "/v1/music/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "audios", "audio", "outputs"],
      mediaKeys: ["audio_url", "url", "uri", "download_url"],
    };
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requirePrompt(req);
    const [min, max] = MUSIC_DURATION_RANGE[this.kind];
    const duration = pickNumber(this.providerOptions(req), ["duration", "duration_s", "durationS"]);
    if (duration !== undefined && (duration < min || duration > max)) {
      throw vendorParamError(
        `${this.kind} duration ${duration}s out of range (${min}~${max})`,
        { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
      );
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const options = this.providerOptions(req);
    const [min, max] = MUSIC_DURATION_RANGE[this.kind];
    const raw = pickNumber(options, ["duration", "duration_s", "durationS"]) ?? MUSIC_DEFAULT_DURATION_S;
    const duration = Math.min(max, Math.max(min, Math.round(raw)));
    return {
      model: this.modelFor(req),
      kind: this.kind,
      prompt: this.requirePrompt(req),
      duration,
      // 音乐可要纯伴奏；音效没有「伴奏」概念，固定 false
      instrumental: this.kind === "text2music" && options.instrumental === true,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const [min, max] = MUSIC_DURATION_RANGE[this.kind];
    const raw = pickNumber(this.providerOptions(req), ["duration", "duration_s", "durationS"]) ?? MUSIC_DEFAULT_DURATION_S;
    return { ext: "mp3", count: 1, durationS: Math.min(max, Math.max(min, Math.round(raw))) };
  }
}
