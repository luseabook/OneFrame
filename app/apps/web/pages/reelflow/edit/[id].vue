<script setup lang="ts">
import type { EpisodeDto, ProjectDto, StoryboardDto, TimelineClipAssetDto, TimelinePublicationDto } from "~/types/api";
import { isShotFinalized } from "~/utils/shot-status";

/**
 * ReelFlow 剪辑台（对齐竞品 /reelflow/edit/:projectId）
 *
 * 结构（竞品登录态实测，docs/03-frontend/reference-reelflow-spec.md §4.2 FLOW:77-86）：
 *   顶栏 64      ← 返回分镜创作 / 时间线导出（选中态）/ 保存 + 右侧集数选择、导出
 *   左栏 298     ← 「剧集资产」，只列**已定稿**的分镜素材（一致性闸门）
 *   中区          ← 播放器 + 「请在左侧选择分镜资产加入至时间线」
 *   底部 164      ← 时间线轨道（片段可拖拽排序 / 可裁剪时长）+ 播放头 + 缩放 + 刻度尺
 *
 * 三条必须说清的实现决定：
 *
 * 1. **「已定稿」闸门怎么映射到我们的数据模型**
 *    竞品的 `resource.status=2`（已定稿=正式态，才能被引用）在我们这里的等价物是
 *    `storyboards.status=5`（出片完成）。理由：剪辑台要的是**能进成片的料**，
 *    status 1/2/3/4 分别对应草稿/确认/已投递/出图，都还没有可用视频文件；
 *    拿 status=2 当"已定稿"放进时间线，导出时只能全部跳过——那不是闸门，是空壳。
 *    所以闸门 = `status===5 && video_task_id`，未达标的镜头在「全部」视图里可见但
 *    不可加入（明确告诉用户卡在哪一步），默认视图根本不显示。
 *
 * 2. **「更新分镜」是显式按钮，不自动同步**（竞品原话：时间线材料不会自动更新）。
 *    进入页面只读服务端已存的时间线，绝不因为分镜变了就重排用户的剪辑结果。
 *    重建时按 shot_id 保留已有片段的时长，避免把用户裁过的时长冲掉。
 *
 * 3. **拖拽全用原生 pointer events**，不引 dnd 库：三种交互共用一套指针状态机
 *    （左栏拖入 / 轨道内换位 / 右边缘裁时长）。pointerdown 时 capture，pointerup
 *    统一收尾——鼠标移出容器也不会丢事件（canvas 页同款做法）。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });
const { t } = useI18n();
useHead({ title: () => t("editor.metaTitle") });

const api = useApi();
const toast = useToast();
const route = useRoute();
const projectId = computed(() => String(route.params.id ?? ""));

/** 片段：服务端契约字段 + 本地派生字段（url 不入库，1h 签名地址） */
interface Clip {
  clip_id: string;
  shot_id: string;
  task_id: string | null;
  name: string;
  duration: number;
  /** 播放用签名地址（本地派生）；null = 还没拿到/不可用 */
  url: string | null;
  shot_no: number;
  /** 源文件探测失败（mock 占位字节）：仅在 UI 提示，不影响导出 */
  unplayable?: boolean;
  /** 片段资产绑定（服务端只在有绑定时返回该字段） */
  assets?: TimelineClipAssetDto[];
}

const project = ref<ProjectDto | null>(null);
const episodes = ref<EpisodeDto[]>([]);
const selectedEpisodeId = ref("");
const shots = ref<StoryboardDto[]>([]);
const clips = ref<Clip[]>([]);
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");

// ── 左栏筛选：默认「已定稿」（闸门）；「全部」只读预览，未定稿不可加入 ──
type RailFilter = "finalized" | "all";
const railFilter = ref<RailFilter>("finalized");

/** 闸门：出片完成且有视频任务 = 可进成片的料（与项目页共用 ~/utils/shot-status 的同一 selector） */
function isFinalized(shot: StoryboardDto): boolean {
  return isShotFinalized(shot);
}

const finalizedShots = computed(() => shots.value.filter(isFinalized));

interface RailRow {
  shot: StoryboardDto;
  finalized: boolean;
}

/** 左栏行：默认只给已定稿；「全部」视图把未定稿也列出来（disabled，用于解释卡点） */
const railRows = computed<RailRow[]>(() => {
  if (railFilter.value === "finalized") return finalizedShots.value.map((shot) => ({ shot, finalized: true }));
  return shots.value.map((shot) => ({ shot, finalized: isFinalized(shot) }));
});

/** 已加入时间线的镜头（重复加入时提示，不静默去重） */
const inTimelineShotIds = computed(() => new Set(clips.value.map((c) => c.shot_id)));

// ── 时间轴几何与播放 ─────────────────────────────────────
const pxPerSec = ref(48);
const MIN_PX_PER_SEC = 12;
const MAX_PX_PER_SEC = 200;
const playhead = ref(0);
const playing = ref(false);
let rafId = 0;

const totalDuration = computed(() => clips.value.reduce((sum, c) => sum + c.duration, 0));
const trackWidth = computed(() => Math.max(320, totalDuration.value * pxPerSec.value));

/** 竞品顶栏是 00:00:00 三段式，这里保持同款 */
function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const playheadLabel = computed(() => fmtTime(playhead.value));
const totalLabel = computed(() => fmtTime(totalDuration.value));

/** 播放头落在哪个片段（累加定位） */
const activeClipIndex = computed(() => {
  if (!clips.value.length) return -1;
  let acc = 0;
  for (let i = 0; i < clips.value.length; i += 1) {
    const c = clips.value[i]!;
    if (playhead.value < acc + c.duration) return i;
    acc += c.duration;
  }
  return clips.value.length - 1;
});
const activeClip = computed<Clip | null>(() => {
  const i = activeClipIndex.value;
  return i >= 0 ? (clips.value[i] ?? null) : null;
});

/**
 * 刻度间隔自适应：竞品按 1 分钟一格，但它的成片是分钟级；
 * 我们单镜 5s、整集几十秒，1 分钟一格等于一根刻度都没有。
 * 所以按「相邻刻度至少 64px」从固定档位里挑，最密 1s、最疏 60s。
 */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60];
const tickStep = computed(() => {
  for (const step of TICK_STEPS) if (step * pxPerSec.value >= 64) return step;
  return 60;
});
const ticks = computed(() => {
  const step = tickStep.value;
  const count = Math.ceil(totalDuration.value / step) + 1;
  return Array.from({ length: Math.max(1, Math.min(400, count)) }, (_, i) => i * step);
});

// ── 片段播放地址（1h 签名 URL）────────────────────────────
async function clipUrl(taskId: string): Promise<string | null> {
  try {
    const res = await api.get<{ url: string }>(`/tasks/${taskId}/results/1/download-url`);
    return res.url ?? null;
  } catch {
    return null;
  }
}

/** 并发补齐播放地址（一次 3 个，避免批量签名把接口打满） */
async function hydrateClipUrls(): Promise<void> {
  const wave = 3;
  for (let i = 0; i < clips.value.length; i += wave) {
    const slice = clips.value.slice(i, i + wave);
    await Promise.all(
      slice.map(async (clip) => {
        if (!clip.task_id || clip.url) return;
        const url = await clipUrl(clip.task_id);
        const target = clips.value.find((c) => c.clip_id === clip.clip_id);
        if (target) target.url = url;
      }),
    );
  }
}

// ── 载入 ─────────────────────────────────────────────────
async function loadProject(): Promise<void> {
  const data = await api.get<{ project: ProjectDto; episodes: EpisodeDto[] }>(`/projects/${projectId.value}`);
  project.value = data.project;
  episodes.value = data.episodes;
  // U3：项目页「去剪辑台」带 ?ep=<episodeId>，编辑器必须按该集载入——
  // 否则用户从第 3 集跳过来，剪辑台却把选中集重置成第 1 集，等于跳转丢了上下文。
  const wanted = String(route.query.ep ?? "");
  const hit = wanted ? data.episodes.find((ep) => ep.id === wanted) : undefined;
  if (!selectedEpisodeId.value) selectedEpisodeId.value = hit?.id ?? data.episodes[0]?.id ?? "";
}

async function loadEpisode(): Promise<void> {
  if (!selectedEpisodeId.value) {
    shots.value = [];
    return;
  }
  const data = await api.get<{ episode: EpisodeDto; storyboards: StoryboardDto[] }>(
    `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}`,
  );
  shots.value = data.storyboards;
}

async function loadTimeline(): Promise<void> {
  if (!selectedEpisodeId.value) {
    clips.value = [];
    return;
  }
  const data = await api.get<{ clips: Array<{ clip_id: string; shot_id: string; task_id: string | null; name: string; duration: number; assets?: TimelineClipAssetDto[] }> }>(
    `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline`,
  );
  const shotNoById = new Map(shots.value.map((s) => [s.id, s.shot_no]));
  clips.value = (data.clips ?? []).map((c) => ({
    clip_id: c.clip_id,
    shot_id: c.shot_id,
    task_id: c.task_id,
    name: c.name,
    duration: c.duration,
    url: null,
    shot_no: shotNoById.get(c.shot_id) ?? 0,
    ...(c.assets && c.assets.length > 0 ? { assets: c.assets } : {}),
  }));
  playhead.value = 0;
  void hydrateClipUrls();
}

