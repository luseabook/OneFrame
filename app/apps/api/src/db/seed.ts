import { inArray } from "drizzle-orm";
import { db } from "./database";
import { modelPrices, models, skus } from "@app/db";

/**
 * 种子数据：**46 个模型**，对齐竞品 ReelMate 的真实模型目录。
 *
 * 数据来源：`rea-reelmate/cli-out/model-all.json`（竞品线上目录 46 条，2026-10-24 拉取）。
 * 竞品字段 → 我方字段的映射：
 *   display_name / vendor / type / types / need_vip / visible / description / logo /
 *   tags / activity_tags / promotions / mode_order / supported_modes /
 *   params.generation.<mode> / params.storyboard_reference_video /
 *   params.script_to_scene_refer / price_variants
 * → models 行（vendor 用竞品原值；capability 取 type，file→text）+ model_prices 行。
 *
 * ## 五个「场景键」是这份目录的核心设计（同一份目录服务五个产品场景）
 *
 * | # | 场景键 | 成员数 | 谁在用 | 靠什么表达 |
 * |---:|---|---:|---|---|
 * | 1 | 资产生图 | 4 | 制片工坊（角色/场景/道具定妆图） | `modes.studio_asset_image` |
 * | 2 | 画布生图 | 9 | 无限画布 / 单点工具 | `capability=image` 且 `modes.text2image`、**无** `studio_asset_image` |
 * | 3 | 剧本转场景 | 4 | 剧本→分镜环节的参考图 | `sceneModes.script_to_scene_refer` |
 * | 4 | 分镜参考生视频 | 10 | 制片工坊出片 | `sceneModes.storyboard_reference_video` |
 * | 5 | 画布节点可用模式 | 11 种 mode | 无限画布（node.md 的 mode 全集） | `modes.*` + `modeOrder` |
 *
 * ⚠️ **1 与 2 必须零交集**，这是竞品刻意的场景隔离：自营模型守流水线必经环节（控成本），
 * 聚合模型守效果决胜点（保质量）。不是数据巧合——`seed.spec.ts` 用脚本断言这一点，
 * 谁把 `text2image` 加进那 4 条自营模型、或把 `studio_asset_image` 加进聚合模型，测试就红。
 *
 * ## 价格
 * 竞品在 `price_variants` 里**公开了 11 个模型的真实价**（元/档），这里按
 * **10 积分 = 1 元**（PRD §10）换算成积分，落进 `REAL_PRICE_SEED`，
 * 再展开成 `model_prices` 行（见下方定价循环）。
 * 其余模型/档位仍是 **PLACEHOLDER**：按 RE 实测锚点
 * （文生视频 5s/720p = 8 积分，1080P≈×2）。
 * 所有金额都只是**新库初值**——定价 owner 决策后通过 `/ops/admin/model-prices` 热更，代码不写死。
 * 竞品的「优惠版」SKU 不为它单独建模型，改由 `time_limited_credits` 表达限时价。
 */

type Res = { value: string; label: string };

/** 单个 mode 的参数枚举（结构与竞品 `params.generation.<mode>` 对齐，只保留有语义的键） */
type ModeCfg = {
  endpoint: string;
  ratios?: string[];
  durations?: number[];
  default_ratio?: string;
  default_duration?: number;
  resolution_options: Res[];
  resolutions: string[];
  default_resolution?: string;
  counts?: number[];
  default_count?: number;
  media_limits?: Record<string, number>;
  mouth_drive?: string;
  off_peak?: boolean;
  image_quality?: string[];
  max_prompt_length?: number;
  /** 仅 scene 档位用：该场景固定走哪个 mode（竞品 `storyboard_reference_video.mode`） */
  mode?: string;
};

/**
 * 场景键的两种形态：
 *   - `storyboard_reference_video`：带完整档位（时长/比例/分辨率/素材上限），与 mode 配置
 *     同形——出片要按这些档位校验并「就近取低」时长；
 *   - `script_to_scene_refer`：只是「该模型参与此场景」的开关（竞品就是 `{enabled:true}`），
 *     该场景复用模型的图像能力，不需要独立档位。
 */
type SceneCfg = ModeCfg | { enabled: boolean };

type ModelSeed = {
  id: bigint;
  vendor: string;
  name: string;
  displayName: string;
  description: string;
  logo: string;
  capability: string;
  types: string[];
  tags: { name: string; style?: string }[];
  promotions: string[];
  adapterCode: string;
  visible: boolean;
  needVip: boolean;
  audioVideoSupport: boolean;
  sort: number;
  modeOrder: Record<string, number>;
  modes: Record<string, ModeCfg>;
  sceneModes: Record<string, SceneCfg>;
};

/** 连续时长枚举；竞品大量使用 4..30 / 2..30 这种连续档 */
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * `[value, label]` 元组 → 分辨率选项。
 *
 * **label 与提交值必须分离**：竞品把「1080P优惠版」这种展示名与 `720p_sale` 这种提交值
 * 分开存。合并成一个字段会让前端把中文标签当分辨率提交，接口 100% 400。
 */
const res = (pairs: [string, string][]): Res[] => pairs.map(([value, label]) => ({ value, label }));

/**
 * 按次计价的模式（LLM / 分析类）。
 *
 * `resolution: "per_call"` 不是「分辨率」，而是**计价单位**：LLM 按次收费，与图像/视频
 * 按「档位 × 时长」定价不同。价格来自 `model_prices`，运营随时改，代码不写死金额。
 */
const perCall = (): ModeCfg => ({
  endpoint: "chat",
  resolution_options: [{ value: "per_call", label: "按次" }],
  resolutions: ["per_call"],
  default_resolution: "per_call",
  counts: [1],
  default_count: 1,
});

/** `generation.<mode>` 配置构造器（保留默认值以让前端「选完模型即报价」） */
const video = (spec: {
  ep: string;
  ratios?: string[];
  durations?: number[];
  res: [string, string][];
  default_ratio?: string;
  default_duration?: number;
  default_resolution?: string;
  counts?: number[];
  limits?: Record<string, number>;
  mouth_drive?: string;
  off_peak?: boolean;
  image_quality?: string[];
  max_prompt_length?: number;
}): ModeCfg => ({
  endpoint: spec.ep,
  ...(spec.ratios ? { ratios: spec.ratios } : {}),
  ...(spec.durations ? { durations: spec.durations } : {}),
  resolution_options: res(spec.res),
  resolutions: spec.res.map(([value]) => value),
  ...(spec.default_ratio ? { default_ratio: spec.default_ratio } : {}),
  ...(spec.default_duration != null ? { default_duration: spec.default_duration } : {}),
  ...(spec.default_resolution ? { default_resolution: spec.default_resolution } : {}),
  ...(spec.counts ? { counts: spec.counts } : {}),
  ...(spec.limits ? { media_limits: spec.limits } : {}),
  ...(spec.mouth_drive ? { mouth_drive: spec.mouth_drive } : {}),
  ...(spec.off_peak != null ? { off_peak: spec.off_peak } : {}),
  ...(spec.image_quality ? { image_quality: spec.image_quality } : {}),
  ...(spec.max_prompt_length ? { max_prompt_length: spec.max_prompt_length } : {}),
});

/**
 * 流水线场景档位（`sceneModes.<sceneKey>`）：与 mode 配置同形，但多一个
 * `mode`（该场景固定走哪个 generation mode）与 `enabled`。
 *
 * 为什么不复用 `video()`：场景档位的 `endpoint` 由背后的 mode 决定，场景本身不发请求，
 * 因此 endpoint 留空——复用会让「scene 自己有个 endpoint」造成误读。
 */
