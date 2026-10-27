import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, pickNumber, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 对口型驱动模式（竞品 `advanced-lip`）：整段替换音轨 / 只驱动口型（保留原声底色） */
export const LIP_SYNC_MODES = ["replace_audio", "lip_only"] as const;
export type LipSyncMode = (typeof LIP_SYNC_MODES)[number];

export type LipSyncConfig = PostprocessHttpConfig;

/**
 * 对口型适配器（视频 + 音频 → 视频）。
 *
 * 输入约定：`input.reference_uris = [视频, 音频]`（顺序固定）。
 * 为什么不新增 `video_uri` / `audio_uri` 字段：`GenerationInput` 是既有公开契约
 * （api-spec §5），本批不改共享 schema；`reference_uris` 的顺序语义由适配器声明并校验，
 * 语义清楚且不需要迁移客户端。
 *
 * 协议形状：
 *   POST {base}/v1/lip-sync/tasks {model, video_url, audio_url, mode}
 *   GET  {base}/v1/lip-sync/tasks/{id}
 *   → data.results[].video_url
 */
export class LipSyncAdapter extends HttpPostprocessAdapter {
  readonly vendor = "lip-sync";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: LipSyncConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/lip-sync/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/lip-sync/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  protected validate(req: NormalizedGenRequest): void {
    // 两个素材缺一不可：只有视频没音频 → 没有驱动信号；只有音频没视频 → 没有目标画面
    this.requireReferences(req, 2, ["video", "audio"]);
    const mode = this.mode(req);
    if (!LIP_SYNC_MODES.includes(mode)) {
      throw vendorParamError(`lip-sync mode must be one of ${LIP_SYNC_MODES.join("|")}, got ${mode}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  private mode(req: NormalizedGenRequest): LipSyncMode {
    const raw = this.providerOptions(req).mode;
    return typeof raw === "string" && raw.length > 0 ? (raw as LipSyncMode) : "replace_audio";
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [videoUrl, audioUrl] = this.requireReferences(req, 2, ["video", "audio"]);
    return {
      model: this.modelFor(req),
      video_url: videoUrl,
      audio_url: audioUrl,
      mode: this.mode(req),
      // 口型贴合强度：默认 1.0（标准）；越低越保守，避免大幅失真
      sync_strength: pickNumber(this.providerOptions(req), ["sync_strength"]) ?? 1,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    // 口型产物时长 = 输入视频时长；未知时给 5s（与其它视频能力的 mock 默认一致）
    const duration = pickNumber(this.providerOptions(req), ["duration", "duration_s"]) ?? 5;
    return { ext: "mp4", count: 1, durationS: duration };
  }
}