async function bootstrap(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    await loadProject();
    await loadEpisode();
    await loadTimeline();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : t("editor.loadFailed");
  } finally {
    loading.value = false;
  }
}

// ── 保存（显式 + 防抖 + 三态可见）────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const dirty = ref(false);

/**
 * 保存状态三态（竞品「保存」按钮在无改动时不可见/不高亮，我们把它做成常驻可见的状态位）：
 *   idle   —— 本次会话还没有要保存的改动（显示为无）
 *   dirty  —— 有改动未落库（防抖 700ms 内 → 显示「未保存」）
 *   saving —— 请求在途（显示「保存中…」）
 *   saved  —— 上一次 PUT 成功（显示「已保存」）
 *   error  —— 上一次 PUT 失败（显示「保存失败」，红色；不做成只在 toast 里一闪而过）
 */
type SavePhase = "idle" | "dirty" | "saving" | "saved" | "error";
const savePhase = ref<SavePhase>("idle");

const savePhaseLabel = computed<string>(() => {
  switch (savePhase.value) {
    case "saving":
      return t("editor.saveSaving");
    case "saved":
      return t("editor.saveSaved");
    case "error":
      return t("editor.saveFailed");
    case "dirty":
      return t("editor.unsaved");
    default:
      return "";
  }
});

function scheduleSave(): void {
  dirty.value = true;
  savePhase.value = "dirty";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistTimeline(true), 700);
}

async function persistTimeline(silent: boolean, keepalive = false): Promise<boolean> {
  if (!selectedEpisodeId.value) return false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  saving.value = true;
  savePhase.value = "saving";
  try {
    const res = await api.put<{ clips: Array<{ clip_id: string }> }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline`,
      {
        clips: clips.value.map((c) => ({
          clip_id: c.clip_id,
          shot_id: c.shot_id,
          task_id: c.task_id,
          name: c.name,
          duration: c.duration,
        })),
      },
      // 卸载/刷新时普通 fetch 会被浏览器取消；keepalive 让这最后一个写请求能发出（同源同鉴权，不新造机制）
      keepalive ? { keepalive: true } : {},
    );
    // 服务端会回填/重建 clip_id：同步回本地，否则下次覆盖写会一直新建 id
    if (Array.isArray(res.clips) && res.clips.length === clips.value.length) {
      const ids = res.clips.map((c) => c.clip_id);
      clips.value = clips.value.map((c, i) => ({ ...c, clip_id: ids[i] ?? c.clip_id }));
    }
    dirty.value = false;
    savePhase.value = "saved";
    if (!silent) toast.success(t("editor.saved"));
    return true;
  } catch (e) {
    savePhase.value = "error";
    toast.error(e instanceof Error ? t("editor.saveFailedWith", { msg: e.message }) : t("editor.saveFailed"));
    return false;
  } finally {
    saving.value = false;
  }
}

/**
 * 卸载 / 刷新 / 切后台时的最后一道保险：先清防抖 timer，再把未落库的改动用 keepalive 发出去。
 * 不 await —— 浏览器不会等 promise；keepalive 才能让请求在文档销毁后继续完成。
 */
function flushPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (!dirty.value || !selectedEpisodeId.value) return;
  void persistTimeline(true, true);
}

// ── 加入 / 移除 / 更新分镜 ────────────────────────────────
function newClipId(): string {
  // crypto.randomUUID 在 http://127.0.0.1 也属于安全上下文，可用；兜底走时间戳
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 32);
  return `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function clipFromShot(shot: StoryboardDto): Clip {
  return {
    clip_id: newClipId(),
    shot_id: shot.id,
    task_id: shot.video_task_id,
    name: t("editor.shotClip", { no: shot.shot_no }),
    // 后端契约：duration 整数 1..30；分镜时长可能为 null
    duration: Math.min(30, Math.max(1, Math.round(shot.duration_s ?? 5))),
    url: null,
    shot_no: shot.shot_no,
  };
}

const info = ref("");

/** 删除后的页内撤销条：8s 内可还原（toast 只有 success/error/info，没有 action/undo API，所以不做成 toast 动作） */
const removedClip = ref<{ clip: Clip; index: number } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

// ── 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z，可见安全网）──────────
/**
 * 两条撤销通道各管一段，互不冲突：
 * 1. 删除后的页内撤销条（8s，位置可还原）——「刚删错」的即时反馈；
 * 2. 本段历史栈——时间线上所有编辑（加入 / 删除 / 换位 / 裁剪 / 更新分镜）都能回退，
 *    删掉撤销条过期之后也还能救。
 *
 * 存的是**整份片段数组快照**而不是命令对象：后端 clip 契约只有 clip_id/shot_id/task_id/
 * name/duration 五个字段，一集几十段，快照体量可以忽略；命令模式要为 5 种操作各写一对
 * do/undo，出错面反而更大。
 */
const HISTORY_LIMIT = 50;
const historyPast = ref<Clip[][]>([]);
const historyFuture = ref<Clip[][]>([]);

function snapshotClips(): Clip[] {
  return clips.value.map((c) => ({ ...c }));
}

/** 在任何改动落盘前调用：把「改动前」的状态压栈，并清空重做栈 */
function pushHistory(): void {
  historyPast.value = [...historyPast.value, snapshotClips()].slice(-HISTORY_LIMIT);
  historyFuture.value = [];
}

const canUndo = computed(() => historyPast.value.length > 0);
const canRedo = computed(() => historyFuture.value.length > 0);

function applyHistory(next: Clip[]): void {
  clips.value = next.map((c) => ({ ...c }));
  if (playhead.value > totalDuration.value) playhead.value = totalDuration.value;
  scheduleSave();
}

function undoClips(): void {
  const prev = historyPast.value[historyPast.value.length - 1];
  if (!prev) return;
  historyPast.value = historyPast.value.slice(0, -1);
  historyFuture.value = [...historyFuture.value, snapshotClips()];
  applyHistory(prev);
}

function redoClips(): void {
  const next = historyFuture.value[historyFuture.value.length - 1];
  if (!next) return;
  historyFuture.value = historyFuture.value.slice(0, -1);
  historyPast.value = [...historyPast.value, snapshotClips()];
  applyHistory(next);
}

async function addShot(shot: StoryboardDto, atIndex?: number): Promise<void> {
  if (!isFinalized(shot)) {
    toast.error(t("editor.shotNotFinalized", { no: shot.shot_no }));
    return;
  }
  const clip = clipFromShot(shot);
  const list = [...clips.value];
  const index = atIndex === undefined ? list.length : Math.max(0, Math.min(list.length, atIndex));
  list.splice(index, 0, clip);
  pushHistory();
  clips.value = list;
  if (clip.task_id) {
    const url = await clipUrl(clip.task_id);
    const target = clips.value.find((c) => c.clip_id === clip.clip_id);
    if (target) target.url = url;
  }
  scheduleSave();
  info.value = t("editor.addedClip", { name: clip.name });
}

function removeClip(clipId: string): void {
  const index = clips.value.findIndex((c) => c.clip_id === clipId);
  if (index < 0) return;
  pushHistory();
  const [clip] = clips.value.splice(index, 1);
  if (!clip) return;
  if (playhead.value > totalDuration.value) playhead.value = totalDuration.value;
  removedClip.value = { clip, index };
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    removedClip.value = null;
    undoTimer = undefined;
  }, 8000);
  scheduleSave();
  toast.info(t("editor.clipRemoved", { name: clip.name }));
}

function undoRemoveClip(): void {
  const pending = removedClip.value;
  if (!pending) return;
  removedClip.value = null;
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = undefined;
  }
  const next = [...clips.value];
  next.splice(Math.min(pending.index, next.length), 0, pending.clip);
  // 撤销条本身也是一次改动：压栈后可再用 Ctrl+Z 反悔（与历史栈不冲突）
  pushHistory();
  clips.value = next;
  scheduleSave();
  toast.success(t("editor.clipRestored", { name: pending.clip.name }));
}

/**
 * 「更新分镜」= 显式同步（竞品原话：时间线材料不会自动更新）。
 * 语义：按本集全部已定稿镜头重建轨道；**已存在的镜头保留用户裁过的时长与顺序**，
 * 只补新增的、去掉已不再定稿的。这样点一下不会把剪辑成果清零。
 */
async function rebuildFromStoryboards(): Promise<void> {
  const finals = finalizedShots.value;
  if (!finals.length) {
    toast.error(t("editor.noFinalizedShots"));
    return;
  }
  const byShotId = new Map(clips.value.map((c) => [c.shot_id, c]));
  const rebuilt: Clip[] = finals.map((shot) => {
    const existing = byShotId.get(shot.id);
    if (existing) return { ...existing, shot_no: shot.shot_no };
    return clipFromShot(shot);
  });
  // 记录被移除的镜头（不再定稿 / 已删除），提示用户而不是静默丢
  const removed = clips.value.filter((c) => !finals.some((s) => s.id === c.shot_id)).length;
  pushHistory();
  clips.value = rebuilt;
  playhead.value = Math.min(playhead.value, totalDuration.value);
  await hydrateClipUrls();
  scheduleSave();
  toast.success(
    removed > 0
      ? t("editor.syncedWithRemoved", { count: finals.length, removed })
      : t("editor.synced", { count: finals.length }),
  );
}

