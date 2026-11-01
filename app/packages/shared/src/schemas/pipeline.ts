import { z } from "zod";
import { storyboardVideoModeSchema } from "./project";

// 剧本流水线（PRD F2 / api-spec §8）请求与 LLM 输出 schema。
// LLM 输出必须先过这里校验，再落库（WBS 2.2：解析失败零容忍）。

export const outlineEpisodeSchema = z.object({
  ep_no: z.number().int().min(1).max(100),
  title: z.string().min(1).max(100),
  synopsis: z.string().min(1).max(1000),
});
export const outlineSchema = z.object({
  episodes: z.array(outlineEpisodeSchema).min(1).max(20),
});
export type OutlineResult = z.infer<typeof outlineSchema>;

export const characterDraftSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  prompt: z.string().min(1).max(1000),
});
export const charactersSchema = z.object({
  characters: z.array(characterDraftSchema).min(1).max(10),
});
export type CharactersResult = z.infer<typeof charactersSchema>;

export const scriptDraftSchema = z.object({
  script_text: z.string().min(1).max(100_000),
});
export type ScriptDraftResult = z.infer<typeof scriptDraftSchema>;

export const storyboardDraftSchema = z.object({
  shot_no: z.number().int().min(1),
  shot_desc: z.string().min(1).max(500),
  video_prompt: z.string().min(1).max(2000),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
  character_names: z.array(z.string().min(1)).max(10).optional(),
});
export const storyboardsSchema = z.object({
  storyboards: z.array(storyboardDraftSchema).min(1).max(30),
});
export type StoryboardsResult = z.infer<typeof storyboardsSchema>;

export const splitEpisodesRequestSchema = z.object({
  source_text: z.string().max(50_000).optional(),
  ep_count: z.number().int().min(1).max(20).optional(),
});
export type SplitEpisodesRequest = z.infer<typeof splitEpisodesRequestSchema>;

export const episodePatchSchema = z.object({
  title: z.string().max(100).optional(),
  synopsis: z.string().max(1000).optional(),
  script_text: z.string().max(100_000).optional(),
  /**
   * 第 91 批：集状态（`episodes.status`：1 草稿 / 2 确认）。
   *
   * 证据：竞品 `POST /web/v1/df/episode/status`（`ApiDfEpisodeStatusPOST`，`requestDataJsonSchema` 为 `{}`）。
   * 列本来就有、只是没有入口；竞品把改状态做成独立端点，我方按 REST 口径放进 PATCH。
   * **只接受 1/2**：3 之后的号是生成流水的状态（分镜 side），集本身没有那些态。
   */
  status: z.union([z.literal(1), z.literal(2)]).optional(),
});
export type EpisodePatchRequest = z.infer<typeof episodePatchSchema>;

export const outlineConfirmSchema = z.object({
  episodes: z.array(outlineEpisodeSchema).min(1).max(20),
});
export type OutlineConfirmRequest = z.infer<typeof outlineConfirmSchema>;

export const charactersGenerateSchema = z.object({
  count: z.number().int().min(1).max(10).default(5),
});
export type CharactersGenerateRequest = z.infer<typeof charactersGenerateSchema>;

export const scriptDraftGenerateSchema = z.object({
  instructions: z.string().max(1000).optional(),
});
export type ScriptDraftGenerateRequest = z.infer<typeof scriptDraftGenerateSchema>;

export const storyboardsGenerateSchema = z.object({
  shot_count: z.number().int().min(4).max(30).default(10),
});
export type StoryboardsGenerateRequest = z.infer<typeof storyboardsGenerateSchema>;

export const storyboardPatchSchema = z.object({
  shot_desc: z.string().max(500).optional(),
  video_prompt: z.string().max(2000).optional(),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
  character_ids: z.array(z.string()).max(10).optional(),
  // P9：3D 定格图（storage key）；传 null/"" 清空
  first_frame_uri: z.string().max(500).nullish(),
  last_frame_uri: z.string().max(500).nullish(),
});
export type StoryboardPatchRequest = z.infer<typeof storyboardPatchSchema>;

