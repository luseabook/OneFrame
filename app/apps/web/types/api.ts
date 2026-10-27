// Web 端 API 类型（与 docs/02-architecture/api-spec.md 对齐；仅前端消费所需字段）
export interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

export interface AuthUser {
  id: string;
  nickname: string;
  /** 服务端返回的原始字段名为 avatar_uri（见 /v1/me）；前端统一映射到 avatar */
  avatar_uri?: string | null;
  avatar: string | null;
  /** 首次登录/注册接口可能不回 avatar，故允许缺省（由 /me 补齐） */
  onboarded?: boolean;
}

export interface Credits {
  balance: number;
  frozen: number;
}

export interface MeResponse {
  user: { id: string; nickname: string; avatar_uri: string | null };
  space: { id: string; name: string };
  credits: Credits;
  vip: null;
  /** 新手引导是否已关闭（PRD 增补 §3） */
  onboarded?: boolean;
}

export interface ResolutionOption {
  value: string;
  label: string;
}

export interface ModeConfig {
  endpoint?: string;
  ratios?: string[];
  durations?: number[];
  default_duration?: number;
  default_ratio?: string;
  default_resolution?: string;
  resolution_options?: ResolutionOption[];
  resolutions?: string[];
  counts?: number[];
  default_count?: number;
  media_limits?: Record<string, number>;
}

export interface ModelDto {
  name: string;
  display_name: string;
  vendor: string;
  types: string[];
  need_vip: boolean;
  sort: number;
  visible: boolean;
  description: string;
  logo: string;
  tags: unknown;
  promotions: unknown;
  audio_video_support: boolean;
  mode_order: Record<string, number>;
  modes: Record<string, ModeConfig>;
  scene_modes: Record<string, unknown>;
}

export interface QuoteResponse {
  credits: number;
  strike_credits: number;
  discount: number;
  points_code: string;
  balance_after_estimate: number;
  sufficient: boolean;
  quote_id?: string;
  quote_expires_at?: string;
}

export interface TaskDto {
  task_id: string;
  status: number;
  progress: number;
  mode: string;
  capability: string;
  model_id: string;
  scene: string | null;
  results: Array<{ uri?: string; preview_uri?: string }> | null;
  error: { kind?: string; message?: string } | null;
  credits_frozen: number;
  credits_settled: number;
  created_at: string;
  finished_at: string | null;
  input?: { prompt?: string };
  options?: { ratio?: string; resolution?: string; duration?: number };
}

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProjectDto {
  id: string;
  title: string;
  genre: string | null;
  drama_type: number;
  ratio: string;
  source_type: number;
  source_text: string | null;
  source_file_name?: string | null;
  status: number;
  archived_at?: string | null;
  is_sample?: boolean;
  created_at: string;
  /** 最后写操作时间（ReelFlow 列表卡「最后编辑于 …」用它） */
  updated_at?: string;
}

/** 作品（作品=项目，PRD 增补 §1.3）：带成果聚合 */
export interface WorkDto extends ProjectDto {
  episode_count: number;
  shot_count: number;
  done_count: number;
  cover_uri: string | null;
  work_state: "draft" | "producing" | "ready" | "archived";
  /** ReelFlow：项目全部时间线片段时长之和（秒）；0 = 还没剪过 */
  timeline_duration_s?: number;
  /** ReelFlow：已保存时间线的集数 */
  timeline_episode_count?: number;
}

export interface EpisodeDto {
  id: string;
  ep_no: number;
  title: string | null;
  synopsis: string | null;
  script_text: string | null;
  status: number;
}

export interface CharacterDto {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  prompt: string | null;
  ref_image_uri: string | null;
  portrait_asset_id: string | null;
  portrait_url: string | null;
  source_task_id: string | null;
  status: number;
}

/** 项目资产（P2）：kind=character 时来自 characters 接口，其余来自 /projects/:id/assets */
export interface ProjectAssetDto {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  prompt: string | null;
  ref_image_uri: string | null;
  portrait_asset_id: string | null;
  portrait_url?: string | null;
  source_task_id?: string | null;
  status: number;
  finalized_at?: string | null;
  bound_shot_count?: number;
}

export interface AssetDto {
  id: string;
  kind: string;
  name: string;
  uri: string;
  url: string;
  meta: { content_type?: string; size?: number; tags?: string[]; folder_id?: string | null };
  tags?: string[];
  folder_id?: string | null;
  created_at: string;
}