// ── 指针拖拽（三种交互共用一个状态机）────────────────────
type DragKind = "rail" | "reorder" | "trim";
interface DragState {
  kind: DragKind;
  /** 被拖的片段（rail 拖拽时为空） */
  clipId: string;
  /** 拖的是哪个镜头（rail 用） */
  shot: StoryboardDto | null;
  startX: number;
  lastX: number;
  /** 拖拽开始前的时间线快照（reorder 用，避免边拖边改数组导致抖动） */
  originOrder: string[];
  originDuration: number;
  moved: boolean;
  /** 指针在轨道内的横向位置（drop 位置提示） */
  dropIndex: number | null;
  /** 裁剪前的时间线快照（一次拖动 = 一个撤销步；没真改就丢掉，不留空步） */
  baseline: Clip[] | null;
}

const drag = ref<DragState | null>(null);
const dragGhost = ref<{ x: number; y: number; label: string } | null>(null);
const trackEl = ref<HTMLElement | null>(null);

/**
 * 插入指示线：把「过滤后的插入位」换算回原始数组里「插在谁之前」，
 * 否则向右拖动时那根 2px 线会画在被拖片段自己身上（位置对不上手感）。
 */
const dropBeforeIndex = computed<number | null>(() => {
  const state = drag.value;
  if (!state || state.kind !== "reorder" || state.dropIndex === null) return null;
  const from = clips.value.findIndex((c) => c.clip_id === state.clipId);
  if (from < 0) return null;
  return state.dropIndex <= from ? state.dropIndex : state.dropIndex + 1;
});

/** 屏幕 x → 轨道内的时间线索引（按片段中点判定插入位置） */
function indexAtX(clientX: number, ignoreClipId?: string): number {
  const el = trackEl.value;
  if (!el) return clips.value.length;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left + el.scrollLeft;
  let acc = 0;
  let index = 0;
  for (const clip of clips.value) {
    if (clip.clip_id === ignoreClipId) {
      acc += clip.duration * pxPerSec.value;
      continue;
    }
    const mid = acc + (clip.duration * pxPerSec.value) / 2;
    if (x < mid) return index;
    acc += clip.duration * pxPerSec.value;
    index += 1;
  }
  return clips.value.filter((c) => c.clip_id !== ignoreClipId).length;
}

/** 指针距轨道上下 90px 内就认「落在轨道上」，否则视为放弃（避免误加） */
function isOverTrack(clientY: number): boolean {
  const el = trackEl.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return clientY >= rect.top - 90 && clientY <= rect.bottom + 40;
}

function onRailPointerDown(ev: PointerEvent, shot: StoryboardDto, finalized: boolean): void {
  if (ev.button !== 0) return;
  if (!finalized) {
    toast.error(t("editor.shotNotFinalizedShort", { no: shot.shot_no }));
    return;
  }
  ev.preventDefault();
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  drag.value = {
    kind: "rail",
    clipId: "",
    shot,
    startX: ev.clientX,
    lastX: ev.clientX,
    originOrder: clips.value.map((c) => c.clip_id),
    originDuration: 0,
    moved: false,
    dropIndex: null,
    baseline: null,
  };
  dragGhost.value = { x: ev.clientX, y: ev.clientY, label: t("editor.shotClip", { no: shot.shot_no }) };
}

function onClipPointerDown(ev: PointerEvent, clip: Clip, mode: "reorder" | "trim"): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  drag.value = {
    kind: mode,
    clipId: clip.clip_id,
    shot: null,
    startX: ev.clientX,
    lastX: ev.clientX,
    originOrder: clips.value.map((c) => c.clip_id),
    originDuration: clip.duration,
    moved: false,
    dropIndex: null,
    baseline: mode === "trim" ? snapshotClips() : null,
  };
}

function onPointerMove(ev: PointerEvent): void {
  const state = drag.value;
  if (!state) return;
  state.lastX = ev.clientX;
  const dx = ev.clientX - state.startX;
  if (!state.moved && Math.abs(dx) < 3) return;
  state.moved = true;

  if (state.kind === "rail") {
    dragGhost.value = { x: ev.clientX, y: ev.clientY, label: state.shot ? t("editor.shotClip", { no: state.shot.shot_no }) : "" };
    state.dropIndex = isOverTrack(ev.clientY) ? indexAtX(ev.clientX) : null;
    return;
  }
  if (state.kind === "reorder") {
    state.dropIndex = indexAtX(ev.clientX, state.clipId);
    return;
  }
  // trim：右边缘拖动 = 改时长（出点）。入点固定 0——后端 clip 契约只有 duration，
  // 没有 in/out 字段，所以这里只做「出点」；硬做入点会写不进去（假功能）。
  const delta = Math.round(dx / pxPerSec.value);
  const next = Math.min(30, Math.max(1, state.originDuration + delta));
  const target = clips.value.find((c) => c.clip_id === state.clipId);
  if (target && target.duration !== next) {
    target.duration = next;
    dirty.value = true;
  }
}

function onPointerUp(): void {
  const state = drag.value;
  drag.value = null;
  dragGhost.value = null;
  if (!state) return;

  if (state.kind === "rail") {
    if (!state.shot) return;
    // 纯单击（未移动）= 按文案「点击加入时间线」追加到末尾；
    // 之前只有拖到轨道才入轨，而左栏三处文案都写"点选/点击加入"，用户会反复点没反应。
    if (!state.moved) {
      void addShot(state.shot, clips.value.length);
      return;
    }
    if (state.dropIndex !== null) {
      void addShot(state.shot, state.dropIndex);
    }
    return;
  }

  if (state.kind === "reorder") {
    const from = clips.value.findIndex((c) => c.clip_id === state.clipId);
    const to = state.dropIndex;
    if (!state.moved || from < 0 || to === null) return;
    const list = [...clips.value];
    const [item] = list.splice(from, 1);
    if (!item) return;
    /*
     * indexAtX 返回的是「把被拖片段摘掉之后」的插入位，所以**右移不能再回退一位**：
     * 旧写法 `to > from ? to - 1 : to` 会让「把第 1 段拖到第 2 段右边」插回原位，
     * 也就是向右拖永远不动（U4 e2e 实测复现，见 reports/U4.md §2.5）。
     */
    const insertAt = Math.max(0, Math.min(list.length, to));
    list.splice(insertAt, 0, item);
    pushHistory();
    clips.value = list;
    scheduleSave();
    return;
  }

  if (state.kind === "trim" && state.moved) {
    // 只有真的改动了时长才记一步：拖歪了又拖回去不该占一格历史
    const changed =
      state.baseline?.some((c, i) => clips.value[i]?.duration !== c.duration) ?? false;
    if (changed && state.baseline) {
      historyPast.value = [...historyPast.value, state.baseline].slice(-HISTORY_LIMIT);
      historyFuture.value = [];
    }
    scheduleSave();
    return;
  }

  if (state.moved) scheduleSave();
}

function onClipKeydown(ev: KeyboardEvent, clip: Clip): void {
  // 键盘可达性：←/→ 换位，Delete/Backspace 移除
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    ev.preventDefault();
    const from = clips.value.findIndex((c) => c.clip_id === clip.clip_id);
    const to = from + (ev.key === "ArrowLeft" ? -1 : 1);
    if (from < 0 || to < 0 || to >= clips.value.length) return;
    const list = [...clips.value];
    const [item] = list.splice(from, 1);
    if (!item) return;
    list.splice(to, 0, item);
    pushHistory();
    clips.value = list;
    scheduleSave();
  } else if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    removeClip(clip.clip_id);
  }
}

// ── 播放 ─────────────────────────────────────────────────
const stageVideo = ref<HTMLVideoElement | null>(null);

function seekTo(seconds: number): void {
  playhead.value = Math.min(Math.max(0, seconds), totalDuration.value);
}

/**
 * 点轨道空白处 seek。
 * 不能用 $event.offsetX：offsetX 相对的是**事件目标**，而轨道横向滚动过以后
 * 它不含 scrollLeft，点右侧会把播放头甩到片头。用 clientX - rect + scrollLeft 才准。
 */
function onTrackClick(ev: MouseEvent): void {
  const el = trackEl.value;
  if (!el) return;
  // 点在片段上 = 选中/拖拽，不该 seek
  if ((ev.target as HTMLElement | null)?.closest(".rf-clip, .rf-clip__rm, .rf-clip__trim")) return;
  const rect = el.getBoundingClientRect();
  const x = ev.clientX - rect.left + el.scrollLeft;
  seekTo(x / pxPerSec.value);
}

