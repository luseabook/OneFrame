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
  // 文字重绘（工具箱「文字重绘」卡）：保留画面结构、替换画面里的文字。
  // 与 `inpaint` 的差别是**指令来源**：inpaint 给蒙版（改哪儿），文字重绘给文字内容（改成什么），
  // 因此它是独立 mode 而不是 inpaint 的参数——计价口径也不同（按次 vs 按面积）。
  "text_repaint",
] as const;
export const SpeechMode = ["tts", "voice_clone"] as const;

/**
 * 音乐 / 音效 / 音频后处理模式（第 3 批工具箱）。
 *
 * 为什么独立成组而不是塞进 `SpeechMode`：`SpeechMode` 是「说人话」（TTS/音色克隆），
 * 计价按字符或次；音乐/音效是「配氛围」，计价按时长档，产物用途也不同
 * （台词轨 vs BGM 轨）。放进同一个枚举会让价目表分不清两种计价口径。
 *
 * ⚠️ 这几个 mode 目前只到**适配器层**（`model-adapters` 的 tts/music/…），
 * 还没有进 `model_prices` 的目录条目——第 3 批接 UI 时才需要给它们配模型与价。
 * 列在这里是为了让 `GenerationMode` 的类型闭包完整，避免第 3 批再改一次公共契约。
 */
export const AudioToolMode = ["text2music", "text2sfx", "auto_bgm", "audio_timbre_modify"] as const;

/**
 * 视频后处理模式（第 3 批工具箱）。
 *
 * 与 `VideoMode` 的区别：`VideoMode` 是「生成」（从文本/图片/参考素材造出新画面），
 * 这里全是「改造已有视频」（不改内容语义，只改画质/字幕/结构）。分开的好处：
 * 价目表能对「生成」与「后处理」用不同计价策略，且任务列表能分开统计。
 *
 * 注意 `video_upscale` 与 `ImageMode` 的 `upscale` 是两回事（视频 vs 图片）。
 */
export const VideoToolMode = [
  "video_upscale",
  "lip_sync",
  "video_effects",
  "de_subtitle_auto",
  "de_subtitle_region",
  "video_slicing",
  "fps_duration_unify",
  "video_audio_separation",
] as const;

/**
 * 文本模式（LLM 步骤，按次计价）。
 *
 * 为什么放进 mode 枚举而不是走 `scene`/`options`：这两个能力是**独立的任务形态**
 * （输入一段文本、产出一段文本、按次计费），与"同一个 mode 换参数"的后处理
 * （crop/panorama → sub_mode）不同。它们也需要进入 `tasks.mode` 才能在任务列表/
 * 后台/对账里被单独统计。
 *
 * 计价单位：`model_prices.resolution` 存 `per_call`、`duration_s` 为 NULL；
 * 金额由运营在 `/ops/admin/model-prices` 配置，**代码不写死任何金额**。
 */
export const TextMode = [
  "script_optimization",
  "storyboard_parse",
  "asset_extraction",
  "storyboard_asset_match", // 分镜 × 资产匹配（把拆分资产的结果按镜头对上去）
] as const;

/**
 * 分析类模式（媒体 → 结构化 JSON，按次计价）。
 *
 * 与 `TextMode` 的差别只有「输入是媒体而不是文本」，任务形态/计价/回写完全一致：
 * 一条 `tasks`、按次扣费、单价来自 `model_prices`、结果写回节点 `params.result_text`。
 *
 * `video_parse`：视频拆解（拉片）。参照站是视频节点上的一个动作
 * （`VideoNode` 的 `video-parse` 事件 → `task_type=video_parse` → 结果落在
 * `result.videoParse`，并在画布上落一张「视频解析资产表」/文本节点）。我方按
 * ADR-013 对齐**行为**、协议自研：同一条任务脊柱 + 一键建资产节点，不另造任务表。
 */
export const AnalysisMode = ["video_parse"] as const;

/**
 * 同步返回文本的模式：文本类 + 分析类。
 *
 * 适配器/mock 用它判断"这个任务是不是同步产出文本"——用 adapter_code 判会把
 * 同一适配器上的媒体任务误判成同步文本（见 mock.ts 的注释）。
 */
export const SyncTextMode = [...TextMode, ...AnalysisMode] as const;

export const GenerationMode = [
  ...VideoMode,
  ...ImageMode,
  ...SpeechMode,
  ...TextMode,
  ...AnalysisMode,
  ...AudioToolMode,
  ...VideoToolMode,
] as const;
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