export interface ShareView {
  task_id: string;
  mode: string;
  status: number;
  created_at: string;
  expires_at: string;
  results: Array<{ url: string; preview_url?: string; text?: string }>;
  error: { message?: string } | null;
}

export interface FlowDto {
  id: string;
  kind: string;
  delta: number;
  frozen_delta: number;
  balance_after: number;
  task_id: string | null;
  memo: string | null;
  created_at: string;
}

export interface MatrixShot {
  id: string;
  shot_no: number;
  status: number;
  task_status: number | null;
}

export interface MatrixEpisode {
  id: string;
  ep_no: number;
  title: string | null;
  shots: MatrixShot[];
}

export interface MatrixDto {
  project: { id: string; title: string };
  episodes: MatrixEpisode[];
}

export interface ExportDto {
  export_id: string;
  status: number;
  download_url: string | null;
  error: { code?: number; message?: string } | null;
  expires_at: string | null;
}

export interface StoryboardDto {
  id: string;
  shot_no: number;
  shot_desc: string | null;
  video_prompt: string | null;
  duration_s: number | null;
  ratio: string | null;
  resolution: string | null;
  status: number;
  image_task_id: string | null;
  video_task_id: string | null;
  character_ids: string[];
  /** P9：3D 定格设为该镜首帧/尾帧（storage key）与其签名 URL */
  first_frame_uri?: string | null;
  last_frame_uri?: string | null;
  first_frame_url?: string | null;
  last_frame_url?: string | null;
}

export const TaskStatus = {
  PENDING: 1,
  RUNNING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  CANCELED: 5,
  REVIEWING: 6,
  REVIEW_REJECTED: 7,
} as const;

export const statusLabel = (status: number): string =>
  ({
    1: "排队中",
    2: "生成中",
    3: "已完成",
    4: "失败",
    5: "已取消",
    6: "审核中",
    7: "审核未过",
  })[status] ?? `未知(${status})`;

// ── 创作 Agent（第 4 批：agent 域收口）────────────────────────
// 竞品证据：Skill 卡 8 端点 `rea-reelmate/routes.txt:378-385`；
// 推荐卡字段 `docs/01-product/_parts/d-canvas-agent.md:342-346`；
// STT `routes.txt:126`。这些形状是后端 `modules/agent/*` 的直接投影。

