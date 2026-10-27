import { z } from "zod";

/**
 * 广告剧（drama_ad）口径常量与 LLM 输出 schema。
 *
 * 竞品证据（逐条可对行号）：
 * - 12 端点：`rea-reelmate/routes.txt:680-691`（`df/script_project/drama_ad/*`）
 * - 页面：`routes.txt:11-12`（`/ad-drama/create`、`/ad-drama/workspace`）
 * - 五段语义：`docs/01-product/reelmate-feature-map.md:267`
 *   「商品图 + 卖点 → brief → 剧本 → 分镜（`brief`/`selling-point`/`script`/`storyboard`/`asset` 五段）」
 * - 参数名与流程细节：`_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/ad.md`
 *   （`material_name`/`material_highlight`/`material_image`/`style`/`ratio`/`sp_type`/
 *   `theme`/`group_ids`/`brief_id`/`need_voice`/`template_type`，见该文件 :57-67、:117、:133、:149）
 */

/** 竞品把项目类型写成 `sp_type=2`（`commands/ad.md:64`）；我方落 `script_projects.project_mode=2` */
export const AD_PROJECT_MODE = 2;
/** 竞品 `ad save` 明确要求 `sp_type` 当前只用 2（`commands/ad.md:64-66`），原样记录以便溯源 */
export const AD_SP_TYPE = 2;

/** 画幅：竞品只允许这两种（`commands/ad.md:63`） */
export const AD_RATIOS = ["9:16", "16:9"] as const;

/**
 * 五段（`feature-map.md:267` 的 brief / selling-point / script / storyboard / asset）。
 *
 * 顺序是我方对「先卖点后方案」的解读：卖点是素材理解，方案（brief）是创意选择，
 * 之后才是剧本/分镜/资产。竞品的 `STAGE` 值域**未取证**（CLI 只打印 `STAGE` 列，
 * `commands/ad.md:41`，没有任何取值样例）→ 这里显式登记为「我方定义」。
 */
export const AD_STAGES = [
  { stage: 1, key: "selling_point", name: "卖点" },
  { stage: 2, key: "brief", name: "剧情方案" },
  { stage: 3, key: "script", name: "剧本" },
  { stage: 4, key: "storyboard", name: "分镜" },
  { stage: 5, key: "asset", name: "资产" },
] as const;

export type AdStageKey = (typeof AD_STAGES)[number]["key"];

/** 项目状态（我方定义，待取证：竞品 `info` 的 `STATUS` 取值未取证） */
export const AD_STATUS = {
  ACTIVE: 1,
  COMPLETED: 2,
} as const;

export const AD_STATUS_LABEL: Record<number, string> = {
  1: "进行中",
  2: "已完成",
};

/**
 * 每个生成动作**借用哪个 LLM 计价模式**（不新造 mode，避免目录里出现没有价的模式）。
 *
 * 三个 mode 都在文本模型目录里且按次计价（`seed.ts:218-222`，`capability==="text"` 时
 * 统一写 `resolution=per_call`、2 积分/次，见 `seed.ts:1486-1498`）：
 * - `script_optimization`：卖点 / brief / 剧本 / 编辑 / 资产提示词（都是"改写文本"）
 * - `storyboard_parse`：分镜规划（与剧本流水线的分镜解析同口径）
 * - `asset_extraction`：资产抽取（与剧本流水线一致）
 *
 * 为什么不干脆免费：task-16 明确「生成动作必须走既有 credits/quote + tasks 记账（不白送）」，
 * 而文本模型在目录里**本来就有价**，免费反而会让"广告剧比短剧便宜"变成一个隐藏补贴。
 */
export const AD_LLM_MODE = {
  selling_point: "script_optimization",
  brief: "script_optimization",
  script: "script_optimization",
  script_edit: "script_optimization",
  image_tips: "script_optimization",
  storyboard: "storyboard_parse",
  asset_extract: "asset_extraction",
} as const;

export type AdLlmAction = keyof typeof AD_LLM_MODE;

export const AD_ACTION_LABEL: Record<AdLlmAction, string> = {
  selling_point: "生成卖点",
  brief: "生成剧情方案",
  script: "生成广告脚本",
  script_edit: "编辑广告脚本",
  image_tips: "生成资产提示词",
  storyboard: "生成分镜",
  asset_extract: "抽取广告资产",
};

/** `mode_meta` 大小上限（服务端不解析语义，但要防"塞文件"把 jsonb 撑爆） */
export const AD_MODE_META_MAX_BYTES = 64 * 1024;

/** brief 候选数量（竞品"生成多个 brief 候选"，具体条数未取证 → 我方给 3 条并允许 1~5） */
export const AD_BRIEF_CANDIDATES = 3;
/** 分镜镜头数默认值（竞品 `template_type` 只分急速/至尊两档，不给镜数 → 我方按档位给默认） */
export const AD_SHOT_COUNT = { fast: 6, premium: 10 } as const;

// ── LLM 输出 schema（强约束；real 模式下过 zod + 输出审核）─────────────

export const sellingPointsResultSchema = z.object({
  selling_points: z.array(z.string().min(1).max(120)).min(1).max(8),
});
export type SellingPointsResult = z.infer<typeof sellingPointsResultSchema>;

export const adBriefSchema = z.object({
  title: z.string().min(1).max(60),
  /** 一句话立意（logline） */
  logline: z.string().min(1).max(300),
  /** 剧情节拍 3~5 条 */
  beats: z.array(z.string().min(1).max(200)).min(1).max(6),
  tone: z.string().max(40).default(""),
});
export type AdBrief = z.infer<typeof adBriefSchema> & { id: string };