/**
 * 第 68 批：手动新增一条分镜。
 *
 * 证据：竞品 `POST /web/v1/df/episode/:ep_id/storyboard-add`
 * （`_acceptance/competitor_endpoints.tsv` 里的 `ApiDfEpisodeEpIdStoryboardAddPOST`，
 * `paramNames:["ep_id"]`）。竞品的 `requestDataJsonSchema` 是空对象，
 * 所以**字段名是我方自定的**（沿用 `storyboardPatchSchema` 的命名口径），待取证。
 */
export const storyboardCreateSchema = z.object({
  /** 省略 = 追加到末尾；给了就必须是该集当前没占用的号 */
  shot_no: z.number().int().min(1).max(999).optional(),
  shot_desc: z.string().max(500).optional(),
  video_prompt: z.string().max(2000).optional(),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
  /** 插到这一条之后（其余自动顺延）；与 `shot_no` 互斥 */
  insert_after: z.string().min(1).max(20).optional(),
});
export type StoryboardCreateRequest = z.infer<typeof storyboardCreateSchema>;

/**
 * 第 68 批：批量删除分镜。
 *
 * 证据：竞品 `POST /web/v1/df//episode/:ep_id/storyboard/delete`
 * （注意竞品路径里有一个双斜杠，是它自己的笔误；`paramNames:["ep_id"]`，
 * 要删的分镜 id 只能放在 body 里）。字段名我方自定，待取证。
 */
export const storyboardBatchDeleteSchema = z.object({
  shot_ids: z.array(z.string().min(1).max(20)).min(1).max(200),
});
export type StoryboardBatchDeleteRequest = z.infer<typeof storyboardBatchDeleteSchema>;

/**
 * 第 91 批：批量追加分镜。
 *
 * 证据：竞品 `POST /web/v1/df/storyboard/:storyboard_id/info/batch-add`
 * （`ApiDfStoryboardStoryboardIdInfoBatchAddPOST`，`paramNames:["storyboard_id"]`，
 * `requestDataJsonSchema` 为 `{}`）。竞品是「给一个 storyboard 批量加 info 条目」；
 * 我方没有 info 层（一行 `storyboards` 就是一个镜头），语义对齐为「给这一集按顺序追加若干镜头」。
 *
 * **不接受 `shot_no`/`insert_after`**：批量带序号插入一旦中途撞号，"部分成功"会污染后面所有序号；
 * 要插中间请走单条 `POST …/storyboards`（它有显式的插位语义与重排）。
 */
export const storyboardBatchCreateSchema = z.object({
  items: z.array(storyboardCreateSchema.omit({ shot_no: true, insert_after: true })).min(1).max(50),
});
export type StoryboardBatchCreateRequest = z.infer<typeof storyboardBatchCreateSchema>;

/**
 * 第 91 批：批量删集。
 *
 * 证据：竞品 `POST /web/v1/df/episode/batch-delete`（`ApiDfEpisodeBatchDeletePOST`，
 * 无 paramNames；要删的集 id 只能放 body）。整批一个事务：要么全删、要么一条都不动。
 */
export const episodeBatchDeleteSchema = z.object({
  episode_ids: z.array(z.string().min(1).max(20)).min(1).max(50),
});
export type EpisodeBatchDeleteRequest = z.infer<typeof episodeBatchDeleteSchema>;

/**
 * 第 68 批：重排分镜号。
 *
 * 证据：竞品 `POST /web/v1/df/episode/:ep_id/storyboard/num-update`
 * （`ApiDfEpisodeEpIdStoryboardNumUpdatePOST`）。它只给形状不给字段，故：
 * 传 `shot_ids` = 按这个顺序重排；不传 = 按现有号压实成 `step, 2*step, …`。
 */
