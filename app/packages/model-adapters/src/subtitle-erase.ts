import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, asRecord, pickNumber, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 去字幕的两种模式（竞品 `de_subtitle_auto` / `de_subtitle_region`） */
export const SUBTITLE_ERASE_MODES = ["auto", "region"] as const;
export type SubtitleEraseMode = (typeof SUBTITLE_ERASE_MODES)[number];

/** 区域去字幕的归一化坐标（0~1），与分辨率无关——前端画完框直接按比例传，不用知道视频尺寸 */
export interface SubtitleRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 归一化坐标边界校验：越界必须报错，静默裁剪会让用户框错位置却看不出来 */
export function assertRegion(region: SubtitleRegion): void {
  const { x, y, w, h } = region;
  for (const [name, value] of Object.entries({ x, y, w, h })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`subtitle region ${name} must be within 0~1, got ${value}`);
    }
  }
  if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) {
    throw new Error(`subtitle region overflows frame: x+w=${x + w}, y+h=${y + h}`);
  }
  if (w <= 0 || h <= 0) throw new Error("subtitle region width/height must be > 0");
}

export type SubtitleEraseConfig = PostprocessHttpConfig;

/**
 * 去字幕适配器（auto 自动检测 / region 框选区域）。
 *
 * 两种模式**共用一个适配器**：供应商侧是同一接口的 `mode` 字段差异，
 * 拆两个文件会造出两份重试/错误映射代码，却没有任何行为差异。
 *
 * 协议形状：
 *   POST {base}/v1/video/de-subtitle/tasks {model, video_url, mode, region?, inpaint}
 *   GET  {base}/v1/video/de-subtitle/tasks/{id}
 *   → data.results[].video_url
 *
 * ⚠️ 与 `constants.ImageMode` 里的 `erase` 不是一回事：那个是**图像**涂抹重绘（inpaint），
 * 这个是**视频**整段去字幕。二者产物类型不同（image vs video），不能共用一个 adapter_code。
 */
export class SubtitleEraseAdapter extends HttpPostprocessAdapter {
  readonly vendor = "subtitle-erase";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: SubtitleEraseConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/de-subtitle/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/de-subtitle/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private mode(req: NormalizedGenRequest): SubtitleEraseMode {
    const raw = String(this.providerOptions(req).mode ?? "").trim();
    return (SUBTITLE_ERASE_MODES as readonly string[]).includes(raw)
      ? (raw as SubtitleEraseMode)
      : "auto";
  }

  /**
   * 区域来源：`options.region` 或 `options.sub_mode`（竞品把它们放在 canvas mode 的
   * sub_mode 里）。两者都读是为了兼容画布侧既有传参方式，优先级 region > sub_mode。
   */
  private region(req: NormalizedGenRequest): SubtitleRegion | undefined {
    const options = this.providerOptions(req);
    const candidate = asRecord(options.region) ?? asRecord(options.sub_mode);
    if (!candidate) return undefined;
    const x = pickNumber(candidate, ["x"]);
    const y = pickNumber(candidate, ["y"]);
    const w = pickNumber(candidate, ["w", "width"]);
    const h = pickNumber(candidate, ["h", "height"]);
    if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
    return { x, y, w, h };
  }

  protected validate(req: NormalizedGenRequest): void {
    const refs = req.request.input.reference_uris ?? [];
    if (refs.length === 0) {
      throw vendorParamError("subtitle-erase adapter requires reference_uris[0] = source video", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const raw = String(this.providerOptions(req).mode ?? "").trim();
    if (raw.length > 0 && !(SUBTITLE_ERASE_MODES as readonly string[]).includes(raw)) {
      throw vendorParamError(
        `subtitle-erase mode must be ${SUBTITLE_ERASE_MODES.join("|")}, got ${raw}`,
        { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
      );
    }
    if (this.mode(req) === "region") {
      const region = this.region(req);
      // region 模式没有区域就等于没给指令：必须显式报错，不能悄悄退化成 auto
      // （用户以为只擦了框内，实际全片被检测改写——产物不可逆且已扣费）
      if (!region) {
        throw vendorParamError("subtitle-erase region mode requires options.region {x,y,w,h}", {
          vendor: this.vendor,
          operation: `POST ${this.defaultSubmitPath()}`,
        });
      }
      assertRegion(region);
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = req.request.input.reference_uris;
    const mode = this.mode(req);
    const region = mode === "region" ? this.region(req) : undefined;
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      mode,
      ...(region ? { region: [region.x, region.y, region.w, region.h] } : {}),
      // 擦除后的补全方式：inpaint=内容填充（默认）/ blur=模糊遮挡（速度快、痕迹明显）
      inpaint: this.providerOptions(req).inpaint === true,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = req.request.options?.duration;
    return { ext: "mp4", count: 1, durationS: typeof duration === "number" ? duration : 5 };
  }
}
