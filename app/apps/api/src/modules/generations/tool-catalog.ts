import { and, eq, isNull } from "drizzle-orm";
import { modelPrices, models } from "@app/db";
import { newId, type GenerationMode } from "@app/shared";
import { db } from "../../db/database";
import { POSTPROCESS_CODES } from "@app/model-adapters";

/**
 * 工具箱目录（第 3 批单一数据源）
 *
 * ## 为什么这张表要既管后端又管前端
 *
 * 工具箱的 20 张卡与 16 个工具 mode 是**同一份事实**的两种视图：卡是给用户看的入口，
 * mode 是给任务脊柱用的枚举。如果前端硬编码一份卡清单、后端再硬编码一份 mode→模型映射，
 * 每加一张卡就要改两处，且"卡点进去 404 / 卡能点但 mode 没人接"这类漂移无法在编译期发现。
 * 因此这里只维护**一张表**：
 *   - `TOOL_CARDS`：20 张卡（文案逐字照参照站工具箱页；顺序即截图顺序；第 93 批 +声音克隆）——
 *     `GET /generations/tools` 直接吐给前端，`pages/tools.vue` 不再写死任何卡；
 *   - `TOOL_MODES`：16 个工具 mode（第 3 批 14 个 + 涂抹重绘的 inpaint + 第 93 批声音克隆）——每个 mode 声明
 *     它用哪个模型、什么价、参数面板长什么样、吃什么输入；
 *   - `ensureToolCatalog()`：把 `TOOL_MODES` 幂等落成 `models` / `model_prices` 行，
 *     让「报价」这条既有链路（`credits.price()` 读目录）不需要为本批开特例。
 *
 * ## 竞品证据（ADR-013：照做不臆造）
 *
 * - 17 条 `/create/*` 路由：`rea-reelmate/routes.txt:25-41`
 * - 「灵感成片」是 Agent 工具、无独立 `/create` 路由：`routes.txt:42`（`/creation-agent`）、
 *   `docs/01-product/reelmate-feature-map.md §3.5`（报告点名无独立路由 5 项）
 * - 「音色修改」同为报告点名、无独立路由的工具：`reelmate-feature-map.md §3.5`
 * - 卡片文案与顺序：`docs/03-frontend/reference-alignment-spec.md §5.3`（逐字）
 *
 * ## 价格口径（`resolution='per_call'`）
 *
 * 工具箱的能力绝大多数是**按次**计价（一条视频超分一次、一段 TTS 一次），
 * 而 `model_prices` 的主键维度是 `(model_id, mode, resolution, duration_s)`：
 * `duration_s` 留 NULL 已经表示"按次"，`resolution` 必须给个值，于是用 `per_call` 这个
 * 显式哨兵值（而不是滥用 `720p` 之类看起来像画质档的字符串）。运营在
 * `/ops/admin/model-prices` 看到的也是 `per_call`，不容易误以为是分辨率。
 * 唯一的例外是视频超清：它的档位**就是**分辨率（1080p/2K/4K），所以按真实档位定价。
 * 所有金额都是**新库初值**（与 seed.ts 同一口径：代码不写死计费，运营可热更）。
 */

export type ToolCategory = "video" | "image" | "audio";
export type ToolSurface = "legacy" | "agent" | "tool";
export type ToolResultMedia = "video" | "image" | "audio";

export interface ToolParamOption {
  value: string;
  label: string;
}

/** 参数控件声明：前端按它渲染参数面板（不再为每个工具写一套表单） */
export interface ToolParam {
  key: string;
  label: string;
  type: "select" | "number" | "switch" | "text";
  default: string | number | boolean;
  options?: ToolParamOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}

/** 输入槽位声明：决定页面上出现哪些上传框 / 输入框以及是否必填 */
export interface ToolInputSlot {
  key: "prompt" | "video" | "audio" | "image" | "mask";
  label: string;
  required: boolean;
  accept?: string;
  maxSizeMb?: number;
  placeholder?: string;
  hint?: string;
}

export interface ToolModeDefinition {
  key: string;
  mode: GenerationMode;
  title: string;
  category: ToolCategory;
  capability: "video" | "image" | "speech" | "music";
  resultMedia: ToolResultMedia;
  model: {
    name: string;
    displayName: string;
    vendor: string;
    adapterCode: string;
    description: string;
  };
  /** 与模型目录同形的档位声明（写进 models.modes[mode]） */
  modeConfig: {
    endpoint: string;
    resolution_options: ToolParamOption[];
    default_resolution: string;
    durations?: number[];
    default_duration?: number;
    counts?: number[];
    default_count?: number;
    ratios?: string[];
    media_limits?: Record<string, number>;
  };
  /**
   * 价目**首次落库的默认值**（resolution 为 per_call 或真实画质档）。
   *
   * 只在 `model_prices` 里该档位的**行不存在**时使用；行一旦存在就以 DB 为准，
   * 运营在 `/ops/admin/model-prices` 改价/下架不会被 `ensureToolCatalog` 覆盖
   * （契约 §2.10）。要强制回刷需显式设 `CATALOG_SYNC_TOOLS=true`。
   */
  prices: Array<{ resolution: string; credits: number; strikeCredits: number }>;
  /** 前端不显示、但必须随 options 一起提交的固定参数（例如去字幕的 mode=region） */
  fixedOptions?: Record<string, unknown>;
  /**
   * 必填的 `options` 参数键（值不能为空串）。
   *
   * 为什么要单独声明：这类参数是**内容**而不是素材（如文字重绘的替换文字），
   * 既不是 `input.prompt` 也不是 `reference_uris`，光靠输入槽校验会漏；
   * 漏了就会在 worker 的适配器 validate 里才失败，而那时积分已冻结。
   */
  requiredParams?: string[];
  params: ToolParam[];
  inputs: ToolInputSlot[];
  evidence: string;
}