const scene = (spec: {
  mode?: string;
  ratios?: string[];
  durations?: number[];
  res: [string, string][];
  default_ratio?: string;
  default_duration?: number;
  default_resolution?: string;
  counts?: number[];
  limits?: Record<string, number>;
  mouth_drive?: string;
  off_peak?: boolean;
  max_prompt_length?: number;
}): ModeCfg => ({
  endpoint: "",
  ...(spec.mode ? { mode: spec.mode } : {}),
  ...(spec.ratios ? { ratios: spec.ratios } : {}),
  ...(spec.durations ? { durations: spec.durations } : {}),
  resolution_options: res(spec.res),
  resolutions: spec.res.map(([value]) => value),
  ...(spec.default_ratio ? { default_ratio: spec.default_ratio } : {}),
  ...(spec.default_duration != null ? { default_duration: spec.default_duration } : {}),
  ...(spec.default_resolution ? { default_resolution: spec.default_resolution } : {}),
  ...(spec.counts ? { counts: spec.counts } : {}),
  ...(spec.limits ? { media_limits: spec.limits } : {}),
  ...(spec.mouth_drive ? { mouth_drive: spec.mouth_drive } : {}),
  ...(spec.off_peak != null ? { off_peak: spec.off_peak } : {}),
  ...(spec.max_prompt_length ? { max_prompt_length: spec.max_prompt_length } : {}),
});

/**
 * 46 条模型目录（对齐竞品 `cli-out/model-all.json`）。
 *
 * vendor 分布：tomoviee 13（自营）/ jimeng 8 / kling 7 / hailuo 5 / wan 3 /
 * happy-horse 3 / vidu 3 / deepseek 1 / google 1 / midjourney 1 / openai 1 = 46。
 *
 * id 沿用既有 seed 的 1001..1010（存量测试与数据引用了这些 id），新增的用 1011+。
 * name 是**协议标识**（英文、稳定、对外契约），displayName 是中文展示名——
 * 两者不能混用：改展示名不该动协议，改协议要迁移数据。
 */
