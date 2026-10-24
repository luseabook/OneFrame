import { inArray } from "drizzle-orm";
import { db } from "./database";
import { modelPrices, models } from "@app/db";

// 种子数据：首批 10 个模型（从 RE 46 模型目录中选型，见 docs/02-architecture/database.md §2）
// ⚠️ 价格均为 PLACEHOLDER（按 RE 实测锚点：文生视频 5s/720p = 8 积分；1080P≈×2）。
//    定价 owner 决策后通过 admin 热更（model_prices），无需改代码。

type Res = { value: string; label: string };
type ModeCfg = {
  endpoint: string;
  ratios?: string[];
  durations?: number[];
  default_duration?: number;
  resolution_options: Res[];
  resolutions: string[];
  default_resolution?: string;
  counts?: number[];
  default_count?: number;
  media_limits?: Record<string, number>;
  mouth_drive?: string;
  off_peak?: boolean;
};
type ModelSeed = {
  id: bigint;
  vendor: string;
  name: string;
  displayName: string;
  description: string;
  logo: string;
  capability: string;
  types: string[];
  tags: { name: string }[];
  promotions: string[];
  adapterCode: string;
  visible: boolean;
  needVip: boolean;
  audioVideoSupport: boolean;
  sort: number;
  modeOrder: Record<string, number>;
  modes: Record<string, ModeCfg>;
  sceneModes: Record<string, unknown>;
};

const R_720_1080: Res[] = [
  { value: "720p", label: "720P" },
  { value: "1080p", label: "1080P" },
];
const R_SALE: Res[] = [
  { value: "720p_sale", label: "1080P优惠版" },
  { value: "720p", label: "720P" },
  { value: "1080p", label: "1080P" },
];
const R_1080: Res[] = [{ value: "1080p", label: "1080P" }];
const R_IMG: Res[] = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];
const RATIOS = ["16:9", "9:16", "1:1"];

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const videoMode = (
  endpoint: string,
  durations: number[] | null,
  res: Res[] = R_720_1080,
  ratios: string[] = RATIOS,
): ModeCfg => ({
  endpoint,
  ratios,
  ...(durations ? { durations, default_duration: 5 } : {}),
  resolution_options: res,
  resolutions: res.map((r) => r.value),
  default_resolution: res[0]?.value,
  counts: [1, 2, 3, 4],
  default_count: 1,
  media_limits: { image: 9, video: 3, audio: 3, total: 12 },
  mouth_drive: "optional",
  off_peak: false,
});

const imageMode = (endpoint: string, res: Res[] = R_IMG, ratios: string[] = ["1:1", "16:9", "9:16"]): ModeCfg => ({
  endpoint,
  ratios,
  resolution_options: res,
  resolutions: res.map((r) => r.value),
  default_resolution: res[0]?.value,
  counts: [1, 2, 3, 4],
  default_count: 1,
});

const storyboardScene = (durations: number[], res: Res[] = R_SALE) => ({
  durations,
  ratios: RATIOS,
  resolution_options: res,
  resolutions: res.map((r) => r.value),
  default_duration: 5,
  default_resolution: res[0]?.value,
  media_limits: { image: 9, video: 3, audio: 3, total: 12 },
  mouth_drive: "optional",
  off_peak: false,
});

