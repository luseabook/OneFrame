import { vendorParamError } from "./errors";
import { HttpPostprocessAdapter, pickNumber, type PostprocessHttpConfig, type ResultMedia } from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/** 单个切片区间（秒，半开区间 [start, end)） */
export interface SliceRange {
  start: number;
  end: number;
}

/** 切片策略：按时长均分 / 按显式区间 / 按镜额（n 等分） */
export const SLICING_STRATEGIES = ["duration", "ranges", "count"] as const;
export type SlicingStrategy = (typeof SLICING_STRATEGIES)[number];

/** 单片时长边界（秒）：小于 1s 无意义，大于 300s 说明参数用错了 */
export const SLICE_DURATION_MIN_S = 1;
export const SLICE_DURATION_MAX_S = 300;
/** 单次最多切几片（与 LIMITS.SHOT_COUNT_MAX 同量级，防止一次请求产上千文件） */
export const SLICE_COUNT_MAX = 50;

export type SlicingConfig = PostprocessHttpConfig;

/**
 * 视频切片适配器。
 *
 * 三种策略共用一个适配器（供应商侧就是同一接口的 `strategy` 字段差异）：
 *   - `duration`：每片 N 秒（最常用：把长视频切成可用分镜长度）
 *   - `ranges`  ：显式区间数组（精剪/回填时用）
 *   - `count`   ：等分 N 片
 *
 * 协议形状：
 *   POST {base}/v1/video/slicing/tasks {model, video_url, strategy, slice_duration?, ranges?, count?}
 *   GET  {base}/v1/video/slicing/tasks/{id}
 *   → data.results[].video_url（**多产物**：切片天然是 1→N）
 *
 * 多产物是本适配器与其它后处理适配器的关键差别：`mockShape` 的 count 不为 1，
 * 且结果顺序必须稳定（按 start 升序），否则时间线拼回去会乱序。
 */
export class SlicingAdapter extends HttpPostprocessAdapter {
  readonly vendor = "slicing";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: SlicingConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/slicing/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/slicing/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "segments", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private strategy(req: NormalizedGenRequest): SlicingStrategy {
    const raw = String(this.providerOptions(req).strategy ?? "").trim();
    if ((SLICING_STRATEGIES as readonly string[]).includes(raw)) return raw as SlicingStrategy;
    // 未显式声明时按参数推断：给了 ranges 就是 ranges，否则按 duration。
    // 注意判据是「字段存在」而不是「长度 > 0」——传 `ranges: []` 是用户**明确要区间切**，
    // 只是没填，必须报错让他补；按长度判断会静默退化成 duration 切法（切出来的片不是他要的）。
    if (this.providerOptions(req).ranges !== undefined) return "ranges";
    return "duration";
  }

  private rangesOf(req: NormalizedGenRequest): SliceRange[] {
    const raw = this.providerOptions(req).ranges;
    if (!Array.isArray(raw)) return [];
    const out: SliceRange[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Json;
      const start = pickNumber(record, ["start", "start_s"]);
      const end = pickNumber(record, ["end", "end_s"]);
      if (start === undefined || end === undefined) continue;
      out.push({ start, end });
    }
    return out;
  }

  private sliceDuration(req: NormalizedGenRequest): number {
    const raw = pickNumber(this.providerOptions(req), ["slice_duration", "slice_duration_s", "duration"]);
    return Math.round(raw ?? (req.request.options?.duration ?? 5));
  }

  protected validate(req: NormalizedGenRequest): void {
    const refs = req.request.input.reference_uris ?? [];
    if (refs.length === 0) {
      throw vendorParamError("slicing adapter requires reference_uris[0] = source video", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const strategy = this.strategy(req);
    if (strategy === "ranges") {
      const ranges = this.rangesOf(req);
      if (ranges.length === 0) {
        throw vendorParamError("slicing ranges strategy requires options.ranges [{start,end}]", {
          vendor: this.vendor,
          operation: `POST ${this.defaultSubmitPath()}`,
        });
      }
      if (ranges.length > SLICE_COUNT_MAX) {
        throw vendorParamError(`slicing at most ${SLICE_COUNT_MAX} ranges, got ${ranges.length}`, {
          vendor: this.vendor,
          operation: `POST ${this.defaultSubmitPath()}`,
        });
      }
      let previousEnd = -1;
      for (const [index, range] of ranges.entries()) {
        if (range.end <= range.start) {
          throw vendorParamError(`slicing range[${index}] end must be > start (${range.start}~${range.end})`, {
            vendor: this.vendor,
            operation: `POST ${this.defaultSubmitPath()}`,
          });
        }
        // 区间必须升序且不重叠：乱序/重叠切片拼回时间线会重复或丢帧
        if (range.start < previousEnd) {
          throw vendorParamError(
            `slicing ranges must be sorted and non-overlapping (range[${index}] starts at ${range.start} before ${previousEnd})`,
            { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
          );
        }
        previousEnd = range.end;
      }
      return;
    }
    if (strategy === "duration") {
      const slice = this.sliceDuration(req);
      if (slice < SLICE_DURATION_MIN_S || slice > SLICE_DURATION_MAX_S) {
        throw vendorParamError(
          `slicing slice duration must be ${SLICE_DURATION_MIN_S}~${SLICE_DURATION_MAX_S}s, got ${slice}`,
          { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
        );
      }
      return;
    }
    const count = pickNumber(this.providerOptions(req), ["count"]);
    if (count !== undefined && (count < 1 || count > SLICE_COUNT_MAX)) {
      throw vendorParamError(`slicing count must be 1~${SLICE_COUNT_MAX}, got ${count}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = req.request.input.reference_uris;
    const strategy = this.strategy(req);
    const body: Json = { model: this.modelFor(req), video_url: sourceVideo, strategy };
    if (strategy === "ranges") {
      body.ranges = this.rangesOf(req).map((range) => [range.start, range.end]);
    } else if (strategy === "duration") {
      body.slice_duration = this.sliceDuration(req);
    } else {
      body.count = Math.min(
        SLICE_COUNT_MAX,
        Math.max(1, Math.round(pickNumber(this.providerOptions(req), ["count"]) ?? 2)),
      );
    }
    // 是否同时输出每片的封面图（时间线/素材列表要缩略图）
    body.with_cover = this.providerOptions(req).with_cover !== false;
    return body;
  }

  protected mockShape(req: NormalizedGenRequest) {
    const strategy = this.strategy(req);
    let count = 2;
    if (strategy === "ranges") count = this.rangesOf(req).length;
    else if (strategy === "count") {
      count = Math.min(
        SLICE_COUNT_MAX,
        Math.max(1, Math.round(pickNumber(this.providerOptions(req), ["count"]) ?? 2)),
      );
    }
    return { ext: "mp4", count: Math.max(1, count), durationS: this.sliceDuration(req) };
  }
}