function togglePlay(): void {
  if (!clips.value.length) {
    toast.error(t("editor.timelineEmptyAdd"));
    return;
  }
  playing.value = !playing.value;
  if (!playing.value) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    stageVideo.value?.pause();
    return;
  }
  if (playhead.value >= totalDuration.value) playhead.value = 0;
  const startedAt = performance.now() - playhead.value * 1000;
  const tick = (): void => {
    if (!playing.value) return;
    const elapsed = (performance.now() - startedAt) / 1000;
    if (elapsed >= totalDuration.value) {
      playhead.value = totalDuration.value;
      playing.value = false;
      rafId = 0;
      stageVideo.value?.pause();
      return;
    }
    playhead.value = elapsed;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

/** 片段切换后：自动 play 当前片段源（静音预览，成片音轨本来就没有） */
watch(activeClipIndex, async () => {
  if (!playing.value) return;
  const el = stageVideo.value;
  if (!el || !activeClip.value?.url) return;
  try {
    await el.play();
  } catch {
    /* 浏览器自动播放策略：静音下一般允许，失败就不打断播放头 */
  }
});

function onVideoError(): void {
  const clip = activeClip.value;
  if (clip) clip.unplayable = true;
}

// ── 导出（真实 ffmpeg 合成，轮询 → 下载 mp4）──────────────
const exportId = ref("");
const exportStatus = ref(0);
const exportUrl = ref<string | null>(null);
const exportError = ref("");
const exporting = ref(false);
const previewComposed = ref(false);
let exportTimer: ReturnType<typeof setInterval> | undefined;

const EXPORT_LABEL = computed<Record<number, string>>(() => ({
  0: "",
  1: t("editor.statusQueued"),
  2: t("editor.statusRendering"),
  3: t("editor.statusDone"),
  4: t("editor.statusFailed"),
}));

async function startExport(): Promise<void> {
  if (!clips.value.length) {
    toast.error(t("editor.timelineEmptyExport"));
    return;
  }
  // 导出前必须先落库：worker 是读服务端时间线来合成的，不先 PUT 会导出旧内容
  const saved = await persistTimeline(true);
  if (!saved) return;
  exportError.value = "";
  exportUrl.value = null;
  exportStatus.value = 0;
  exporting.value = true;
  try {
    const res = await api.post<{ export_id: string; status: number }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/export`,
      {},
    );
    exportId.value = res.export_id;
    exportStatus.value = res.status ?? 1;
    pollExport();
  } catch (e) {
    exporting.value = false;
    exportError.value = e instanceof Error ? e.message : t("editor.submitFailed");
    toast.error(t("editor.exportSubmitFailed", { msg: exportError.value }));
  }
}

function pollExport(): void {
  if (exportTimer) clearInterval(exportTimer);
  let tries = 0;
  exportTimer = setInterval(async () => {
    tries += 1;
    try {
      const data = await api.get<{
        export_id: string;
        status: number;
        download_url: string | null;
        error: { message?: string } | null;
      }>(`/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/export/${exportId.value}`);
      exportStatus.value = data.status;
      if (data.status === 3) {
        exportUrl.value = data.download_url;
        exporting.value = false;
        toast.success(t("editor.composeDone"));
        if (exportTimer) clearInterval(exportTimer);
      } else if (data.status === 4) {
        exportError.value = data.error?.message ?? t("editor.composeFailed");
        exporting.value = false;
        toast.error(t("editor.composeFailedWith", { msg: exportError.value }));
        if (exportTimer) clearInterval(exportTimer);
      }
    } catch {
      /* 轮询失败继续，直到超时 */
    }
    if (tries > 150 && exportTimer) {
      // 5 分钟仍未终态：明确告知，不无限转圈
      clearInterval(exportTimer);
      exporting.value = false;
      exportError.value = t("editor.exportTimeout");
    }
  }, 2000);
}

/** 浏览器下载（a[download]）；跨域签名 URL 走原生 href 更稳 */
function downloadComposed(): void {
  if (!exportUrl.value) return;
  const a = document.createElement("a");
  a.href = exportUrl.value;
  a.download = `timeline-${selectedEpisodeId.value}.mp4`;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── 切片发布（timeline_publications：1 排队 / 2 转码中 / 3 可播放 / 4 失败 / 5 已下架）──
const showPublish = ref(false);
// ── 弹窗无障碍：aria-modal + 遮罩关闭 + Esc + Tab 焦点陷阱 + 关闭后焦点归还 ──
const publishPanel = ref<HTMLElement | null>(null);
const clipAssetsPanel = ref<HTMLElement | null>(null);
let modalReturnFocus: HTMLElement | null = null;
/** 任一弹窗打开时，全局 Space / 方向键不得再控制播放与 seek */
const modalOpen = computed(() => showPublish.value || (showClipAssets.value && Boolean(assetClip.value)));
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function rememberFocus(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && !el.closest(".rf-modal")) modalReturnFocus = el;
}

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * 初始焦点落在**面板容器**（tabindex="-1"），而不是第一个可聚焦元素。
 *
 * 原因（U4 e2e 实测）：第一个可聚焦元素是右上角 ✕，弹窗一开焦点就在它身上，
 * 用户按 Space（本意是「别播放」或只是习惯性按键）会直接激活 ✕ 把弹窗关掉，
 * 已输入的标题一起丢。落在容器上：读屏仍会播报 aria-label / 标题，Space 不触发任何按钮，
 * Tab 第一次落到 ✕，方向与视觉焦点顺序一致。
 */
function focusFirstIn(panel: HTMLElement | null): void {
  const target = panel ?? focusablesIn(panel)[0];
  target?.focus();
}

function closeModals(): void {
  if (!modalOpen.value) return;
  showPublish.value = false;
  showClipAssets.value = false;
  const back = modalReturnFocus;
  modalReturnFocus = null;
  void nextTick(() => back?.focus());
}

/** Tab 首尾循环：焦点不能跑到 aria-modal 背后的页面上 */
function trapFocus(ev: KeyboardEvent, panel: HTMLElement | null): void {
  if (ev.key !== "Tab") return;
  const list = focusablesIn(panel);
  if (!list.length) return;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement;
  const inside = panel?.contains(active as Node | null) ?? false;
  // 焦点可能停在面板容器本身（初始焦点）：Shift+Tab 必须回卷到最后一个，否则会漏到弹窗背后
  const atStart = active === first || active === panel || !inside;
  if (ev.shiftKey && atStart) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && (active === last || !inside)) {
    ev.preventDefault();
    first.focus();
  }
}

const publications = ref<TimelinePublicationDto[]>([]);
const pubTitle = ref("");
const pubStartS = ref(0);
const pubEndS = ref(0);
const publishing = ref(false);
const pubError = ref("");
let pubTimer: ReturnType<typeof setInterval> | undefined;
/** 切片最短 1 秒（后端不校验时长，前端是唯一闸门：0.4s 的片子没人能看，还白花一次转码） */
const MIN_SLICE_S = 1;

const PUB_STATUS = computed<Record<number, { text: string; tone: "info" | "success" | "danger" | "neutral" }>>(() => ({
  1: { text: t("editor.pubStatusQueued"), tone: "info" },
  2: { text: t("editor.pubStatusTranscoding"), tone: "info" },
  3: { text: t("editor.pubStatusPlayable"), tone: "success" },
  4: { text: t("editor.pubStatusFailed"), tone: "danger" },
  5: { text: t("editor.pubStatusOffline"), tone: "neutral" },
}));

async function loadPublications(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  try {
    const data = await api.get<{ list: TimelinePublicationDto[]; total: number }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/publications`,
    );
    publications.value = data.list;
  } catch (e) {
    pubError.value = e instanceof Error ? e.message : t("editor.publishLoadFailed");
  }
}

async function openPublish(): Promise<void> {
  rememberFocus();
  showPublish.value = true;
  pubError.value = "";
  pubTitle.value = t("editor.titles.slice", { title: project.value?.title ?? "", episode: episodeLabel.value });
  // 默认整集：起止按当前时间线总时长（单位秒，提交时换算 ms）
  pubStartS.value = 0;
  pubEndS.value = Math.round(totalDuration.value);
  void nextTick(() => focusFirstIn(publishPanel.value));
  await loadPublications();
}

/** 轮询未终态的发布（转码是异步的：1→2→3/4） */
function pollPublications(): void {
  if (pubTimer) clearInterval(pubTimer);
  let tries = 0;
  pubTimer = setInterval(async () => {
    tries += 1;
    await loadPublications();
    const pending = publications.value.some((item) => item.status === 1 || item.status === 2);
    if (!pending || tries > 150) {
      if (pubTimer) clearInterval(pubTimer);
      pubTimer = undefined;
      if (tries > 150) pubError.value = t("editor.transcodeTimeout");
    }
  }, 2000);
}

async function publishSlice(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  const total = Math.round(totalDuration.value);
  // 三道闸门按「上限 → 先后 → 最短」的顺序给可读原因，不让用户对着 500 猜
  if (pubStartS.value < 0) pubStartS.value = 0;
  if (pubEndS.value <= pubStartS.value) {
    pubError.value = t("editor.endAfterStart");
    return;
  }
  if (pubEndS.value > total) {
    pubError.value = t("editor.endBeyondTimeline", { total });
    return;
  }
  if (pubEndS.value - pubStartS.value < MIN_SLICE_S) {
    pubError.value = t("editor.sliceTooShort", { min: MIN_SLICE_S });
    return;
  }
  // 发布读的是服务端时间线：先落库，否则会发出旧内容
  const saved = await persistTimeline(true);
  if (!saved) return;
  publishing.value = true;
  pubError.value = "";
  try {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/publish`,
      {
        title: pubTitle.value.trim() || undefined,
        slice: { start_ms: Math.round(pubStartS.value * 1000), end_ms: Math.round(pubEndS.value * 1000) },
      },
    );
    toast.success(t("editor.publishSubmitted"));
    await loadPublications();
    pollPublications();
  } catch (e) {
    pubError.value = e instanceof Error ? e.message : t("editor.publishFailed");
    toast.error(t("editor.publishFailedWith", { msg: pubError.value }));
  } finally {
    publishing.value = false;
  }
}

async function unpublish(item: TimelinePublicationDto): Promise<void> {
  if (!confirm(t("editor.offlineConfirm", { title: item.title }))) return;
  try {
    await api.delete(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/publications/${item.publication_id}`,
    );
    toast.success(t("editor.offlineDone"));
    await loadPublications();
  } catch (e) {
    pubError.value = e instanceof Error ? e.message : t("editor.offlineFailed");
    toast.error(pubError.value);
  }
}

