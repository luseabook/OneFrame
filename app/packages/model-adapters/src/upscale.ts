import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, pickString, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 超分目标档（竞品 `video-super-resolution`：720P→1080P / 1080P→2K / 2K→4K） */
export const UPSCALE_TARGETS = ["720p", "1080p", "2K", "4K"] as const;
export type UpscaleTarget = (typeof UPSCALE_TARGETS)[number];

export const UPSCALE_DEFAULT_TARGET: UpscaleTarget = "1080p";
/** 2 倍超分模型（topaz / 火山）常见的放大上限 */
export const UPSCALE_MAX_SCALE = 4;

export type UpscaleConfig = PostprocessHttpConfig;

/**
 * 视频超分（视频超清）适配器。
 *
 * 输入约定：`input.reference_uris[0]` 是源视频；`options.resolution` 是目标档——
 * 复用既有字段而不是新造 `target_resolution`：目录里每个模型本来就声明了
 * `resolution_options`，工具页选档走的是同一个 UI 控件，语义天然一致。
 *
 * 协议形状：
 *   POST {base}/v1/video/upscale/tasks {model, video_url, target_resolution, scale, fps}
 *   GET  {base}/v1/video/upscale/tasks/{id}
 *   → data.results[].video_url
 */
export class UpscaleAdapter extends HttpPostprocessAdapter {
  readonly vendor = "upscale";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: UpscaleConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/upscale/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/upscale/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private target(req: NormalizedGenRequest): UpscaleTarget {
    const raw = String(req.request.options?.resolution ?? "").trim();
    const matched = UPSCALE_TARGETS.find((value) => value.toLowerCase() === raw.toLowerCase());
    return matched ?? UPSCALE_DEFAULT_TARGET;
  }

  protected validate(req: NormalizedGenRequest): void {
    // 源视频必填：没有源就是「生成」不是「超分」，那是另一个 mode 的事
    const refs = req.request.input.reference_uris ?? [];
    if (refs.length === 0) {
      throw vendorParamError("upscale adapter requires reference_uris[0] = source video", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const raw = String(req.request.options?.resolution ?? "").trim();
    if (raw.length > 0 && !UPSCALE_TARGETS.some((value) => value.toLowerCase() === raw.toLowerCase())) {
      throw vendorParamError(
        `upscale target resolution must be one of ${UPSCALE_TARGETS.join("|")}, got ${raw}`,
        { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
      );
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = req.request.input.reference_uris;
    const target = this.target(req);
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      target_resolution: target,
      // 供应商侧多数按「目标档」自动推倍率，scale 只是显式提示（不参与计价，
      // 真实计价由 model_prices 的档位决定）
      scale: target === "4K" ? 4 : target === "2K" ? 2 : 2,
      fps: pickString(req.request.options ?? {}, ["fps"]) ?? undefined,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = req.request.options?.duration;
    return { ext: "mp4", count: 1, durationS: typeof duration === "number" ? duration : 5 };
  }
}
