import { vendorParamError } from "./errors";
import {
  asRecord,
  HttpPostprocessAdapter,
  pickNumber,
  pickString,
  type PostprocessHttpConfig,
  type ResultMedia,
} from "./postprocess";
import type { NormalizedGenRequest } from "./types";

type Json = Record<string, unknown>;

/**
 * 第 3 批工具箱补齐的七个单点能力（都是「拿一个已有媒体改它」的后处理）。
 *
 * 为什么集中在这一个文件里：它们与 `tts.ts` / `music.ts` / `upscale.ts` 等既有适配器
 * **协议骨架完全相同**（提交→轮询→取产物），差别只有「请求体字段」和「产物媒体类型」。
 * 每个类 30~50 行，集中放能让人一眼看出「这一批新增了哪些能力、各自吃什么参数」，
 * 也避免 registry 里多出七个 import 路径。
 *
 * 与既有适配器的边界（不要顺手合并）：
 *   - `video_upscale` 已有 `upscale.ts`（超分档位/倍率语义独立）；
 *   - `video_slicing` 已有 `slicing.ts`（1→N 多产物、区间校验独立）；
 *   - `de_subtitle_*` 已有 `subtitle-erase.ts`（区域归一化坐标校验独立）。
 * 这里只补**没有实现**的七个：特效 / 帧率时长统一 / 音画分离 / 音色修改 / 自动配乐 /
 * 涂抹重绘 / 文字重绘。
 */

/** 视频特效模板（竞品 `/create/video-effects/effect` 的效果位；模板清单由运营扩展） */
export const VIDEO_EFFECTS = ["cinematic", "film_grain", "neon_glow", "dreamy_blur", "vhs"] as const;

/** 帧率统一的目标档：视频平台常见的交付帧率 */
export const FPS_TARGETS = [12, 24, 25, 30, 60] as const;

/** 音画分离的音频容器（wav 用于二次混音，mp3 用于直接试听） */
export const AUDIO_SEPARATION_FORMATS = ["mp3", "wav"] as const;

/** 音色预设（竞品「音色修改」的预设位；真实音色清单由供应商 voice/list 给） */
export const TIMBRE_PRESETS = ["warm_female", "warm_male", "narrator", "child", "robot"] as const;

/** 自动配乐风格（音乐库分类；匹配算法按风格 + 节奏点选曲） */
export const BGM_STYLES = ["epic", "calm", "tension", "warm", "upbeat"] as const;

/** 涂抹重绘的补全方式 */
export const INPAINT_MODES = ["inpaint", "erase", "blur"] as const;

/** 文字重绘的字体风格 */
export const REPAINT_FONTS = ["sans", "serif", "handwritten", "poster"] as const;

/**
 * 视频特效（转场 / 风格化）。
 *
 * 与「视频编辑」的区别：编辑改**内容语义**（把 A 换成 B），特效应只改**观感**
 * （调色、颗粒、光效、转场），不改画面里有什么。因此它是独立 mode：任务列表能分开统计，
 * 计价也能按「特效模板档」而不是按生成时长。
 */