export const storyboardRenumberSchema = z.object({
  shot_ids: z.array(z.string().min(1).max(20)).min(1).max(500).optional(),
  step: z.number().int().min(1).max(100).default(1),
});
export type StoryboardRenumberRequest = z.infer<typeof storyboardRenumberSchema>;

export const generateVideosBatchSchema = z.object({
  shot_ids: z.array(z.string().min(1)).min(1).max(30),
  budget_credits_max: z.number().int().min(1),
  model: z.string().min(1),
  // P5-1：生成模式（默认参考生视频）；video_edit 由服务端显式 400101
  mode: storyboardVideoModeSchema.default("universal_reference"),
  ratio: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});
export type GenerateVideosBatchRequest = z.infer<typeof generateVideosBatchSchema>;

export const portraitGenerateSchema = z.object({
  count: z.number().int().min(1).max(4).default(1),
  prompt: z.string().max(1000).optional(),
});
export type PortraitGenerateRequest = z.infer<typeof portraitGenerateSchema>;

export const portraitRebindSchema = z.object({
  asset_id: z.string().min(1),
});
export type PortraitRebindRequest = z.infer<typeof portraitRebindSchema>;

export const portraitSelectSchema = z.object({
  task_id: z.string().min(1),
  index: z.number().int().min(0).max(3),
});
export type PortraitSelectRequest = z.infer<typeof portraitSelectSchema>;

export const assetUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  /**
   * 图片 8MB / 视频 32MB（视频还要再走 base64，所以这里放宽到 45M 字符）。
   *
   * 为什么视频也走 base64：本地/演示栈没有 OSS 直传，而「视频续写/编辑/参考」
   * 这类工具没有视频源就用不了。这是 **MVP 限制**——真实生产应换预签名直传
   * （`docs/02-architecture/api-spec.md §9` 已登记该偏离与上限）。
   */
  content_type: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    /**
     * 音频（第 3 批工具箱）：对口型的驱动人声、音色修改的源音轨、自动配乐的参考音轨
     * 都必须先能上传成 asset。此前白名单只有图片/视频，音频工具"能点但永远上传失败"，
     * 提交前的 `input.reference_uris` 也就永远凑不齐。
     * 上限与视频同档（32MB base64），可以覆盖整集台词音频。
     */
    "audio/mpeg",
    "audio/wav",
    "audio/mp4",
  ]),
  data_base64: z.string().min(16).max(45_000_000),
});
export type AssetUploadRequest = z.infer<typeof assetUploadSchema>;

export const reportCreateSchema = z.object({
  reason: z.enum(["porn", "violence", "illegal", "infringement", "spam", "other"]),
  detail: z.string().max(500).optional(),
  contact: z.string().max(100).optional(),
});
export type ReportCreateRequest = z.infer<typeof reportCreateSchema>;

export const reportResolveSchema = z.object({
  action: z.enum(["takedown", "dismiss"]),
  note: z.string().max(500).optional(),
});
export type ReportResolveRequest = z.infer<typeof reportResolveSchema>;

export const shareCreateSchema = z.object({
  expires_in_days: z.number().int().min(1).max(30).default(7),
});
export type ShareCreateRequest = z.infer<typeof shareCreateSchema>;

/**
 * 画布分享（第 126 批）。
 *
 * 与任务分享同一套过期口径（1..30 天，默认 7），另加 `allow_clone`：
 * 公开页是否允许观众把这张画布克隆到自己的空间。克隆本身在第 127 批实现，
 * 这里先落开关，避免届时再加迁移改表。
 */
export const canvasShareCreateSchema = z.object({
  expires_in_days: z.number().int().min(1).max(30).default(7),
  allow_clone: z.boolean().default(false),
});
export type CanvasShareCreateRequest = z.infer<typeof canvasShareCreateSchema>;

export const projectPatchSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  genre: z.string().max(50).optional(),
});
export type ProjectPatchRequest = z.infer<typeof projectPatchSchema>;