export interface ToolCardDefinition {
  key: string;
  title: string;
  desc: string;
  category: ToolCategory;
  sort: number;
  route: string;
  surface: ToolSurface;
  /** `surface=tool` 时：该页包含哪些工具 mode（第一项是默认 tab，即卡本身的能力） */
  pageToolKeys?: string[];
  evidence: string;
}

const PER_CALL = "per_call";

const RES_PER_CALL: ToolParamOption[] = [{ value: PER_CALL, label: "按次" }];

const VIDEO_INPUT: ToolInputSlot = {
  key: "video",
  label: "源视频",
  required: true,
  accept: "video/*",
  maxSizeMb: 64,
  hint: "mp4 / mov / webm，≤64MB",
};
const IMAGE_INPUT: ToolInputSlot = {
  key: "image",
  label: "源图",
  required: true,
  accept: "image/*",
  maxSizeMb: 12,
  hint: "png / jpg，≤12MB",
};
const AUDIO_INPUT: ToolInputSlot = {
  key: "audio",
  label: "源音频",
  required: true,
  accept: "audio/*",
  maxSizeMb: 32,
  hint: "mp3 / wav，≤32MB",
};

/**
 * 16 个工具 mode。
 *
 * 顺序无业务含义（卡顺序在 `TOOL_CARDS` 里定），但按「视频 → 图像 → 音频」分组便于阅读。
 */