async function copyShareToken(item: TimelinePublicationDto): Promise<void> {
  if (!item.share_token) return;
  try {
    await navigator.clipboard.writeText(item.share_token);
    toast.success(t("editor.tokenCopied"));
  } catch {
    toast.error(t("editor.copyFailed"));
  }
}

// ── 片段资产绑定（wf/clip-bind-asset，快照语义）────────────────
const showClipAssets = ref(false);
const assetClip = ref<Clip | null>(null);
const clipAssetError = ref("");
const clipAssetBusy = ref(false);
const projectAssetList = ref<
  Array<{ id: string; name: string; kind: string; status: number; ref_image_uri: string | null }>
>([]);

async function openClipAssets(clip: Clip): Promise<void> {
  rememberFocus();
  showClipAssets.value = true;
  assetClip.value = clip;
  clipAssetError.value = "";
  void nextTick(() => focusFirstIn(clipAssetsPanel.value));
  try {
    const data = await api.get<{ list: typeof projectAssetList.value }>(`/projects/${projectId.value}/assets`);
    // 只列已定稿且有参考图的资产：未定稿挂上去在成片里也是空引用
    projectAssetList.value = data.list.filter((asset) => asset.status === 2 && asset.ref_image_uri);
  } catch (e) {
    clipAssetError.value = e instanceof Error ? e.message : t("editor.clipAssetsLoadFailed");
  }
}

/** 当前绑定 → 提交体（快照语义：必须把既有绑定一起带上，否则会被覆盖清空） */
function bindingPayload(clip: Clip, extra?: { assetId?: string; taskId?: string }) {
  const assets = clip.assets ?? [];
  const assetIds = assets.filter((item) => item.source !== "shot_product").map((item) => item.id);
  const existingTask = assets.find((item) => item.source === "shot_product")?.task_id ?? null;
  if (extra?.assetId) assetIds.push(extra.assetId);
  return {
    asset_ids: [...new Set(assetIds)],
    task_id: extra?.taskId ?? existingTask ?? undefined,
  };
}

async function refreshClipAssets(): Promise<void> {
  const clipId = assetClip.value?.clip_id;
  await loadTimeline();
  assetClip.value = clips.value.find((clip) => clip.clip_id === clipId) ?? assetClip.value;
}

async function bindProjectAsset(assetId: string): Promise<void> {
  const clip = assetClip.value;
  if (!clip) return;
  clipAssetBusy.value = true;
  clipAssetError.value = "";
  try {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/clips/${clip.clip_id}/assets`,
      bindingPayload(clip, { assetId }),
    );
    await refreshClipAssets();
    toast.success(t("editor.assetBound"));
  } catch (e) {
    clipAssetError.value = e instanceof Error ? e.message : t("editor.bindFailed");
    toast.error(clipAssetError.value);
  } finally {
    clipAssetBusy.value = false;
  }
}

async function bindShotProductToClip(): Promise<void> {
  const clip = assetClip.value;
  if (!clip || !clip.task_id) {
    clipAssetError.value = t("editor.noShotOutput");
    return;
  }
  clipAssetBusy.value = true;
  try {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/clips/${clip.clip_id}/assets`,
      bindingPayload(clip, { taskId: clip.task_id }),
    );
    await refreshClipAssets();
    toast.success(t("editor.shotBound"));
  } catch (e) {
    clipAssetError.value = e instanceof Error ? e.message : t("editor.bindFailed");
    toast.error(clipAssetError.value);
  } finally {
    clipAssetBusy.value = false;
  }
}

