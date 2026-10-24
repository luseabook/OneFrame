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

// v1 mode 全集（api-spec §5；ADR-003：差异在参数不在端点）
export const VideoMode = [
  "text2video",
  "image2video",
  "first_frame",
  "first_last_frame",
  "universal_reference",
  "video_extend",
  "video_edit",
  "video_upscale",
] as const;
export const ImageMode = [
  "text2image",
  "image2image",
  "multi_reference",
  "upscale",
  "outpaint",
  "inpaint",
  "erase",
] as const;
export const SpeechMode = ["tts", "voice_clone"] as const;

export const GenerationMode = [...VideoMode, ...ImageMode, ...SpeechMode] as const;
export type GenerationMode = (typeof GenerationMode)[number];

export const Ratio = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type Ratio = (typeof Ratio)[number];

export const Resolution = ["480p", "720p", "1080p", "2K", "4K"] as const;
export type Resolution = (typeof Resolution)[number];

export const CreditFlowKind = [
  "recharge",
  "gift",
  "freeze",
  "settle",
  "unfreeze",
  "expire",
  "adjust",
] as const;
export type CreditFlowKind = (typeof CreditFlowKind)[number];

export const DramaType = { LIVE: 1, ANIME: 2 } as const; // 真人 / 动漫（PRD F2）
export const ProjectSourceType = { NOVEL: 1, IDEA: 2 } as const;

// 分镜时长枚举档位（对齐视频生成模型时长档位，生成下限 4s；api-spec §8 / database.md）
export const STORYBOARD_DURATIONS = [4, 5, 6, 8, 10] as const;
export type StoryboardDuration = (typeof STORYBOARD_DURATIONS)[number];

export const LIMITS = {
  PROMPT_MAX: 2000,
  NOVEL_MAX: 50000,
  REFERENCE_URIS_MAX: 3,
  SHOT_COUNT_MAX: 30,
  COUNT_MAX: 4,
  DURATION_MIN: 4,
  DURATION_MAX: 30,
  EPISODE_MAX: 20,
  CHARACTER_MAX: 10, // 角色卡上限（PRD F2 ≤10 张）
} as const;
