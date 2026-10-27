<script setup lang="ts">
import type { EpisodeDto, ProjectDto, StoryboardDto } from "~/types/api";

/**
 * ReelFlow 剪辑台（对齐竞品 /reelflow/edit/:projectId）
 *
 * 结构（竞品登录态实测，docs/03-frontend/reference-reelflow-spec.md §4.2 FLOW:77-86）：
 *   顶栏 64      ← 返回分镜创作 / 时间线导出（选中态）/ 保存 + 右侧集数选择、导出
 *   左栏 290     ← 「剧集资产」，只列**已定稿**的分镜素材（一致性闸门）
 *   中区          ← 播放器 + 「请在左侧选择分镜资产加入至时间线」
 *   底部 150      ← 时间线轨道（片段可拖拽排序 / 可裁剪时长）+ 播放头 + 缩放 + 刻度尺
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
useHead({ title: "时间线导出 · 一帧" });

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

/** 闸门：出片完成且有视频任务 = 可进成片的料 */
function isFinalized(shot: StoryboardDto): boolean {
  return shot.status === 5 && Boolean(shot.video_task_id);
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
  if (!selectedEpisodeId.value) selectedEpisodeId.value = data.episodes[0]?.id ?? "";
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
  const data = await api.get<{ clips: Array<{ clip_id: string; shot_id: string; task_id: string | null; name: string; duration: number }> }>(
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
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

// ── 保存（显式 + 防抖）────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const dirty = ref(false);

function scheduleSave(): void {
  dirty.value = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistTimeline(true), 700);
}

async function persistTimeline(silent: boolean): Promise<boolean> {
  if (!selectedEpisodeId.value) return false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  saving.value = true;
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
    );
    // 服务端会回填/重建 clip_id：同步回本地，否则下次覆盖写会一直新建 id
    if (Array.isArray(res.clips) && res.clips.length === clips.value.length) {
      const ids = res.clips.map((c) => c.clip_id);
      clips.value = clips.value.map((c, i) => ({ ...c, clip_id: ids[i] ?? c.clip_id }));
    }
    dirty.value = false;
    if (!silent) toast.success("时间线已保存");
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? `保存失败：${e.message}` : "保存失败");
    return false;
  } finally {
    saving.value = false;
  }
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
    name: `分镜 ${shot.shot_no}`,
    // 后端契约：duration 整数 1..30；分镜时长可能为 null
    duration: Math.min(30, Math.max(1, Math.round(shot.duration_s ?? 5))),
    url: null,
    shot_no: shot.shot_no,
  };
}

const info = ref("");

async function addShot(shot: StoryboardDto, atIndex?: number): Promise<void> {
  if (!isFinalized(shot)) {
    toast.error(`分镜 ${shot.shot_no} 还没定稿：先在分镜页投递并等出片`);
    return;
  }
  const clip = clipFromShot(shot);
  const list = [...clips.value];
  const index = atIndex === undefined ? list.length : Math.max(0, Math.min(list.length, atIndex));
  list.splice(index, 0, clip);
  clips.value = list;
  if (clip.task_id) {
    const url = await clipUrl(clip.task_id);
    const target = clips.value.find((c) => c.clip_id === clip.clip_id);
    if (target) target.url = url;
  }
  scheduleSave();
  info.value = `已加入 ${clip.name}`;
}

function removeClip(clipId: string): void {
  clips.value = clips.value.filter((c) => c.clip_id !== clipId);
  if (playhead.value > totalDuration.value) playhead.value = totalDuration.value;
  scheduleSave();
}

/**
 * 「更新分镜」= 显式同步（竞品原话：时间线材料不会自动更新）。
 * 语义：按本集全部已定稿镜头重建轨道；**已存在的镜头保留用户裁过的时长与顺序**，
 * 只补新增的、去掉已不再定稿的。这样点一下不会把剪辑成果清零。
 */
