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
  /** 拆集来源本子（迁移 0026）：null = 未用小说拆集；novel 侧 reopen 用它精确判断 */
  source_novel_id?: string | null;
  created_at: string;
  /** 最后写操作时间（ReelFlow 列表卡「最后编辑于 …」用它） */
  updated_at?: string;
}

/** 作品（作品=项目，PRD 增补 §1.3）：带成果聚合 */
export interface WorkDto extends ProjectDto {
  /** 形态：工坊项目 / 无限画布（全部项目聚合页把两者放同一清单） */
  kind?: "workshop" | "canvas";
  episode_count: number;
  shot_count: number;
  done_count: number;
  cover_uri: string | null;
  work_state: "draft" | "producing" | "ready" | "archived" | "canvas";
  /** ReelFlow：项目全部时间线片段时长之和（秒）；0 = 还没剪过 */
  timeline_duration_s?: number;
  /** ReelFlow：已保存时间线的集数 */
  timeline_episode_count?: number;
  /** 画布侧只读投影（工坊项目为 null） */
  node_count?: number | null;
  creation_mode?: number | null;
  running_nodes?: number | null;
  failed_nodes?: number | null;
}

/** GET /works 聚合响应（tab=workshop|canvas|all + 筛选 + has_more） */
export interface WorksListDto {
  list: WorkDto[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  tabs: { workshop: number; canvas: number };
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
  /** 星标（置顶常用角色/场景）：列表按 starred 优先排序 */
  is_starred: boolean;
  /** IP/模板归类键（`ip:my-hero` 这类；只做归类与筛选，不做模板渲染） */
  template_key: string | null;
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

// ── 3D 导演台（director 域）──────────────────────────────────────
// payload 是**不透明场景快照**（相机/机位/角色站位/位姿），服务端不解析语义，
// 只做大小上限与 version 乐观锁；前端与组件状态互转集中在
// `components/director/useDirectorPersistence.ts` 一处。

export interface DirectorSceneDto {
  id: string;
  project_id: string | null;
  episode_id: string | null;
  name: string;
  payload: Record<string, unknown>;
  thumbnail_uri: string | null;
  /** 服务端签好的可访问 URL（storage key 由后端签名；完整 URL 原样返回） */
  thumbnail_url: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectorPosePresetDto {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  /** 1 个人 / 2 团队共享 */
  scope: number;
  created_by: string | null;
  /** 是否是我创建的（团队共享里区分"谁存的"） */
  mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface DirectorHeartbeatDto {
  scene_id: string;
  ttl_s: number;
  /** 除自己之外、最近 60s 内还在该场景的人 */
  collaborators: Array<{ user_id: string; nickname: string; last_seen_ms: number }>;
  count: number;
}

// ══════════════════════════════════════════════════════════════════
// 账号 SSO / 双 token / 团队权限码（第 9 批 B）
// ══════════════════════════════════════════════════════════════════

export interface OauthProviderDto {
  provider: "wechat" | "qq" | "apple" | "douyin";
  label: string;
  /** false → 登录页按钮置灰 + tooltip「未配置」；后端取授权 URL 会 400101 */
  configured: boolean;
  disabled_reason: "provider_not_configured" | null;
}

export interface OauthProvidersDto {
  list: OauthProviderDto[];
  /** true 表示当前进程走了 OAUTH_MOCK（验收时别误判"渠道已通"） */
  mock: boolean;
}

export interface OauthAuthorizeUrlDto {
  provider: string;
  authorize_url: string;
  state: string;
  expires_in: number;
  mock: boolean;
}

/** `POST /auth/renew` 只回 access（不轮换 master/refresh） */
export interface RenewResultDto {
  access_token: string;
  expires_in: number;
}

export interface TeamPermissionItemDto {
  code: string;
  name: string;
  group: string;
}

export interface TeamPermissionGroupDto {
  group: string;
  name: string;
  codes: string[];
}

export interface TeamPermissionCatalogDto {
  list: TeamPermissionItemDto[];
  groups: TeamPermissionGroupDto[];
  total: number;
}

export interface TeamRolePermissionsDto {
  role_id: string;
  role_code: string;
  role_name: string;
  role_level: number;
  is_system: boolean;
  /** 权限码集合（已去重排序） */
  permissions: string[];
  /** 落库形状：[{module, action, permission_code}] */
  power_list: unknown[];
  module_id_list: unknown;
  known_permissions: string[];
  /** 目录外的历史码（脏数据，保存会被拒） */
  unknown_permissions: string[];
}

export interface TeamTempInfoDto {
  space_id: string;
  name: string;
  type: number;
  film_enabled: boolean;
  agent_whitelist: boolean;
  api_key_white: boolean;
  sd_is_support: boolean;
  sd_480p_is_support: boolean;
  seedance_is_support: boolean;
  tsd_is_support: boolean;
  /** 未取证项一律 null（不用假 false 冒充"确定不支持"） */
  is_lingman_wsid: boolean | null;
  is_sd_discount_black: boolean | null;
  is_support: boolean | null;
  unverified: string[];
  derived_from: string;
  model_families: { total_visible: number; vendors: string[] };
}

// ── 第 3 轮（首发补全 A）：分集质量/合成/解析 + 切片发布 + 片段资产 ────────────

/** 分集质量检查（只读）：issues[] + 加权 score */
export interface QualityIssueDto {
  code: string;
  severity: "error" | "warn";
  category: "shots" | "prompt" | "assets" | "duration" | "timeline";
  message: string;
  shot_id?: string;
  shot_no?: number;
  hint?: string;
}

export interface QualityDimensionDto {
  key: QualityIssueDto["category"];
  label: string;
  weight: number;
  score: number;
  weighted: number;
  ok_items: number;
  total_items: number;
}

export interface QualityCheckDto {
  project_id: string;
  ep_id: string;
  ep_no: number;
  status: "pass" | "warn" | "fail";
  score: number;
  blocking: boolean;
  read_only: true;
  dimensions: QualityDimensionDto[];
  issues: QualityIssueDto[];
  stats: {
    shot_count: number;
    prompt_avg_len: number;
    bound_asset_count: number;
    finalized_asset_count: number;
    timeline_clip_count: number;
    timeline_duration_s: number;
    shot_duration_s: number;
    succeeded_video_tasks: number;
  };
  checked_at: string;
}

/** 分集合成导出：zip 包（exports 四态）+ 成片 mp4（timeline_exports 四态）两个 job */
export interface FilmSynthesisDto {
  export_id: string;
  synthesis_export_id: string;
  status: number;
  status_label: string;
  success_ratio: number;
  shots_total: number;
  shots_ready: number;
  clips: number;
  duration_s: number;
  watermarked: boolean;
  poll: { package: string; synthesis: string };
}

/** 分镜表解析（贴表 → storyboards），备份后覆盖 */
export interface EpisodeParseDto {
  dry_run: boolean;
  ep_id: string;
  mode: "replace" | "merge";
  parsed: number;
  created?: number;
  updated?: number;
  removed?: number;
  would_create?: number;
  would_update?: number;
  backup_key: string | null;
  storyboards?: StoryboardDto[];
  preview?: Array<{ shot_no: number; shot_desc: string; video_prompt?: string; duration_s?: number }>;
  retried?: boolean;
}

/** 切片发布（timeline_publications）：1 排队 / 2 转码中 / 3 可播放 / 4 失败 / 5 已下架 */
export interface TimelinePublicationDto {
  publication_id: string;
  title: string;
  status: 1 | 2 | 3 | 4 | 5;
  status_label: "queued" | "transcoding" | "ready" | "failed" | "removed" | "unknown";
  slice: {
    unit?: string;
    start_ms?: number;
    end_ms?: number;
    duration_ms?: number;
    clip_ids?: string[] | null;
    source_export_id?: string;
  };
  share_token: string | null;
  download_url: string | null;
  error: { code?: number; message?: string } | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelinePublicationListDto {
  list: TimelinePublicationDto[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/** 片段资产绑定（wf/clip-bind-asset） */
export interface TimelineClipAssetDto {
  source: "asset" | "project_asset" | "shot_product";
  id: string;
  name: string;
  uri: string;
  task_id?: string | null;
}

// ── 原创剧本链（`original_script/*`，task-13）─────────────────────
// 与改编链共用 NovelDto / NovelCharacterDto / NovelChapterOutlineDto /
// NovelEpisodeOutlineDto / NovelEpisodeDto；这里只补原创链独有的三样产物
// （创意方案 / 素材 / 总纲），它们存在 novels.meta.original（无独立表）。

export interface NovelOriginalIdeaDto {
  ni_id: string;
  title: string;
  logline: string;
  genre: string;
  tone: string;
  selected: boolean;
}

export interface NovelOriginalMaterialDto {
  nm_id: string;
  title: string;
  content: string;
  selected: boolean;
}

export interface NovelOriginalBeatDto {
  no: number;
  beat: string;
  summary: string;
}

export interface NovelOriginalOutlineDto {
  title: string;
  logline: string;
  theme: string;
  beats: NovelOriginalBeatDto[];
  structure: string;
  generated_at?: string;
  edited_at?: string;
}

/** `/novel/:id/original_script/state`：一次拿全原创链八步进度 */
export interface NovelOriginalStateDto {
  novel: NovelDto;
  source_type: number;
  user_input: string;
  selected_ni_id: string | null;
  steps: Record<string, NovelStepState>;
  counts: {
    ideas: number;
    materials: number;
    chapter_outlines: number;
    episode_outlines: number;
    episodes: number;
  };
  llm_mode: "mock" | "real";
}

/* ══════════════════════════════════════════════════════════════
   剧本集市（market，第 6 批 B）—— 对照竞品 `df/novel_market` 29 端点
   ══════════════════════════════════════════════════════════════ */

export interface MarketAuthorDto {
  user_id: string;
  nickname: string;
  avatar_uri: string | null;
}

/** 作品 DTO（`market_works` 的对外投影；status 语义见 MARKET_WORK_STATUS_LABEL） */
export interface MarketWorkDto {
  id: string;
  novel_id: string | null;
  owner_user_id: string;
  space_id: string;
  title: string;
  summary: string;
  cover_uri: string | null;
  /** 1 小说 / 2 剧本 / 3 分镜包 */
  kind: number;
  kind_name: string;
  /** 售价（积分） */
  price_credits: number;
  /** 预售定金（积分）；非预售作品为 null */
  preorder_price_credits: number | null;
  /** 1 草稿 / 2 待审 / 3 在售 / 4 已驳回 / 5 已下架 / 6 预售中 */
  status: number;
  status_name: string;
  audit_note: string | null;
  sales_count: number;
  /** 累计收益（成交价 − 抽成）；**不是积分余额**，提现走独立申请 */
  revenue_credits: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** 分类/标签直接来自 `market_works` 两列（迁移 0030），不再回查配置表 */
  category_id: string | null;
  tag_ids: string[];
  author?: MarketAuthorDto;
}

/** 审核留痕（迁移 0030 `market_review_logs`）：提交/通过/驳回/下架各一行 */
export interface MarketReviewLogDto {
  id: string;
  work_id: string;
  /** 1 提交 / 2 通过 / 3 驳回 / 4 下架 */
  action: number;
  action_name: string;
  operator_admin_id: string | null;
  operator_user_id: string | null;
  note: string | null;
  created_at: string;
}

export interface MarketCategoryDto {
  id: string;
  name: string;
  sort: number;
  status: number;
}

export interface MarketTagDto {
  id: string;
  name: string;
  status: number;
}

export interface MarketConfigDto {
  categories: MarketCategoryDto[];
  tags: MarketTagDto[];
  /** 抽成比例（basis point）：2000 = 20%。前端不许写死，一律用这个值 */
  commission_bps: number;
  commission_note: string;
  min_withdraw_credits: number;
  agreement_kinds: Array<{ kind: number; name: string; note: string }>;
  work_status: Array<{ status: number; name: string }>;
}

export interface MarketScriptListDto {
  list: MarketWorkDto[];
  total: number;
  page: number;
  page_size: number;
  /** 是否应用了分类/标签筛选（false 表示只按 SQL 条件过滤） */
  taxonomy_filtered: boolean;
}

export interface MarketWorkCountsDto {
  chapters: number;
  characters: number;
  episodes: number;
  total_word_count: number;
}

export interface MarketScriptDetailDto extends MarketWorkDto {
  author: MarketAuthorDto;
  counts: MarketWorkCountsDto;
  access: { free_preview: boolean; requires_purchase: boolean; content_endpoints: string[] };
}

export interface MarketAgreementTextDto {
  work_id: string;
  kind: number;
  kind_name: string;
  title: string;
  body: string;
  signed: boolean;
  creator_view?: {
    price_credits: number;
    commission_credits: number;
    revenue_credits: number;
    commission_bps: number;
    note: string;
  };
}

export interface MarketAgreementDto {
  id: string;
  work_id: string;
  work_title: string;
  buyer_user_id: string;
  space_id: string;
  /** 1 购买 / 2 预售 / 3 授权 / 4 退款反向记录 */
  kind: number;
  kind_name: string;
  price_credits: number;
  commission_credits: number;
  revenue_credits: number;
  /** 1 待支付 / 2 已生效 / 3 已退款 */
  status: number;
  status_name: string;
  signed_at: string | null;
  created_at: string;
}

export interface MarketBuyResultDto {
  agreement: MarketAgreementDto;
  /** true = 重复购买，未再扣分（幂等） */
  idempotent: boolean;
  /** 扣分后余额；幂等重放时为 null */
  balance_after: number | null;
}

export interface MarketContentTreeDto {
  work_id: string;
  novel_id: string | null;
  chapters: Array<{ chapter_no: number; title: string; word_count: number }>;
  chapter_count: number;
  total_word_count: number;
  episode_outlines: Array<{ episode_no: number; title: string; synopsis: string }>;
  episodes: Array<{ episode_no: number; title: string; status: number }>;
  content_included: boolean;
}

export interface MarketCharacterDto {
  id: string;
  name: string;
  role_type: number;
  role_type_name: string;
  description: string;
  appearance: string;
  personality: string;
  is_core: boolean;
}

export interface MarketEpisodeDto {
  id: string;
  episode_no: number;
  title: string;
  status: number;
  version: number;
  word_count: number;
  script_text: string;
}

export interface MarketCreatorProfileDto {
  user_id: string;
  nickname: string;
  avatar_uri: string | null;
  works_count: number;
  on_sale_count: number;
  total_sales: number;
  revenue_credits: number;
  available_withdraw_credits: number;
  commission_bps: number;
  min_withdraw_credits: number;
}

export interface MarketWorkDetailOwnDto extends MarketWorkDto {
  counts: MarketWorkCountsDto;
  readiness: {
    has_novel: boolean;
    novel_finalized: boolean | null;
    price_set: boolean;
    can_submit: boolean;
  };
}

export interface MarketWorkStatsDto {
  works_count: number;
  works_by_status: Record<string, number>;
  total_sales: number;
  revenue_credits: number;
  commission_bps: number;
  withdraw: { locked_credits: number; paid_credits: number; available_credits: number };
}

export interface MarketRevenueRowDto {
  agreement_id: string;
  work_id: string;
  work_title: string;
  kind: number;
  kind_name: string;
  price_credits: number;
  commission_credits: number;
  revenue_credits: number;
  status: number;
  status_name: string;
  buyer_user_id: string;
  created_at: string;
}

export interface MarketRevenueOverviewDto {
  revenue_credits: number;
  total_sales: number;
  commission_bps: number;
  available_credits: number;
  locked_credits: number;
  paid_credits: number;
  min_withdraw_credits: number;
  settlement_note: string;
}

/** 提现状态机：1 待审 → 2 已通过 → 3 已打款；1/2 → 4 已驳回；1 → 5 已撤销 */
export interface MarketWithdrawalDto {
  id: string;
  user_id: string;
  space_id: string;
  amount_credits: number;
  status: number;
  status_name: string;
  channel: string;
  account_info: Record<string, unknown>;
  review_note: string | null;
  paid_at: string | null;
  /** 当前状态允许的下一步（approve/reject/payout/cancel） */
  next_actions: string[];
  created_at: string;
  updated_at: string;
}

export interface MarketParseResultDto {
  work_id: string;
  novel_id: string | null;
  structure: {
    kind: string;
    counts: MarketWorkCountsDto;
    writable: boolean;
    note: string;
  };
}

export interface MarketCreatorParseDto {
  novel_id: string;
  title: string;
  status: number;
  finalized: boolean;
  chapter_count: number;
  total_word_count: number;
  character_count: number;
  episode_count: number;
  suggested: { title: string; summary: string; kind: number; cover_uri: string | null };
  writable: boolean;
}

/* ══════════════════════════════════════════════════════════════
   团队知识库（knowledge，第 6 批 B）—— 对照竞品 `df/user_knowledge` 29 端点
   ══════════════════════════════════════════════════════════════ */

export interface KnowledgeDirNodeDto {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  depth: number;
  asset_count?: number;
  created_at: string;
  updated_at: string;
  children?: KnowledgeDirNodeDto[];
}

export interface KnowledgeDirTreeDto {
  list: KnowledgeDirNodeDto[];
  tree: KnowledgeDirNodeDto[];
  max_depth: number;
  count: number;
  /** 未挂目录的条目数（前端"未分类"节点用） */
  unclassified_assets?: number;
}

export interface KnowledgeTagDto {
  id: string;
  name: string;
  asset_count: number;
  in_use: boolean;
  created_at: string;
}

export interface KnowledgeResourceRefDto {
  id: string;
  kind: string;
  uri: string;
  preview_uri: string | null;
  name: string;
}

export interface KnowledgeAssetDto {
  id: string;
  dir_id: string | null;
  dir_name: string | null;
  asset_id: string | null;
  title: string;
  content: string | null;
  tags: string[];
  /** 1 文本 / 2 资产引用 / 3 链接 */
  source_type: number;
  source_type_name: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  resource: KnowledgeResourceRefDto | null;
}

export interface KnowledgeAssetListDto {
  list: KnowledgeAssetDto[];
  total: number;
  page: number;
  page_size: number;
}

export interface KnowledgeInfoDto {
  scope: string;
  note: string;
  dir_count: number;
  asset_count: number;
  tag_count: number;
  asset_by_source_type: { text: number; asset_reference: number; link: number };
  max_dir_depth: number;
  unclassified_assets: number;
}

export interface KnowledgeScriptwriterDto {
  user_id: string;
  nickname: string;
  asset_count: number;
  last_updated_at: string | null;
}



// ── 首页配置 / 未读长轮询 / AB 实验位（模块 #1 收尾）─────────────────────
// 契约：`GET /v1/home/config` / `GET /v1/home/unread?since=` / `GET /v1/home/ab?key=`
export interface HomeSectionDto {
  key: string;
  visible: boolean;
  sort: number;
}

export interface HomeConfigDto {
  /** 未配置时为 null（此时 source=default，前端按内置顺序渲染） */
  version: number | null;
  scope: "global" | "space" | "default";
  source: "default" | "db";
  sections: HomeSectionDto[];
  ab_slots: Array<{ key: string; experiment: string }>;
  unread: { poll_timeout_ms: number; poll_interval_ms: number };
  updated_at: string | null;
}

export interface HomeUnreadItemDto {
  type: "task_event" | "task_status" | "share";
  task_id: string;
  event_type: string | null;
  title: string | null;
  created_at: string;
}

export interface HomeUnreadDto {
  items: HomeUnreadItemDto[];
  /** 下一次轮询带回的游标（超时时与入参相同，不会跳读） */
  cursor: string;
  waited_ms: number;
  timed_out: boolean;
  poll_after_ms: number;
}

export interface HomeAbDto {
  key: string;
  active: boolean;
  experiment_id: string | null;
  variant: string | null;
  assigned: boolean;
  reason?: string;
}

// ── 运营位（模块 #27 收尾）：/v1/ops/admin/promo-slots ───────────────────
export interface PromoSlotDto {
  id: string;
  /** banner | pop_up | activity | creator */
  slot: string;
  title: string;
  image_uri: string | null;
  link_uri: string | null;
  sort: number;
  /** 1 启用 / 2 停用 */
  status: number;
  starts_at: string | null;
  ends_at: string | null;
  view_count: number;
  click_count: number;
  created_by: string | null;
  /** status 启用且当前时间在窗口内（与公开读接口同口径） */
  active_now: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromoSlotListDto {
  list: PromoSlotDto[];
  count: number;
  active_count: number;
  slots: string[];
}

// ── 内容安全（模块 #25 收尾）──────────────────────────────────────────
export interface CaptchaTicketDto {
  /** 恒 false：未接入第三方行为验证码（本地算术题兜底） */
  available: false;
  provider: null;
  mode: "local_arithmetic";
  reason: string;
  configured_provider: string | null;
  integration: "not_implemented" | "none";
  challenge: { a: number; b: number; op: "+" };
  ticket: string;
  expires_in: number;
}

export interface CaptchaVerifyDto {
  passed: boolean;
  reason?: "invalid_ticket" | "expired" | "used_or_expired" | "wrong_answer" | "verifier_unavailable";
  retry_allowed: boolean;
}

export interface ModerationTextHitDto {
  word: string;
  index: number;
  category: string;
  level: number;
}

export interface ModerationTextDetectDto {
  enabled: boolean;
  risky: boolean;
  action: "allow" | "review" | "block";
  hits: ModerationTextHitDto[];
  categories: string[];
  scanned_chars: number;
  scene: string | null;
}

export interface ModerationTaskStatusDto {
  task_id: string;
  status: number;
  status_name: string;
  reviewing: boolean;
  rejected: boolean;
  terminal: boolean;
  mode: string;
  capability: string;
  result_count: number;
  error: unknown;
  finished_at: string | null;
  events: Array<{ type: string; created_at: string; payload: unknown }>;
}

// ── 分享页批量下载（模块 #26 收尾）────────────────────────────────────
// 公开接口：只认 token，打包范围由 share 行决定（不接受 task_ids）
export interface ShareBatchDownloadDto {
  url: string;
  filename: string;
  count: number;
  expires_in: number;
}

// ── 画布快照恢复（模块 #11 收尾）──────────────────────────────────────
export interface CanvasRecoverResultDto {
  from_version: number;
  snapshot_created_at: string;
  nodes_recovered: number;
  edges_recovered: number;
  skipped_existing: number;
  skipped_deleted: number;
  skipped_dangling_edges: number;
}

// ── 第 6 批 A：创作者中心 crc / 运营增长 op / 活动 campaign ─────────────
// 与 `apps/api/src/modules/{creator,op,campaign}` 的响应形状一致（字段全部 snake_case，
// 与后端 DTO 同形，避免前端再做一层映射导致两边漂移）。
export interface CreatorWorkDto {
  id: string;
  title: string;
  summary: string;
  kind: number;
  kind_label: string | null;
  category: string;
  cover_uri: string | null;
  uri: string | null;
  /** 1 草稿 / 2 待审 / 3 已通过 / 4 已驳回 / 5 已下架 */
  status: number;
  status_label: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  creator_user_id: string;
  space_id: string;
  view_count: number;
  like_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  creator?: { nickname: string; avatar_uri: string | null } | null;
  liked?: boolean;
  is_owner?: boolean;
}

export interface CreatorProfileDto {
  user_id: string;
  nickname: string;
  bio: string;
  avatar_uri: string | null;
  status: number;
  follower_count: number;
  following_count: number;
  like_count: number;
  works: { total: number; approved: number; pending: number; rejected: number };
  view_count: number;
  created_at: string;
  /** 是否具备审核权（作品所属 space 的管理员）——前端据此决定是否渲染审核按钮 */
  can_review?: boolean;
}

export interface CreatorLikeResultDto {
  asset_id: string;
  liked: boolean;
  like_count: number;
  changed: boolean;
}

export interface CreatorFollowResultDto {
  creator_user_id: string;
  following: boolean;
  follower_count: number;
}

export interface CreatorFollowRowDto {
  user_id: string;
  nickname: string | null;
  bio?: string;
  follower_count?: number;
  followed_at?: string;
}

export interface CreatorIncentiveDto {
  total_credits: number;
  record_count: number;
  by_category: Record<string, number>;
  list: Array<{ id: string; credits: number; category: string; memo: string | null; created_at: string }>;
  page: number;
  page_size: number;
}

export interface CampaignDto {
  id: string;
  campaign_key: string | null;
  title: string;
  kind: number;
  brief: string;
  cover_uri: string | null;
  reward_credits: number;
  start_at: string | null;
  end_at: string | null;
  status: number;
  space_id: string | null;
  my_signup?: CampaignSignupDto | null;
  signup_count?: number;
  shortlist_count?: number;
  open_for_signup?: boolean;
}

export interface CampaignSignupDto {
  id: string;
  campaign_id: string;
  /** 1 已报名 / 2 已入围 / 3 已获奖 / 4 已取消 */
  status: number;
  status_label: string | null;
  work_id: string | null;
  nominated_at: string | null;
  created_at: string;
}

export interface CampaignSignupResultDto {
  signed_up: boolean;
  replayed: boolean;
  revived?: boolean;
  rewarded_credits: number;
  balance_after?: number | null;
  signup: CampaignSignupDto | null;
}

export interface InviteCodeDto {
  code: string | null;
  credits: number;
  invitee_count: number;
  share_link?: string;
}

export interface DistributorOverviewDto {
  me: { parent_user_id: string | null; commission_bps: number; bound_at: string | null };
  invitee_count: number;
  income_credits: number;
  income_records: number;
  pending_credits: number;
}

export interface RedeemCodeInfoDto {
  found: boolean;
  code: string;
  credits: number;
  /** -1 = 不限次 */
  remaining_uses: number;
  expires_at: string | null;
  valid: boolean;
  reason?: string;
}

export interface RedeemResultDto {
  redeemed: boolean;
  replayed: boolean;
  already_redeemed: boolean;
  code: string;
  credits: number;
  balance_after?: number;
}

export interface DailyRewardDto {
  rewarded: boolean;
  already_rewarded: boolean;
  day: string;
  credits: number;
  today_credits: number;
  balance_after?: number;
}

export interface Paged<T> {
  list: T[];
  count: number;
  page: number;
  page_size: number;
}

// ══════════════════════════════════════════════════════════════════
// ReelFlow 公开播放页（/watch/:token）—— 只含"看作品需要的"字段，
// 不含 space/user/project/episode 等内部标识（后端 publicWatch 已收紧键集合）。
// ══════════════════════════════════════════════════════════════════

export interface WatchPublicationDto {
  title: string;
  episode_no: number | null;
  /** 3 = 可播放（其余状态端点会以错误码 + reason 返回，不会进这里） */
  status: number;
  /** 现签 1 小时的播放/下载地址 */
  file_url: string;
  duration_ms: number | null;
  published_at: string | null;
  /** 播放量（当前落 Redis，非数据库权威计数） */
  view_count: number;
}

export interface WatchViewResultDto {
  ok: boolean;
  /** 本次是否真的 +1（同 token + 同 IP 5 分钟内只算一次） */
  counted: boolean;
  view_count: number;
}

// ── 视频转绘 video_redraw（模块 #14，迁移 0031）─────────────────────────
export interface RedrawModeMeta {
  source_uri: string;
  source_kind: "upload" | "asset";
  source_asset_id?: string | null;
  style: string;
  redraw_strength: number;
  source_duration_s: number | null;
  episode_ranges: Record<string, [number, number]>;
  shot_duration_s: number;
}

export interface RedrawProjectDto {
  id: string;
  title: string;
  project_mode: number;
  ratio: string;
  status: number;
  mode_meta: RedrawModeMeta;
  created_at: string;
  updated_at: string;
}

export interface RedrawProgressDto {
  episodes: number;
  storyboards: number;
  storyboards_submitted: number;
  redraw_assets: number;
  bound_storyboards: number;
  percent: number;
}

export interface RedrawProjectInfoDto extends RedrawProjectDto {
  source: { uri: string; kind: string; duration_s: number | null; asset_id: string | null };
  style: string;
  redraw_strength: number;
  /** 竞品 CLI 同名字段：episode|storyboard|bind|done */
  video_redraw_stage: "episode" | "storyboard" | "redraw" | "bind" | "done";
  video_redraw_stage_status: 1 | 2 | 3;
  latest_flow: { task_count: number; latest_at: string | null } | null;
  progress: RedrawProgressDto;
}

export interface RedrawPointDto {
  project_id: string;
  target: "image" | "video";
  mode: string;
  model: string;
  shots: number;
  unit_credits: number;
  total_credits: number;
  balance: number;
  sufficient: boolean;
  points_code: string;
  price_locked: boolean;
}

export interface RedrawEpisodeDto {
  id: string;
  project_id: string;
  ep_no: number;
  title: string | null;
  synopsis: string | null;
  status: number;
  source_range?: [number, number];
}

export interface RedrawStoryboardDto {
  id: string;
  episode_id: string;
  shot_no: number;
  shot_desc: string | null;
  video_prompt: string | null;
  duration_s: number | null;
  ratio: string | null;
  status: number;
  image_task_id: string | null;
  video_task_id: string | null;
}

export interface RedrawPlanResultDto {
  episode_id: string;
  source_range: [number, number];
  shot_duration_s: number;
  shots: number;
  created: number;
  list: RedrawStoryboardDto[];
}

export interface RedrawGenerateResultDto {
  project_id: string;
  target: "image" | "video";
  model: string | null;
  count: number;
  tasks: Array<{ storyboard_id: string; project_asset_id: string; task_id: string }>;
}

export interface RedrawBindResultDto {
  project_id: string;
  bound: number;
  binds: Array<{ storyboard_id: string; project_asset_ids: string[] }>;
}

/** 复用既有剧本域的只读接口拿集/分镜列表（转绘不重复建列表端点） */
export interface ScriptProjectDetailDto {
  project: { id: string; title: string; ratio?: string };
  episodes: Array<{ id: string; ep_no: number; title: string | null; synopsis: string | null; status: number }>;
  characters: unknown[];
}

export interface ScriptEpisodeDetailDto {
  episode: { id: string; ep_no: number; title: string | null; status: number };
  storyboards: Array<{
    id: string;
    shot_no: number;
    shot_desc: string | null;
    video_prompt: string | null;
    duration_s: number | null;
    status: number;
    image_task_id?: string | null;
    video_task_id?: string | null;
    asset_ids?: string[];
  }>;
}