export const TOOL_MODES: ToolModeDefinition[] = [
  // ── 视频 ──────────────────────────────────────────────
  {
    key: "lip-sync",
    mode: "lip_sync",
    title: "视频对口型",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-lip-sync",
      displayName: "对口型 Pro",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.lipSync,
      description: "给定视频与人声，重新驱动口型，唇形贴合",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/advanced-lip",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 2 },
    },
    prices: [{ resolution: PER_CALL, credits: 20, strikeCredits: 25 }],
    params: [
      {
        key: "mode",
        label: "驱动方式",
        type: "select",
        default: "replace_audio",
        options: [
          { value: "replace_audio", label: "整段替换音轨" },
          { value: "lip_only", label: "只驱动口型（保留原声底色）" },
        ],
      },
      { key: "sync_strength", label: "贴合强度", type: "number", default: 1, min: 0.5, max: 1.5, step: 0.1 },
    ],
    inputs: [
      { ...VIDEO_INPUT, label: "目标视频" },
      { ...AUDIO_INPUT, label: "人声音频" },
      { key: "prompt", label: "补充说明", required: false, placeholder: "可选：口型幅度、情绪", maxSizeMb: undefined },
    ],
    evidence: "routes.txt:29（/create/lip-sync）；competition-plan §4.1（advanced-lip）",
  },
  {
    key: "video-upscale",
    mode: "video_upscale",
    title: "视频超清",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-video-upscale",
      displayName: "视频超分",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.upscale,
      description: "AI 重建高清细节，支持 1080P / 2K / 4K 三档",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-super-resolution",
      resolution_options: [
        { value: "1080p", label: "1080P" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
      default_resolution: "1080p",
      media_limits: { image: 1 },
    },
    prices: [
      { resolution: "1080p", credits: 15, strikeCredits: 20 },
      { resolution: "2K", credits: 30, strikeCredits: 40 },
      { resolution: "4K", credits: 60, strikeCredits: 80 },
    ],
    params: [],
    inputs: [VIDEO_INPUT],
    evidence: "routes.txt:41（/create/video-upscale）；competition-plan §4.1（video-super-resolution）",
  },
  {
    key: "video-effects",
    mode: "video_effects",
    title: "视频特效",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-video-effects",
      displayName: "特效工坊",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.videoEffects,
      description: "一键套用电影级特效与转场，不改画面内容",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-effects",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 10, strikeCredits: 12 }],
    params: [
      {
        key: "effect",
        label: "特效模板",
        type: "select",
        default: "cinematic",
        options: [
          { value: "cinematic", label: "电影感" },
          { value: "film_grain", label: "胶片颗粒" },
          { value: "neon_glow", label: "霓虹辉光" },
          { value: "dreamy_blur", label: "柔光朦胧" },
          { value: "vhs", label: "复古录像带" },
        ],
      },
      { key: "intensity", label: "强度", type: "number", default: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "with_transition", label: "叠加转场", type: "switch", default: false },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "routes.txt:38（/create/video-effects/effect）；competition-plan §4.1（effects + ffmpeg）",
  },
  {
    key: "de-subtitle-auto",
    mode: "de_subtitle_auto",
    title: "去字幕（自动检测）",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-de-subtitle-auto",
      displayName: "视频去字幕 · 自动",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.subtitleErase,
      description: "自动检测并擦除全片字幕，按内容填充背景",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-de-subtitle",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 12, strikeCredits: 15 }],
    fixedOptions: { mode: "auto" },
    params: [{ key: "inpaint", label: "内容填充（关闭=模糊遮挡）", type: "switch", default: true }],
    inputs: [VIDEO_INPUT],
    evidence: "canvas-node-tasks CANVAS_MODE_MAP（de_subtitle_auto）；competition-plan §4.2",
  },
  {
    key: "de-subtitle-region",
    mode: "de_subtitle_region",
    title: "去字幕（框选区域）",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-de-subtitle-region",
      displayName: "视频去字幕 · 框选",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.subtitleErase,
      description: "只在框选区域内擦除字幕，其它画面保持原样",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-de-subtitle",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 12, strikeCredits: 15 }],
    fixedOptions: { mode: "region" },
    params: [
      { key: "region_x", label: "区域 X", type: "number", default: 0.1, min: 0, max: 1, step: 0.01 },
      { key: "region_y", label: "区域 Y", type: "number", default: 0.75, min: 0, max: 1, step: 0.01 },
      { key: "region_w", label: "区域宽", type: "number", default: 0.8, min: 0.01, max: 1, step: 0.01 },
      { key: "region_h", label: "区域高", type: "number", default: 0.2, min: 0.01, max: 1, step: 0.01 },
      { key: "inpaint", label: "内容填充（关闭=模糊遮挡）", type: "switch", default: true },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "canvas-node-tasks CANVAS_MODE_MAP（de_subtitle_region）；competition-plan §4.2",
  },
  {
    key: "video-slicing",
    mode: "video_slicing",
    title: "视频切片",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-video-slicing",
      displayName: "切片台",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.slicing,
      description: "按时长/等分把长视频切成可直接用的分镜片段（1→N）",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-slicing",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 8, strikeCredits: 10 }],
    params: [
      {
        key: "strategy",
        label: "切片方式",
        type: "select",
        default: "duration",
        options: [
          { value: "duration", label: "按每片时长" },
          { value: "count", label: "按等分片数" },
        ],
      },
      { key: "slice_duration", label: "每片时长", type: "number", default: 5, min: 1, max: 300, unit: "秒" },
      { key: "count", label: "等分片数", type: "number", default: 2, min: 1, max: 50 },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "competition-plan §4.2（video-slicing）；slicing.ts 的三种策略",
  },
  {
    key: "fps-unify",
    mode: "fps_duration_unify",
    title: "帧率时长统一",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-fps-unify",
      displayName: "交付规整",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.fpsUnify,
      description: "把成片统一到发布要求的帧率与时长（裁剪/补帧/循环）",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/fps-duration-unify",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 6, strikeCredits: 8 }],
    params: [
      {
        key: "target_fps",
        label: "目标帧率",
        type: "select",
        default: "30",
        options: [
          { value: "12", label: "12 fps" },
          { value: "24", label: "24 fps" },
          { value: "25", label: "25 fps" },
          { value: "30", label: "30 fps" },
          { value: "60", label: "60 fps" },
        ],
      },
      { key: "target_duration", label: "目标时长（0=不变）", type: "number", default: 0, min: 0, max: 600, unit: "秒" },
      {
        key: "pad_mode",
        label: "时长不足时",
        type: "select",
        default: "trim",
        options: [
          { value: "trim", label: "裁掉多余部分" },
          { value: "pad", label: "末帧补齐" },
          { value: "loop", label: "循环填满" },
        ],
      },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "competition-plan §4.2（fps-duration-unify）",
  },
  {
    key: "audio-separation",
    mode: "video_audio_separation",
    title: "音画分离",
    category: "video",
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-audio-separation",
      displayName: "拆轨工具",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.audioSeparation,
      description: "一条视频拆成静音画面 + 独立音轨（1→2 产物）",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/video-audio-separation",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 6, strikeCredits: 8 }],
    params: [
      {
        key: "format",
        label: "音轨格式",
        type: "select",
        default: "mp3",
        options: [
          { value: "mp3", label: "MP3" },
          { value: "wav", label: "WAV（混音用）" },
        ],
      },
      { key: "keep_video", label: "同时输出静音画面", type: "switch", default: true },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "competition-plan §4.2（video-audio-separation）",
  },
  {
    key: "auto-bgm",
    mode: "auto_bgm",
    title: "自动配乐",
    category: "audio",
    // capability 跟**产物**走而不是跟输入走：auto-bgm 的产物是带 BGM 的视频，
    // 写成 music 会让 worker 按 audio/mpeg 落库，前端 <video> 拿到 .mp3 播不了
    capability: "video",
    resultMedia: "video",
    model: {
      name: "toolbox-auto-bgm",
      displayName: "智能配乐",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.autoBgm,
      description: "成片自动匹配 BGM 与节奏点，人声段自动压低",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/auto-bgm",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 18, strikeCredits: 22 }],
    params: [
      {
        key: "style",
        label: "配乐风格",
        type: "select",
        default: "warm",
        options: [
          { value: "epic", label: "史诗" },
          { value: "calm", label: "舒缓" },
          { value: "tension", label: "紧张" },
          { value: "warm", label: "温情" },
          { value: "upbeat", label: "轻快" },
        ],
      },
      { key: "volume", label: "BGM 音量", type: "number", default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: "ducking", label: "人声段自动压低", type: "switch", default: true },
    ],
    inputs: [VIDEO_INPUT],
    evidence: "routes.txt:25（/create/auto-bgm）；competition-plan §4.1（auto-bgm）",
  },
  // ── 图像 ──────────────────────────────────────────────
  {
    key: "inpaint",
    mode: "inpaint",
    title: "涂抹重绘",
    category: "image",
    capability: "image",
    resultMedia: "image",
    model: {
      name: "toolbox-inpaint",
      displayName: "局部重绘",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.inpaint,
      description: "圈出要改的地方，只在蒙版区域内重绘",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/image-inpaint",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 3 },
    },
    prices: [{ resolution: PER_CALL, credits: 12, strikeCredits: 15 }],
    params: [
      {
        key: "inpaint_mode",
        label: "补全方式",
        type: "select",
        default: "inpaint",
        options: [
          { value: "inpaint", label: "内容重绘" },
          { value: "erase", label: "擦除（留空）" },
          { value: "blur", label: "模糊遮挡" },
        ],
      },
      { key: "strength", label: "重绘强度", type: "number", default: 0.85, min: 0, max: 1, step: 0.05 },
    ],
    inputs: [
      IMAGE_INPUT,
      {
        key: "mask",
        label: "蒙版（白色为重绘区域）",
        required: true,
        accept: "image/*",
        maxSizeMb: 12,
        hint: "与源图同尺寸的黑白图",
      },
      { key: "prompt", label: "重绘描述", required: true, placeholder: "例如：换成红色连衣裙，保持光影一致" },
    ],
    evidence: "routes.txt:26（/create/brush-repaint）；competition-plan §4.1（inpaint 复用画布能力，补页面）",
  },
  {
    key: "text-repaint",
    mode: "text_repaint",
    title: "文字重绘",
    category: "image",
    capability: "image",
    resultMedia: "image",
    model: {
      name: "toolbox-text-repaint",
      displayName: "文字替换",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.textRepaint,
      description: "保留画面结构，替换画面里的文字内容与字形",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/text-repaint",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 10, strikeCredits: 12 }],
    requiredParams: ["text"],
    params: [
      { key: "text", label: "替换文字", type: "text", default: "", hint: "最多 120 字" },
      {
        key: "font",
        label: "字体风格",
        type: "select",
        default: "sans",
        options: [
          { value: "sans", label: "无衬线" },
          { value: "serif", label: "衬线" },
          { value: "handwritten", label: "手写" },
          { value: "poster", label: "海报体" },
        ],
      },
      { key: "color", label: "文字颜色", type: "text", default: "#ffffff" },
    ],
    inputs: [
      IMAGE_INPUT,
      { key: "prompt", label: "风格描述（可选）", required: false, placeholder: "例如：暖色做旧、轻微发光" },
    ],
    evidence: "routes.txt:31（/create/text-repaint）；competition-plan §4.1（brush-repaint / text-repaint）",
  },
  // ── 音频 ──────────────────────────────────────────────
  {
    key: "text-to-speech",
    mode: "tts",
    title: "文生语音",
    category: "audio",
    capability: "speech",
    resultMedia: "audio",
    model: {
      name: "toolbox-tts",
      displayName: "多音色配音",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.tts,
      description: "多音色配音，情绪与语速可控",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/text-to-speech",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      counts: [1],
      default_count: 1,
    },
    prices: [{ resolution: PER_CALL, credits: 8, strikeCredits: 10 }],
    params: [
      {
        key: "voice",
        label: "音色",
        type: "select",
        default: "zh_female_shuangkuaisisi",
        options: [
          { value: "zh_female_shuangkuaisisi", label: "爽快思思（女）" },
          { value: "zh_female_tianmeixiaoyuan", label: "甜美小媛（女）" },
          { value: "zh_male_yuanboxiaoshu", label: "渊博小叔（男）" },
          { value: "zh_male_jieshuoxingger", label: "解说小哥（男）" },
          { value: "en_female_sarah", label: "Sarah（英）" },
        ],
      },
      { key: "speed", label: "语速", type: "number", default: 1, min: 0.25, max: 4, step: 0.05 },
    ],
    inputs: [
      { key: "prompt", label: "台词文本", required: true, placeholder: "输入要朗读的文本（≤2000 字）" },
    ],
    evidence: "routes.txt:35（/create/text-to-speech）；competition-plan §4.1（text-to-speech + voice/list）",
  },
  {
    key: "text-to-music",
    mode: "text2music",
    title: "文生音乐",
    category: "audio",
    capability: "music",
    resultMedia: "audio",
    model: {
      name: "toolbox-text-to-music",
      displayName: "音乐生成",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.music,
      description: "按描述生成配乐，风格与时长可选",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/text-to-music",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      // 按次计价（durationS=NULL）：不给 `durations`，否则 credits.price() 会按秒档找价目，
      // 而这一族的商业口径是"一条音乐一个价"，长度只影响生成耗时不影响价格。
      // 时长控件仍在 `params` 里（用户可选 15/30 秒），但不由目录档位约束。
      counts: [1],
      default_count: 1,
    },
    prices: [{ resolution: PER_CALL, credits: 15, strikeCredits: 18 }],
    params: [
      { key: "instrumental", label: "纯伴奏（无人声）", type: "switch", default: true },
      { key: "duration", label: "时长", type: "number", default: 15, min: 5, max: 30, unit: "秒" },
    ],
    inputs: [
      { key: "prompt", label: "音乐描述", required: true, placeholder: "例如：温暖钢琴，缓慢推进，适合雨夜回忆" },
    ],
    evidence: "routes.txt:33（/create/text-to-music）；competition-plan §4.1（text-to-music）",
  },
  {
    key: "text-to-sound",
    mode: "text2sfx",
    title: "文生音效",
    category: "audio",
    capability: "music",
    resultMedia: "audio",
    model: {
      name: "toolbox-text-to-sfx",
      displayName: "音效生成",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.sfx,
      description: "环境声、动作声一键生成",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/text-to-sound",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      // 同文生音乐：按次计价，时长由 params 里的控件决定、不参与价目档位
      counts: [1],
      default_count: 1,
    },
    prices: [{ resolution: PER_CALL, credits: 5, strikeCredits: 6 }],
    params: [{ key: "duration", label: "时长", type: "number", default: 5, min: 1, max: 30, unit: "秒" }],
    inputs: [
      { key: "prompt", label: "音效描述", required: true, placeholder: "例如：雨点打在铁皮屋顶，远处雷声" },
    ],
    evidence: "routes.txt:34（/create/text-to-sound）；competition-plan §4.1（text-to-sfx）",
  },
  {
    key: "audio-timbre",
    mode: "audio_timbre_modify",
    title: "音色修改",
    category: "audio",
    capability: "music",
    resultMedia: "audio",
    model: {
      name: "toolbox-timbre-modify",
      displayName: "音色改造",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.timbreModify,
      description: "保留台词内容，把音轨换成另一个音色",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/audio-timbre-modify",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      media_limits: { image: 1 },
    },
    prices: [{ resolution: PER_CALL, credits: 10, strikeCredits: 12 }],
    params: [
      {
        key: "timbre",
        label: "目标音色",
        type: "select",
        default: "warm_female",
        options: [
          { value: "warm_female", label: "温柔女声" },
          { value: "warm_male", label: "沉稳男声" },
          { value: "narrator", label: "旁白" },
          { value: "child", label: "童声" },
          { value: "robot", label: "机械声" },
        ],
      },
      { key: "pitch", label: "音高偏移", type: "number", default: 0, min: -12, max: 12, unit: "半音" },
      { key: "strength", label: "改造强度", type: "number", default: 0.9, min: 0, max: 1, step: 0.05 },
    ],
    inputs: [AUDIO_INPUT],
    evidence: "reelmate-feature-map.md §3.5（报告点名的「音色修改」无独立路由）；competition-plan §4.2",
  },
  {
    /**
     * 声音克隆（第 93 批）。
     *
     * 这张卡的存在理由不是"再做一个音频工具"，而是**给「我的音色」列表一个生产者**：
     * 竞品 `ai/voice-clone-list`、`ai/voice-clone/{task_id}`、`rename`、`DELETE` 这 4 条形状
     * 都是围绕"克隆出来的音色"做增删改查。若只有查询端点、没有发起克隆的入口，
     * 列表永远是空的 —— 那种"端点齐全但无内容"的实现比不做更糟（用户点进去只看到空白）。
     * 因此本批把「克隆入口」与「音色库 CRUD」放在同一批交付。
     *
     * 计价口径：按次（`per_call`）。克隆是一次训练 + 一次试听合成，成本落在训练上，
     * 与朗读文本长度无关 → 不给 `durations`，否则 `credits.price()` 会按秒档找不到价目。
     */
    key: "voice-clone",
    mode: "voice_clone",
    title: "声音克隆",
    category: "audio",
    capability: "speech",
    resultMedia: "audio",
    model: {
      name: "toolbox-voice-clone",
      displayName: "声音克隆",
      vendor: "self",
      adapterCode: POSTPROCESS_CODES.voiceClone,
      description: "上传一段参考音频，用这个声音朗读任意文本",
    },
    modeConfig: {
      endpoint: "/web/v1/ai/voice-clone",
      resolution_options: RES_PER_CALL,
      default_resolution: PER_CALL,
      // 参考音频 1 条（不写 `image` 键：这个 mode 没有图像输入，
      // 写了会让 `normalizeToolOptions` 给不存在的槽位留位）
      media_limits: { audio: 1 },
      counts: [1],
      default_count: 1,
    },
    prices: [{ resolution: PER_CALL, credits: 12, strikeCredits: 15 }],
    params: [
      {
        key: "voice_name",
        label: "音色名称",
        type: "text",
        default: "",
        hint: "保存到「我的音色」时显示的名字，留空则用「我的音色」",
      },
      { key: "speed", label: "语速", type: "number", default: 1, min: 0.25, max: 4, step: 0.05 },
    ],
    inputs: [
      AUDIO_INPUT,
      { key: "prompt", label: "朗读文本", required: true, placeholder: "输入要让这个声音朗读的文本（≤2000 字）" },
    ],
    evidence:
      "competitor_endpoints.tsv〔ai/voice-clone、ai/voice-clone-list、ai/voice-clone/{task_id}（GET/DELETE）、ai/voice-clone/rename〕；competition-plan §4.1",
  },
];

/** 卡片顺序（逐字照 `tools.png` / 参照站工具箱页的顺序；文案见 reference-alignment-spec §5.3） */
export const TOOL_CARDS: ToolCardDefinition[] = [
  {
    key: "text-to-video",
    title: "文生视频",
    desc: "主流高质量模型，风格、动作轻松…",
    category: "video",
    sort: 10,
    route: "/create/text-to-video",
    surface: "legacy",
    evidence: "routes.txt:36（/create/text-to-video）",
  },
  {
    key: "image-to-video",
    title: "图生视频",
    desc: "一键让静态图动出电影感",
    category: "video",
    sort: 20,
    route: "/create/image-to-video",
    surface: "legacy",
    evidence: "routes.txt:28（/create/image-to-video）",
  },
  {
    key: "lip-sync",
    title: "视频对口型",
    desc: "视频对口型一键搞定，唇形贴合超…",
    category: "video",
    sort: 30,
    route: "/create/lip-sync",
    surface: "tool",
    pageToolKeys: ["lip-sync"],
    evidence: "routes.txt:29（/create/lip-sync）",
  },
  {
    key: "reference-to-video",
    title: "参考生视频",
    desc: "多图参考，让画面自然动起来",
    category: "video",
    sort: 40,
    route: "/create/reference-to-video",
    surface: "legacy",
    evidence: "routes.txt:30（/create/reference-to-video）",
  },
  {
    key: "video-refer",
    title: "视频参考",
    desc: "照着参考视频的运镜与节奏再创作",
    category: "video",
    sort: 50,
    route: "/create/video-refer",
    surface: "legacy",
    evidence: "routes.txt:40（/create/video-refer）",
  },
  {
    key: "inspiration",
    title: "灵感成片",
    desc: "Agent 智能规划，从创意到完整短片",
    category: "video",
    sort: 60,
    route: "/create/inspiration",
    surface: "agent",
    evidence: "routes.txt:42（/creation-agent）；reelmate-feature-map §3.5（报告点名无独立 /create 路由）",
  },
  {
    key: "video-upscale",
    title: "视频超清",
    desc: "AI 重建高清细节，影视工业级画质…",
    category: "video",
    sort: 70,
    route: "/create/video-upscale",
    surface: "tool",
    /**
     * 参照站只有 `/create/video-upscale` 这一条路由，去字幕/切片/帧率规整/拆轨在竞品侧
     * 是**画布节点上的后处理动作**（`CANVAS_MODE_MAP` 里有 de_subtitle_*、video_clip）。
     * 我方把这一族收在「视频超清」卡落地页的 tab 里：能力都有真实 mode 与报价，
     * 不需要为竞品没有路由的功能臆造卡片（ADR-013 决策 2）。竞品对应交互的取证登记在 report。
     */
    pageToolKeys: [
      "video-upscale",
      "de-subtitle-auto",
      "de-subtitle-region",
      "video-slicing",
      "fps-unify",
      "audio-separation",
    ],
    evidence: "routes.txt:41（/create/video-upscale）；competition-plan §4.2（后处理族）",
  },
  {
    key: "video-extend",
    title: "视频续写",
    desc: "AI 延续创作灵感，让故事无限精彩…",
    category: "video",
    sort: 80,
    route: "/create/video-extend",
    surface: "legacy",
    evidence: "routes.txt:39（/create/video-extend）",
  },
  {
    key: "video-edit",
    title: "视频编辑",
    desc: "多模态智能编辑，自由修改视频内容",
    category: "video",
    sort: 90,
    route: "/create/video-edit",
    surface: "legacy",
    evidence: "routes.txt:37（/create/video-edit）",
  },
  {
    key: "video-effects",
    title: "视频特效",
    desc: "一键套用电影级特效与转场",
    category: "video",
    sort: 100,
    route: "/create/video-effects",
    surface: "tool",
    pageToolKeys: ["video-effects"],
    evidence: "routes.txt:38（/create/video-effects/effect）",
  },
  {
    key: "text-to-image",
    title: "文生图",
    desc: "一句话出图，风格与画质随心控制",
    category: "image",
    sort: 110,
    route: "/create/text-to-image",
    surface: "legacy",
    evidence: "routes.txt:32（/create/text-to-image）",
  },
  {
    key: "image-to-image",
    title: "图生图",
    desc: "参考图打底，重绘出新的画面",
    category: "image",
    sort: 120,
    route: "/create/image-to-image",
    surface: "legacy",
    evidence: "routes.txt:27（/create/image-to-image）",
  },
  {
    key: "inpaint",
    title: "涂抹重绘",
    desc: "圈出要改的地方，局部重绘",
    category: "image",
    sort: 130,
    route: "/create/brush-repaint",
    surface: "tool",
    pageToolKeys: ["inpaint"],
    evidence: "routes.txt:26（/create/brush-repaint）",
  },
  {
    key: "text-repaint",
    title: "文字重绘",
    desc: "保留画面结构，替换其中的文字",
    category: "image",
    sort: 140,
    route: "/create/text-repaint",
    surface: "tool",
    pageToolKeys: ["text-repaint"],
    evidence: "routes.txt:31（/create/text-repaint）",
  },
  {
    key: "text-to-speech",
    title: "文生语音",
    desc: "多音色配音，情绪与语速可控",
    category: "audio",
    sort: 150,
    route: "/create/text-to-speech",
    surface: "tool",
    pageToolKeys: ["text-to-speech"],
    evidence: "routes.txt:35（/create/text-to-speech）",
  },
  {
    key: "text-to-music",
    title: "文生音乐",
    desc: "按描述生成配乐，风格与时长可选",
    category: "audio",
    sort: 160,
    route: "/create/text-to-music",
    surface: "tool",
    pageToolKeys: ["text-to-music"],
    evidence: "routes.txt:33（/create/text-to-music）",
  },
  {
    key: "text-to-sound",
    title: "文生音效",
    desc: "环境声、动作声一键生成",
    category: "audio",
    sort: 170,
    route: "/create/text-to-sound",
    surface: "tool",
    pageToolKeys: ["text-to-sound"],
    evidence: "routes.txt:34（/create/text-to-sound）",
  },
  {
    key: "auto-bgm",
    title: "自动配乐",
    desc: "成片自动匹配 BGM 与节奏点",
    category: "audio",
    sort: 180,
    route: "/create/auto-bgm",
    surface: "tool",
    pageToolKeys: ["auto-bgm"],
    evidence: "routes.txt:25（/create/auto-bgm）",
  },
  {
    key: "audio-timbre",
    title: "音色修改",
    desc: "保留台词，换一个音色重录",
    category: "audio",
    sort: 190,
    route: "/create/audio-timbre",
    surface: "tool",
    pageToolKeys: ["audio-timbre"],
    evidence:
      "reelmate-feature-map.md §3.5（报告点名的「音色修改」，无独立 /create 路由，本批以 mode=audio_timbre_modify 承载）",
  },
  {
    key: "voice-clone",
    title: "声音克隆",
    desc: "上传参考音频，克隆一个专属音色",
    category: "audio",
    sort: 200,
    route: "/create/voice-clone",
    surface: "tool",
    pageToolKeys: ["voice-clone"],
    evidence:
      "competitor_endpoints.tsv〔ai/voice-clone、ai/voice-clone-list、ai/voice-clone/{task_id}（GET/DELETE）、ai/voice-clone/rename〕——克隆产物即「我的音色」的实体",
  },
];

const TOOL_MODE_BY_MODE = new Map<string, ToolModeDefinition>(TOOL_MODES.map((tool) => [tool.mode, tool]));
const TOOL_MODE_BY_KEY = new Map<string, ToolModeDefinition>(TOOL_MODES.map((tool) => [tool.key, tool]));

export function toolForMode(mode: string): ToolModeDefinition | undefined {
  return TOOL_MODE_BY_MODE.get(mode);
}

export function toolForKey(key: string): ToolModeDefinition | undefined {
  return TOOL_MODE_BY_KEY.get(key);
}

/** 是否为工具箱 mode（后处理/单点能力）：决定「报价档位归一」与「输入前置校验」是否启用 */
export function isToolMode(mode: string): boolean {
  return TOOL_MODE_BY_MODE.has(mode);
}

/**
 * 工具箱 mode 的档位归一。
 *
 * 为什么必须做：`generationOptionsSchema` 的默认值是 `resolution: "720p"`（视频档位），
 * 而工具箱的档位是 `per_call` / `source` / `1080p|2K|4K`。直接投递会得到
 * "resolution 720p not supported"——这是画布/agent 都踩过的同一个坑。
 * 规则与 `agent-task.service.normalize()` 一致：**档位由目录决定，禁止写死**。
 */
export function normalizeToolOptions<T extends { options: unknown }>(tool: ToolModeDefinition, body: T): T {
  const options: Record<string, unknown> = { ...(body.options as Record<string, unknown>) };
  const allowed = tool.modeConfig.resolution_options.map((item) => item.value);
  const current = typeof options.resolution === "string" ? options.resolution : "";
  if (!allowed.includes(current)) options.resolution = tool.modeConfig.default_resolution;

  const durations = tool.modeConfig.durations;
  if (durations && durations.length > 0 && !durations.includes(Number(options.duration))) {
    options.duration = tool.modeConfig.default_duration ?? durations[0];
  }
  if (!durations) {
    // 无时长档的能力（按次计价）：duration 不参与定价，但保留用户意图（适配器可能读它做 mock 时长）
    if (typeof options.duration !== "number") options.duration = 5;
  }
  const counts = tool.modeConfig.counts;
  if (counts && counts.length > 0 && !counts.includes(Number(options.count))) {
    options.count = tool.modeConfig.default_count ?? counts[0];
  }
  // 前端按参数面板拼出来的 region_* / target_* 等字段，转成适配器认识的形状
  const params = options as Record<string, unknown>;
  if (tool.mode === "de_subtitle_region") {
    params.region = {
      x: Number(params.region_x ?? 0.1),
      y: Number(params.region_y ?? 0.75),
      w: Number(params.region_w ?? 0.8),
      h: Number(params.region_h ?? 0.2),
    };
  }
  if (tool.mode === "fps_duration_unify") {
    const target = Number(params.target_duration ?? 0);
    // 0 = 保持原时长：删掉字段而不是传 0（适配器会把 0 当成"统一到 0 秒"的非法指令）
    if (target > 0) params.target_duration = target;
    else delete params.target_duration;
    params.target_fps = Number(params.target_fps ?? 30);
  }
  if (tool.mode === "video_slicing" && params.strategy === "count") {
    params.count = Number(params.count ?? 2);
  }
  return { ...body, options: { ...options, ...(tool.fixedOptions ?? {}) } };
}

/**
 * 工具箱 mode 的输入前置校验。
 *
 * 为什么放在建任务之前而不是只靠适配器 validate：适配器是在 **worker** 里跑的，
 * 那时积分已冻结、任务已落库——用户要等一次"失败-退冻"才知道少传了素材。
 * 这里提前拦，返回 400100（参数错误），前端能直接指到缺哪个槽。
 */
export function assertToolInput(
  tool: ToolModeDefinition,
  input: { prompt?: string; reference_uris?: string[] },
  options: Record<string, unknown> = {},
): void {
  const refs = input.reference_uris ?? [];
  const prompt = (input.prompt ?? "").trim();
  for (const slot of tool.inputs) {
    if (!slot.required) continue;
    if (slot.key === "prompt" && !prompt) {
      throw new ToolInputError(`${tool.title} 需要填写${slot.label}（input.prompt）`, { field: "input.prompt" });
    }
    if (slot.key === "video" && refs.length < 1) {
      throw new ToolInputError(`${tool.title} 需要上传${slot.label}（input.reference_uris[0]）`, {
        field: "input.reference_uris",
      });
    }
    if (slot.key === "audio" && refs.length < 1) {
      throw new ToolInputError(`${tool.title} 需要上传${slot.label}（input.reference_uris[0]）`, {
        field: "input.reference_uris",
      });
    }
    if (slot.key === "image" && refs.length < 1) {
      throw new ToolInputError(`${tool.title} 需要上传${slot.label}（input.reference_uris[0]）`, {
        field: "input.reference_uris",
      });
    }
    if (slot.key === "mask" && refs.length < 2) {
      throw new ToolInputError(`${tool.title} 需要上传${slot.label}（input.reference_uris[1]）`, {
        field: "input.reference_uris",
      });
    }
  }
  // 内容型必填参数（如文字重绘的替换文字）：空串等于没给指令
  for (const key of tool.requiredParams ?? []) {
    const value = options[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ToolInputError(`${tool.title} 需要填写${key}（options.${key}）`, { field: `options.${key}` });
    }
  }
  // 对口型：顺序语义是 [视频, 音频]，少一个就是缺驱动信号
  if (tool.mode === "lip_sync" && refs.length < 2) {
    throw new ToolInputError("视频对口型需要两个素材：reference_uris[0]=视频，[1]=音频", {
      field: "input.reference_uris",
    });
  }
}

/** 输入校验错误：由 generations service 转成 AppError(INVALID_PARAM)，保留字段定位 */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly details: { field: string },
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** 目录 ensure 结果（测试用：断言幂等与条目数） */
export interface EnsureToolCatalogResult {
  models_inserted: number;
  prices_inserted: number;
}

let ensuredInThisProcess = false;

/**
 * 把 `TOOL_MODES` 幂等落成模型目录与价目。
 *
 * 为什么不在 `seed.ts` 里做：seed 是"新库初始化"的一次性脚本，而工具箱目录要能被
 * **正在跑的库**补上（本批上线时线上库已有 46 个模型，不可能重跑 seed）；
 * 也不放在模块 `onModuleInit`：API 启动阶段写库会让"DB 只读/维护中"的部署直接起不来。
 * 因此由 `GET /generations/tools` 与工具 mode 的投递路径**惰性触发一次**（进程内记忆）。
 *
 * ## 写入边界（契约 §2.10）：代码管「定义」，DB 管「运营」
 *
 * 这个函数会在每次目录请求/工具投递上被反复触发，所以它**不能**是最省事的全量覆盖：
 * - 代码负责的字段（`vendor`/`display_name`/`capability`/`adapter_code`/`modes`…）每次同步，
 *   因为档位定义变了不刷就会"价目在、却报 no price"；
 * - 运营负责的字段（`visible`/`sort`、价目的 `credits`/`strike_credits`/`active`）**只在
 *   行不存在时给初值**。否则运营在后台调完价，下一次 `GET /generations/tools` 就被抹回
 *   代码常量——现象是"改了没生效"，且没有任何报错，属于最难排查的一类缺陷。
 * - 需要强制把定义连带运营字段刷回线上（如档位重构后要重置价格），显式设
 *   `CATALOG_SYNC_TOOLS=true` 恢复旧的"全量覆盖"行为。
 */
export async function ensureToolCatalog(): Promise<EnsureToolCatalogResult> {
  if (ensuredInThisProcess) return { models_inserted: 0, prices_inserted: 0 };
  /**
   * 逃生开关。这里直接读 `process.env` 而不是走 `env.ts`：`env.ts` 由 api-ops 在本批
   * 同步修改，先读原始环境变量可以让两边独立落地、互不阻塞（契约 §2.10 明确允许）。
   */
  const syncOperationalFields = process.env.CATALOG_SYNC_TOOLS === "true";
  let modelsInserted = 0;
  let pricesInserted = 0;
  for (const [index, tool] of TOOL_MODES.entries()) {
    const [existing] = await db.select().from(models).where(eq(models.name, tool.model.name));
    /**
     * 代码负责的**定义**字段：已存在也要同步。
     *
     * 为什么必须更新：`modes` 里的档位声明是计价与参数校验的依据（例如"有没有 durations"
     * 决定 `credits.price()` 按次还是按秒档找价目）。只 insert-if-missing 的话，
     * 一次定义变更（比如音乐从按秒档改成按次）在已有库上永远不生效——本地测试会看到
     * "价目明明在却报 no price"这种无法定位的现象。
     */
    const definition = {
      vendor: tool.model.vendor,
      displayName: tool.model.displayName,
      description: tool.model.description,
      capability: tool.capability,
      types: [tool.capability],
      adapterCode: tool.model.adapterCode,
      audioVideoSupport: tool.resultMedia === "video",
      modeOrder: { [tool.mode]: 0 },
      modes: { [tool.mode]: tool.modeConfig },
      sceneModes: {},
      updatedAt: new Date(),
    };
    /**
     * 运营字段的**初值**（只在新建行时写入；已存在行的 `visible`/`sort` 归运营）。
     *
     * ⚠️ `visible=false`：这些是**内部能力行**（后处理/单点工具），不是竞品对齐的
     * 模型目录条目。放进用户可选模型列表会污染「46 条竞品目录」这条硬契约
     * （`test/model-catalog.spec.ts`），也让画布/Agent 的模型选择器出现
     * "deepseek 也能做对口型"这种错配。
     *
     * 但 `tasks.model_id` / `model_prices.model_id` 是 NOT NULL + FK，任务必须有
     * 一条模型行可引用，所以行必须存在、只是不可见；`findByName` 仍能查到
     * （目录可见性只约束列表，不约束内部按名查找，见 models.service 注释）。
     */
    const operationalDefaults = { visible: false, sort: 900 + index };
    let modelId = existing?.id;
    if (!existing) {
      modelId = newId();
      const insertedModels = await db
        .insert(models)
        .values({
          id: modelId,
          name: tool.model.name,
          logo: "",
          tags: [{ name: "工具箱" }],
          promotions: [],
          needVip: false,
          ...definition,
          ...operationalDefaults,
        })
        .onConflictDoNothing({ target: models.name })
        .returning({ id: models.id });
      modelsInserted += insertedModels.length;
      const [reloaded] = await db.select().from(models).where(eq(models.name, tool.model.name));
      modelId = reloaded?.id ?? modelId;
    } else {
      // 默认只刷定义（保留运营改过的 visible/sort）；开了 CATALOG_SYNC_TOOLS 才连运营字段一起覆盖
      await db
        .update(models)
        .set(syncOperationalFields ? { ...definition, ...operationalDefaults } : definition)
        .where(eq(models.id, existing.id));
    }
    if (!modelId) continue;
    for (const price of tool.prices) {
      /**
       * 价目：`tool.prices` 只是**首次落库的默认值**。
       *
       * 行已存在时默认什么都不做（运营改价/下架优先）；只有显式开全量同步才把金额与
       * 启停刷回目录常量。不新增行是为了不破坏 `uq_model_prices_per_call`
       * 那条"按次档位只能一条"的部分唯一索引。
       */
      const insertedPrices = await db
        .insert(modelPrices)
        .values({
          id: newId(),
          modelId,
          mode: tool.mode,
          resolution: price.resolution,
          durationS: null,
          credits: price.credits,
          strikeCredits: price.strikeCredits,
          active: true,
        })
        .onConflictDoNothing()
        .returning({ id: modelPrices.id });
      pricesInserted += insertedPrices.length;
      if (insertedPrices.length === 0 && syncOperationalFields) {
        await db
          .update(modelPrices)
          .set({ credits: price.credits, strikeCredits: price.strikeCredits, active: true, updatedAt: new Date() })
          .where(
            and(
              eq(modelPrices.modelId, modelId),
              eq(modelPrices.mode, tool.mode),
              eq(modelPrices.resolution, price.resolution),
              isNull(modelPrices.durationS),
            ),
          );
      }
    }
  }
  ensuredInThisProcess = true;
  return { models_inserted: modelsInserted, prices_inserted: pricesInserted };
}

/** 仅测试用：让 ensure 在下一个用例重新真正执行一次 */
export function resetToolCatalogMemoForTest(): void {
  ensuredInThisProcess = false;
}

/** 给 `GET /generations/tools` 的公开视图（不吐 adapterCode 以外的运营字段） */
export function publicToolCatalog() {
  return {
    cards: TOOL_CARDS.slice()
      .sort((a, b) => a.sort - b.sort)
      .map((card) => ({
        key: card.key,
        title: card.title,
        desc: card.desc,
        category: card.category,
        route: card.route,
        surface: card.surface,
        page_tool_keys: card.pageToolKeys ?? [],
        evidence: card.evidence,
      })),
    tools: TOOL_MODES.map((tool) => ({
      key: tool.key,
      mode: tool.mode,
      title: tool.title,
      category: tool.category,
      capability: tool.capability,
      result_media: tool.resultMedia,
      model: {
        name: tool.model.name,
        display_name: tool.model.displayName,
        description: tool.model.description,
      },
      resolution_options: tool.modeConfig.resolution_options,
      default_resolution: tool.modeConfig.default_resolution,
      params: tool.params,
      inputs: tool.inputs,
      required_params: tool.requiredParams ?? [],
      fixed_options: tool.fixedOptions ?? {},
      evidence: tool.evidence,
    })),
  };
}
