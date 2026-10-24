// Web 端 API 类型（与 docs/02-architecture/api-spec.md 对齐；仅前端消费所需字段）
export interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

export interface AuthUser {
  id: string;
  nickname: string;
  avatar: string | null;
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
  status: number;
  created_at: string;
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

export interface AssetDto {
  id: string;
  kind: string;
  name: string;
  uri: string;
  url: string;
  meta: { content_type?: string; size?: number };
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