const MODEL_SEED: ModelSeed[] = [
  {
    id: 1001n,
    vendor: "jimeng",
    name: "seedance-2.5",
    displayName: "Seedance 2.5",
    description: "全能视频模型，支持多参考/延长/编辑",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-30s" }, { name: "音频生成" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 10,
    modeOrder: { universal_reference: 0, video_extend: 0, video_edit: 4 },
    modes: {
      universal_reference: videoMode("/web/v1/ai/refer-media-to-video", range(4, 30), R_SALE),
      video_extend: videoMode("/web/v1/ai/video-to-video", range(4, 30), R_SALE),
      video_edit: videoMode("/web/v1/ai/refer-video-to-video", null, R_SALE),
    },
    sceneModes: {
      storyboard_reference_video: storyboardScene(range(4, 30), R_SALE),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1002n,
    vendor: "jimeng",
    name: "seedance-2.0-vip",
    displayName: "Seedance 2.0 VIP",
    description: "影视级画质，首帧/首尾帧/参考生视频",
    logo: "models/ic24_jimeng.svg",
    capability: "video",
    types: ["video"],
    tags: [{ name: "4-15s" }, { name: "音频生成" }],
    promotions: [],
    adapterCode: "volcengine:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 11,
    modeOrder: { first_frame: 1, first_last_frame: 0, image2video: 1, universal_reference: 1, video_edit: 5 },
    modes: {
      image2video: videoMode("/web/v1/ai/image-to-video", range(4, 15)),
      first_frame: videoMode("/web/v1/ai/image-to-video", range(4, 15)),
      first_last_frame: videoMode("/web/v1/ai/image-to-video", range(4, 15)),
      universal_reference: videoMode("/web/v1/ai/refer-media-to-video", range(4, 15), R_SALE),
      video_edit: videoMode("/web/v1/ai/refer-video-to-video", null, R_720_1080),
    },
    sceneModes: {
      storyboard_reference_video: storyboardScene(range(4, 15), R_SALE),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1003n,
    vendor: "tomoviee",
    name: "tgi-2",
    displayName: "TGI 2",
    description: "自营图像模型（文生图/图生图/多参考）",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [{ name: "生图" }],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 20,
    modeOrder: { image2image: 0, multi_reference: 0, text2image: 0 },
    modes: {
      text2image: imageMode("/web/v1/ai/text-to-image"),
      image2image: imageMode("/web/v1/ai/refer-image-to-image"),
      multi_reference: imageMode("/web/v1/ai/refer-image-to-image"),
    },
    sceneModes: {},
  },
  {
    id: 1004n,
    vendor: "tomoviee",
    name: "tgi-2.5-flare",
    displayName: "TGI 2.5 Flare",
    description: "资产生图专用（角色/场景/道具）",
    logo: "models/tomoviee.png",
    capability: "image",
    types: ["image"],
    tags: [{ name: "资产" }],
    promotions: [],
    adapterCode: "tomoviee:image",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 21,
    modeOrder: { studio_asset_image: 0 },
    modes: {
      studio_asset_image: imageMode("/web/v1/ai/text-to-image"),
    },
    sceneModes: {},
  },
  {
    id: 1005n,
    vendor: "tomoviee",
    name: "sky-media-2.0",
    displayName: "天幕2.0",
    description: "最优惠视频模型，5s 固定时长",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5s" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 30,
    modeOrder: { first_frame: 17, first_last_frame: 7, image2video: 17, text2video: 0 },
    modes: {
      text2video: videoMode("/web/v1/ai/text-to-video", [5], R_720_1080, ["16:9", "9:16", "4:3", "3:4", "1:1"]),
      image2video: videoMode("/web/v1/ai/image-to-video", [5], R_720_1080),
      first_frame: videoMode("/web/v1/ai/image-to-video", [5], R_720_1080),
      first_last_frame: videoMode("/web/v1/ai/image-to-video", [5], R_720_1080),
    },
    sceneModes: {},
  },
  {
    id: 1006n,
    vendor: "tomoviee",
    name: "sky-media-2.1",
    displayName: "天幕2.1",
    description: "电影质感文生视频",
    logo: "models/tomoviee.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5s" }],
    promotions: [],
    adapterCode: "tomoviee:video",
    visible: true,
    needVip: false,
    audioVideoSupport: true,
    sort: 31,
    modeOrder: { text2video: 1 },
    modes: {
      text2video: videoMode("/web/v1/ai/text-to-video", [5], R_720_1080, ["16:9", "9:16", "4:3", "3:4", "1:1"]),
    },
    sceneModes: {},
  },
  {
    id: 1007n,
    vendor: "kling",
    name: "kling-2.6",
    displayName: "可灵2.6",
    description: "影视级画质，5/10s，1080P",
    logo: "models/kling.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "5-10s" }],
    promotions: [],
    adapterCode: "kling:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 40,
    modeOrder: { first_frame: 10, image2video: 10, text2video: 2 },
    modes: {
      text2video: videoMode("/web/v1/ai/text-to-video", [5, 10], R_1080, ["16:9", "9:16", "1:1"]),
      image2video: videoMode("/web/v1/ai/image-to-video", [5, 10], R_1080),
      first_frame: videoMode("/web/v1/ai/image-to-video", [5, 10], R_1080),
    },
    sceneModes: {},
  },
  {
    id: 1008n,
    vendor: "vidu",
    name: "vidu-q2",
    displayName: "Vidu Q2",
    description: "主体一致性控制，1-8s",
    logo: "models/vidu.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "1-8s" }],
    promotions: [],
    adapterCode: "vidu:video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 50,
    modeOrder: { first_frame: 3, first_last_frame: 4, image2video: 3, universal_reference: 11 },
    modes: {
      image2video: videoMode("/web/v1/ai/image-to-video", range(1, 8), R_SALE),
      first_frame: videoMode("/web/v1/ai/image-to-video", range(1, 8), R_SALE),
      first_last_frame: videoMode("/web/v1/ai/image-to-video", range(1, 8), R_SALE),
      universal_reference: videoMode("/web/v1/ai/refer-image-to-video", range(1, 8), R_SALE),
    },
    sceneModes: { storyboard_reference_video: storyboardScene(range(1, 8), R_SALE) },
  },
  {
    id: 1009n,
    vendor: "wan",
    name: "wan-3.0",
    displayName: "Wan 3.0",
    description: "多参考视频，2-30s",
    logo: "models/wan.png",
    capability: "video",
    types: ["video"],
    tags: [{ name: "2-30s" }],
    promotions: [],
    adapterCode: "aliyun:video",
    visible: true,
    needVip: true,
    audioVideoSupport: true,
    sort: 60,
    modeOrder: { universal_reference: 3, script_to_scene_refer: 2 },
    modes: {
      universal_reference: videoMode("/web/v1/ai/refer-media-to-video", range(2, 30), R_720_1080),
    },
    sceneModes: {
      storyboard_reference_video: storyboardScene(range(2, 30), R_720_1080),
      script_to_scene_refer: { enabled: true },
    },
  },
  {
    id: 1010n,
    vendor: "deepseek",
    name: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    description: "剧本/大纲/分镜 LLM",
    logo: "models/deepseek.svg",
    capability: "text",
    types: ["file"],
    tags: [{ name: "LLM" }],
    promotions: [],
    adapterCode: "deepseek:chat",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 200,
    modeOrder: {},
    modes: {},
    sceneModes: {},
  },
];