export class VideoEffectsAdapter extends HttpPostprocessAdapter {
  readonly vendor = "video-effects";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/effects/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/effects/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private effect(req: NormalizedGenRequest): string {
    return pickString(this.providerOptions(req), ["effect", "effect_id", "template"]) ?? "";
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source video"]);
    const effect = this.effect(req);
    if (!effect) {
      // 没给模板等于没给指令：静默套一个默认特效会让用户拿到"不是我选的"成片，还照样扣费
      throw vendorParamError(`video-effects requires options.effect (one of ${VIDEO_EFFECTS.join("|")})`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = this.requireReferences(req, 1, ["source video"]);
    const intensity = pickNumber(this.providerOptions(req), ["intensity"]);
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      effect: this.effect(req),
      // 强度归一到 0~1：越界不报错而是夹紧——它是观感参数，夹紧不会改变用户意图的语义
      intensity: Math.min(1, Math.max(0, intensity ?? 0.8)),
      with_transition: this.providerOptions(req).with_transition === true,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = req.request.options?.duration;
    return { ext: "mp4", count: 1, durationS: typeof duration === "number" ? duration : 5 };
  }
}

/**
 * 帧率与时长统一（交付前规整）。
 *
 * 输入是一段视频，输出是「帧率 = target_fps、时长 = target_duration」的同一段视频。
 * `pad_mode` 决定时长不足/超出时怎么处理：`trim` 裁掉多出来的部分、`pad` 用最后一帧补齐、
 * `loop` 循环填满。三者产出的可交付性不同（loop 会重复动作），必须显式选择。
 */
export class FpsDurationUnifyAdapter extends HttpPostprocessAdapter {
  readonly vendor = "fps-unify";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/fps-unify/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/fps-unify/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private targetFps(req: NormalizedGenRequest): number {
    return Math.round(pickNumber(this.providerOptions(req), ["target_fps", "fps"]) ?? 30);
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source video"]);
    const fps = this.targetFps(req);
    if (!(FPS_TARGETS as readonly number[]).includes(fps)) {
      throw vendorParamError(`fps-duration-unify target_fps must be one of ${FPS_TARGETS.join("|")}, got ${fps}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const duration = pickNumber(this.providerOptions(req), ["target_duration", "target_duration_s"]);
    if (duration !== undefined && (duration < 1 || duration > 600)) {
      throw vendorParamError(`fps-duration-unify target_duration must be 1~600s, got ${duration}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const padMode = pickString(this.providerOptions(req), ["pad_mode"]) ?? "trim";
    if (!["trim", "pad", "loop"].includes(padMode)) {
      throw vendorParamError(`fps-duration-unify pad_mode must be trim|pad|loop, got ${padMode}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = this.requireReferences(req, 1, ["source video"]);
    const duration = pickNumber(this.providerOptions(req), ["target_duration", "target_duration_s"]);
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      target_fps: this.targetFps(req),
      ...(duration === undefined ? {} : { target_duration: duration }),
      pad_mode: pickString(this.providerOptions(req), ["pad_mode"]) ?? "trim",
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = pickNumber(this.providerOptions(req), ["target_duration", "target_duration_s"]);
    return { ext: "mp4", count: 1, durationS: duration ?? req.request.options?.duration ?? 5 };
  }
}

/**
 * 音画分离（拆轨）。
 *
 * 一次产出**两个**文件：静音视频 + 独立音轨。因此产物是 1→2，前端要能分别下载。
 * 顺序固定为 [video, audio]：`extractSpec` 的 arrayKeys 里 videos 在 audios 之前，
 * 供应商把两者混在一个 `results` 数组时依赖 mediaKeys 命中顺序，仍然先视频后音频。
 */
export class AudioSeparationAdapter extends HttpPostprocessAdapter {
  readonly vendor = "audio-separation";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/audio-separation/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/audio-separation/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["videos", "audios", "results", "outputs"],
      mediaKeys: ["video_url", "audio_url", "url", "uri", "download_url"],
    };
  }

  private format(req: NormalizedGenRequest): string {
    const raw = pickString(this.providerOptions(req), ["format"]) ?? "mp3";
    return (AUDIO_SEPARATION_FORMATS as readonly string[]).includes(raw) ? raw : "mp3";
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source video"]);
    const raw = pickString(this.providerOptions(req), ["format"]);
    if (raw !== undefined && !(AUDIO_SEPARATION_FORMATS as readonly string[]).includes(raw)) {
      throw vendorParamError(
        `audio-separation format must be ${AUDIO_SEPARATION_FORMATS.join("|")}, got ${raw}`,
        { vendor: this.vendor, operation: `POST ${this.defaultSubmitPath()}` },
      );
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = this.requireReferences(req, 1, ["source video"]);
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      format: this.format(req),
      // 是否保留原视频画面（false = 只交音轨；多数拆轨场景只要音轨）
      keep_video: this.providerOptions(req).keep_video !== false,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = req.request.options?.duration;
    // 1→2：静音视频 + 音轨。基类的 mock 只认一个扩展名，这里给 mp4，
    // 第二个产物的真实容器由供应商返回（mock 阶段只看形状数量，见 report 的已知偏离）
    return { ext: "mp4", count: 2, durationS: typeof duration === "number" ? duration : 5 };
  }
}

/**
 * 音色修改（保留台词内容，换音色）。
 *
 * 与 `voice_clone`（SpeechMode）的区别：克隆是「给样本、复制一个人的音色」，
 * 音色修改是「拿一条成品音轨、换成预设音色」。输入是音频不是文本，产出仍是音频，
 * 所以归在 `AudioToolMode` 而不是 `SpeechMode`。
 */
export class TimbreModifyAdapter extends HttpPostprocessAdapter {
  readonly vendor = "timbre-modify";
  protected readonly resultMedia: ResultMedia = "audio";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/audio/timbre/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/audio/timbre/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["audios", "audio", "results", "outputs"],
      mediaKeys: ["audio_url", "url", "uri", "download_url"],
    };
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source audio"]);
    const timbre = pickString(this.providerOptions(req), ["timbre", "voice"]);
    if (!timbre) {
      throw vendorParamError(`timbre-modify requires options.timbre (one of ${TIMBRE_PRESETS.join("|")})`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const pitch = pickNumber(this.providerOptions(req), ["pitch"]);
    if (pitch !== undefined && (pitch < -12 || pitch > 12)) {
      throw vendorParamError(`timbre-modify pitch must be -12~12 semitones, got ${pitch}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceAudio] = this.requireReferences(req, 1, ["source audio"]);
    const strength = pickNumber(this.providerOptions(req), ["strength"]);
    return {
      model: this.modelFor(req),
      audio_url: sourceAudio,
      timbre: pickString(this.providerOptions(req), ["timbre", "voice"]),
      pitch: Math.round(pickNumber(this.providerOptions(req), ["pitch"]) ?? 0),
      strength: Math.min(1, Math.max(0, strength ?? 0.9)),
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    return { ext: "mp3", count: 1, durationS: req.request.options?.duration ?? 5 };
  }
}

/**
 * 自动配乐（成片自动匹配 BGM）。
 *
 * 输入视频 + 风格，输出**带 BGM 的视频**（不是单独音轨）：竞品这条工具的产品语义是
 * 「成片自动匹配 BGM 与节奏点」，用户要的是能直接发布的成片，不是还要自己混一遍。
 * `ducking` 控制是否在人声段自动压低 BGM（短剧台词必需）。
 */
export class AutoBgmAdapter extends HttpPostprocessAdapter {
  readonly vendor = "auto-bgm";
  protected readonly resultMedia: ResultMedia = "video";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/video/auto-bgm/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/video/auto-bgm/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "videos", "outputs"],
      mediaKeys: ["video_url", "url", "uri", "download_url"],
    };
  }

  private style(req: NormalizedGenRequest): string {
    return pickString(this.providerOptions(req), ["style", "bgm_style"]) ?? "";
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source video"]);
    const style = this.style(req);
    if (!style) {
      throw vendorParamError(`auto-bgm requires options.style (one of ${BGM_STYLES.join("|")})`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const volume = pickNumber(this.providerOptions(req), ["volume", "music_volume"]);
    if (volume !== undefined && (volume < 0 || volume > 1)) {
      throw vendorParamError(`auto-bgm volume must be 0~1, got ${volume}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceVideo] = this.requireReferences(req, 1, ["source video"]);
    return {
      model: this.modelFor(req),
      video_url: sourceVideo,
      style: this.style(req),
      volume: Math.min(1, Math.max(0, pickNumber(this.providerOptions(req), ["volume", "music_volume"]) ?? 0.3)),
      // 人声段自动压低 BGM：短剧默认开（关掉会出现台词被音乐盖住）
      ducking: this.providerOptions(req).ducking !== false,
      // 与第一个节拍对齐（匹配节奏点）
      beat_sync: this.providerOptions(req).beat_sync !== false,
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const duration = req.request.options?.duration;
    return { ext: "mp4", count: 1, durationS: typeof duration === "number" ? duration : 5 };
  }
}

/**
 * 涂抹重绘（inpaint）：源图 + 蒙版 → 只在蒙版区域重绘。
 *
 * 输入约定 `reference_uris = [源图, 蒙版]`（顺序固定，与 lip-sync 的 [视频, 音频] 同一规则：
 * 不改共享 schema，顺序语义由适配器声明并校验）。蒙版必须是**同尺寸黑白图**，
 * 白 = 重绘区域；这是各家 inpaint 的事实约定，写成文档以免前端传反。
 */
export class ImageInpaintAdapter extends HttpPostprocessAdapter {
  readonly vendor = "image-inpaint";
  protected readonly resultMedia: ResultMedia = "image";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/image/inpaint/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/image/inpaint/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "images", "outputs"],
      mediaKeys: ["image_url", "url", "uri", "download_url"],
    };
  }

  private inpaintMode(req: NormalizedGenRequest): string {
    const raw = pickString(this.providerOptions(req), ["inpaint_mode", "sub_mode"]) ?? "inpaint";
    return (INPAINT_MODES as readonly string[]).includes(raw) ? raw : "inpaint";
  }

  protected validate(req: NormalizedGenRequest): void {
    const refs = req.request.input.reference_uris ?? [];
    if (refs.length === 0) {
      throw vendorParamError("image-inpaint requires reference_uris[0] = source image", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const maskUri = pickString(this.providerOptions(req), ["mask_uri"]);
    if (refs.length < 2 && !maskUri) {
      // 没有蒙版等于「整图重绘」，那是 image2image 的事：静默整图重绘会毁掉用户没圈出的部分
      throw vendorParamError("image-inpaint requires a mask (reference_uris[1] or options.mask_uri)", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    this.requirePrompt(req);
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceImage, maskRef] = req.request.input.reference_uris ?? [];
    const maskUri = pickString(this.providerOptions(req), ["mask_uri"]) ?? maskRef;
    const strength = pickNumber(this.providerOptions(req), ["strength"]);
    return {
      model: this.modelFor(req),
      image_url: sourceImage,
      mask_url: maskUri,
      prompt: this.requirePrompt(req),
      mode: this.inpaintMode(req),
      strength: Math.min(1, Math.max(0, strength ?? 0.85)),
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const count = Math.max(1, Math.min(req.request.options?.count ?? 1, 4));
    return { ext: "png", count };
  }
}

/**
 * 文字重绘：保留画面结构，替换画面里的文字。
 *
 * 输入 `reference_uris[0]` 是源图；`options.text` 是要渲染的新文字（必填），
 * `options.font` / `options.color` 控制字形。为什么文字内容走 `options.text` 而不是 `input.prompt`：
 * prompt 在这条链上是「风格描述」（"手写体、暖色、轻微做旧"），文字本身是要精确控制的内容，
 * 混在 prompt 里会被模型自由发挥——而文字错一个字符就是废稿。
 */
export class TextRepaintAdapter extends HttpPostprocessAdapter {
  readonly vendor = "text-repaint";
  protected readonly resultMedia: ResultMedia = "image";

  constructor(config: PostprocessHttpConfig) {
    super(config);
  }

  protected defaultSubmitPath(): string {
    return "/v1/image/text-repaint/tasks";
  }

  protected defaultPollPath(): string {
    return "/v1/image/text-repaint/tasks/{id}";
  }

  protected get extractSpec() {
    return {
      arrayKeys: ["results", "images", "outputs"],
      mediaKeys: ["image_url", "url", "uri", "download_url"],
    };
  }

  private font(req: NormalizedGenRequest): string {
    const raw = pickString(this.providerOptions(req), ["font", "font_style"]) ?? "sans";
    return (REPAINT_FONTS as readonly string[]).includes(raw) ? raw : "sans";
  }

  protected validate(req: NormalizedGenRequest): void {
    this.requireReferences(req, 1, ["source image"]);
    const text = pickString(this.providerOptions(req), ["text", "replace_text"]) ?? "";
    if (!text.trim()) {
      throw vendorParamError("text-repaint requires options.text (the replacement text)", {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    if (text.length > 120) {
      throw vendorParamError(`text-repaint text too long (max 120 chars), got ${text.length}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
    const raw = pickString(this.providerOptions(req), ["font", "font_style"]);
    if (raw !== undefined && !(REPAINT_FONTS as readonly string[]).includes(raw)) {
      throw vendorParamError(`text-repaint font must be ${REPAINT_FONTS.join("|")}, got ${raw}`, {
        vendor: this.vendor,
        operation: `POST ${this.defaultSubmitPath()}`,
      });
    }
  }

  protected buildSubmitBody(req: NormalizedGenRequest): Json {
    const [sourceImage] = this.requireReferences(req, 1, ["source image"]);
    const region = asRecord(this.providerOptions(req).region);
    const x = region ? pickNumber(region, ["x"]) : undefined;
    const y = region ? pickNumber(region, ["y"]) : undefined;
    const w = region ? pickNumber(region, ["w", "width"]) : undefined;
    const h = region ? pickNumber(region, ["h", "height"]) : undefined;
    return {
      model: this.modelFor(req),
      image_url: sourceImage,
      text: pickString(this.providerOptions(req), ["text", "replace_text"]),
      font: this.font(req),
      color: pickString(this.providerOptions(req), ["color"]) ?? "#ffffff",
      // 文字框（归一化坐标）；不传则由供应商自动检测文字区域
      ...(x !== undefined && y !== undefined && w !== undefined && h !== undefined
        ? { region: [x, y, w, h] }
        : {}),
      prompt: (req.request.input.prompt ?? "").trim(),
    };
  }

  protected mockShape(req: NormalizedGenRequest) {
    const count = Math.max(1, Math.min(req.request.options?.count ?? 1, 4));
    return { ext: "png", count };
  }
}