async function clearClipAssets(): Promise<void> {
  const clip = assetClip.value;
  if (!clip) return;
  clipAssetBusy.value = true;
  try {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline/clips/${clip.clip_id}/assets`,
      { clear: true },
    );
    await refreshClipAssets();
    toast.success(t("editor.clearedBinding"));
  } catch (e) {
    clipAssetError.value = e instanceof Error ? e.message : t("editor.clearFailed");
  } finally {
    clipAssetBusy.value = false;
  }
}

// ── 生命周期 ─────────────────────────────────────────────
// 换集：重新载分镜 + 该集时间线（时间线是 per-episode 的）
watch(selectedEpisodeId, async (next, prev) => {
  if (!next || next === prev) return;
  playing.value = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (exportTimer) clearInterval(exportTimer);
  if (pubTimer) clearInterval(pubTimer);
  showPublish.value = false;
  showClipAssets.value = false;
  publications.value = [];
  // 历史栈是按「本集时间线」记的：换集必须清空，否则 Ctrl+Z 会把上一集的片段插到这一集
  historyPast.value = [];
  historyFuture.value = [];
  removedClip.value = null;
  exportStatus.value = 0;
  exportUrl.value = null;
  exportError.value = "";
  await loadEpisode();
  await loadTimeline();
});

function onKeydown(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null;
  // ① Esc 最先处理：弹窗打开时（哪怕焦点在输入框里）都能关
  if (ev.key === "Escape" && modalOpen.value) {
    ev.preventDefault();
    closeModals();
    return;
  }
  // ② 弹窗打开期间不劫持全局快捷键：Space / 方向键留给弹窗自身
  if (modalOpen.value) return;
  // ③ 输入框里不劫持快捷键（输入框内的 Ctrl+Z 必须是原生文本撤销）
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  // ④ 撤销 / 重做：Ctrl+Z / ⌘Z；Shift 变重做；Ctrl+Y 也当重做（Windows 习惯）
  if (ev.ctrlKey || ev.metaKey) {
    const combo = ev.key.toLowerCase();
    if (combo === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redoClips();
      else undoClips();
      return;
    }
    if (combo === "y") {
      ev.preventDefault();
      redoClips();
      return;
    }
  }
  if (ev.code === "Space") {
    ev.preventDefault();
    togglePlay();
  } else if (ev.code === "ArrowLeft") {
    ev.preventDefault();
    seekTo(playhead.value - (ev.shiftKey ? 5 : 1));
  } else if (ev.code === "ArrowRight") {
    ev.preventDefault();
    seekTo(playhead.value + (ev.shiftKey ? 5 : 1));
  }
}

/** 刷新/关闭标签：有未落库改动时先 keepalive 冲一次，再让浏览器弹确认 */
function onBeforeUnload(ev: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  flushPendingSave();
  ev.preventDefault();
  // 现代浏览器忽略文案，但必须赋值 returnValue 才会弹确认
  ev.returnValue = "";
}

/** 切后台/切标签：页面可能再也回不来，先冲一次 */
function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") flushPendingSave();
}

onMounted(async () => {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pagehide", flushPendingSave);
  window.addEventListener("beforeunload", onBeforeUnload);
  document.addEventListener("visibilitychange", onVisibilityChange);
  await bootstrap();
});

onUnmounted(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pagehide", flushPendingSave);
  window.removeEventListener("beforeunload", onBeforeUnload);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (rafId) cancelAnimationFrame(rafId);
  if (exportTimer) clearInterval(exportTimer);
  if (pubTimer) clearInterval(pubTimer);
  if (undoTimer) clearTimeout(undoTimer);
  // 先移除监听、取消定时器，再冲未落库改动（不 await：浏览器不会等）
  flushPendingSave();
});

const episodeLabel = computed(() => {
  const idx = episodes.value.findIndex((e) => e.id === selectedEpisodeId.value);
  if (idx < 0) return t("editor.thisEpisode");
  return t("editor.episodeNo", { n: episodes.value[idx]?.ep_no ?? idx + 1 });
});
</script>

<template>
  <div class="rf">
    <!-- ═════════ 顶栏 64：返回 / 时间线导出（选中）/ 保存 + 集数 + 导出 ═════════ -->
    <header class="rf-top">
      <div class="rf-top__left">
        <NuxtLink :to="`/projects/${projectId}`" class="rf-pill">{{ t("editor.backToStoryboard") }}</NuxtLink>
        <span class="rf-pill rf-pill--on">{{ t("editor.timelineExport") }}</span>
        <Button size="sm" :loading="saving" :disabled="loading" @click="persistTimeline(false)">{{ t("editor.save") }}</Button>
      </div>

      <div class="rf-top__mid">
        <b class="rf-title" :title="project?.title">{{ project?.title ?? t("editor.titleFallback") }}</b>
        <!-- 保存三态（dirty / saving / saved / error）：常驻可见，不只靠 3s 就消失的 toast -->
        <span
          v-if="savePhase !== 'idle'"
          class="rf-save"
          :class="`rf-save--${savePhase}`"
          :data-save-state="savePhase"
          role="status"
          aria-live="polite"
        >
          <i class="rf-save__dot" aria-hidden="true" />{{ savePhaseLabel }}
        </span>
      </div>

      <div class="rf-top__right">
        <select v-if="episodes.length > 1" v-model="selectedEpisodeId" class="rf-select" :aria-label="episodeLabel">
          <option v-for="ep in episodes" :key="ep.id" :value="ep.id">{{ t("editor.episodeNo", { n: ep.ep_no }) }}</option>
        </select>
        <span v-else class="rf-ep">{{ episodeLabel }}</span>

        <Tag v-if="exportStatus" :tone="exportStatus === 4 ? 'danger' : exportStatus === 3 ? 'success' : 'info'" size="sm" dot>
          {{ EXPORT_LABEL[exportStatus] }}
        </Tag>
        <a v-if="exportUrl" :href="exportUrl" class="rf-download" download @click.prevent="downloadComposed">{{ t("editor.downloadMp4") }}</a>
        <Button size="sm" variant="ghost" :disabled="!selectedEpisodeId || loading" @click="openPublish">
          {{ t("editor.publishSlice") }}
        </Button>
        <Button class="rf-export" :loading="exporting" :disabled="!clips.length || loading" @click="startExport">
          {{ exporting ? t("editor.composing") : t("editor.export") }}
        </Button>
        <AccountPills compact />
      </div>
    </header>

    <p v-if="loadError" class="rf-err">{{ loadError }}</p>

    <!-- ═════════ 三区：左栏 298 / 中区播放器 / 底部时间线 164（竞品 1424×805 实测 298 / 1102×164）═════════ -->
    <div class="rf-body" :class="{ 'is-loading': loading }">
      <!-- 左栏「剧集资产」 -->
      <aside class="rf-rail">
        <div class="rf-rail__head">
          <b>{{ t("editor.projectAssets") }}</b>
          <select v-model="railFilter" class="rf-mini" :aria-label="t('editor.materialFilter')">
            <option value="finalized">{{ t("editor.filterFinalized") }}</option>
            <option value="all">{{ t("editor.filterAll") }}</option>
          </select>
        </div>
        <p class="rf-rail__hint">
          {{ t("editor.railHintPrefix") }}<em>{{ t("editor.railHintEm") }}</em>{{ t("editor.railHintSuffix") }}
          <span v-if="railFilter === 'finalized'">
            {{ t("editor.railCount", { finalized: finalizedShots.length, total: shots.length }) }}
          </span>
        </p>

        <div class="rf-list">
          <div
            v-for="row in railRows"
            :key="row.shot.id"
            class="rf-asset"
            :class="{ 'is-draft': !row.finalized, 'is-in': inTimelineShotIds.has(row.shot.id) }"
            :data-shot-no="row.shot.shot_no"
            :data-finalized="row.finalized ? '1' : '0'"
            :role="row.finalized ? 'button' : undefined"
            :tabindex="row.finalized ? 0 : -1"
            :title="row.finalized ? t('editor.railItemTitleOk') : t('editor.railItemTitleLocked')"
            @pointerdown="onRailPointerDown($event, row.shot, row.finalized)"
            @keydown.enter="row.finalized && addShot(row.shot)"
          >
            <span class="rf-asset__thumb">
              <img v-if="row.shot.first_frame_url" :src="row.shot.first_frame_url" alt="" />
              <span v-else>{{ row.shot.shot_no }}</span>
            </span>
            <span class="rf-asset__body">
              <b>{{ row.shot.shot_desc || t("editor.shotClip", { no: row.shot.shot_no }) }}</b>
              <em>
                <template v-if="row.finalized">{{ t("editor.filterFinalized") }} · {{ row.shot.duration_s ?? 5 }}s</template>
                <template v-else>{{ t("editor.railItemTitleLocked") }} · {{ row.shot.status }}</template>
              </em>
            </span>
            <span v-if="row.finalized" class="rf-asset__add" aria-hidden="true">＋</span>
          </div>

          <EmptyState
            v-if="!railRows.length"
            :title="railFilter === 'finalized' ? t('editor.lockTitleNoMaterial') : t('editor.lockTitleNoShot')"
            :description="
              railFilter === 'finalized'
                ? t('editor.railLockedHintFinalized')
                : t('editor.railLockedHintEmpty')
            "
          />
        </div>

        <div class="rf-rail__foot">
          <Button size="sm" variant="ghost" :disabled="loading" @click="rebuildFromStoryboards">{{ t("editor.updateStoryboards") }}</Button>
          <span class="rf-rail__n">{{ t("editor.trackClips", { count: clips.length }) }}</span>
        </div>
      </aside>

      <!-- 中区播放器 -->
      <section class="rf-stage">
        <!--
          撤销 / 重做：键盘 Ctrl+Z / Ctrl+Shift+Z 的**可见**安全网。
          位置对齐竞品（播放器上方居中的两枚图标，1424 下 ≈x836~900 / y85~100）。
        -->
        <div class="rf-hist">
          <button
            type="button"
            class="rf-hist__btn"
            :disabled="!canUndo"
            :title="t('editor.undoTitle')"
            :aria-label="t('editor.undoTitle')"
            data-hist="undo"
            @click="undoClips"
          >
            ↶
          </button>
          <button
            type="button"
            class="rf-hist__btn"
            :disabled="!canRedo"
            :title="t('editor.redoTitle')"
            :aria-label="t('editor.redoTitle')"
            data-hist="redo"
            @click="redoClips"
          >
            ↷
          </button>
        </div>
        <div v-if="previewComposed && exportUrl" class="rf-player">
          <video :src="exportUrl" class="rf-video" controls playsinline />
          <button type="button" class="rf-switch" @click="previewComposed = false">{{ t("editor.backToPreview") }}</button>
        </div>
        <div v-else-if="activeClip && activeClip.url && !activeClip.unplayable" class="rf-player">
          <video
            ref="stageVideo"
            :key="activeClip.clip_id"
            :src="activeClip.url"
            class="rf-video"
            muted
            playsinline
            @error="onVideoError"
          />
        </div>
        <div v-else class="rf-placeholder">
          <span class="rf-placeholder__icon">▶</span>
          <p v-if="activeClip">
            {{ t("editor.clipNoVideo", { name: activeClip.name }) }}
            <em v-if="activeClip.unplayable">{{ t("editor.mockPlaceholderNote") }}</em>
          </p>
          <p v-else>{{ t("editor.pickAssetHint") }}</p>
        </div>

        <!-- 竞品同款紫色气泡：显式说明「不自动同步」 -->
        <div class="rf-bubble">
          <b>{{ t("editor.updateTitle") }}</b>
          <span>{{ t("editor.updateHint") }}</span>
        </div>

        <div v-if="exportUrl" class="rf-exportdone">
          <span>{{ t("editor.exportDone", { status: EXPORT_LABEL[3] }) }}</span>
          <button type="button" class="rf-exportdone__btn" @click="previewComposed = true">{{ t("editor.playComposed") }}</button>
          <button type="button" class="rf-exportdone__btn" @click="downloadComposed">{{ t("editor.downloadMp4") }}</button>
        </div>
      </section>

      <!-- 底部时间线 164 -->
      <footer class="rf-tl">
        <div class="rf-tl__bar">
          <button type="button" class="rf-play" @click="togglePlay">{{ playing ? t("editor.pause") : t("editor.play") }}</button>
          <span class="rf-time">{{ playheadLabel }} / {{ totalLabel }}</span>
          <span class="rf-count">{{ t("editor.countLine", { clips: clips.length, seconds: Math.round(totalDuration) }) }}</span>
          <Button
            size="sm"
            variant="ghost"
            :disabled="!activeClip"
            :title="t('editor.clipAssetsTitle')"
            @click="activeClip && openClipAssets(activeClip)"
          >
            {{ t("editor.clipAssetsBtn") }}
          </Button>
          <span class="rf-spacer" />
          <label class="rf-zoom">
            <span>{{ t("editor.zoom") }}</span>
            <button type="button" class="rf-zoom__btn" :aria-label="t('editor.zoomOut')" @click="pxPerSec = Math.max(MIN_PX_PER_SEC, pxPerSec - 8)">−</button>
            <input v-model.number="pxPerSec" type="range" :min="MIN_PX_PER_SEC" :max="MAX_PX_PER_SEC" step="4" :aria-label="t('editor.zoomRange')" />
            <button type="button" class="rf-zoom__btn" :aria-label="t('editor.zoomIn')" @click="pxPerSec = Math.min(MAX_PX_PER_SEC, pxPerSec + 8)">＋</button>
          </label>
        </div>

        <!-- 轨道：点击空白 seek；片段可拖拽换位、右边缘拖动裁时长 -->
        <div
          ref="trackEl"
          class="rf-track"
          :class="{ 'is-drop': drag?.kind === 'rail' && drag.dropIndex !== null }"
          @click="onTrackClick"
        >
          <div class="rf-ruler">
            <span v-for="tick in ticks" :key="tick" class="rf-tick" :style="{ left: `${tick * pxPerSec}px` }">{{ fmtTime(tick) }}</span>
          </div>

          <div class="rf-clips" :style="{ width: `${trackWidth}px` }">
            <div
              v-for="(clip, i) in clips"
              :key="clip.clip_id"
              class="rf-clip"
              :class="{
                on: activeClipIndex === i,
                'is-dropbefore': dropBeforeIndex === i,
                'is-dragging': drag?.clipId === clip.clip_id && drag.moved,
              }"
              :style="{ width: `${clip.duration * pxPerSec}px` }"
              :data-clip-id="clip.clip_id"
              :data-shot-no="clip.shot_no"
              tabindex="0"
              :aria-label="t('editor.clipAria', { name: clip.name, seconds: clip.duration })"
              @pointerdown="onClipPointerDown($event, clip, 'reorder')"
              @keydown="onClipKeydown($event, clip)"
            >
              <b>{{ clip.name }}</b>
              <em>{{ clip.duration }}s</em>
              <button type="button" class="rf-clip__rm" :title="t('editor.remove')" @pointerdown.stop @click.stop="removeClip(clip.clip_id)">✕</button>
              <!-- 右边缘 = 出点裁剪（入点需后端 clip 契约扩展，这里不假装支持） -->
              <span
                class="rf-clip__trim"
                :title="t('editor.dragDuration')"
                @pointerdown.stop="onClipPointerDown($event, clip, 'trim')"
              />
            </div>

            <p v-if="!clips.length" class="rf-clips__empty">
              {{ t("editor.timelineEmptyTrack") }}
            </p>
            <div class="rf-head" :style="{ left: `${playhead * pxPerSec}px` }" />
          </div>
        </div>
      </footer>
    </div>

    <!-- ═════════ 删除撤销条：误删可还原（8s）═════════ -->
    <div v-if="removedClip" class="rf-undo" role="status">
      <span class="rf-undo__text">{{ t("editor.clipRemoved", { name: removedClip.clip.name }) }}</span>
      <button type="button" class="rf-undo__btn" @click="undoRemoveClip">{{ t("editor.undo") }}</button>
    </div>

    <!-- ═════════ 切片发布（wf/publish + wf/video-slicing）═════════ -->
    <div
      v-if="showPublish"
      class="rf-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('editor.publishModalAria')"
      @click.self="closeModals"
    >
      <div ref="publishPanel" class="rf-modal__panel" tabindex="-1" @keydown="trapFocus($event, publishPanel)">
        <header class="rf-modal__head">
          <b>{{ t("editor.publishSlice") }}</b>
          <button
            type="button"
            class="rf-modal__x"
            :aria-label="t('editor.closeModal')"
            @click="closeModals"
          >✕</button>
        </header>
        <p class="rf-modal__hint">
          {{ t("editor.publishIntro") }}
        </p>
        <p v-if="pubError" class="rf-modal__err">{{ pubError }}</p>

        <div class="rf-form">
          <label>
            <span>{{ t("editor.publishTitleLabel") }}</span>
            <input v-model="pubTitle" class="rf-input" maxlength="100" :placeholder="t('editor.publishTitlePlaceholder')" />
          </label>
          <label>
            <span>{{ t("editor.startLabel") }}</span>
            <input
              v-model.number="pubStartS"
              class="rf-input"
              type="number"
              min="0"
              :max="Math.max(0, Math.round(totalDuration) - 1)"
              step="1"
            />
          </label>
          <label>
            <span>{{ t("editor.endLabel") }}</span>
            <input
              v-model.number="pubEndS"
              class="rf-input"
              type="number"
              :min="Math.round(pubStartS) + 1"
              :max="Math.round(totalDuration)"
              step="1"
            />
          </label>
          <Button size="sm" :loading="publishing" :disabled="!clips.length" @click="publishSlice">
            {{ t("editor.publishAction") }}
          </Button>
        </div>

        <div class="rf-pub-list">
          <div v-for="item in publications" :key="item.publication_id" class="rf-pub">
            <span class="rf-pub__title" :title="item.title">{{ item.title }}</span>
            <Tag
              :tone="PUB_STATUS[item.status]?.tone ?? 'neutral'"
              size="sm"
              dot
            >
              {{ PUB_STATUS[item.status]?.text ?? item.status }}
            </Tag>
            <span class="rf-pub__slice">
              {{ Math.round((item.slice.start_ms ?? 0) / 1000) }}s ~
              {{ Math.round((item.slice.end_ms ?? 0) / 1000) }}s
            </span>
            <!--
              裁剪状态必须可见：只在后端留 transcode_mode、前端不显示，等于没人会发现
              "我以为是 30s 切片，其实是整片复制"。status=3 才有意义（转码前还没决定方式）。
            -->
            <span
              v-if="item.status === 3 && item.transcode_mode"
              class="rf-pub__trim"
              :class="item.transcode_mode === 'ffmpeg' ? 'rf-pub__trim--ok' : 'rf-pub__trim--warn'"
              :title="
                item.transcode_mode === 'ffmpeg'
                  ? t('editor.pubTrimFfmpeg')
                  : t('editor.pubTrimCopyReason', { reason: item.transcode_reason ?? '—' })
              "
            >
              {{ item.transcode_mode === "ffmpeg" ? t("editor.pubTrimFfmpeg") : t("editor.pubTrimCopy") }}
            </span>
            <a v-if="item.download_url" :href="item.download_url" class="rf-pub__dl" download>{{ t("editor.download") }}</a>
            <button
              v-if="item.share_token"
              type="button"
              class="rf-pub__btn"
              :title="t('editor.copyTokenTitle')"
              @click="copyShareToken(item)"
            >
              {{ t("editor.copyToken") }}
            </button>
            <a v-if="item.status === 3" :href="`/share/${item.share_token}`" target="_blank" class="rf-pub__btn">
              {{ t("editor.sharePage") }}
            </a>
            <button
              v-if="item.status !== 5"
              type="button"
              class="rf-pub__btn is-danger"
              @click="unpublish(item)"
            >
              {{ t("editor.offline") }}
            </button>
          </div>
          <p v-if="publications.length === 0" class="rf-modal__hint">{{ t("editor.noPublications") }}</p>
        </div>
      </div>
    </div>

    <!-- ═════════ 片段资产（wf/clip-bind-asset，快照语义）═════════ -->
    <div
      v-if="showClipAssets && assetClip"
      class="rf-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('editor.clipAssetsModalAria')"
      @click.self="closeModals"
    >
      <div ref="clipAssetsPanel" class="rf-modal__panel" tabindex="-1" @keydown="trapFocus($event, clipAssetsPanel)">
        <header class="rf-modal__head">
          <b>{{ t("editor.clipAssetsTitleWith", { name: assetClip.name }) }}</b>
          <button
            type="button"
            class="rf-modal__x"
            :aria-label="t('editor.closeModal')"
            @click="closeModals"
          >✕</button>
        </header>
        <p class="rf-modal__hint">
          {{ t("editor.clipAssetsIntro") }}
        </p>
        <p v-if="clipAssetError" class="rf-modal__err">{{ clipAssetError }}</p>

        <div class="rf-form">
          <Button size="sm" variant="ghost" :loading="clipAssetBusy" @click="bindShotProductToClip">
            {{ t("editor.bindShotOutput") }}
          </Button>
          <Button size="sm" variant="ghost" :disabled="clipAssetBusy" @click="clearClipAssets">{{ t("editor.clearBinding") }}</Button>
        </div>

        <div class="rf-assets">
          <div v-for="asset in assetClip.assets ?? []" :key="`${asset.source}:${asset.id}`" class="rf-asset-row">
            <span class="rf-asset-row__src">{{ asset.source }}</span>
            <span class="rf-asset-row__name">{{ asset.name }}</span>
            <span class="rf-asset-row__uri" :title="asset.uri">{{ asset.uri }}</span>
          </div>
          <p v-if="!(assetClip.assets ?? []).length" class="rf-modal__hint">{{ t("editor.noClipAssets") }}</p>
        </div>

        <p class="rf-modal__hint">{{ t("editor.pickFromFinalized") }}</p>
        <div class="rf-assets">
          <button
            v-for="asset in projectAssetList"
            :key="asset.id"
            type="button"
            class="rf-pub__btn"
            :disabled="clipAssetBusy"
            @click="bindProjectAsset(asset.id)"
          >
            {{ asset.name }} · {{ asset.kind }}
          </button>
          <p v-if="projectAssetList.length === 0" class="rf-modal__hint">{{ t("editor.noProjectAssets") }}</p>
        </div>
      </div>
    </div>

    <!-- 拖拽跟随气泡 -->
    <div v-if="dragGhost" class="rf-ghost" :style="{ left: `${dragGhost.x + 12}px`, top: `${dragGhost.y + 12}px` }">
      {{ dragGhost.label }}
    </div>

    <p v-if="info || exportError" class="rf-note" :class="{ 'is-err': Boolean(exportError) }">
      {{ exportError || info }}
    </p>
  </div>
</template>

<style scoped>
/* 整页固定视口：编辑器不整页滚动，三区各自内部滚动（与 /projects 时间线视图同款） */
.rf {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
  background: var(--bg-app);
  overflow: hidden;
}

/* ── 顶栏 64 ── */
.rf-top {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px 0 8px;
}
.rf-top__left,
.rf-top__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rf-top__mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 4px;
}
.rf-title {
  font-size: 14px;
  color: var(--text-2);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 保存状态：dirty / saving / saved / error 四色同形（圆点 + 文案），不靠 toast 一闪而过 */
.rf-save {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--text-4);
}
.rf-save__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
}
.rf-save--dirty {
  color: var(--warning);
}
.rf-save--saving {
  color: var(--text-3);
}
.rf-save--saving .rf-save__dot {
  animation: rf-save-pulse 900ms ease-in-out infinite;
}
.rf-save--saved {
  color: var(--success);
}
.rf-save--error {
  color: var(--danger);
}
@keyframes rf-save-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.rf-pill {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--panel-tint);
  color: #ffffffcc;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.rf-pill:hover {
  color: #fff;
  background: var(--panel-tint-strong);
}
/* 选中态：品牌 40%（竞品实测 rgba(155,70,255,.4)） */
.rf-pill--on {
  background: var(--brand-40);
  color: #fff;
  cursor: default;
}
.rf-ep {
  font-size: 13px;
  color: var(--text-3);
  white-space: nowrap;
}
.rf-select {
  height: 32px;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  color: var(--text-2);
  font-size: 13px;
}
.rf-download {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--success-bg);
  color: var(--success);
  font-size: 13px;
  font-weight: 600;
}
.rf-export {
  height: 40px !important;
  border-radius: 10px !important;
  font-weight: 700;
}

.rf-err {
  margin: 0 0 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
}

/* ── 三区网格：左栏 298 跨两行；右列上=播放器，下=时间线 164 ──
 * 竞品 1424×805 实测：左栏 x8~306（298）、时间线块 1102×164（x314~1416, y633~797）。
 * 本页 .rf 左右内距 8 + 列间距 8，故 1424 → 298 + 8 + 1102 = 1408 正好；
 * 时间线 164 + 8 间距 + 64 顶栏 + 8 底部内距 = 805 → 上沿 y633，与竞品同位。
 */
.rf-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 298px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 164px;
  gap: 8px;
}
.rf-body.is-loading {
  opacity: 0.6;
  pointer-events: none;
}

/* ── 左栏「剧集资产」 ── */
.rf-rail {
  grid-row: 1 / span 2;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-panel);
  background: var(--panel-tint);
  overflow: hidden;
}
.rf-rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  color: var(--text-1);
}
.rf-mini {
  height: 26px;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-2);
  font-size: 12px;
}
.rf-rail__hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.rf-rail__hint em {
  color: var(--brand-300);
  font-style: normal;
}
.rf-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}
.rf-asset {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.26);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.rf-asset:hover {
  border-color: var(--border-3);
  background: rgba(0, 0, 0, 0.36);
}
.rf-asset.is-in {
  border-color: var(--brand-border);
}
/* 未定稿：可见但不可拖/不可点（显式解释闸门，而不是让它凭空消失） */
.rf-asset.is-draft {
  opacity: 0.55;
  cursor: not-allowed;
}
.rf-asset__thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #2a2140, #17141f);
  color: var(--text-4);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rf-asset__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rf-asset__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rf-asset__body b {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rf-asset__body em {
  font-style: normal;
  font-size: 10px;
  color: var(--text-4);
}
.rf-asset__add {
  color: var(--brand-300);
  font-size: 14px;
  text-align: center;
}
.rf-rail__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-1);
}
.rf-rail__n {
  font-size: 11px;
  color: var(--text-4);
}

/* ── 中区播放器 ── */
.rf-stage {
  position: relative;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  border-radius: var(--radius-panel);
  background: var(--bg-sunken);
  overflow: hidden;
}
.rf-player {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.rf-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  background: #000;
}
.rf-hist {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  gap: 6px;
}
.rf-hist__btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgb(0 0 0 / 34%);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.rf-hist__btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.rf-hist__btn:hover:not(:disabled) {
  border-color: var(--brand-500);
  color: var(--brand-300);
}
.rf-switch {
  position: absolute;
  top: 4px;
  right: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: #000000b0;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.rf-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-4);
  font-size: 13px;
  text-align: center;
  max-width: 420px;
}
.rf-placeholder__icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--panel-tint);
  font-size: 20px;
  opacity: 0.8;
}
.rf-placeholder em {
  font-style: normal;
  color: var(--text-5);
  font-size: 11px;
}
/* 竞品同款紫色提示气泡（右下角） */
.rf-bubble {
  position: absolute;
  right: 12px;
  bottom: 12px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--brand-40);
  color: #fff;
}
.rf-bubble b {
  font-size: 12px;
  font-weight: 700;
}
.rf-bubble span {
  font-size: 11px;
  line-height: 1.5;
  color: #ffffffd8;
}
.rf-exportdone {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: #0f2a1cd0;
  border: 1px solid #1d5c3c;
  color: var(--success);
  font-size: 12px;
}
.rf-exportdone__btn {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #1d5c3c;
  background: transparent;
  color: var(--success);
  font-size: 11px;
  cursor: pointer;
}

/* ── 底部时间线（高 164，竞品 1102×164） ── */
.rf-tl {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-panel);
  background: var(--panel-tint);
  overflow: hidden;
}
.rf-tl__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
}
.rf-play {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: var(--brand-500);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.rf-play:hover {
  background: var(--brand-600);
}
.rf-time {
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.rf-count {
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.rf-spacer {
  flex: 1;
}
.rf-zoom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-4);
}
.rf-zoom input {
  width: 100px;
  accent-color: var(--brand-500);
}
.rf-zoom__btn {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.rf-track {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.34);
  padding: 18px 0 6px;
  transition: box-shadow var(--duration-fast);
}
/* 从左栏拖过来时高亮，明确"可以放这里" */
.rf-track.is-drop {
  box-shadow: inset 0 0 0 1px var(--brand-500);
}
.rf-ruler {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 16px;
  pointer-events: none;
}
.rf-tick {
  position: absolute;
  top: 1px;
  font-size: 10px;
  color: var(--text-5);
  font-variant-numeric: tabular-nums;
  transform: translateX(2px);
  white-space: nowrap;
}
.rf-clips {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 100%;
  max-height: 96px;
  padding-left: 2px;
}
.rf-clip {
  position: relative;
  min-width: 40px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: linear-gradient(160deg, #2a2140, #17141f);
  color: var(--text-2);
  padding: 6px 8px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.rf-clip:hover {
  border-color: var(--border-3);
}
.rf-clip.on {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}
.rf-clip.is-dragging {
  opacity: 0.45;
}
/* 插入位置指示线（拖拽换位时） */
.rf-clip.is-dropbefore::before {
  content: "";
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--brand-400);
}
.rf-clip b {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rf-clip em {
  font-style: normal;
  font-size: 10px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.rf-clip__rm {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 4px;
  background: #000000a8;
  color: var(--text-2);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.rf-clip:hover .rf-clip__rm {
  opacity: 1;
}
/* 右边缘裁剪把手 */
.rf-clip__trim {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  background: linear-gradient(90deg, transparent, #ffffff24);
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.rf-clip:hover .rf-clip__trim {
  opacity: 1;
}
.rf-clips__empty {
  margin: 0;
  padding: 14px 10px;
  font-size: 12px;
  color: var(--text-4);
  white-space: nowrap;
}
.rf-head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--brand-500);
  pointer-events: none;
}

/* 拖拽跟随 */
.rf-ghost {
  position: fixed;
  z-index: var(--z-modal);
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--brand-40);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
  backdrop-filter: blur(4px);
}

.rf-note {
  margin: 0;
  padding: 0 4px;
  font-size: 11px;
  color: var(--text-4);
}
.rf-note.is-err {
  color: var(--danger);
}

/* 窄屏：左栏降到上方（保底可用，不是主场景） */
@media (max-width: 1100px) {
  .rf-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 180px minmax(0, 1fr) 164px;
  }
  .rf-rail {
    grid-row: 1;
    grid-column: 1;
  }
}

/* ═════════ 切片发布 / 片段资产 浮层（wf/publish + wf/clip-bind-asset）═════════ */
/* 删除撤销条：底部居中，压在时间线上方，8s 自动消失 */
.rf-undo {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: var(--z-toast, 60);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-btn, 10px);
  border: 1px solid var(--panel-line);
  background: var(--bg-surface);
  box-shadow: var(--shadow-pop, 0 10px 30px rgb(0 0 0 / 45%));
  font-size: 13px;
  color: var(--text-1);
}
.rf-undo__text {
  max-width: 46vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rf-undo__btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--brand, #9b46ff);
  background: transparent;
  color: var(--brand, #9b46ff);
  font-size: 13px;
  cursor: pointer;
}
.rf-undo__btn:hover {
  background: rgb(155 70 255 / 12%);
}
.rf-modal {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}
.rf-modal__panel {
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100dvh - 80px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--bg-surface);
}
.rf-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  color: var(--text-1);
}
.rf-modal__x {
  width: 24px;
  height: 24px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.rf-modal__hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.rf-modal__err {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
}
.rf-form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.rf-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-4);
}
.rf-input {
  height: 28px;
  min-width: 120px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-1);
  font-size: 12px;
  outline: none;
}
.rf-input:focus {
  border-color: var(--brand-500);
}
.rf-pub-list,
.rf-assets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow: auto;
  padding-right: 2px;
}
.rf-pub {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) auto auto auto auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.24);
  font-size: 12px;
  color: var(--text-2);
}
.rf-pub__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}
.rf-pub__slice {
  font-variant-numeric: tabular-nums;
  color: var(--text-4);
  font-size: 11px;
}
.rf-pub__dl {
  color: var(--success);
  font-size: 11px;
}
.rf-pub__btn {
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.rf-pub__btn:hover {
  border-color: var(--brand-500);
  color: var(--brand-300);
}
.rf-pub__btn.is-danger {
  border-color: var(--danger);
  color: var(--danger);
}
.rf-asset-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}
.rf-asset-row__src {
  color: var(--text-4);
}
.rf-asset-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}
.rf-asset-row__uri {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-5);
}
</style>
