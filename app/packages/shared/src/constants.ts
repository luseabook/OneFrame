// 领域枚举（api-spec §5/§6，database.md 同步）

export const TaskStatus = {
  PENDING: 1,
  RUNNING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  CANCELED: 5,
  REVIEWING: 6,
  REVIEW_REJECTED: 7,
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// 对用户可见的状态归并（前端只认这四态 + 审核两态）
export const UserFacingStatus = {
  [TaskStatus.PENDING]: "queued",
  [TaskStatus.RUNNING]: "running",
  [TaskStatus.REVIEWING]: "running",
  [TaskStatus.SUCCEEDED]: "succeeded",
  [TaskStatus.FAILED]: "failed",
  [TaskStatus.CANCELED]: "canceled",
  [TaskStatus.REVIEW_REJECTED]: "rejected",
} as const;

export const Capability = {
  VIDEO: "video",
  IMAGE: "image",
  TEXT: "text",
  SPEECH: "speech",
  MUSIC: "music",
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

// v1 generation mode 全集（api-spec §5；ADR-003：差异在参数不在端点）
// 覆盖 RE 的 11 个 generation mode；后处理类（video_upscale 等）不进生成枚举（Ph2 独立能力）
export const VideoMode = [
  "text2video",
  "image2video",
  "first_frame",
  "first_last_frame",
  "universal_reference",
  "video_extend",
  "video_edit",
] as const;
export const ImageMode = [
  "text2image",
  "image2image",
  "multi_reference",
  "studio_asset_image", // 资产生图（角色/场景/道具）；RE 中仅部分模型支持
  "upscale",
  "outpaint",
  "inpaint",
  "erase",
] as const;
export const SpeechMode = ["tts", "voice_clone"] as const;

export const GenerationMode = [...VideoMode, ...ImageMode, ...SpeechMode] as const;
export type GenerationMode = (typeof GenerationMode)[number];

// 流水线 scene 键（api-spec §5）：仅两个；studio_asset_image 是 mode，不是 scene 键
export const SceneKey = ["script_to_scene_refer", "storyboard_reference_video"] as const;
export type SceneKey = (typeof SceneKey)[number];

// 常用展示值；实际合法性一律以模型目录 modes/scene 枚举为准（不得假设所有模型共享）
export const Ratio = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type Ratio = (typeof Ratio)[number];

export const Resolution = ["480p", "720p", "1080p", "2K", "4K"] as const;
export type Resolution = (typeof Resolution)[number];

// 不写 expire：Alpha/Beta 积分不设有效期（database §4；若引入有效期再新增 kind 并同步不变式）
export const CreditFlowKind = [
  "recharge",
  "gift",
  "freeze",
  "settle",
  "unfreeze",
  "adjust",
] as const;
export type CreditFlowKind = (typeof CreditFlowKind)[number];

// 剧目类型（对齐参照产品「新建项目」三种选项）：
// 1 国内仿真人剧 / 2 海外仿真人剧 / 3 2D/3D 动漫
// 兼容：LIVE 为旧代码别名（=1）；旧 ANIME=2 的历史数据由迁移 0010 修正为 3
export const DramaType = { LIVE: 1, DOMESTIC_LIVE: 1, OVERSEAS_LIVE: 2, ANIME: 3 } as const;
export type DramaType = (typeof DramaType)[keyof typeof DramaType];
// 新建项目可选画面比例（参照产品只提供两种）
export const PROJECT_RATIOS = ["9:16", "16:9"] as const;
export type ProjectRatio = (typeof PROJECT_RATIOS)[number];
// PRD F2①：1 粘贴小说 / 2 一句话想法 / 3 导入剧本拆集 / 4 二创裂变（Ph3 预留）
export const ProjectSourceType = { NOVEL: 1, IDEA: 2, SCRIPT: 3, FISSION: 4 } as const;
export type ProjectSourceType = (typeof ProjectSourceType)[keyof typeof ProjectSourceType];

// 资产状态（database §3）：1 草稿 / 2 已定稿（可被分镜引用）
export const ProjectAssetStatus = { DRAFT: 1, FINALIZED: 2 } as const;
export type ProjectAssetStatus = (typeof ProjectAssetStatus)[keyof typeof ProjectAssetStatus];

// 分镜时长：仅存储；投递时按所选模型 scene.storyboard_reference_video.durations
// 校验并就近取合法低档（RE：各模型时长集合不同）
export const STORYBOARD_DURATION_DEFAULT = 5;
export const STORYBOARD_DURATION_MIN = 1;
export const STORYBOARD_DURATION_MAX = 30;

export const LIMITS = {
  PROMPT_MAX: 2000,
  NOVEL_MAX: 50000,
  REFERENCE_URIS_MAX: 3,
  SHOT_COUNT_MAX: 30,
  COUNT_MAX: 4,
  DURATION_MIN: 1, // 模型侧外边界；具体枚举由模型目录给出
  DURATION_MAX: 30,
  EPISODE_MAX: 20,
  CHARACTER_MAX: 10, // 角色卡上限（PRD F2 ≤10 张）
} as const;