/** Skill 卡（广场/我的/收藏三种列表共用同一形状） */
export interface AgentSkill {
  skill_id: string;
  name: string;
  /** 斜杠指令名（= config.slug）；输入框首词与之匹配即视为使用该技能 */
  name_en: string;
  summary: string;
  cover_uri: string | null;
  category: string;
  category_label: string;
  /** 选中卡片后填入输入框的预置 prompt（以 /slug 开头） */
  prompt_template: string;
  config: Record<string, unknown>;
  /** 1 私有 / 2 广场可见 */
  visibility: number;
  use_count: number;
  favorite_count: number;
  status: number;
  is_favorite: boolean;
  is_mine: boolean;
  owner_user_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillPage {
  list: AgentSkill[];
  total: number;
  page: number;
  page_size: number;
}

export interface AgentRecommendSkillRef {
  skill_id: string;
  skill_name: string;
  skill_name_en: string;
}

/** 推荐卡（tag 1~5 与竞品枚举一致） */
export interface AgentRecommendCard {
  recommend_id: string;
  title: string;
  description: string;
  preset_prompt: string;
  tag: number;
  tag_label: string;
  skills: AgentRecommendSkillRef[];
  cover_file_id: string | null;
}

export interface AgentRecommendResult {
  list: AgentRecommendCard[];
  source: "signals" | "default";
  signals: {
    recent_project_count: number;
    recent_asset_count: number;
    recent_image_count: number;
    recent_video_count: number;
    recent_session_count: number;
  };
}

/** STT 能力位：available=false 时前端必须降级（不弹错） */
export interface AgentSttToken {
  available: boolean;
  provider: { id: string; name: string; mode: string; model: string } | null;
  token: string | null;
  expires_at: string | null;
  ttl_s: number;
  transcribe_path: string | null;
  reason: string | null;
  fallback: "browser" | null;
}

export interface AgentSttRelayResult {
  text: string;
  provider: string;
  model: string;
}

/** 任务详情（任务卡用；与后端 tasks.service TaskDto 对齐） */
export interface AgentTaskDetail {
  task_id: string;
  status: number;
  progress: number;
  mode: string;
  capability: string;
  model_id: string;
  scene: string | null;
  results: unknown;
  error: unknown;
  credits_frozen: number;
  credits_settled: number;
  created_at: string;
  finished_at: string | null;
  title?: string | null;
  feedback?: unknown;
}

/** 分享链接（POST /tasks/:id/share） */
export interface TaskShareLink {
  token: string;
  share_path: string;
  expires_at: string;
}

// ── 工具箱目录（GET /generations/tools）─────────────────────────
// 单一数据源在服务端 `apps/api/src/modules/generations/tool-catalog.ts`：
// 19 张卡与工具 mode/参数面板都从这里来，前端不再硬编码卡清单。

export interface ToolParamOption {
  value: string;
  label: string;
}

export interface ToolParamSpec {
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

export interface ToolInputSpec {
  key: "prompt" | "video" | "audio" | "image" | "mask";
  label: string;
  required: boolean;
  accept?: string;
  maxSizeMb?: number;
  placeholder?: string;
  hint?: string;
}

export interface ToolModeDto {
  key: string;
  mode: string;
  title: string;
  category: "video" | "image" | "audio";
  capability: string;
  result_media: "video" | "image" | "audio";
  model: { name: string; display_name: string; description: string };
  resolution_options: ToolParamOption[];
  default_resolution: string;
  params: ToolParamSpec[];
  inputs: ToolInputSpec[];
  fixed_options: Record<string, unknown>;
  /** 内容型必填参数键（如文字重绘的 text）；前端据此在前置校验里挡住空提交 */
  required_params: string[];
  evidence: string;
}

export interface ToolCardDto {
  key: string;
  title: string;
  desc: string;
  category: "video" | "image" | "audio";
  route: string;
  surface: "legacy" | "agent" | "tool";
  page_tool_keys: string[];
  evidence: string;
}

export interface ToolCatalogDto {
  cards: ToolCardDto[];
  tools: ToolModeDto[];
}

// ══════════════════════════════════════════════════════════════════
// 小说改编链（novel 域，第 2 批）
// 对照 `/v1/novel/*`；字段与 `packages/shared/src/schemas/novel.ts` 的出参一一对应
// （id 一律 string：雪花 bigint 直接进 JSON 会丢精度）。
// ══════════════════════════════════════════════════════════════════

/** 剧本来本来源：1 小说改编 / 2 一句话想法 / 3 导入剧本 / 4 创意裂变 / 5 海外改编 */
export type NovelSourceTypeValue = 1 | 2 | 3 | 4 | 5;
/** 1 草稿 / 16 已定稿（16 是竞品原值，只有 16 能作为制片工坊的拆集源） */
export type NovelStatusValue = 1 | 16;

export interface NovelDto {
  id: string;
  space_id: string;
  title: string;
  source_type: NovelSourceTypeValue;
  status: NovelStatusValue;
  sp_type: number;
  ratio: string;
  episode_count: number;
  meta: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** 仅创建响应返回：本次创建顺带解析出的章数（粘贴即分章） */
  chapter_count?: number;
}

export interface NovelCounts {
  chapters: number;
  characters: number;
  chapter_outlines: number;
  episode_outlines: number;
  episodes: number;
  script_versions: number;
}

export interface NovelDetailDto {
  novel: NovelDto;
  counts: NovelCounts;
  llm_mode: "mock" | "real";
}

export interface NovelChapterSummaryDto {
  id: string;
  novel_id: string;
  chapter_no: number;
  title: string;
  word_count: number;
}

export interface NovelChapterDto extends NovelChapterSummaryDto {
  content: string;
}

export interface NovelWorldviewDto {
  id: string;
  novel_id: string;
  summary: string;
  settings: Record<string, unknown>;
  era: string;
  geography: string;
  factions: Array<{ name: string; description?: string }>;
  rules: string[];
  relations: Array<{ from: string; to: string; kind: string; note?: string }>;
  created_at: string;
  updated_at: string;
}

export interface NovelCharacterDto {
  id: string;
  novel_id: string;
  name: string;
  role_type: 1 | 2 | 3;
  description: string;
  appearance: string;
  personality: string;
  prompt: string;
  is_core: boolean;
}

export interface NovelChapterOutlineDto {
  id: string;
  novel_id: string;
  chapter_no: number;
  title: string;
  synopsis: string;
  sort: number;
}

export interface NovelEpisodeOutlineDto {
  id: string;
  novel_id: string;
  episode_no: number;
  title: string;
  synopsis: string;
  sort: number;
}

export interface NovelEpisodeSummaryDto {
  id: string;
  novel_id: string;
  episode_no: number;
  title: string;
  status: number;
  version: number;
  chars: number;
}

export interface NovelEpisodeDto {
  id: string;
  novel_id: string;
  episode_no: number;
  title: string;
  script_text: string;
  status: number;
  version: number;
}

export interface NovelVersionDto {
  id: string;
  novel_id: string;
  episode_id: string | null;
  version_no: number;
  chars: number;
  finalized_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface NovelStepState {
  done: boolean;
  hint: string;
}

export interface NovelSummaryDto {
  novel: NovelDto;
  counts: NovelCounts;
  llm_mode: "mock" | "real";
  steps: {
    split: NovelStepState;
    content_analysis: NovelStepState;
    chapter_outline: NovelStepState;
    episode_outline: NovelStepState;
    core_character: NovelStepState;
    script: NovelStepState;
    finalize: NovelStepState;
  };
  finalized: boolean;
}

export interface NovelEditSessionDto {
  id: string;
  novel_id: string;
  user_id: string;
  status: 1 | 2;
  heartbeat_at: string | null;
  title: string;
  instructions: string;
  scope_episode_nos: number[];
  is_current: boolean;
  last_turn_at: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  pending_count?: number;
}

export interface NovelEditMessageDto {
  id: string;
  session_id: string;
  role: 1 | 2;
  content: string;
  pending_changes: unknown[];
  created_at: string;
}

/** 逐集 diff：apply/reject 的对象，前端双栏对照直接用 original/proposed 两段 */
export interface NovelEditPendingDto {
  id: string;
  session_id: string;
  episode_id: string;
  episode_no: number;
  original_text: string;
  proposed_text: string;
  change_summary: string;
  status: 1 | 2 | 3;
}

export interface NovelAgentChatResultDto {
  reply: string;
  message: NovelEditMessageDto;
  user_message: NovelEditMessageDto;
  pending: NovelEditPendingDto[];
  ignored_episode_nos: number[];
  llm_mode: "mock" | "real";
}

export interface NovelFissionIdeaDto {
  ni_id: string;
  title: string;
  logline: string;
  angle: string;
  selected: boolean;
}

/** 列表口径与后端 listQuerySchema 一致 */
export interface NovelListDto {
  list: NovelDto[];
  total: number;
  page: number;
  page_size: number;
}

// ══════════════════════════════════════════════════════════════════
// 影视版 film 域（对照 /web/v1/film/projects/:project_id/*）
// 口径：对外只暴露 { field_id: value } 稀疏映射，不暴露 film_cells 行结构。
// ══════════════════════════════════════════════════════════════════

export type FilmFieldType =
  | "text"
  | "date"
  | "user"
  | "select"
  | "multi_select"
  | "number"
  | "link"
  | "canvas_ref"
  | "asset_ref"
  | "review_ref"
  | "points_ro"
  | "task_status";

/** 行状态：与后端 FilmTaskStatus 同值（1..5） */
export type FilmTaskStatusValue = 1 | 2 | 3 | 4 | 5;

export interface FilmTableCellMap {
  [fieldId: string]: unknown;
}

export interface FilmFieldDto {
  id: string;
  table_id: string;
  key: string;
  name: string;
  field_type: FilmFieldType;
  is_system: boolean;
  /** ⚠️ 「该 field_type 每表至多一个」，不是值唯一 */
  is_unique_type: boolean;
  sort: number;
  config_json: Record<string, unknown>;
  hidden: boolean;
  width: number | null;
}

export interface FilmTableDto {
  id: string;
  table_id?: string;
  space_id: string;
  project_id: string;
  name: string;
  is_preset: boolean;
  sort: number;
  version: number;
}

export interface FilmTaskDto {
  id: string;
  task_id: string;
  table_id: string;
  parent_id: string | null;
  sort: number;
  version: number;
  status: FilmTaskStatusValue;
  status_name: string;
  title: string;
  review_version_no: number;
  assignee_user_id: string | null;
  cells: FilmTableCellMap;
  produce?: { canvas_ids: string[] };
  review?: {
    latest_version_no: number;
    version_id: string | null;
    thumb_file_id: string | null;
    version_no: string | null;
  };
  children?: FilmTaskDto[];
  created_at: string;
  updated_at: string;
}

export interface FilmPrefDto {
  hidden_field_ids: string[];
  filter: unknown[];
  ui: Record<string, unknown>;
}

export interface FilmTaskQueryDto {
  table: FilmTableDto;
  fields: FilmFieldDto[];
  tasks: FilmTaskDto[];
  pref: FilmPrefDto;
  page: { page: number; page_size: number; total_main: number };
}

export interface FilmReviewVersionDto {
  id: string;
  version_id: string;
  task_id: string;
  version_no: string;
  status: 1 | 2 | 3;
  submitted_by: string;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  asset_ids: string[];
  thumb_file_id: string | null;
  comment_count: number;
  read_by_me: boolean;
}

export interface FilmReviewCommentDto {
  id: string;
  comment_id: string;
  version_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export interface FilmReviewDto {
  task_id: string;
  latest_version_no: string | null;
  version_id: string | null;
  thumb_file_id: string | null;
  unread: number;
  versions: FilmReviewVersionDto[];
  comments: FilmReviewCommentDto[];
}

export interface FilmCanvasBindingDto {
  id: string;
  binding_id: string;
  task_id: string;
  canvas_id: string;
  node_id: string;
  created_at: string;
}

export interface FilmProjectRowDto {
  project_id: string;
  title: string;
  table_count: number;
  task_count: number;
  updated_at: string;
  last_opened_at: string | null;
}

export interface FilmTemplateDto {
  template_id: string;
  id: string;
  name: string;
  scope: 1 | 2;
  owner_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface FilmExportDto {
  export_id: string;
  id: string;
  status: number;
  format: string;
  file_uri: string | null;
  download_url: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface FilmExportCreateResultDto extends FilmExportDto {
  format_requested: string;
  delivered_format: "csv" | "zip";
  table_count: number;
  row_count: number;
  truncated: boolean;
  note: string;
  /** xlsx 未提供的偏离说明（前端提示条直接用这个文案） */
  max_rows_per_table: number;
}

export interface FilmStatsDto {
  total: number;
  by_status: Record<string, number>;
  by_assignee: Array<{ user_id: string | null; total: number; done: number; pending_review: number }>;
  not_started: number;
  in_progress: number;
  pending_review: number;
  rejected: number;
  done: number;
}

export interface FilmCanvasOptionDto {
  canvas_id: string;
  id: string;
  name: string;
  cover: string | null;
  created_at: string;
}

export interface FilmFuncWhitelistDto {
  check: boolean;
  scene: string;
  enabled?: boolean;
}

export interface FilmRecentOpenDto {
  project_id: string;
  table_id: string | null;
  opened_at: string;
}

// ── 第 1 批「出片质量」：主体库 / 抽取流水线 / 资产×分镜匹配 ─────────────────
// 与 apps/api 的 subjects / extraction / script(asset-match) 端点同构（ADR-009 域划分）。

export interface SubjectFileDto {
  id: string;
  uri: string;
  /** 预签名下载 URL（1h） */
  url: string;
  /** 1 参考图 / 2 正面 / 3 侧面 / 4 背面 / 5 细节 */
  role: number;
  sort: number;
  asset_id: string | null;
}

/** 审核三态：1 审核中 / 2 通过 / 3 驳回（驳回 retryable=false，禁止自动重试） */
export type SubjectReviewStatusValue = 1 | 2 | 3;
export type SubjectKindValue = 1 | 2 | 3;

export interface SubjectDto {
  id: string;
  name: string;
  kind: SubjectKindValue;
  kind_name: "character" | "scene" | "prop" | "unknown";
  desc: string | null;
  cover_uri: string | null;
  review_status: SubjectReviewStatusValue;
  review_status_name: "reviewing" | "approved" | "rejected" | "unknown";
  retryable: boolean;
  reject_reason: string | null;
  /** 供应商业务线编号（Seedance = [3]） */
  business_list: number[];
  tags: string[];
  project_id: string | null;
  files: SubjectFileDto[];
  created_at: string;
  updated_at: string;
}

export interface SubjectListDto {
  list: SubjectDto[];
  total: number;
  page: number;
  page_size: number;
}

export interface SubjectStatusItemDto {
  subject_id: string;
  status: "reviewing" | "approved" | "rejected" | "unknown";
  retryable: boolean;
  reject_reason: string | null;
}

/** 抽取任务四态：1 进行中 / 2 成功 / 3 失败 / 4 失效 */
export type ExtractionTaskStatusValue = 1 | 2 | 3 | 4;

export interface ExtractionDraftDto {
  id: string;
  task_id: string;
  eed_id: string;
  kind: SubjectKindValue;
  kind_name: "character" | "scene" | "prop" | "unknown";
  name: string;
  payload: { prompt?: string | null; description?: string | null; [key: string]: unknown };
  /** 1 草稿 / 2 已落项目资产 / 3 已丢弃 */
  state: number;
  state_name: string;
  parent_state_id: string | null;
  /** 子形态指向父形态 eed_id；主形态为 "0" */
  main_eed_id: string;
  is_sub: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractionTaskDto {
  id: string;
  et_id: string;
  project_id: string | null;
  episode_id: string | null;
  source_asset_id: string | null;
  source_uri: string | null;
  /** 1 清单 / 2 角色提示词 / 3 场景提示词 / 4 道具提示词 / 5 三合一 */
  task_type: number;
  status: ExtractionTaskStatusValue;
  status_name: "running" | "succeeded" | "failed" | "invalid" | "unknown";
  /** 只有失败/失效为 true（redo 只允许这两态） */
  retryable: boolean;
  eed_id: string | null;
  result: Record<string, unknown>;
  error: { code?: number; message?: string } | null;
  draft_count: number;
  sub_draft_count: number;
  drafts: ExtractionDraftDto[];
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  created?: boolean;
  deduped?: boolean;
  redo?: boolean;
}

export interface ExtractionDraftListDto {
  list: ExtractionDraftDto[];
  total: number;
  count: number;
  page: number;
  page_size: number;
  has_more: boolean;
  next_page: number | null;
}

/** 匹配项状态：1 未定稿 / 2 已匹配 / 3 缺失 */
export type MatchEntryStatusValue = 1 | 2 | 3;

export interface MatchEntryDto {
  resource_id: string;
  name: string;
  kind: SubjectKindValue;
  kind_name: string;
  status: MatchEntryStatusValue;
  status_name: "unfinalized" | "matched" | "missing";
  prompt: string | null;
  has_prompt: boolean;
  prompt_generating: boolean;
  prompt_blocked: boolean;
  file_id: string | null;
  ref_image_uri: string | null;
  ref_image_url: string | null;
  finalized_at: string | null;
  bound_shot_count: number;
  supplementable: boolean;
}

export interface MatchCountDto {
  total: number;
  matched: number;
  unfinalized: number;
  missing: number;
  supplementable: number;
}

export interface MatchOptionDto {
  value: "smart-supplement" | "rematch" | "keep";
  label: string;
  default: boolean;
  destructive: boolean;
  note?: string;
  target_count?: number;
  targets?: Array<{ resource_id: string; kind: string; name: string }>;
  qty?: number;
}

export interface MatchResultDto {
  ep_id: string;
  /** 0 未匹配 / 1 部分未定稿 / 2 全部已匹配 / 3 有缺失 */
  status: 0 | 1 | 2 | 3;
  status_name: "none" | "partial" | "matched" | "missing";
  counts: { characters: MatchCountDto; scenes: MatchCountDto; props: MatchCountDto };
  totals: MatchCountDto;
  characters: MatchEntryDto[];
  scenes: MatchEntryDto[];
  props: MatchEntryDto[];
  supplement: {
    options: MatchOptionDto[];
    target_count: number;
    reusable_count: number;
    needs_image_count: number;
  };
}

export interface SupplementMissingDto {
  dry_run: boolean;
  targets: Array<{ resource_id: string; kind: string; name: string }>;
  completed: Array<{ resource_id: string; name: string; action: string }>;
  reused: Array<{ resource_id: string; name: string; reused_from: string }>;
  pending_image: Array<{ resource_id: string; name: string; kind: string; prompt: string }>;
  failed: Array<{ resource_id: string; name: string; reason: string }>;
  status?: number;
  status_name?: string;
  counts?: MatchResultDto["counts"];
  next_actions?: Array<{
    action: string;
    method: string;
    path: string;
    resource_id: string;
    kind: string;
    qty: number;
    note: string;
  }>;
  notes?: string[];
}