export const adBriefsResultSchema = z.object({
  briefs: z.array(adBriefSchema).min(1).max(5),
});
export type AdBriefsResult = z.infer<typeof adBriefsResultSchema>;

export const adScriptResultSchema = z.object({
  script_text: z.string().min(1).max(20_000),
});
export type AdScriptResult = z.infer<typeof adScriptResultSchema>;

export const adStoryboardsResultSchema = z.object({
  storyboards: z
    .array(
      z.object({
        shot_no: z.number().int().min(1),
        shot_desc: z.string().min(1).max(500),
        video_prompt: z.string().min(1).max(1000),
        duration_s: z.number().int().min(1).max(30).default(5),
      }),
    )
    .min(1)
    .max(30),
});
export type AdStoryboardsResult = z.infer<typeof adStoryboardsResultSchema>;

export const adImageTipsResultSchema = z.object({
  tips: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        prompt: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(30),
});
export type AdImageTipsResult = z.infer<typeof adImageTipsResultSchema>;

/**
 * 资产抽取结果。
 *
 * `kind` 取值域跟 `project_assets.kind` 一致（character|scene|prop，schema.ts:511）。
 * 商品本体的 `ref_image_uri` 直接取 `material_image`——广告片主角是商品，
 * 让 LLM"抽"商品名反而可能抽错（它只知道名字）。
 */
export const adAssetResultSchema = z.object({
  assets: z
    .array(
      z.object({
        kind: z.enum(["character", "scene", "prop"]),
        name: z.string().min(1).max(80),
        description: z.string().max(300).default(""),
        prompt: z.string().max(1000).default(""),
        ref_image_uri: z.string().max(2048).nullable().default(null),
      }),
    )
    .min(1)
    .max(20),
});
export type AdAssetResult = z.infer<typeof adAssetResultSchema>;

/** `mode_meta` 的形状（**只在本模块内使用**；库里是 jsonb，不建列） */
export interface AdModeMeta {
  material: {
    /** 竞品 `material_name`（`commands/ad.md:59`） */
    name: string;
    /** 竞品 `material_highlight`（`:60`） */
    highlight: string;
    /** 竞品 `material_image`（`:61`）= 已上传商品图；我方存 asset id 或 uri */
    image: string;
    /** 竞品 `style`（`:62`）风格 ID */
    style: string;
    /** 竞品 `ratio`（`:63`）9:16 | 16:9 */
    ratio: string;
    /** 竞品 `sp_type`（`:64`）原样留痕 */
    sp_type: number;
    /** 竞品 `theme`（`:65`）可选主题 ID */
    theme?: string;
    /** 竞品 `group_ids`（`:66`）可选分组串 */
    group_ids?: string;
  };
  selling_points: string[];
  briefs: AdBrief[];
  selected_brief: string | null;
  script: { text: string; edited_at?: string; reset_at?: string } | null;
  storyboard: { template_type?: number; shot_count: number; generated_at: string } | null;
  image_tips: Array<{ name: string; prompt: string; asset_id?: string }>;
  /** 竞品 `ad asset` 的 `need_voice`（1 生成配音 / 2 不生成，`commands/ad.md:133`）原样留痕 */
  asset: { need_voice?: number } | null;
  /** 我方定义（竞品 STAGE 值域未取证） */
  stage: number;
  /** 我方定义（竞品 STATUS 值域未取证） */
  status: number;
  /** 最近一次动作用途留痕（便于 info 回答"这一步花了多少积分"） */
  charges: Array<{ action: string; credits: number; task_id: string; at: string }>;
}

export function emptyAdMeta(material: AdModeMeta["material"]): AdModeMeta {
  return {
    material,
    selling_points: [],
    briefs: [],
    selected_brief: null,
    script: null,
    storyboard: null,
    image_tips: [],
    asset: null,
    stage: 1,
    status: AD_STATUS.ACTIVE,
    charges: [],
  };
}

/** 宽容读取：库里 jsonb 可能来自旧版本/人工写入，缺字段一律补默认而不是抛错 */
export function readAdMeta(raw: unknown): AdModeMeta {
  const meta = (raw ?? {}) as Partial<AdModeMeta>;
  const material = (meta.material ?? {}) as Partial<AdModeMeta["material"]>;
  return {
    material: {
      name: String(material.name ?? ""),
      highlight: String(material.highlight ?? ""),
      image: String(material.image ?? ""),
      style: String(material.style ?? ""),
      ratio: String(material.ratio ?? "9:16"),
      sp_type: Number(material.sp_type ?? AD_SP_TYPE),
      ...(material.theme ? { theme: String(material.theme) } : {}),
      ...(material.group_ids ? { group_ids: String(material.group_ids) } : {}),
    },
    selling_points: Array.isArray(meta.selling_points) ? meta.selling_points : [],
    briefs: Array.isArray(meta.briefs) ? meta.briefs : [],
    selected_brief: meta.selected_brief ?? null,
    script: meta.script ?? null,
    storyboard: meta.storyboard ?? null,
    image_tips: Array.isArray(meta.image_tips) ? meta.image_tips : [],
    asset: meta.asset ?? null,
    stage: Number(meta.stage ?? 1),
    status: Number(meta.status ?? AD_STATUS.ACTIVE),
    charges: Array.isArray(meta.charges) ? meta.charges : [],
  };
}

export function assertMetaSize(meta: AdModeMeta): void {
  const bytes = Buffer.byteLength(JSON.stringify(meta), "utf8");
  if (bytes > AD_MODE_META_MAX_BYTES) {
    throw new Error(`mode_meta too large: ${bytes} > ${AD_MODE_META_MAX_BYTES}`);
  }
}