const resFactor = (value: string): number => {
  if (value.includes("sale")) return 1.25;
  if (value.includes("1080") || value === "2K" || value === "4K") return 2;
  return 1;
};

const PRICE_SEED: (typeof modelPrices.$inferInsert)[] = [];
let priceSeq = 900_000;

for (const model of MODEL_SEED) {
  for (const [mode, cfg] of Object.entries(model.modes)) {
    if (model.capability === "video") {
      for (const dur of cfg.durations ?? []) {
        if (![5, 10].includes(dur)) continue;
        for (const r of cfg.resolution_options) {
          const base = Math.round((8 * dur) / 5);
          const credits = Math.round(base * resFactor(r.value));
          PRICE_SEED.push({
            id: BigInt(++priceSeq),
            modelId: model.id,
            mode,
            resolution: r.value,
            durationS: dur,
            credits,
            strikeCredits: Math.round(credits * 1.25),
          });
        }
      }
    } else if (model.capability === "image") {
      for (const r of cfg.resolution_options) {
        const credits = r.value === "1K" ? 2 : r.value === "2K" ? 4 : 8;
        PRICE_SEED.push({
          id: BigInt(++priceSeq),
          modelId: model.id,
          mode,
          resolution: r.value,
          durationS: null,
          credits,
          strikeCredits: credits + 1,
        });
      }
    }
  }
}

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
    // 价格按 model 维度重建（NULL duration_s 在唯一索引中不参与去重，seed 用 delete+insert 保证幂等）
    await tx.delete(modelPrices).where(inArray(modelPrices.modelId, modelIds));
    if (PRICE_SEED.length > 0) {
      await tx.insert(modelPrices).values(PRICE_SEED);
    }
  });

  console.log(`[seed] models=${MODEL_SEED.length}, prices=${PRICE_SEED.length} (PLACEHOLDER pricing)`);
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exitCode = 1;
});