async function rebuildFromStoryboards(): Promise<void> {
  const finals = finalizedShots.value;
  if (!finals.length) {
    toast.error("本集还没有已定稿镜头：先去分镜页投递并等出片");
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
  clips.value = rebuilt;
  playhead.value = Math.min(playhead.value, totalDuration.value);
  await hydrateClipUrls();
  scheduleSave();
  toast.success(
    removed > 0
      ? `已按 ${finals.length} 个已定稿镜头同步（移除 ${removed} 个不再定稿的片段）`
      : `已按 ${finals.length} 个已定稿镜头同步`,
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
}

const drag = ref<DragState | null>(null);
const dragGhost = ref<{ x: number; y: number; label: string } | null>(null);
const trackEl = ref<HTMLElement | null>(null);

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
    toast.error(`分镜 ${shot.shot_no} 未定稿，不能进入时间线`);
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
  };
  dragGhost.value = { x: ev.clientX, y: ev.clientY, label: `分镜 ${shot.shot_no}` };
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
    dragGhost.value = { x: ev.clientX, y: ev.clientY, label: state.shot ? `分镜 ${state.shot.shot_no}` : "" };
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
    if (state.shot && state.dropIndex !== null) {
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
    // 移除后目标索引要按原位置回退一位
    const insertAt = Math.max(0, Math.min(list.length, to > from ? to - 1 : to));
    list.splice(insertAt, 0, item);
    clips.value = list;
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
    toast.error("时间线还是空的：从左侧点选分镜加入");
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

const EXPORT_LABEL: Record<number, string> = {
  0: "",
  1: "排队中",
  2: "渲染中",
  3: "已完成",
  4: "失败",
};

async function startExport(): Promise<void> {
  if (!clips.value.length) {
    toast.error("时间线为空：先把分镜加入时间线");
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
    exportError.value = e instanceof Error ? e.message : "提交失败";
    toast.error(`导出提交失败：${exportError.value}`);
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
        toast.success("合成完成，可下载 mp4（含 AI 生成水印）");
        if (exportTimer) clearInterval(exportTimer);
      } else if (data.status === 4) {
        exportError.value = data.error?.message ?? "合成失败";
        exporting.value = false;
        toast.error(`合成失败：${exportError.value}`);
        if (exportTimer) clearInterval(exportTimer);
      }
    } catch {
      /* 轮询失败继续，直到超时 */
    }
    if (tries > 150 && exportTimer) {
      // 5 分钟仍未终态：明确告知，不无限转圈
      clearInterval(exportTimer);
      exporting.value = false;
      exportError.value = "导出超时（5 分钟未完成），请到任务中心查看";
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
  exportStatus.value = 0;
  exportUrl.value = null;
  exportError.value = "";
  await loadEpisode();
  await loadTimeline();
});

function onKeydown(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null;
  // 输入框里不劫持快捷键
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
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

onMounted(async () => {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeydown);
  await bootstrap();
});

onUnmounted(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  window.removeEventListener("keydown", onKeydown);
  if (rafId) cancelAnimationFrame(rafId);
  if (saveTimer) clearTimeout(saveTimer);
  if (exportTimer) clearInterval(exportTimer);
});

const episodeLabel = computed(() => {
  const idx = episodes.value.findIndex((e) => e.id === selectedEpisodeId.value);
  if (idx < 0) return "本集";
  return `第${episodes.value[idx]?.ep_no ?? idx + 1}集`;
});
</script>