const MODEL_SEED: ModelSeed[] = [
  {
    id: 1010n,
    vendor: "deepseek",
    name: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    description: "",
    logo: "",
    capability: "text",
    types: ["file"],
    tags: [],
    promotions: [],
    adapterCode: "deepseek:chat",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 200,
    modeOrder: {},
    modes: {
      script_optimization: perCall(),
      storyboard_parse: perCall(),
      asset_extraction: perCall(),
      storyboard_asset_match: perCall(),
      video_parse: perCall(),
    },
    sceneModes: {},
  },
  {
    id: 1039n,
    vendor: "google",
    name: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro Preview",
    description: "",
    logo: "",
    capability: "text",
    types: ["file"],
    tags: [],
    promotions: [],
    adapterCode: "google:chat",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 201,
    modeOrder: {},
    modes: {
      script_optimization: perCall(),
      storyboard_parse: perCall(),
      asset_extraction: perCall(),
      storyboard_asset_match: perCall(),
      video_parse: perCall(),
    },
    sceneModes: {},
  },
  {
    id: 1040n,
    vendor: "openai",
    name: "tg-chat-5.5",
    displayName: "TG Chat 5.5",
    description: "",
    logo: "",
    capability: "text",
    types: ["file"],
    tags: [],
    promotions: [],
    adapterCode: "openai:chat",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 202,
    modeOrder: {},
    modes: {
      script_optimization: perCall(),
      storyboard_parse: perCall(),
      asset_extraction: perCall(),
      storyboard_asset_match: perCall(),
      video_parse: perCall(),
    },
    sceneModes: {},
  },
  {
    id: 1003n,
    vendor: "tomoviee",
    name: "tgi-2",
    displayName: "TGI 2",
    description: "媲美GPT image 2超强真实感、精准文字、丰富世界知识生成，角色一致性、图像编辑能力卓越",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [{ name: "人像特调版", style: "portrait" }],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 20,
    modeOrder: { image2image: 0, multi_reference: 0, text2image: 0 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["1:1","1:2","2:1","9:16","16:9","3:4","4:3","2:3","3:2","4:5","5:4","9:21","21:9"], res: [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]], default_ratio: "1:1", default_resolution: "1K", counts: [1,2,3,4], image_quality: ["low","medium","high"], max_prompt_length: 10000 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["1:1","1:2","2:1","9:16","16:9","3:4","4:3","2:3","3:2","4:5","5:4","9:21","21:9"], res: [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]], default_ratio: "1:1", default_resolution: "1K", counts: [1,2,3,4], limits: { image: 1 }, image_quality: ["low","medium","high"], max_prompt_length: 10000 }),
      multi_reference: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["1:1","1:2","2:1","9:16","16:9","3:4","4:3","2:3","3:2","4:5","5:4","9:21","21:9"], res: [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]], default_ratio: "1:1", default_resolution: "1K", counts: [1,2,3,4], limits: { image: 7 }, image_quality: ["low","medium","high"], max_prompt_length: 10000 }),
    },
    sceneModes: {},
  },
  {
    id: 1038n,
    vendor: "midjourney",
    name: "midjourney-v8.2",
    displayName: "悠船 V8.2",
    description: "Midjourney影视质感进阶，光影、人物与材质细节精准还原",
    logo: "models/midjourney.svg",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "midjourney:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 110,
    modeOrder: { image2image: 1, text2image: 1 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["1K", "1K"], ["2K", "2K"]], default_ratio: "16:9", default_resolution: "1K", counts: [4], max_prompt_length: 1024 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["1K", "1K"], ["2K", "2K"]], default_ratio: "16:9", default_resolution: "1K", counts: [4], limits: { image: 1 }, max_prompt_length: 1024 }),
    },
    sceneModes: {},
  },
  {
    id: 1034n,
    vendor: "jimeng",
    name: "jimeng-5.0-pro",
    displayName: "即梦5.0Pro",
    description: "商业设计、影视、高密度图文等场景效果全面提升",
    logo: "models/ic24_jimeng.svg",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "volcengine:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 100,
    modeOrder: { image2image: 5, text2image: 5 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["1K", "1K"], ["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 800 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["1K", "1K"], ["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 800 }),
    },
    sceneModes: {},
  },
  {
    id: 1035n,
    vendor: "jimeng",
    name: "jimeng-5.0",
    displayName: "即梦5.0",
    description: "引入实时检索能力，指令响应更精准，理解与生成表现全面提升",
    logo: "models/ic24_jimeng.svg",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "volcengine:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 101,
    modeOrder: { image2image: 6, text2image: 6 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["3K", "3K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 800 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["3K", "3K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 700 }),
    },
    sceneModes: {},
  },
  {
    id: 1036n,
    vendor: "jimeng",
    name: "jimeng-4.5",
    displayName: "即梦4.5",
    description: "语义理解及融图一致性能力较4.0升级",
    logo: "models/ic24_jimeng.svg",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "volcengine:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 102,
    modeOrder: { image2image: 10, text2image: 7 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 800 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 700 }),
    },
    sceneModes: {},
  },
  {
    id: 1014n,
    vendor: "tomoviee",
    name: "tnb-2",
    displayName: "TNB 2",
    description: "极速生成媲美全球顶尖水准的图像，细节精致、光影生动，精准支持多语言文字，实时联网让创意与现实互通",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 25,
    modeOrder: { image2image: 9, text2image: 8 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 5660 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 5660 }),
    },
    sceneModes: {},
  },
  {
    id: 1015n,
    vendor: "tomoviee",
    name: "tnb-pro",
    displayName: "TNB Pro",
    description: "效果对齐全球头部最强生图模型，语义遵从及推理能力大升级，擅长复杂细节处理",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 26,
    modeOrder: { image2image: 7, multi_reference: 1, text2image: 9 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 6000 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 6000 }),
      multi_reference: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 7 }, max_prompt_length: 6000 }),
    },
    sceneModes: {},
  },
  {
    id: 1016n,
    vendor: "tomoviee",
    name: "tnb-pro-beta",
    displayName: "TNB Pro-Beta",
    description: "效果对齐头部生图模型，测试版性价比之选",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 27,
    modeOrder: { image2image: 12, text2image: 10 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 6000 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 6000 }),
    },
    sceneModes: {},
  },
  {
    id: 1037n,
    vendor: "jimeng",
    name: "jimeng-4.0",
    displayName: "即梦4.0",
    description: "擅长亚洲人像美学，画面质感高",
    logo: "models/ic24_jimeng.svg",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "volcengine:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 103,
    modeOrder: { image2image: 11, text2image: 12 },
    modes: {
      text2image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 800 }),
      image2image: video({ ep: "/web/v1/ai/refer-image-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"], ["4K", "4K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 700 }),
    },
    sceneModes: {},
  },
  {
    id: 1004n,
    vendor: "tomoviee",
    name: "tgi-2.5-flare",
    displayName: "TGI 2.5 Flare",
    description: "媲美GPT image 2.5,极速高质量图像生成，兼顾效果与效率",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 21,
    modeOrder: {},
    modes: {
      studio_asset_image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["1:1","1:2","2:1","9:16","16:9","3:4","4:3","2:3","3:2","4:5","5:4","9:21","21:9"], res: [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]], default_ratio: "1:1", default_resolution: "1K", counts: [1,2,3,4], image_quality: ["low","medium","high","xhigh","max"], max_prompt_length: 10000 }),
    },
    sceneModes: {},
  },
  {
    id: 1011n,
    vendor: "tomoviee",
    name: "tgi-2.5-sunburst",
    displayName: "TGI 2.5 Sunburst",
    description: "媲美GPT image 2.5,精准生成与编辑，复杂指令稳定还原",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 22,
    modeOrder: {},
    modes: {
      studio_asset_image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["1:1","1:2","2:1","9:16","16:9","3:4","4:3","2:3","3:2","4:5","5:4","9:21","21:9"], res: [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]], default_ratio: "1:1", default_resolution: "1K", counts: [1,2,3,4], image_quality: ["low","medium","high","xhigh","max"], max_prompt_length: 10000 }),
    },
    sceneModes: {},
  },
  {
    id: 1012n,
    vendor: "tomoviee",
    name: "sky-media-realistic",
    displayName: "天幕写实版",
    description: "极速出图，擅长写实风格",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 23,
    modeOrder: {},
    modes: {
      studio_asset_image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 1000 }),
    },
    sceneModes: {},
  },
  {
    id: 1013n,
    vendor: "tomoviee",
    name: "tnb",
    displayName: "TNB",
    description: "语义遵从和推理能力佳",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 24,
    modeOrder: {},
    modes: {
      studio_asset_image: video({ ep: "/web/v1/ai/text-to-image", ratios: ["16:9","9:16","4:3","3:4","1:1"], res: [["2K", "2K"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], max_prompt_length: 5660 }),
    },
    sceneModes: {},
  },
  {
    id: 1001n,
    vendor: "jimeng",
    name: "seedance-2.5",
    displayName: "Seedance 2.5",
    description: "全能模型、情绪演绎佳，更低抽卡率",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-30s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 10,
    modeOrder: { script_to_scene_refer: 0, universal_reference: 0, video_edit: 4, video_extend: 0 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 30), res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p_sale", counts: [1,2,3,4], limits: { image: 30, video: 10, audio: 10, total: 50 }, mouth_drive: "optional", max_prompt_length: 20000 }),
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_resolution: "720p_sale", counts: [1,2,3,4], limits: { image: 30, video: 1, audio: 10, total: 41 }, max_prompt_length: 20000 }),
      video_extend: video({ ep: "/web/v1/ai/video-to-video", durations: range(4, 30), res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p_sale", counts: [1,2,3,4], limits: { image: 30, video: 10, audio: 10, total: 50 }, mouth_drive: "optional", max_prompt_length: 20000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 30), res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["1080p", "1080P"]], default_duration: 5, default_resolution: "720p_sale", counts: [1,2,3,4], limits: { audio: 10, image: 30, total: 50, video: 10 }, mouth_drive: "optional", off_peak: false, max_prompt_length: 20000 }),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1002n,
    vendor: "jimeng",
    name: "seedance-2.0-vip",
    displayName: "Seedance 2.0 VIP",
    description: "全能模型，动作表现自然流畅、指令理解精准、情绪演绎佳",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 11,
    modeOrder: { first_frame: 1, first_last_frame: 0, image2video: 1, script_to_scene_refer: 1, universal_reference: 1, video_edit: 5 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: range(4, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 10000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: range(4, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 10000 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: range(4, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, mouth_drive: "optional", max_prompt_length: 10000 }),
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 15), res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["720p_hd", "2K超清版"], ["1080p", "1080P"], ["4k", "4K"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p_sale", counts: [1,2,3,4], limits: { image: 9, video: 3, audio: 3, total: 12 }, mouth_drive: "optional", max_prompt_length: 10000 }),
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", res: [["720p", "720P"], ["720p_hd", "2K超清版"], ["1080p", "1080P"], ["4k", "4K"]], default_ratio: "16:9", default_resolution: "720p", counts: [1,2,3,4], limits: { image: 9, video: 1, audio: 3, total: 13 }, max_prompt_length: 10000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 15), res: [["720p_sale", "1080P优惠版"], ["720p", "720P"], ["720p_hd", "2K超清版"], ["1080p", "1080P"], ["4k", "4K"]], default_duration: 5, default_resolution: "720p_sale", counts: [1,2,3,4], limits: { audio: 3, image: 9, total: 12, video: 3 }, mouth_drive: "optional", off_peak: false, max_prompt_length: 10000 }),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1041n,
    vendor: "jimeng",
    name: "seedance-2.0-mini",
    displayName: "Seedance 2.0 mini",
    description: "超高性价比，比VIP版本更快的推理速度",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 12,
    modeOrder: { script_to_scene_refer: 3, universal_reference: 2 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 15), res: [["720p", "720P"], ["1080p_sale", "1080P全高清版"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p", counts: [1,2,3,4], limits: { image: 9, video: 3, audio: 3, total: 12 }, mouth_drive: "optional", max_prompt_length: 10000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(4, 15), res: [["720p", "720P"], ["1080p_sale", "1080P全高清版"]], default_duration: 5, default_resolution: "720p", counts: [1,2,3,4], limits: { audio: 3, image: 9, total: 12, video: 3 }, mouth_drive: "optional", off_peak: false, max_prompt_length: 10000 }),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1009n,
    vendor: "wan",
    name: "wan-3.0",
    displayName: "Wan 3.0",
    description: "超高性价比，表演台词能力强",
    logo: "models/wan.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "2-30s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: ["60% off"],
    adapterCode: "aliyun:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 60,
    modeOrder: { script_to_scene_refer: 2, universal_reference: 3 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: range(2, 30), res: [["720p", "720P"], ["720p_sale", "1080P优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 10, video: 5, audio: 5, total: 20 }, mouth_drive: "optional", max_prompt_length: 18000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: range(2, 30), res: [["480p", "480P"], ["720p", "720P"], ["720p_sale", "1080P优惠版"], ["1080p", "1080P"]], default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { audio: 5, image: 10, total: 20, video: 5 }, mouth_drive: "optional", off_peak: false, max_prompt_length: 18000 }),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1017n,
    vendor: "hailuo",
    name: "minimax-h3-sale",
    displayName: "Minimax H3 优惠版",
    description: "与Minimax H3 能力一致，超高性价比",
    logo: "models/hailuo.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "minimax:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 74,
    modeOrder: { universal_reference: 4 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(5, 15), res: [["720p", "720P"], ["1080p", "1080P"], ["2K", "2K"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 9, audio: 1, total: 12 }, mouth_drive: "unsupported", max_prompt_length: 7000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(5, 15), res: [["720p", "720P"], ["1080p", "1080P"], ["2K", "2K"]], default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { audio: 1, image: 9, total: 12, video: 0 }, mouth_drive: "unsupported", off_peak: false, max_prompt_length: 7000 }),
    },
  },
  {
    id: 1018n,
    vendor: "hailuo",
    name: "minimax-h3",
    displayName: "MiniMax H3",
    description: "海螺最新多模态智能模型",
    logo: "models/hailuo.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "minimax:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 73,
    modeOrder: { universal_reference: 5, video_edit: 0 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(5, 15), res: [["2K", "2K"], ["768P", "768P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "2K", counts: [1,2,3,4], limits: { image: 9, video: 3, audio: 3, total: 12 }, mouth_drive: "unsupported", max_prompt_length: 7000 }),
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", res: [["2K", "2K"], ["768P", "768P"]], default_ratio: "16:9", default_resolution: "2K", counts: [1,2,3,4], limits: { image: 9, video: 1, audio: 3, total: 13 }, max_prompt_length: 7000 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", ratios: ["16:9","9:16","21:9","4:3","3:4","1:1"], durations: range(5, 15), res: [["2K", "2K"], ["768P", "768P"]], default_duration: 5, default_resolution: "2K", counts: [1,2,3,4], limits: { audio: 3, image: 9, total: 12, video: 3 }, mouth_drive: "unsupported", off_peak: false, max_prompt_length: 7000 }),
    },
  },
  {
    id: 1019n,
    vendor: "happy-horse",
    name: "happy-horse-1.1",
    displayName: "Happy Horse 1.1",
    description: "超强理解能力，角色一致性和口播能力升级",
    logo: "models/happyhorse.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "happy-horse:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 80,
    modeOrder: { universal_reference: 8 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 9, total: 9 }, mouth_drive: "unsupported", off_peak: true, max_prompt_length: 2500 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { audio: 0, image: 9, total: 9, video: 0 }, mouth_drive: "unsupported", off_peak: true, max_prompt_length: 2500 }),
    },
  },
  {
    id: 1020n,
    vendor: "happy-horse",
    name: "happy-horse-1.0",
    displayName: "Happy Horse 1.0",
    description: "超强理解能力，出色的人物一致性和表情管理",
    logo: "models/happyhorse.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "happy-horse:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 81,
    modeOrder: { first_frame: 0, image2video: 0, universal_reference: 9 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2500 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2500 }),
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 9, total: 9 }, mouth_drive: "optional", off_peak: true, max_prompt_length: 2500 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", durations: range(3, 15), res: [["720p", "720P"], ["1080p", "1080P"]], default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { audio: 0, image: 9, total: 9, video: 0 }, mouth_drive: "optional", off_peak: true, max_prompt_length: 2500 }),
    },
  },
  {
    id: 1021n,
    vendor: "kling",
    name: "kling-o3",
    displayName: "可灵O3",
    description: "影视级画质，情绪与质感叙事大升级，音画同出",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 44,
    modeOrder: { universal_reference: 10, video_edit: 3 },
    modes: {
      universal_reference: video({ ep: "/web/v1/ai/refer-media-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["4k", "4K"], ["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 7, total: 7 }, mouth_drive: "optional", off_peak: true, max_prompt_length: 2500 }),
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_resolution: "720p", counts: [1,2,3,4], limits: { image: 4, video: 1, total: 5 }, max_prompt_length: 2500 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", durations: [3, 5, 8, 10, 12, 15], res: [["4k", "4K"], ["1080p", "1080P"], ["720p", "720P"]], default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { audio: 0, image: 7, total: 7, video: 0 }, mouth_drive: "optional", off_peak: true, max_prompt_length: 2500 }),
    },
  },
  {
    id: 1008n,
    vendor: "vidu",
    name: "vidu-q2",
    displayName: "Vidu Q2",
    description: "超强主体一致性控制，秒级叙事支持",
    logo: "models/vidu.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "2-8s" }],
    promotions: [],
    adapterCode: "vidu:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 50,
    modeOrder: { first_frame: 3, first_last_frame: 4, image2video: 3, universal_reference: 11 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: range(1, 8), res: [["720p", "720P"], ["1080p_sale", "1080p优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: range(1, 8), res: [["720p", "720P"], ["1080p_sale", "1080p优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: range(1, 8), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, max_prompt_length: 2000 }),
      universal_reference: video({ ep: "/web/v1/ai/refer-image-to-video", durations: range(2, 8), res: [["720p", "720P"], ["1080p_sale", "1080p优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { image: 7, total: 7 }, mouth_drive: "unsupported", off_peak: true, max_prompt_length: 1800 }),
    },
    sceneModes: {
      storyboard_reference_video: scene({ mode: "universal_reference", durations: range(2, 8), res: [["720p", "720P"], ["1080p_sale", "1080p优惠版"], ["1080p", "1080P"]], default_duration: 5, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { audio: 0, image: 7, total: 7, video: 0 }, mouth_drive: "unsupported", off_peak: true, max_prompt_length: 1800 }),
    },
  },
  {
    id: 1022n,
    vendor: "vidu",
    name: "vidu-q3-pro",
    displayName: "Vidu Q3-Pro",
    description: "最长15s生成，打斗效果升级",
    logo: "models/vidu.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "vidu:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 52,
    modeOrder: { first_frame: 2, image2video: 2 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2000 }),
    },
    sceneModes: {},
  },
  {
    id: 1042n,
    vendor: "jimeng",
    name: "jimeng-3.5-pro",
    displayName: "即梦3.5 Pro",
    description: "模型效果升级，支持音画同出",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-12s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 104,
    modeOrder: { first_frame: 6, image2video: 6 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 8, 10, 12], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 800 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 8, 10, 12], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 800 }),
    },
    sceneModes: {},
  },
  {
    id: 1023n,
    vendor: "hailuo",
    name: "hailuo-2.3-fast",
    displayName: "Hailuo 2.3 - Fast",
    description: "更高性价比，擅长打斗场景，动作及运镜表现力优秀",
    logo: "models/hailuo.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "6-10s" }],
    promotions: [],
    adapterCode: "minimax:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 71,
    modeOrder: { first_frame: 7, image2video: 7 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [6, 10], res: [["768p", "768P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [6, 10], res: [["768p", "768P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
    },
    sceneModes: {},
  },
  {
    id: 1024n,
    vendor: "hailuo",
    name: "hailuo-2.3",
    displayName: "Hailuo 2.3",
    description: "擅长打斗场景，动作及运镜表现力优秀",
    logo: "models/hailuo.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "6-10s" }],
    promotions: [],
    adapterCode: "minimax:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 70,
    modeOrder: { first_frame: 8, image2video: 8, text2video: 6 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9"], durations: [6, 10], res: [["768p", "768P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "768p", counts: [1,2,3,4], max_prompt_length: 2000 }),
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [6, 10], res: [["768p", "768P"], ["1080p_sale", "1080P优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [6, 10], res: [["768p", "768P"], ["1080p_sale", "1080P优惠版"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "1080p_sale", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2000 }),
    },
    sceneModes: {},
  },
  {
    id: 1025n,
    vendor: "kling",
    name: "kling-3.0",
    displayName: "可灵3.0",
    description: "影视级画质，情绪与质感叙事大升级，音画同出，多分镜叙事",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }, { name: "多分镜" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 41,
    modeOrder: { first_frame: 9, first_last_frame: 2, image2video: 9 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["4k", "4K"], ["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2500 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["4k", "4K"], ["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2500 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [3, 5, 8, 10, 12, 15], res: [["4k", "4K"], ["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, mouth_drive: "optional", max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1007n,
    vendor: "kling",
    name: "kling-2.6",
    displayName: "可灵2.6",
    description: "影视级画质，擅长情绪与质感叙事，支持音画同出",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 40,
    modeOrder: { first_frame: 10, image2video: 10, text2video: 2 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","1:1"], durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], mouth_drive: "optional", max_prompt_length: 2500 }),
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2500 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1026n,
    vendor: "kling",
    name: "kling-2.5-turbo",
    displayName: "可灵 2.5 Turbo",
    description: "影视级画质，擅长情绪与质感叙事，稳定性更高",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }, { name: "专业", style: "brand" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 42,
    modeOrder: { first_frame: 11, image2video: 11, text2video: 3 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","1:1"], durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 10, default_resolution: "1080p", counts: [1,2,3,4], max_prompt_length: 2500 }),
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 10], res: [["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 10, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2500 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 10], res: [["1080p", "1080P"], ["720p", "720P"]], default_ratio: "16:9", default_duration: 10, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1027n,
    vendor: "wan",
    name: "wan-2.6",
    displayName: "Wan 2.6",
    description: "支持多镜头生成，音画同出",
    logo: "models/wan.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "aliyun:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 61,
    modeOrder: { first_frame: 12, image2video: 12 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5, 10, 15], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "required", max_prompt_length: 800 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5, 10, 15], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "required", max_prompt_length: 800 }),
    },
    sceneModes: {},
  },
  {
    id: 1028n,
    vendor: "wan",
    name: "wan-2.5",
    displayName: "Wan 2.5",
    description: "画面高清，支持音画同出",
    logo: "models/wan.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }, { name: "音频生成" }, { name: "口型同步" }, { name: "专业", style: "brand" }],
    promotions: [],
    adapterCode: "aliyun:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 62,
    modeOrder: { first_frame: 13, image2video: 13, text2video: 5 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5, 10], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p", counts: [1,2,3,4], max_prompt_length: 800 }),
      image2video: video({ ep: "/web/v1/ai/image-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5, 10], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 800 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5, 10], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 800 }),
    },
    sceneModes: {},
  },
  {
    id: 1030n,
    vendor: "tomoviee",
    name: "ts-2.0",
    displayName: "TS 2.0",
    description: "支持上传多故事板进行多分镜叙事规划，音画直出。暂不支持驱动真实人像。",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-12s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 90,
    modeOrder: { first_frame: 14, image2video: 14 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 8, 12], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 3500 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 8, 12], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 3500 }),
    },
    sceneModes: {},
  },
  {
    id: 1031n,
    vendor: "tomoviee",
    name: "tv-3.1",
    displayName: "TV 3.1",
    description: "音画同出逼真性对齐行业头部模型，写实级视频质感，更遵循物理世界规则",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-8s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 91,
    modeOrder: { first_frame: 15, first_last_frame: 5, image2video: 15 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 6000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 6000 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, mouth_drive: "optional", max_prompt_length: 6000 }),
    },
    sceneModes: {},
  },
  {
    id: 1032n,
    vendor: "tomoviee",
    name: "tv-3.1-fast",
    displayName: "TV 3.1 - Fast",
    description: "较TV3.1更高性价比",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-8s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 92,
    modeOrder: { first_frame: 16, first_last_frame: 6, image2video: 16 },
    modes: {
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 6000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, mouth_drive: "optional", max_prompt_length: 6000 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [4, 6, 8], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 8, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, mouth_drive: "optional", max_prompt_length: 6000 }),
    },
    sceneModes: {},
  },
  {
    id: 1005n,
    vendor: "tomoviee",
    name: "sky-media-2.0",
    displayName: "天幕2.0",
    description: "高效生成，稳定的运镜",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5s" }, { name: "最优惠", style: "brand" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 30,
    modeOrder: { first_frame: 17, first_last_frame: 7, image2video: 17, text2video: 0 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p", counts: [1,2,3,4], max_prompt_length: 1000 }),
      image2video: video({ ep: "/web/v1/ai/image-to-video", durations: [5], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 1000 }),
      first_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1 }, max_prompt_length: 1000 }),
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, max_prompt_length: 1000 }),
    },
    sceneModes: {},
  },
  {
    id: 1006n,
    vendor: "tomoviee",
    name: "sky-media-2.1",
    displayName: "天幕2.1",
    description: "电影质感，真实细节",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5s" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 31,
    modeOrder: { text2video: 1 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","4:3","3:4","1:1"], durations: [5], res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "720p", counts: [1,2,3,4], max_prompt_length: 1000 }),
    },
    sceneModes: {},
  },
  {
    id: 1033n,
    vendor: "kling",
    name: "kling-2.5-turbo-std",
    displayName: "可灵 2.5 Turbo-Std",
    description: "影视级画质，擅长情绪与质感叙事，稳定性更高",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 43,
    modeOrder: { text2video: 4 },
    modes: {
      text2video: video({ ep: "/web/v1/ai/text-to-video", ratios: ["16:9","9:16","1:1"], durations: [5, 10], res: [["720p", "720P"]], default_ratio: "16:9", default_duration: 10, default_resolution: "720p", counts: [1,2,3,4], max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1029n,
    vendor: "happy-horse",
    name: "happy-horse-1.0-edit",
    displayName: "Happy Horse 1.0",
    description: "超强理解能力，出色的人物一致性和表情管理",
    logo: "models/happyhorse.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-15s" }, { name: "音频生成" }, { name: "口型同步" }],
    promotions: [],
    adapterCode: "happy-horse:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 82,
    modeOrder: { video_edit: 1 },
    modes: {
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 5, video: 1, total: 6 }, max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1043n,
    vendor: "kling",
    name: "kling-o1",
    displayName: "可灵 O1",
    description: "多模态全能模型。一句话指令改视频。",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 45,
    modeOrder: { video_edit: 2 },
    modes: {
      video_edit: video({ ep: "/web/v1/ai/refer-video-to-video", durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 4, video: 1, total: 5 }, max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
  {
    id: 1044n,
    vendor: "vidu",
    name: "vidu-q2-extend",
    displayName: "Vidu Q2",
    description: "秒级叙事支持，擅长情绪表现及特效",
    logo: "models/vidu.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "3-7s" }],
    promotions: [],
    adapterCode: "vidu:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 51,
    modeOrder: { video_extend: 1 },
    modes: {
      video_extend: video({ ep: "/web/v1/ai/video-to-video", durations: range(3, 7), res: [["720p", "720P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 1, video: 1, total: 2 }, max_prompt_length: 1500 }),
    },
    sceneModes: {},
  },
  {
    id: 1045n,
    vendor: "hailuo",
    name: "hailuo-2.0",
    displayName: "Hailuo 2.0",
    description: "擅长打斗场景，动作及运镜表现力优秀",
    logo: "models/hailuo.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "6-10s" }, { name: "首尾帧" }],
    promotions: [],
    adapterCode: "minimax:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 72,
    modeOrder: { first_last_frame: 1 },
    modes: {
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [6, 10], res: [["768p", "768P"], ["1080p", "1080P"]], default_ratio: "16:9", default_duration: 6, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, max_prompt_length: 2000 }),
    },
    sceneModes: {},
  },
  {
    id: 1046n,
    vendor: "kling",
    name: "kling-2.1",
    displayName: "可灵 2.1",
    description: "影视级画质，能力均衡，转场流畅",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }, { name: "首尾帧" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: false,
    sort: 46,
    modeOrder: { first_last_frame: 3 },
    modes: {
      first_last_frame: video({ ep: "/web/v1/ai/image-to-video", durations: [5, 10], res: [["1080p", "1080P"]], default_ratio: "16:9", default_duration: 5, default_resolution: "1080p", counts: [1,2,3,4], limits: { image: 2 }, max_prompt_length: 2500 }),
    },
    sceneModes: {},
  },
];

/**
 * 竞品公开的真实价（`price_variants`，单位元 → 积分 = 元 × 10，PRD §10）。
 *
 * 覆盖 **11 个模型 / 75 个档位**。语义对齐 `model_prices` 的四类价：
 *   `member`  → `credits`（会员价，实扣）
 *   `strike`  → `strike_credits`（划线原价）
 *   `limited` → `time_limited_credits`（限时价）
 * 竞品的「优惠版」SKU（`model_value` 以 `_discount` 结尾）不在此表：它是同档位的另一个
 * 营销 SKU，我方用限时价字段表达，避免同一 (mode, resolution, duration) 出现两条价
 * （那会撞 `uq_model_prices`，且让扣费金额不确定）。
 */
const REAL_PRICE_SEED: {
  model: string;
  mode: string;
  resolution: string;
  duration: number | null;
  member: number;
  strike: number;
  limited: number | null;
}[] = [
  { model: "tnb-pro", mode: "text2image", resolution: "2K", duration: null, member: 10, strike: 10, limited: null },
  { model: "tnb-pro", mode: "image2image", resolution: "2K", duration: null, member: 10, strike: 10, limited: null },
  { model: "tnb-pro", mode: "multi_reference", resolution: "2K", duration: null, member: 10, strike: 10, limited: null },
  { model: "tnb-pro", mode: "text2image", resolution: "4K", duration: null, member: 15, strike: 15, limited: null },
  { model: "tnb-pro", mode: "image2image", resolution: "4K", duration: null, member: 15, strike: 15, limited: null },
  { model: "tnb-pro", mode: "multi_reference", resolution: "4K", duration: null, member: 15, strike: 15, limited: null },
  { model: "jimeng-4.0", mode: "text2image", resolution: "2K", duration: null, member: 2, strike: 2, limited: null },
  { model: "jimeng-4.0", mode: "image2image", resolution: "2K", duration: null, member: 2, strike: 2, limited: null },
  { model: "jimeng-4.0", mode: "text2image", resolution: "4K", duration: null, member: 4, strike: 4, limited: null },
  { model: "jimeng-4.0", mode: "image2image", resolution: "4K", duration: null, member: 4, strike: 4, limited: null },
  { model: "vidu-q2", mode: "universal_reference", resolution: "720p", duration: 4, member: 8, strike: 13, limited: 6 },
  { model: "vidu-q2", mode: "universal_reference", resolution: "720p", duration: 5, member: 8, strike: 14, limited: 7 },
  { model: "vidu-q2", mode: "universal_reference", resolution: "720p", duration: 8, member: 11, strike: 19, limited: 9 },
  { model: "vidu-q2", mode: "universal_reference", resolution: "1080p", duration: 4, member: 20, strike: 33, limited: 16 },
  { model: "vidu-q2", mode: "universal_reference", resolution: "1080p", duration: 5, member: 22, strike: 36, limited: 17 },
  { model: "vidu-q2", mode: "universal_reference", resolution: "1080p", duration: 8, member: 27, strike: 45, limited: 22 },
  { model: "hailuo-2.3-fast", mode: "image2video", resolution: "768p", duration: 6, member: 8, strike: 14, limited: null },
  { model: "hailuo-2.3-fast", mode: "first_frame", resolution: "768p", duration: 6, member: 8, strike: 14, limited: null },
  { model: "hailuo-2.3-fast", mode: "image2video", resolution: "768p", duration: 10, member: 14, strike: 23, limited: null },
  { model: "hailuo-2.3-fast", mode: "first_frame", resolution: "768p", duration: 10, member: 14, strike: 23, limited: null },
  { model: "hailuo-2.3-fast", mode: "image2video", resolution: "1080p", duration: 6, member: 14, strike: 23, limited: null },
  { model: "hailuo-2.3-fast", mode: "first_frame", resolution: "1080p", duration: 6, member: 14, strike: 23, limited: null },
  { model: "hailuo-2.3", mode: "text2video", resolution: "768p", duration: 6, member: 12, strike: 20, limited: null },
  { model: "hailuo-2.3", mode: "image2video", resolution: "768p", duration: 6, member: 12, strike: 20, limited: null },
  { model: "hailuo-2.3", mode: "first_frame", resolution: "768p", duration: 6, member: 12, strike: 20, limited: null },
  { model: "hailuo-2.3", mode: "text2video", resolution: "768p", duration: 10, member: 24, strike: 40, limited: null },
  { model: "hailuo-2.3", mode: "image2video", resolution: "768p", duration: 10, member: 24, strike: 40, limited: null },
  { model: "hailuo-2.3", mode: "first_frame", resolution: "768p", duration: 10, member: 24, strike: 40, limited: null },
  { model: "hailuo-2.3", mode: "text2video", resolution: "1080p", duration: 6, member: 24, strike: 40, limited: null },
  { model: "hailuo-2.3", mode: "image2video", resolution: "1080p", duration: 6, member: 24, strike: 40, limited: null },
  { model: "hailuo-2.3", mode: "first_frame", resolution: "1080p", duration: 6, member: 24, strike: 40, limited: null },
  { model: "kling-3.0", mode: "image2video", resolution: "1080p", duration: 5, member: 54, strike: 60, limited: null },
  { model: "kling-3.0", mode: "first_frame", resolution: "1080p", duration: 5, member: 54, strike: 60, limited: null },
  { model: "kling-3.0", mode: "first_last_frame", resolution: "1080p", duration: 5, member: 54, strike: 60, limited: null },
  { model: "kling-3.0", mode: "image2video", resolution: "1080p", duration: 10, member: 108, strike: 120, limited: null },
  { model: "kling-3.0", mode: "first_frame", resolution: "1080p", duration: 10, member: 108, strike: 120, limited: null },
  { model: "kling-3.0", mode: "first_last_frame", resolution: "1080p", duration: 10, member: 108, strike: 120, limited: null },
  { model: "kling-2.6", mode: "text2video", resolution: "1080p", duration: 5, member: 37, strike: 50, limited: null },
  { model: "kling-2.6", mode: "image2video", resolution: "1080p", duration: 5, member: 37, strike: 50, limited: null },
  { model: "kling-2.6", mode: "first_frame", resolution: "1080p", duration: 5, member: 37, strike: 50, limited: null },
  { model: "kling-2.6", mode: "text2video", resolution: "1080p", duration: 10, member: 75, strike: 100, limited: null },
  { model: "kling-2.6", mode: "image2video", resolution: "1080p", duration: 10, member: 75, strike: 100, limited: null },
  { model: "kling-2.6", mode: "first_frame", resolution: "1080p", duration: 10, member: 75, strike: 100, limited: null },
  { model: "kling-2.5-turbo", mode: "text2video", resolution: "1080p", duration: 5, member: 20, strike: 25, limited: null },
  { model: "kling-2.5-turbo", mode: "image2video", resolution: "1080p", duration: 5, member: 20, strike: 25, limited: null },
  { model: "kling-2.5-turbo", mode: "first_frame", resolution: "1080p", duration: 5, member: 20, strike: 25, limited: null },
  { model: "kling-2.5-turbo", mode: "text2video", resolution: "1080p", duration: 10, member: 39, strike: 50, limited: null },
  { model: "kling-2.5-turbo", mode: "image2video", resolution: "1080p", duration: 10, member: 39, strike: 50, limited: null },
  { model: "kling-2.5-turbo", mode: "first_frame", resolution: "1080p", duration: 10, member: 39, strike: 50, limited: null },
  { model: "wan-2.6", mode: "image2video", resolution: "720p", duration: 5, member: 18, strike: 30, limited: 15 },
  { model: "wan-2.6", mode: "first_frame", resolution: "720p", duration: 5, member: 18, strike: 30, limited: 15 },
  { model: "wan-2.6", mode: "image2video", resolution: "720p", duration: 10, member: 36, strike: 60, limited: 30 },
  { model: "wan-2.6", mode: "first_frame", resolution: "720p", duration: 10, member: 36, strike: 60, limited: 30 },
  { model: "wan-2.6", mode: "image2video", resolution: "720p", duration: 15, member: 54, strike: 90, limited: 45 },
  { model: "wan-2.6", mode: "first_frame", resolution: "720p", duration: 15, member: 54, strike: 90, limited: 45 },
  { model: "wan-2.6", mode: "image2video", resolution: "1080p", duration: 5, member: 30, strike: 50, limited: 25 },
  { model: "wan-2.6", mode: "first_frame", resolution: "1080p", duration: 5, member: 30, strike: 50, limited: 25 },
  { model: "wan-2.6", mode: "image2video", resolution: "1080p", duration: 10, member: 60, strike: 100, limited: 50 },
  { model: "wan-2.6", mode: "first_frame", resolution: "1080p", duration: 10, member: 60, strike: 100, limited: 50 },
  { model: "wan-2.6", mode: "image2video", resolution: "1080p", duration: 15, member: 90, strike: 150, limited: 75 },
  { model: "wan-2.6", mode: "first_frame", resolution: "1080p", duration: 15, member: 90, strike: 150, limited: 75 },
  { model: "wan-2.5", mode: "text2video", resolution: "720p", duration: 5, member: 18, strike: 30, limited: 15 },
  { model: "wan-2.5", mode: "image2video", resolution: "720p", duration: 5, member: 18, strike: 30, limited: 15 },
  { model: "wan-2.5", mode: "first_frame", resolution: "720p", duration: 5, member: 18, strike: 30, limited: 15 },
  { model: "wan-2.5", mode: "text2video", resolution: "720p", duration: 10, member: 36, strike: 60, limited: 30 },
  { model: "wan-2.5", mode: "image2video", resolution: "720p", duration: 10, member: 36, strike: 60, limited: 30 },
  { model: "wan-2.5", mode: "first_frame", resolution: "720p", duration: 10, member: 36, strike: 60, limited: 30 },
  { model: "wan-2.5", mode: "text2video", resolution: "1080p", duration: 5, member: 30, strike: 50, limited: 25 },
  { model: "wan-2.5", mode: "image2video", resolution: "1080p", duration: 5, member: 30, strike: 50, limited: 25 },
  { model: "wan-2.5", mode: "first_frame", resolution: "1080p", duration: 5, member: 30, strike: 50, limited: 25 },
  { model: "wan-2.5", mode: "text2video", resolution: "1080p", duration: 10, member: 60, strike: 100, limited: 50 },
  { model: "wan-2.5", mode: "image2video", resolution: "1080p", duration: 10, member: 60, strike: 100, limited: 50 },
  { model: "wan-2.5", mode: "first_frame", resolution: "1080p", duration: 10, member: 60, strike: 100, limited: 50 },
  { model: "kling-2.5-turbo-std", mode: "text2video", resolution: "720p", duration: 5, member: 10, strike: 15, limited: null },
  { model: "kling-2.5-turbo-std", mode: "text2video", resolution: "720p", duration: 10, member: 20, strike: 30, limited: null },
];

/**
 * 分辨率档位倍率（用于**占位价**）：优惠版 1.25 / 1080P·2K·4K 2 倍 / 其余 1 倍。
 * 仅在没有竞品真实价的档位上使用；有真实价的档位永远用真实价。
 */
const resFactor = (value: string): number => {
  if (value.includes("sale")) return 1.25;
  if (value.includes("1080") || value === "2K" || value === "4K") return 2;
  return 1;
};

/**
 * 占位价的基准锚点：只在「该 (mode, resolution, duration) 既无真实价、也无法按真实价
 * 的每秒单价派生」时使用。8 积分 / 5s / 720p 是 RE 实测锚点。
 */
const PLACEHOLDER_5S_720P = 8;

/** `${model}|${mode}|${resolution}|${duration|percall}` → 竞品真实价 */
const REAL_BY_KEY = new Map<string, (typeof REAL_PRICE_SEED)[number]>();
for (const row of REAL_PRICE_SEED) {
  REAL_BY_KEY.set(`${row.model}|${row.mode}|${row.resolution}|${row.duration ?? "percall"}`, row);
}

/** 某 (model, mode, resolution) 下竞品公布过的时长档 —— 用来「只在同档位内」派生 */
const realDurationsByRes = new Map<string, number[]>();
for (const row of REAL_PRICE_SEED) {
  if (row.duration === null) continue;
  const key = `${row.model}|${row.mode}|${row.resolution}`;
  const list = realDurationsByRes.get(key) ?? [];
  if (!list.includes(row.duration)) list.push(row.duration);
  realDurationsByRes.set(key, list);
}

const PRICE_SEED: (typeof modelPrices.$inferInsert)[] = [];
let priceSeq = 900_000;

function pushPrice(input: {
  modelId: bigint;
  mode: string;
  resolution: string;
  durationS: number | null;
  credits: number;
  strikeCredits: number;
  memberCredits: number | null;
  timeLimitedCredits: number | null;
}): void {
  PRICE_SEED.push({
    id: BigInt(++priceSeq),
    modelId: input.modelId,
    mode: input.mode,
    resolution: input.resolution,
    durationS: input.durationS,
    credits: input.credits,
    strikeCredits: input.strikeCredits,
    memberCredits: input.memberCredits,
    timeLimitedCredits: input.timeLimitedCredits,
  });
}

/**
 * 价目展开：目录里声明了哪些档位，就必须有对应价，否则 `credits.price()` 会在
 * 「no price for requested model/mode/options」上 400——用户看得见模型却永远下不了单。
 *
 * 档位来源有**两处**，必须都覆盖：
 *   1. `modes.<mode>.resolution_options` —— 画布/单点工具提交时校验的档位；
 *   2. `sceneModes.storyboard_reference_video.resolution_options` —— 分镜出片校验的档位。
 *      它是 mode 的**超集**（实测 wan-3.0 场景多一个 480p），`credits.price()` 在有 scene 时
 *      用场景档位做校验，所以场景独有的档位也必须建价，否则该分辨率下出片 100% 失败。
 *
 * 三档优先级：竞品真实价 → 同档位内按每秒单价派生 → 占位锚点价。
 */
for (const model of MODEL_SEED) {
  /** 该模型要建价的 (mode → resolution 集合) */
  const required = new Map<string, Set<string>>();
  const add = (mode: string, resolution: string): void => {
    const set = required.get(mode) ?? new Set<string>();
    set.add(resolution);
    required.set(mode, set);
  };

  for (const [mode, cfg] of Object.entries(model.modes)) {
    for (const option of cfg.resolution_options) add(mode, option.value);
  }
  for (const sceneCfg of Object.values(model.sceneModes)) {
    // `script_to_scene_refer` 只有 `{enabled:true}`，没有 mode/档位，跳过
    if (!("mode" in sceneCfg) || !sceneCfg.mode) continue;
    for (const option of sceneCfg.resolution_options) add(sceneCfg.mode, option.value);
  }

  for (const [mode, resolutions] of required) {
    const cfg = model.modes[mode];
    // 场景引用了一个该模型没有的 mode → 目录数据自相矛盾，宁可 seed 崩掉
    if (!cfg) throw new Error(`${model.name} 的场景档位引用了不存在的 mode: ${mode}`);

    if (model.capability === "text") {
      // 文本类按次计价：`resolution=per_call`、`duration_s=NULL`
      pushPrice({
        modelId: model.id,
        mode,
        resolution: "per_call",
        durationS: null,
        credits: 2,
        strikeCredits: 3,
        memberCredits: null,
        timeLimitedCredits: null,
      });
      continue;
    }

    if (model.capability === "image") {
      for (const resolution of resolutions) {
        const real = REAL_BY_KEY.get(`${model.name}|${mode}|${resolution}|percall`);
        const credits = real ? real.member : resolution === "1K" ? 2 : resolution === "2K" ? 4 : 8;
        pushPrice({
          modelId: model.id,
          mode,
          resolution,
          durationS: null,
          credits,
          strikeCredits: real ? real.strike : credits + 1,
          memberCredits: real ? real.member : null,
          timeLimitedCredits: real?.limited ?? null,
        });
      }
      continue;
    }

    // 视频类：按 (resolution, duration) 档计价。
    // ⚠️ duration 必须覆盖该 mode **声明的全部时长档**，不能只写 5s/10s：
    //    目录让用户能选 4/6/8s（TV 3.1）、3/5/8/10/12/15s（可灵 3.0），价目表却只有 5s/10s，
    //    `credits.price()` 会直接「no price for requested model/mode/options」400——
    //    用户看得见选项却永远下不了单。宁可价不准，也不能缺档。
    const declaredDurations = cfg.durations ?? [];
    if (declaredDurations.length === 0) {
      /**
       * 没有 durations 的 mode 只有 `video_edit`（竞品 `duration_source: "source_video"`）：
       * 时长由源视频决定、用户选不了，计价按「一次」而不是按秒档。因此写
       * `duration_s = NULL` 的行，与 `credits.price()` 里 `base.durations ? ... : null`
       * 的分支对齐——否则该 mode 一条价都没有，AI 改视频永远 400。
       */
      for (const resolution of resolutions) {
        const real = REAL_BY_KEY.get(`${model.name}|${mode}|${resolution}|percall`);
        const credits = real ? real.member : Math.round(PLACEHOLDER_5S_720P * resFactor(resolution));
        pushPrice({
          modelId: model.id,
          mode,
          resolution,
          durationS: null,
          credits,
          strikeCredits: real ? real.strike : Math.round(credits * 1.25),
          memberCredits: real ? real.member : null,
          timeLimitedCredits: real?.limited ?? null,
        });
      }
      continue;
    }

    for (const resolution of resolutions) {
      const realDurations = realDurationsByRes.get(`${model.name}|${mode}|${resolution}`) ?? [];
      const tiers = new Set<number>(declaredDurations);
      for (const d of realDurations) tiers.add(d);
      if (tiers.size === 0) continue;

      // 真实价的「最小时长档」作为每秒单价锚点：派生只在同 (mode, resolution) 内做，
      // 不跨分辨率/跨模型编造，避免 720P 的单价被 1080P 的价格污染
      const anchor = [...realDurations].sort((a, b) => a - b)[0];
      const anchorRow =
        anchor === undefined ? undefined : REAL_BY_KEY.get(`${model.name}|${mode}|${resolution}|${anchor}`);

      for (const duration of [...tiers].sort((a, b) => a - b)) {
        const real = REAL_BY_KEY.get(`${model.name}|${mode}|${resolution}|${duration}`);
        if (real) {
          pushPrice({
            modelId: model.id,
            mode,
            resolution,
            durationS: duration,
            credits: real.member,
            strikeCredits: real.strike,
            memberCredits: real.member,
            timeLimitedCredits: real.limited,
          });
          continue;
        }
        if (anchorRow && anchor !== undefined && anchor > 0) {
          const memberPerS = anchorRow.member / anchor;
          const strikePerS = anchorRow.strike / anchor;
          const credits = Math.max(1, Math.round(memberPerS * duration));
          const strike = Math.max(credits, Math.round(strikePerS * duration));
          pushPrice({
            modelId: model.id,
            mode,
            resolution,
            durationS: duration,
            credits,
            strikeCredits: strike,
            memberCredits: credits,
            timeLimitedCredits:
              anchorRow.limited === null
                ? null
                : Math.max(1, Math.round((anchorRow.limited / anchor) * duration)),
          });
          continue;
        }
        const base = Math.round((PLACEHOLDER_5S_720P * duration) / 5);
        const credits = Math.round(base * resFactor(resolution));
        pushPrice({
          modelId: model.id,
          mode,
          resolution,
          durationS: duration,
          credits,
          strikeCredits: Math.round(credits * 1.25),
          memberCredits: null,
          timeLimitedCredits: null,
        });
      }
    }
  }
}

// 支付 SKU 目录（PRD §10）：10 积分 = 1 元，Alpha/Beta 期不打折
type SkuSeed = {
  sku: string;
  label: string;
  priceCents: number;
  credits: number;
  /** credits = 充值包（默认）；vip = 订阅档（第 23 项计费补齐） */
  kind?: "credits" | "vip";
  /** 订阅周期：month / quarter / halfyear / year（订阅档才有） */
  period?: string;
};

/**
 * SKU 目录：4 档充值包 + **13 档订阅**（对照竞品 VIP / DF-VIP 13 档，
 * `docs/01-product/_parts/d-commerce-account.md`）。档位结构对齐（标准 VIP / DF-VIP /
 * Pro / Studio 四线 × 月季半年年），**具体价格自建、不抄竞品数字**（ADR-013 决策 3）。
 */
const SKU_SEED: SkuSeed[] = [
  { sku: "credits-500", label: "500 积分", priceCents: 5000, credits: 500 },
  { sku: "credits-1000", label: "1000 积分", priceCents: 10000, credits: 1000 },
  { sku: "credits-3000", label: "3000 积分", priceCents: 30000, credits: 3000 },
  { sku: "credits-6000", label: "6000 积分", priceCents: 60000, credits: 6000 },

  { sku: "vip-month", label: "标准会员 · 月", priceCents: 3900, credits: 600, kind: "vip", period: "month" },
  { sku: "vip-quarter", label: "标准会员 · 季", priceCents: 9900, credits: 1800, kind: "vip", period: "quarter" },
  { sku: "vip-halfyear", label: "标准会员 · 半年", priceCents: 17900, credits: 3600, kind: "vip", period: "halfyear" },
  { sku: "vip-year", label: "标准会员 · 年", priceCents: 29900, credits: 7200, kind: "vip", period: "year" },

  { sku: "df-vip-month", label: "DF 会员 · 月", priceCents: 6900, credits: 1200, kind: "vip", period: "month" },
  { sku: "df-vip-quarter", label: "DF 会员 · 季", priceCents: 17900, credits: 3600, kind: "vip", period: "quarter" },
  { sku: "df-vip-year", label: "DF 会员 · 年", priceCents: 59900, credits: 14400, kind: "vip", period: "year" },

  { sku: "pro-month", label: "Pro 会员 · 月", priceCents: 12900, credits: 2400, kind: "vip", period: "month" },
  { sku: "pro-year", label: "Pro 会员 · 年", priceCents: 99900, credits: 28800, kind: "vip", period: "year" },

  { sku: "studio-month", label: "Studio 会员 · 月", priceCents: 29900, credits: 6000, kind: "vip", period: "month" },
  { sku: "studio-year", label: "Studio 会员 · 年", priceCents: 249900, credits: 72000, kind: "vip", period: "year" },
];

async function main(): Promise<void> {
  const modelIds = MODEL_SEED.map((m) => m.id);
  await db.transaction(async (tx) => {
    for (const model of MODEL_SEED) {
      const { id: _id, ...updatable } = model;
      await tx
        .insert(models)
        .values(model)
        .onConflictDoUpdate({ target: models.name, set: updatable });
    }
    /**
     * 价格按 model 维度重建（delete + insert），而不是 upsert。
     *
     * 为什么：`uq_model_prices` 含 `duration_s`，而 PostgreSQL 把 NULL 视为互不相同，
     * 按次计价的档位无法靠该唯一键去重（详见 schema.ts 里 `uq_model_prices_per_call`
     * 部分索引的注释）。整段重建才是幂等的——连续跑两次 seed，价格行数不变。
     */
    await tx.delete(modelPrices).where(inArray(modelPrices.modelId, modelIds));
    if (PRICE_SEED.length > 0) {
      await tx.insert(modelPrices).values(PRICE_SEED);
    }
  });

  // SKU 目录：按 sku 唯一键 upsert，幂等
  for (const s of SKU_SEED) {
    await db
      .insert(skus)
      .values({
        id: BigInt(Date.now()) * 1000n + BigInt(SKU_SEED.indexOf(s)),
        kind: s.kind ?? "credits",
        period: s.period ?? null,
        active: true,
        sku: s.sku,
        label: s.label,
        priceCents: s.priceCents,
        credits: s.credits,
      })
      .onConflictDoUpdate({
        target: skus.sku,
        set: {
          kind: s.kind ?? "credits",
          period: s.period ?? null,
          label: s.label,
          priceCents: s.priceCents,
          credits: s.credits,
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`[seed] models=${MODEL_SEED.length}, prices=${PRICE_SEED.length}, skus=${SKU_SEED.length}`);
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exitCode = 1;
});