<template>
  <div class="rf">
    <!-- ═════════ 顶栏 64：返回 / 时间线导出（选中）/ 保存 + 集数 + 导出 ═════════ -->
    <header class="rf-top">
      <div class="rf-top__left">
        <NuxtLink :to="`/projects/${projectId}`" class="rf-pill">← 返回分镜创作</NuxtLink>
        <span class="rf-pill rf-pill--on">时间线导出</span>
        <Button size="sm" :loading="saving" :disabled="loading" @click="persistTimeline(false)">保存</Button>
      </div>

      <div class="rf-top__mid">
        <b class="rf-title" :title="project?.title">{{ project?.title ?? "剪辑台" }}</b>
        <span v-if="dirty" class="rf-dirty">未保存</span>
      </div>

      <div class="rf-top__right">
        <select v-if="episodes.length > 1" v-model="selectedEpisodeId" class="rf-select" :aria-label="episodeLabel">
          <option v-for="ep in episodes" :key="ep.id" :value="ep.id">第{{ ep.ep_no }}集</option>
        </select>
        <span v-else class="rf-ep">{{ episodeLabel }}</span>

        <Tag v-if="exportStatus" :tone="exportStatus === 4 ? 'danger' : exportStatus === 3 ? 'success' : 'info'" size="sm" dot>
          {{ EXPORT_LABEL[exportStatus] }}
        </Tag>
        <a v-if="exportUrl" :href="exportUrl" class="rf-download" download @click.prevent="downloadComposed">下载 mp4</a>
        <Button class="rf-export" :loading="exporting" :disabled="!clips.length || loading" @click="startExport">
          {{ exporting ? "合成中…" : "导出" }}
        </Button>
      </div>
    </header>

    <p v-if="loadError" class="rf-err">{{ loadError }}</p>

    <!-- ═════════ 三区：左栏 290 / 中区播放器 / 底部时间线 150 ═════════ -->
    <div class="rf-body" :class="{ 'is-loading': loading }">
      <!-- 左栏「剧集资产」 -->
      <aside class="rf-rail">
        <div class="rf-rail__head">
          <b>剧集资产</b>
          <select v-model="railFilter" class="rf-mini" aria-label="素材筛选">
            <option value="finalized">已定稿</option>
            <option value="all">全部</option>
          </select>
        </div>
        <p class="rf-rail__hint">
          只列<em>已定稿</em>（出片完成）的分镜素材——未定稿进不了时间线。
          <span v-if="railFilter === 'finalized'">
            共 {{ finalizedShots.length }} / {{ shots.length }} 个镜头。
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
            :title="row.finalized ? '点击加入时间线，或拖到下方轨道' : '未定稿：先去分镜页投递并等出片'"
            @pointerdown="onRailPointerDown($event, row.shot, row.finalized)"
            @keydown.enter="row.finalized && addShot(row.shot)"
          >
            <span class="rf-asset__thumb">
              <img v-if="row.shot.first_frame_url" :src="row.shot.first_frame_url" alt="" />
              <span v-else>{{ row.shot.shot_no }}</span>
            </span>
            <span class="rf-asset__body">
              <b>{{ row.shot.shot_desc || `分镜 ${row.shot.shot_no}` }}</b>
              <em>
                <template v-if="row.finalized">已定稿 · {{ row.shot.duration_s ?? 5 }}s</template>
                <template v-else>未定稿 · 状态 {{ row.shot.status }}</template>
              </em>
            </span>
            <span v-if="row.finalized" class="rf-asset__add" aria-hidden="true">＋</span>
          </div>

          <EmptyState
            v-if="!railRows.length"
            :title="railFilter === 'finalized' ? '暂无素材' : '本集还没有分镜'"
            :description="
              railFilter === 'finalized'
                ? '本集还没有已定稿的分镜素材：去分镜页投递并等出片，再点「更新分镜」'
                : '先去分镜页生成分镜，再投递出片'
            "
          />
        </div>

        <div class="rf-rail__foot">
          <Button size="sm" variant="ghost" :disabled="loading" @click="rebuildFromStoryboards">更新分镜</Button>
          <span class="rf-rail__n">轨道 {{ clips.length }} 段</span>
        </div>
      </aside>

      <!-- 中区播放器 -->
      <section class="rf-stage">
        <div v-if="previewComposed && exportUrl" class="rf-player">
          <video :src="exportUrl" class="rf-video" controls playsinline />
          <button type="button" class="rf-switch" @click="previewComposed = false">回到分镜预览</button>
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
            {{ activeClip.name }} 暂无可用视频文件
            <em v-if="activeClip.unplayable">（当前是 mock 适配器的占位字节，配真实 Key 后即可播放）</em>
          </p>
          <p v-else>请在左侧选择分镜资产加入至时间线</p>
        </div>

        <!-- 竞品同款紫色气泡：显式说明「不自动同步」 -->
        <div class="rf-bubble">
          <b>更新分镜</b>
          <span>时间线材料不会自动更新，点「更新分镜」将同步分镜创作页的全部定稿素材。</span>
        </div>

        <div v-if="exportUrl" class="rf-exportdone">
          <span>合成完成 · {{ EXPORT_LABEL[3] }}</span>
          <button type="button" class="rf-exportdone__btn" @click="previewComposed = true">播放成片</button>
          <button type="button" class="rf-exportdone__btn" @click="downloadComposed">下载 mp4</button>
        </div>
      </section>

      <!-- 底部时间线 150 -->
      <footer class="rf-tl">
        <div class="rf-tl__bar">
          <button type="button" class="rf-play" @click="togglePlay">{{ playing ? "暂停" : "播放" }}</button>
          <span class="rf-time">{{ playheadLabel }} / {{ totalLabel }}</span>
          <span class="rf-count">{{ clips.length }} 段 · 共 {{ Math.round(totalDuration) }}s</span>
          <span class="rf-spacer" />
          <label class="rf-zoom">
            <span>缩放</span>
            <button type="button" class="rf-zoom__btn" aria-label="缩小" @click="pxPerSec = Math.max(MIN_PX_PER_SEC, pxPerSec - 8)">−</button>
            <input v-model.number="pxPerSec" type="range" :min="MIN_PX_PER_SEC" :max="MAX_PX_PER_SEC" step="4" aria-label="时间线缩放" />
            <button type="button" class="rf-zoom__btn" aria-label="放大" @click="pxPerSec = Math.min(MAX_PX_PER_SEC, pxPerSec + 8)">＋</button>
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
            <span v-for="t in ticks" :key="t" class="rf-tick" :style="{ left: `${t * pxPerSec}px` }">{{ fmtTime(t) }}</span>
          </div>

          <div class="rf-clips" :style="{ width: `${trackWidth}px` }">
            <div
              v-for="(clip, i) in clips"
              :key="clip.clip_id"
              class="rf-clip"
              :class="{
                on: activeClipIndex === i,
                'is-dropbefore': drag?.dropIndex === i,
                'is-dragging': drag?.clipId === clip.clip_id && drag.moved,
              }"
              :style="{ width: `${clip.duration * pxPerSec}px` }"
              :data-clip-id="clip.clip_id"
              :data-shot-no="clip.shot_no"
              tabindex="0"
              :aria-label="`${clip.name} ${clip.duration} 秒`"
              @pointerdown="onClipPointerDown($event, clip, 'reorder')"
              @keydown="onClipKeydown($event, clip)"
            >
              <b>{{ clip.name }}</b>
              <em>{{ clip.duration }}s</em>
              <button type="button" class="rf-clip__rm" title="移除" @pointerdown.stop @click.stop="removeClip(clip.clip_id)">✕</button>
              <!-- 右边缘 = 出点裁剪（入点需后端 clip 契约扩展，这里不假装支持） -->
              <span
                class="rf-clip__trim"
                title="拖动调整时长（出点）"
                @pointerdown.stop="onClipPointerDown($event, clip, 'trim')"
              />
            </div>

            <p v-if="!clips.length" class="rf-clips__empty">
              时间线为空：从左侧点选分镜加入，或把分镜拖到这条轨道上
            </p>
            <div class="rf-head" :style="{ left: `${playhead * pxPerSec}px` }" />
          </div>
        </div>
      </footer>
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
.rf-dirty {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--warning);
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

/* ── 三区网格：左栏 290 跨两行；右列上=播放器，下=时间线 150 ── */
.rf-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 150px;
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

/* ── 底部时间线（高 150） ── */
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
    grid-template-rows: 180px minmax(0, 1fr) 150px;
  }
  .rf-rail {
    grid-row: 1;
    grid-column: 1;
  }
}
</style>
