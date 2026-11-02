<script setup lang="ts">
import type {
  CharacterDto,
  EpisodeDto,
  ExportDto,
  MatrixDto,
  MatrixShot,
  MatchEntryDto,
  MatchResultDto,
  ModelDto,
  ProjectAssetDto,
  ProjectDto,
  StoryboardDto,
  TaskDto,
} from "~/types/api";
import { statusLabel } from "~/types/api";
import {
  isShotCommitted,
  isShotFinalized,
  isShotInFlight,
  isShotRendered,
} from "~/utils/shot-status";

// 沉浸式工作台（对齐竞品 /series-manage/episode/:id）：无全站侧栏、单一 64px 顶栏。
// 之前用 layout:"app" 会多出 240px 侧栏 + 64px 全局顶栏，工作台可用区从 1424×741
// 缩到 1152×661（右生成台少 180px）；blank 壳把这两块空间还给三列，账户入口改由
// 页面顶栏的 <AccountPills /> 承载（见 docs/03-frontend/competitor-ui-comparison.md §3.3/§4.1）。
definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });

interface BatchItem {
  shot_id: string;
  task_id: string | null;
  submitted: boolean;
  code?: number;
  reason?: string;
}

const { t, locale } = useI18n();
useHead({ title: () => t("projectDetail.metaTitle") });

const api = useApi();
const route = useRoute();
const projectId = computed(() => String(route.params.id));

const project = ref<ProjectDto | null>(null);
const episodes = ref<EpisodeDto[]>([]);
const characters = ref<CharacterDto[]>([]);
const selectedEpisodeId = ref("");
const episode = ref<EpisodeDto | null>(null);
const shots = ref<StoryboardDto[]>([]);
const models = ref<ModelDto[]>([]);
const modelName = ref("wan-3.0");
const budget = ref(1000);
const shotCount = ref(10);
const tab = ref<"outline" | "characters" | "storyboards" | "batch" | "timeline" | "confirm">("storyboards");

/**
 * 进入项目时该落在哪一步（第 105 批 QA 修）。
 *
 * 原来 `tab` 无条件初始化成 `storyboards`（分镜），于是**刚导入小说、还没有分集**的项目
 * 一进来就是第 ③ 步：左边「分镜(0)」、中间写着「选择左上『AI拆分镜』」，
 * 而页面自己的 banner 却在提示「先在 第 ① 步点『生成大纲』」——
 * 等于把用户放进一个做不了任何事的房间，再让他自己找门。
 *
 * 正确口径：**落到第一个未完成的步骤**（与 banner 的指引一致）：
 *   无分集 → 大纲；无角色 → 角色；无分镜 → 分镜（与原来行为一致，不影响成熟项目）。
 * 另外支持 `?tab=outline` 这类深链，便于其它流程精确跳转。
 */
const TAB_KEYS = ["outline", "characters", "storyboards", "batch", "timeline", "confirm"] as const;

function initialTab(): (typeof TAB_KEYS)[number] {
  const wanted = String(route.query.tab ?? "");
  if ((TAB_KEYS as readonly string[]).includes(wanted)) {
    return wanted as (typeof TAB_KEYS)[number];
  }
  if (!episodes.value.length) return "outline";
  if (!characters.value.length) return "characters";
  return "storyboards";
}
const busy = ref("");
const error = ref("");
const info = ref("");
const batchItems = ref<BatchItem[]>([]);
const budgetExceeded = ref(false);
const taskMap = ref<Record<string, TaskDto>>({});
const exportJob = ref<ExportDto | null>(null);
const exporting = ref(false);
const portraitCount = ref(1);
const candidates = ref<{ charId: string; task_id: string; list: Array<{ index: number; url: string }> } | null>(null);
const matrix = ref<MatrixDto | null>(null);
const budgetTouched = ref(false);
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * 3D 导演台（模块 #19）：打开时按 project_id 载入最近场景，组件内部自己管
 * 30s 自动保存 + 心跳 + 版本冲突。这里只负责"入口 + 角色名单"两件事，
 * 不把导演台状态提到页面层（否则页面刷新即丢）。
 */
const directorOpen = ref(false);
/** 导演台需要的角色名单（id/名字/参考图）：分镜绑定角色后画面里就能直接摆位 */
const directorActors = computed(() =>
  characters.value.map((c) => ({ id: c.id, name: c.name, image: c.portrait_url ?? c.ref_image_uri ?? null })),
);
let pollTimer: ReturnType<typeof setInterval> | undefined;
let exportTimer: ReturnType<typeof setInterval> | undefined;

const selectedEpisode = computed(() => episodes.value.find((ep) => ep.id === selectedEpisodeId.value) ?? null);
const allShotsSelected = computed(() => shots.value.length > 0);

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = label;
  error.value = "";
  info.value = "";
  try {
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.opFailed");
    return undefined;
  } finally {
    busy.value = "";
  }
}

async function loadProject(): Promise<void> {
  const data = await api.get<{ project: ProjectDto; episodes: EpisodeDto[]; characters: CharacterDto[] }>(
    `/projects/${projectId.value}`,
  );
  project.value = data.project;
  episodes.value = data.episodes;
  characters.value = data.characters;
  // 深链 / 回跳保留集：`?ep=<episodeId>` 来自「去剪辑台」的往返（编辑台按 project 载入，
  // 集数靠 query 带；本项目页自己也认这个参数，避免回跳后又落回第 1 集）
  const wantedEp = String(route.query.ep ?? "");
  const initialEp = data.episodes.find((ep) => ep.id === wantedEp) ?? data.episodes[0];
  if (!selectedEpisodeId.value && initialEp) {
    selectedEpisodeId.value = initialEp.id;
    await loadEpisode();
  }
}

async function loadEpisode(): Promise<void> {
  if (!selectedEpisodeId.value) {
    episode.value = null;
    shots.value = [];
    return;
  }
  const data = await api.get<{ episode: EpisodeDto; storyboards: StoryboardDto[] }>(
    `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}`,
  );
  episode.value = data.episode;
  shots.value = data.storyboards;
}

async function loadMatrix(): Promise<void> {
  try {
    matrix.value = await api.get<MatrixDto>(`/projects/${projectId.value}/matrix`);
  } catch {
    /* ignore */
  }
}

function matrixClass(shot: MatrixShot): string {
  // 矩阵色表达「渲染结果」：任务失败优先，其次看分镜是否真的出片（status=5）。
  if (shot.task_status === 3 || isShotRendered(shot)) return "success";
  if (shot.task_status === 4 || shot.task_status === 7) return "failed";
  if (isShotInFlight(shot) || shot.task_status === 1 || shot.task_status === 2) return "running";
  return "idle";
}

/**
 * 镜头状态文案的唯一出口（已定稿 / 已投递 / 未定稿）。
 * 项目页镜头卡、导出视图、时间线筛选、编辑台闸门共用同一 selector，
 * 避免同一镜头在不同视图里出现第四套叫法。
 */
function shotStateLabel(shot: StoryboardDto): string {
  if (isShotFinalized(shot)) return t("projectDetail.ui.shotFinalized");
  if (isShotInFlight(shot)) return t("projectDetail.ui.shotSubmitted");
  return t("projectDetail.ui.shotNotFinalized");
}

async function openMatrixShot(episodeId: string): Promise<void> {
  selectedEpisodeId.value = episodeId;
  tab.value = "storyboards";
  await loadEpisode();
}

async function loadModels(): Promise<void> {
  const all = await api.get<ModelDto[]>("/models?capability=video&visible=true");
  models.value = all.filter((m) => Object.keys(m.scene_modes ?? {}).includes("storyboard_reference_video"));
  if (!models.value.some((m) => m.name === modelName.value)) modelName.value = models.value[0]?.name ?? "";
}

async function generateOutline(): Promise<void> {
  await run(t("projectDetail.views.outline"), async () => {
    const result = await api.post<EpisodeDto[]>(`/projects/${projectId.value}/outline/generate`);
    await loadProject();
    info.value = t("projectDetail.outlineGenerated", { count: result.length });
  });
}

async function saveOutline(): Promise<void> {
  await run(t("projectDetail.views.outline"), async () => {
    await api.put(`/projects/${projectId.value}/outline`, {
      episodes: episodes.value.map((ep) => ({
        ep_no: ep.ep_no,
        title: ep.title ?? t("projectDetail.autoEpisodeTitle", { n: ep.ep_no }),
        synopsis: ep.synopsis ?? "",
      })),
    });
    await loadProject();
    info.value = t("projectDetail.outlineConfirmed");
  });
}

function saveEpisodeDebounced(ep: EpisodeDto): void {
  const existing = saveTimers.get(ep.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    try {
      await api.patch(`/projects/${projectId.value}/episodes/${ep.id}`, {
        title: ep.title ?? undefined,
        synopsis: ep.synopsis ?? undefined,
      });
      info.value = t("projectDetail.outlineAutoSaved");
    } catch {
      /* 自动保存失败不打断编辑 */
    }
  }, 600);
  saveTimers.set(ep.id, timer);
}

async function prefillBudget(): Promise<void> {
  if (!selectedEpisodeId.value || shots.value.length === 0) return;
  await run(t("projectDetail.views.batch"), async () => {
    const byId = new Map(characters.value.map((c) => [c.id, c]));
    // 续投场景：只把「在途（3）/ 已出片（5）」算已消耗，其余（草稿 1 / 确认 2 / 出图 4）都待投。
    // 失败镜头 executor 回滚到 status=2 但不清空 video_task_id，所以不能按 video_task_id 分桶。
    const committedShots = shots.value.filter(isShotCommitted);
    const pendingShots = shots.value.filter((shot) => !isShotCommitted(shot));
    // 报价与单镜共用 buildQuoteItem：同一套 mode / scene / 参照图口径，不再有第二套报价逻辑。
    const items = pendingShots.map((shot) =>
      buildQuoteItem(
        shot,
        shot.character_ids
          .map((id) => byId.get(id)?.portrait_url)
          .filter((url): url is string => Boolean(url)),
      ),
    );
    const quote = items.length
      ? await api.post<{ total_credits: number; balance_after_estimate: number; sufficient: boolean }>(
          "/credits/quote/batch",
          { items },
        )
      : { total_credits: 0, balance_after_estimate: 0, sufficient: true };
    // 已消耗：在途/已出片镜头的冻结/结算积分。失败任务会退款，所以失败镜头的旧 task 不计入。
    // 局限：taskMap 只在批量投递后由轮询填充，进页面时为 0 → spent 可能是 0（既有局限，不在此扩大范围）。
    const spent = committedShots.reduce((sum, shot) => {
      const task = taskMap.value[shot.video_task_id ?? ""];
      return sum + (task?.credits_settled ?? task?.credits_frozen ?? 0);
    }, 0);
    const suggested = spent + quote.total_credits;
    budget.value = Math.max(1, suggested);
    budgetTouched.value = false;
    info.value =
      spent > 0
        ? t("projectDetail.quoteContinued", { spent, shots: pendingShots.length, quoted: quote.total_credits, suggested })
        : t("projectDetail.quoteDone", { quoted: quote.total_credits });
  });
}

async function promoteCharacter(character: CharacterDto): Promise<void> {
  await run(t("projectDetail.assetSaved"), async () => {
    const res = await api.post<{ asset_id: string; tags: string[] }>(
      `/projects/${projectId.value}/characters/${character.id}/to-asset`,
      {},
    );
    info.value = t("projectDetail.assetTransferred", { tags: res.tags.join("、") });
  });
}

async function generateCharacters(): Promise<void> {
  await run(t("projectDetail.views.characters"), async () => {
    await api.post(`/projects/${projectId.value}/characters/generate`, { count: 5 });
    await loadProject();
    info.value = t("projectDetail.charactersGenerated");
  });
}

async function generatePortrait(character: CharacterDto): Promise<void> {
  await run(t("projectDetail.views.characters"), async () => {
    const res = await api.post<{ task_id: string }>(
      `/projects/${projectId.value}/characters/${character.id}/portrait`,
      { count: portraitCount.value },
    );
    info.value = t("projectDetail.lookSubmitted", { taskId: res.task_id });
    startPortraitPoll();
  });
}

async function loadCandidates(character: CharacterDto): Promise<void> {
  await run(t("projectDetail.candidatesReady"), async () => {
    const data = await api.get<{ task_id: string; candidates: Array<{ index: number; url: string }> }>(
      `/projects/${projectId.value}/characters/${character.id}/portrait/candidates`,
    );
    candidates.value = { charId: character.id, task_id: data.task_id, list: data.candidates };
  });
}

async function chooseCandidate(item: { index: number }): Promise<void> {
  if (!candidates.value) return;
  await run(t("projectDetail.views.characters"), async () => {
    await api.post(
      `/projects/${projectId.value}/characters/${candidates.value!.charId}/portrait/select`,
      { task_id: candidates.value!.task_id, index: item.index },
    );
    candidates.value = null;
    await loadProject();
    info.value = t("projectDetail.lookSwitched");
  });
}

async function retryExportJob(): Promise<void> {
  if (!exportJob.value || !selectedEpisodeId.value) return;
  await run(t("projectDetail.views.batch"), async () => {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/exports/${exportJob.value!.export_id}/retry`,
    );
    exportJob.value = { ...exportJob.value!, status: 1, error: null, download_url: null };
    info.value = t("projectDetail.exportRequeued");
    startExportPoll();
  });
}

async function finalizeCharacter(character: CharacterDto): Promise<void> {
  await run(t("projectDetail.confirmFinalized"), async () => {
    await api.post(`/projects/${projectId.value}/characters/${character.id}/finalize`);
    await loadProject();
    info.value = t("projectDetail.characterFinalized", { name: character.name });
  });
}

function startPortraitPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries += 1;
    try {
      await loadProject();
    } catch {
      /* ignore transient */
    }
    const pending = characters.value.some((c) => c.source_task_id && c.status !== 2);
    if (!pending || tries > 20) {
      if (pollTimer) clearInterval(pollTimer);
    }
  }, 2000);
}

async function generateScriptDraft(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await run(t("projectDetail.viewCards.outline"), async () => {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/script-draft/generate`,
      {},
    );
    await loadEpisode();
    info.value = t("projectDetail.scriptDraftReady");
  });
}

async function generateStoryboards(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await run(t("projectDetail.views.storyboards"), async () => {
    shots.value = await api.post<StoryboardDto[]>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate`,
      { shot_count: shotCount.value },
    );
    await loadEpisode();
    info.value = t("projectDetail.shotsGenerated", { count: shots.value.length });
  });
}

/**
 * 重生成二次确认（对齐竞品"先 check 再 create"的护栏思路）。
 * 大纲/AI拆分镜都是「整体覆盖」：已有内容时先弹确认，空态直接执行，避免多一次无意义点击。
 */
const regenConfirm = ref<null | "outline" | "shots">(null);
function maybeGenerateOutline(): void {
  if (episodes.value.length) {
    regenConfirm.value = "outline";
    return;
  }
  void generateOutline();
}
function maybeGenerateStoryboards(): void {
  if (shots.value.length) {
    regenConfirm.value = "shots";
    return;
  }
  void generateStoryboards();
}
async function confirmRegenerate(): Promise<void> {
  const kind = regenConfirm.value;
  regenConfirm.value = null;
  if (kind === "outline") await generateOutline();
  else if (kind === "shots") await generateStoryboards();
}

async function saveShot(shot: StoryboardDto): Promise<void> {
  await run(t("projectDetail.shotSaved"), async () => {
    await api.patch(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}`,
      {
        shot_desc: shot.shot_desc,
        video_prompt: shot.video_prompt,
        duration_s: shot.duration_s,
      },
    );
    info.value = t("projectDetail.shotSaved", { no: shot.shot_no });
  });
}

async function submitBatch(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await run(t("projectDetail.views.batch"), async () => {
    const res = await api.post<{ budget_exceeded: boolean; items: BatchItem[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate-videos`,
      {
        shot_ids: shots.value.map((s) => s.id),
        budget_credits_max: budget.value,
        model: modelName.value,
        // 批量必须带上当前模式：后端 generateVideosSchema 的 mode 默认 universal_reference，
        // 不传会静默走到参考模式，与单镜选择的 first_frame / text2video 不一致。
        mode: modeApi.value,
      },
    );
    batchItems.value = res.items;
    budgetExceeded.value = res.budget_exceeded;
    const okCount = res.items.filter((i) => i.submitted).length;
    const notReady = res.items.filter((i) => i.code === 400105).length;
    const overBudget = res.items.filter((i) => i.code === 745703).length;
    // 全部失败时给出可行动的原因，而不是只报「已提交 0 个镜头」
    if (okCount === 0 && notReady > 0) {
      error.value = t("projectDetail.submitAllBlockedNotReady", { count: notReady });
      info.value = "";
    } else if (okCount === 0 && overBudget > 0) {
      error.value = t("projectDetail.submitAllBlockedOverBudget", { count: overBudget });
      info.value = "";
    } else {
      const parts = [t("projectDetail.submitPart", { ok: okCount })];
      if (notReady > 0) parts.push(t("projectDetail.submitSkippedNotReady", { count: notReady }));
      if (overBudget > 0) parts.push(t("projectDetail.submitSkippedOverBudget", { count: overBudget }));
      info.value = parts.join("，");
      error.value = "";
    }
    startTaskPoll();
    await loadEpisode();
    // 投递后刷新矩阵，让用户立刻看到每个镜头的投递/出片状态
    await loadMatrix();
  });
}

function startTaskPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries += 1;
    const ids = batchItems.value.map((i) => i.task_id).filter(Boolean) as string[];
    if (ids.length > 0) {
      try {
        const tasks = await api.get<TaskDto[]>(`/tasks?ids=${ids.join(",")}`);
        taskMap.value = Object.fromEntries(tasks.map((t) => [t.task_id, t]));
      } catch {
        /* ignore */
      }
    }
    const pending = Object.values(taskMap.value).some((t) => [1, 2, 6].includes(t.status));
    if (!pending || tries > 30) {
      if (pollTimer) clearInterval(pollTimer);
    }
  }, 2000);
}

async function submitExport(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  exporting.value = true;
  error.value = "";
  info.value = "";
  try {
    const created = await api.post<ExportDto>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/exports`,
    );
    exportJob.value = created;
    info.value = t("projectDetail.exportSubmitted");
    startExportPoll();
    // 受理即出现在导出记录里（状态 1 排队中），不需要等打包完成才可见
    void loadExportHistory(1);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.exportFailed");
  } finally {
    exporting.value = false;
  }
}

function startExportPoll(): void {
  if (exportTimer) clearInterval(exportTimer);
  let tries = 0;
  exportTimer = setInterval(async () => {
    tries += 1;
    try {
      const data = await api.get<ExportDto>(
        `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/exports/${exportJob.value!.export_id}`,
      );
      exportJob.value = data;
      if (data.status === 3 || data.status === 4) {
        if (exportTimer) clearInterval(exportTimer);
        info.value = data.status === 3 ? t("projectDetail.exportDone") : t("projectDetail.exportNoVideo");
        // 终态后刷新导出记录：下载链接是签名地址，只有完成后才存在
        void loadExportHistory(exportHistoryPage.value);
      }
    } catch {
      /* ignore */
    }
    if (tries > 30 && exportTimer) clearInterval(exportTimer);
  }, 1500);
}

// ══════════ U3：项目级导出记录（GET /projects/:id/exports）══════════
/**
 * 真实导出历史：后端把两条链投影成一张日志（script.service.ts listProjectExports）
 * - `exports`（episode 级分镜 zip）→ kind="storyboard"
 * - `timeline_exports`（成片 mp4，含 AI 水印）→ kind="timeline"
 * 都支持分页 / 状态 / 下载签名 / `truncated`（各链最多最近 500 条）。
 * 前端原先这里是空占位（P1-3），本批接真数据；任何一行都能追到 export_id。
 */
interface ProjectExportItem {
  export_id: string;
  kind: "storyboard" | "timeline";
  episode_id: string;
  episode_no: number | null;
  status: number;
  download_url: string | null;
  error: { code?: number; message?: string } | null;
  expires_at: string | null;
  created_at: string;
  clip_count?: number;
  skipped?: number;
  duration_s?: number;
  watermarked?: boolean;
}
const EXPORT_PAGE_SIZE = 10;
const exportHistory = ref<ProjectExportItem[]>([]);
const exportHistoryTotal = ref(0);
const exportHistoryPage = ref(1);
const exportHistoryLoading = ref(false);
const exportHistoryError = ref("");
const exportHistoryTruncated = ref(false);
const exportHistoryPages = computed(() =>
  Math.max(1, Math.ceil(exportHistoryTotal.value / EXPORT_PAGE_SIZE)),
);

async function loadExportHistory(page = 1): Promise<void> {
  exportHistoryLoading.value = true;
  exportHistoryError.value = "";
  try {
    const q = new URLSearchParams({ page: String(page), page_size: String(EXPORT_PAGE_SIZE) });
    const data = await api.get<{
      list: ProjectExportItem[];
      total: number;
      page: number;
      page_size: number;
      truncated: boolean;
    }>(`/projects/${projectId.value}/exports?${q.toString()}`);
    exportHistory.value = data.list ?? [];
    exportHistoryTotal.value = data.total ?? 0;
    exportHistoryPage.value = data.page ?? page;
    exportHistoryTruncated.value = Boolean(data.truncated);
  } catch (e) {
    exportHistory.value = [];
    exportHistoryTotal.value = 0;
    exportHistoryError.value = e instanceof Error ? e.message : t("projectDetail.ui.exportHistoryFailed");
  } finally {
    exportHistoryLoading.value = false;
  }
}

function exportKindLabel(item: ProjectExportItem): string {
  return item.kind === "timeline"
    ? t("projectDetail.ui.exportKindTimeline")
    : t("projectDetail.ui.exportKindStoryboard");
}
/** 导出四态：1 排队 / 2 打包 / 3 完成 / 4 失败（与 API 的 exports.status 同构） */
function exportStatusText(item: ProjectExportItem): string {
  if (item.status === 1) return t("projectDetail.ui.exportStatusQueued");
  if (item.status === 2) return t("projectDetail.ui.exportStatusPacking");
  if (item.status === 3) return t("projectDetail.ui.exportStatusDone");
  if (item.status === 4) return t("projectDetail.ui.exportStatusFailed");
  return t("projectDetail.ui.exportStatusUnknown");
}
function exportStatusTone(item: ProjectExportItem): "success" | "danger" | "info" | "neutral" {
  if (item.status === 3) return "success";
  if (item.status === 4) return "danger";
  if (item.status === 1 || item.status === 2) return "info";
  return "neutral";
}
function exportExpired(item: ProjectExportItem): boolean {
  if (!item.expires_at) return false;
  const at = new Date(item.expires_at).getTime();
  return Number.isFinite(at) && at <= Date.now();
}
/** 下载列的可读原因：没有签名地址时要说明是「未完成 / 已过期 / 失败」，不能只留一个破折号 */
function exportNoDownloadReason(item: ProjectExportItem): string {
  if (item.status === 4) return item.error?.message || t("projectDetail.ui.exportNoDownloadFailed");
  if (item.status !== 3) return t("projectDetail.ui.exportNoDownloadPending");
  return t("projectDetail.ui.exportNoDownloadExpired");
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(async () => {
  await run(t("projectDetail.metaTitle"), async () => {
    await loadProject();
    await loadModels();
    await loadMatrix();
    await loadProjectAssets();
    await loadVideoModels();
    await loadMatchResult();
  });
  // 数据到齐后再决定落点（见 initialTab 的注释：原来无条件进分镜会让新项目无处下手）
  tab.value = initialTab();
  // 首次进入空项目时给一条可行动提示（PRD 增补 §3.2 空态引导）
  if (!episodes.value.length) {
    info.value = t("projectDetail.noEpisodesHint");
  } else if (characters.value.length && shots.value.length === 0) {
    info.value = t("projectDetail.readyHint");
  }
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (exportTimer) clearInterval(exportTimer);
});

// ── 流水线步骤（UI 编排层）──
const steps = computed(() => [
  { key: "outline" as const, label: t("projectDetail.views.outline"), count: episodes.value.length || undefined },
  { key: "characters" as const, label: t("projectDetail.views.characters"), count: characters.value.length || undefined },
  { key: "storyboards" as const, label: t("projectDetail.views.storyboards"), count: shots.value.length || undefined },
  { key: "batch" as const, label: t("projectDetail.views.batch"), count: batchItems.value.length || undefined },
]);

function stepDone(key: "outline" | "characters" | "storyboards" | "batch"): boolean {
  if (key === "outline") return episodes.value.length > 0;
  if (key === "characters") return characters.value.length > 0 && characters.value.every((c) => c.status === 2);
  if (key === "storyboards") return shots.value.length > 0;
  return batchItems.value.some((b) => b.submitted);
}

async function selectEpisode(id: string): Promise<void> {
  selectedEpisodeId.value = id;
  await loadEpisode();
}

/** 左栏分集标题：后端标题常以「第 N 集」开头，与序号重复，展示时去掉前缀 */
function epShortTitle(ep: EpisodeDto): string {
  const prefix = `第${ep.ep_no}集`;
  const title = (ep.title ?? "").trim();
  const rest = title.startsWith(prefix) ? title.slice(prefix.length).trim() : title;
  return rest || t("projectDetail.untitled");
}

// ══════════ 视图切换（剧本 / 资产 / 分镜 / 导出）══════════
const viewMenu = ref(false);
const viewOptions = [
  { key: "outline" as const, label: t("projectDetail.viewCards.outline"), desc: t("projectDetail.viewCards.outlineDesc") },
  { key: "characters" as const, label: t("projectDetail.viewCards.characters"), desc: t("projectDetail.viewCards.charactersDesc") },
  { key: "storyboards" as const, label: t("projectDetail.viewCards.storyboards"), desc: t("projectDetail.viewCards.storyboardsDesc") },
  { key: "batch" as const, label: t("projectDetail.viewCards.batch"), desc: t("projectDetail.viewCards.batchDesc") },
  { key: "timeline" as const, label: t("projectDetail.viewCards.timelineLabelPreview"), desc: t("projectDetail.viewCards.timelineDescPreview") },
  { key: "confirm" as const, label: t("projectDetail.viewCards.confirm"), desc: t("projectDetail.viewCards.confirmDesc") },
];
const viewLabel = computed(() => viewOptions.find((v) => v.key === tab.value)?.label ?? t("projectDetail.viewFallback"));
function setView(key: "outline" | "characters" | "storyboards" | "batch" | "timeline" | "confirm"): void {
  tab.value = key;
  viewMenu.value = false;
  if (key === "timeline") void loadTimeline();
  // 导出视图 = 本集投递/矩阵 + 项目级导出记录，进视图就取一次真实日志（不缓存假数据）
  if (key === "batch") void loadExportHistory(1);
  // 批量投递固定走参考生视频：切到导出视图时确保当前模型支持该模式
  if (key === "batch" && models.value.length && !models.value.some((m) => m.name === modelName.value)) {
    modelName.value = models.value[0]?.name ?? modelName.value;
  }
}

// ══════════ 资产视图 ══════════
const assetTab = ref<"character" | "scene" | "prop" | "other">("character");
const assetTabOptions = [
  { key: "character" as const, label: t("projectDetail.assetTabs.character") },
  { key: "scene" as const, label: t("projectDetail.assetTabs.scene") },
  { key: "prop" as const, label: t("projectDetail.assetTabs.prop") },
  { key: "other" as const, label: t("projectDetail.assetTabs.other") },
];
const assetTabLabel = computed(() => assetTabOptions.find((a) => a.key === assetTab.value)?.label ?? t("projectDetail.assetTabFallback"));
const assetItems = computed(() => (assetTab.value === "character" ? characters.value : []));
const assetDrawer = ref(false);

// ══════════ 分镜工作台（三列）══════════
const stageTab = ref<"all" | "image" | "video">("all");
const stageTabOptions = [
  { key: "all" as const, label: t("projectDetail.assetFilters.all") },
  { key: "image" as const, label: t("projectDetail.assetFilters.image") },
  { key: "video" as const, label: t("projectDetail.assetFilters.video") },
];
const genTab = ref<"image" | "video">("video");
const mode = ref("reference");
// 参照站 5 种生成模式：前 4 种已按 models.modes 接入，AI改视频需源视频输入、显式不支持
const modeOptions = [
  { key: "reference", apiMode: "universal_reference", label: t("projectDetail.mediaModes.reference"), hint: t("projectDetail.mediaModes.referenceHint") },
  { key: "first_frame", apiMode: "first_frame", label: t("projectDetail.mediaModes.firstFrame"), hint: t("projectDetail.mediaModes.firstFrameHint") },
  { key: "first_last", apiMode: "first_last_frame", label: t("projectDetail.mediaModes.firstLast"), hint: t("projectDetail.mediaModes.firstLastHint") },
  { key: "text", apiMode: "text2video", label: t("projectDetail.mediaModes.text"), hint: t("projectDetail.mediaModes.textHint") },
  { key: "ai_edit", apiMode: "video_edit", label: t("projectDetail.mediaModes.aiEdit"), hint: t("projectDetail.mediaModes.aiEditHint") },
] as const;
const modeApi = computed(
  () => modeOptions.find((m) => m.key === mode.value)?.apiMode ?? "universal_reference",
);
/** 该模式下的模型列表（按 models.modes 过滤，模型目录是权威） */
const videoModels = ref<ModelDto[]>([]);
async function loadVideoModels(): Promise<void> {
  try {
    const list = await api.get<ModelDto[]>(`/models?capability=video&visible=true&mode=${modeApi.value}`);
    videoModels.value = list;
    if (!list.some((m) => m.name === modelName.value)) modelName.value = list[0]?.name ?? "";
  } catch {
    videoModels.value = [];
  }
}
/** 当前模式是否可用（按本镜已绑定资产数量与提示词判断，只做 UI 引导；后端仍会严格校验） */
function modeEnabled(key: string): boolean {
  if (key === "ai_edit") return false;
  if (key === "text") return true;
  const hasShotFrame = Boolean(selectedShot.value?.first_frame_uri);
  if (key === "first_frame") return hasShotFrame || boundImageCount.value >= 1;
  if (key === "first_last") return (hasShotFrame || boundImageCount.value >= 1) && boundImageCount.value >= 1;
  return true;
}
const modeHint = computed(() => {
  const opt = modeOptions.find((m) => m.key === mode.value);
  if (mode.value === "first_last" && boundImageCount.value < 2) return t("projectDetail.modeBlockedFirstLast");
  if (mode.value === "first_frame" && boundImageCount.value < 1) return t("projectDetail.modeBlockedFirstFrame");
  if (mode.value === "text") return t("projectDetail.modeBlockedText");
  return opt?.hint ?? "";
});
const selectedShotId = ref("");
const selectedShot = computed<StoryboardDto | null>(
  () => shots.value.find((s) => s.id === selectedShotId.value) ?? null,
);
function selectShot(id: string): void {
  selectedShotId.value = id;
}
/** 幂等提示：只有「在途/已出片」的镜头重复提交才会复用任务；失败回滚（status=2）会新建重试 */
const idempotentTaskId = computed<string | null>(() => {
  const shot = selectedShot.value;
  if (!shot || !isShotCommitted(shot) || !shot.video_task_id) return null;
  return shot.video_task_id;
});
/**
 * 镜头缩略图：按绑定顺序取第一个「有图」的资产（角色立绘 / 场景道具参考图都算）。
 * 这样在抽屉里绑上场景/道具后，左栏镜头卡立刻换图，不必等整页刷新。
 */
function shotThumb(shot: StoryboardDto): string | null {
  for (const id of shot.character_ids) {
    const asset = assetMap.value.get(id);
    const image = asset ? assetImage(asset) : null;
    if (image) return image;
  }
  return null;
}
/** 中列「全部」是否要连带渲染出片行：视频 tab 永远渲染（含空态），
 *  全部 tab 只在真有出片结果时追加，避免多出一块空 «视频» 区。 */
const showsVideoRows = computed(
  () => stageTab.value === "video" || (stageTab.value === "all" && submittedShots.value.length > 0),
);
const submittedShots = computed(() => batchItems.value);
function batchReason(item: BatchItem): string {
  if (item.code === 400105) return t("projectDetail.batchReasons.notFinalized");
  if (item.code === 745703) return t("projectDetail.batchReasons.overBudget");
  if (item.code === 745701) return t("projectDetail.batchReasons.insufficient");
  return t("projectDetail.batchReasons.notSubmitted");
}
function shotNoOf(shotId: string): string {
  return String(shots.value.find((s) => s.id === shotId)?.shot_no ?? "-");
}
const shotDuration = computed<number>({
  get: () => selectedShot.value?.duration_s ?? 5,
  set: (v: number) => {
    const shot = selectedShot.value;
    if (shot) shot.duration_s = Math.max(1, Math.min(30, Number(v) || 5));
  },
});
const shotQuote = ref<number | null>(null);
/** 按当前生成模式组报价/提交请求体（与后端 mode 语义一致）
 *  @param referenceUris 显式参照图（prefillBudget 用角色立绘）；不传则用当前镜头绑定的已定稿资产 */
function buildQuoteItem(shot: StoryboardDto, referenceUris?: string[]) {
  const imgs =
    referenceUris ??
    boundAssets.value.filter((a) => a.status === 2 && a.ref_image_uri).map((a) => a.ref_image_uri as string);
  const apiMode = modeApi.value;
  const prompt = shot.video_prompt || shot.shot_desc || "";
  const input: Record<string, unknown> = { prompt, reference_uris: [] as string[] };
  if (apiMode === "universal_reference") input.reference_uris = imgs;
  const shotFrame = shot.first_frame_uri ?? null;
  if (apiMode === "first_frame") input.first_frame_uri = shotFrame ?? imgs[0] ?? null;
  if (apiMode === "first_last_frame") {
    input.first_frame_uri = shotFrame ?? imgs[0] ?? null;
    input.last_frame_uri = shot.last_frame_uri ?? imgs[1] ?? null;
  }
  return {
    mode: apiMode,
    model: modelName.value,
    scene: apiMode === "universal_reference" ? "storyboard_reference_video" : null,
    input,
    options: {
      ratio: shot.ratio ?? project.value?.ratio ?? "9:16",
      resolution: shot.resolution ?? "720p",
      duration: shot.duration_s ?? 5,
      count: 1,
    },
  };
}
/** 单镜报价：给「立即生成」按钮显示真实积分消耗（失败则不显示，不编造数字） */
async function quoteSelectedShot(): Promise<void> {
  const shot = selectedShot.value;
  if (!shot) {
    shotQuote.value = null;
    return;
  }
  try {
    const q = await api.post<{ total_credits: number }>("/credits/quote/batch", { items: [buildQuoteItem(shot)] });
    shotQuote.value = q.total_credits;
  } catch {
    shotQuote.value = null;
  }
}
async function saveSelectedShot(): Promise<void> {
  const shot = selectedShot.value;
  if (shot) await saveShot(shot);
}
/** 单镜立即生成：复用批量投递端点，只传当前 shot */
async function submitShot(shot: StoryboardDto): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await saveShot(shot);
  await run(t("projectDetail.views.batch"), async () => {
    const res = await api.post<{ budget_exceeded: boolean; items: BatchItem[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate-videos`,
      { shot_ids: [shot.id], budget_credits_max: budget.value, model: modelName.value, mode: modeApi.value },
    );
    const kept = batchItems.value.filter((b) => b.shot_id !== shot.id);
    batchItems.value = [...kept, ...res.items];
    if (res.budget_exceeded) budgetExceeded.value = true;
    const item = res.items[0];
    if (item?.submitted) {
      info.value = t("projectDetail.shotSubmitted", { no: shot.shot_no });
    } else {
      error.value = t("projectDetail.shotSubmitFailed", { no: shot.shot_no, reason: item ? batchReason(item) : t("projectDetail.unknownReason") });
      info.value = "";
    }
    startTaskPoll();
    await loadEpisode();
    await loadMatrix();
  });
}
watch(shots, (list) => {
  if (!list.length) {
    selectedShotId.value = "";
    return;
  }
  if (!list.some((s) => s.id === selectedShotId.value)) selectedShotId.value = list[0]?.id ?? "";
});
watch(selectedShotId, () => {
  void quoteSelectedShot();
});
// 切模式：重取该模式的模型目录，并刷新报价
watch(mode, async () => {
  await loadVideoModels();
  await quoteSelectedShot();
});
// ══════════ P2：项目资产（场景 / 道具 / 其他）+ 分镜资产绑定 ══════════
const projectAssets = ref<Record<"scene" | "prop" | "other", ProjectAssetDto[]>>({ scene: [], prop: [], other: [] });
const assetFormOpen = ref(false);
const assetFormId = ref<string | null>(null);
const assetFormKind = ref<"scene" | "prop" | "other">("scene");
const assetForm = ref({ name: "", description: "", prompt: "", ref_image_uri: "" });
const uploading = ref(false);
const drawerSaving = ref(false);
const drawerSelection = ref<string[]>([]);

const assetTabKind = computed<"scene" | "prop" | "other" | null>(() =>
  assetTab.value === "character" ? null : assetTab.value,
);
const assetItemsNonCharacter = computed<ProjectAssetDto[]>(() => {
  const kind = assetTabKind.value;
  return kind ? (projectAssets.value[kind] ?? []) : [];
});
/** id → 资产（角色 + 场景/道具/其他），用于分镜素材区与抽屉反查 */
const assetMap = computed(() => {
  const map = new Map<string, ProjectAssetDto>();
  for (const c of characters.value) {
    map.set(c.id, {
      id: c.id,
      kind: "character",
      name: c.name,
      description: c.description,
      prompt: c.prompt,
      ref_image_uri: c.ref_image_uri,
      portrait_asset_id: c.portrait_asset_id,
      portrait_url: c.portrait_url,
      status: c.status,
    });
  }
  for (const kind of ["scene", "prop", "other"] as const) {
    for (const a of projectAssets.value[kind] ?? []) map.set(a.id, a);
  }
  return map;
});
/** 当前分镜已绑定的资产（角色 + 场景/道具），供中列素材区与额度统计 */
const boundAssets = computed<ProjectAssetDto[]>(() =>
  (selectedShot.value?.character_ids ?? [])
    .map((id) => assetMap.value.get(id))
    .filter((a): a is ProjectAssetDto => Boolean(a)),
);
const boundImageCount = computed(() => boundAssets.value.filter((a) => assetImage(a)).length);

/** 项目资产（场景 / 道具 / 其他）的加载态与错误：抽屉与列表要能显示「加载中 / 加载失败」，不能只剩空态 */
const assetsLoading = ref(false);
const assetsError = ref("");

async function loadProjectAssets(): Promise<void> {
  assetsLoading.value = true;
  assetsError.value = "";
  try {
    const kinds = ["scene", "prop", "other"] as const;
    const lists = await Promise.all(
      kinds.map((kind) => api.get<{ list: ProjectAssetDto[] }>(`/projects/${projectId.value}/assets?kind=${kind}`)),
    );
    projectAssets.value = {
      scene: lists[0]?.list ?? [],
      prop: lists[1]?.list ?? [],
      other: lists[2]?.list ?? [],
    };
  } catch (e) {
    // 后端未就绪时不阻塞其它视图：保持空列表；但要留下可读错误，供抽屉「重试」
    projectAssets.value = { scene: [], prop: [], other: [] };
    assetsError.value = e instanceof Error ? e.message : t("projectDetail.assetsLoadFailed");
  } finally {
    assetsLoading.value = false;
  }
}

function assetImage(a: ProjectAssetDto): string | null {
  return a.portrait_url ?? null;
}

function openAssetForm(kind: "scene" | "prop" | "other", asset?: ProjectAssetDto): void {
  assetFormKind.value = kind;
  assetFormId.value = asset?.id ?? null;
  assetForm.value = {
    name: asset?.name ?? "",
    description: asset?.description ?? "",
    prompt: asset?.prompt ?? "",
    ref_image_uri: asset?.ref_image_uri ?? "",
  };
  assetFormOpen.value = true;
}

async function saveAssetForm(): Promise<void> {
  if (!assetForm.value.name.trim()) {
    error.value = t("projectDetail.assetNameRequired");
    return;
  }
  await run(assetFormId.value ? t("projectDetail.assetSaved") : t("projectDetail.views.characters"), async () => {
    const body = {
      name: assetForm.value.name.trim(),
      description: assetForm.value.description,
      prompt: assetForm.value.prompt,
      ...(assetForm.value.ref_image_uri ? { ref_image_uri: assetForm.value.ref_image_uri } : {}),
    };
    if (assetFormId.value) {
      await api.patch(`/projects/${projectId.value}/assets/${assetFormId.value}`, body);
    } else {
      await api.post(`/projects/${projectId.value}/assets`, { kind: assetFormKind.value, ...body });
    }
    assetFormOpen.value = false;
    await loadProjectAssets();
    info.value = t("projectDetail.assetSaved");
  });
}

async function patchProjectAsset(asset: ProjectAssetDto, body: Record<string, unknown>): Promise<void> {
  await run(t("projectDetail.assetUpdated"), async () => {
    await api.patch(`/projects/${projectId.value}/assets/${asset.id}`, body);
    await loadProjectAssets();
    info.value = body.status === 2 ? t("projectDetail.assetFinalized", { name: asset.name }) : t("projectDetail.assetUpdated");
  });
}

async function removeProjectAsset(asset: ProjectAssetDto): Promise<void> {
  await run(t("projectDetail.confirmDeleted"), async () => {
    await api.delete(`/projects/${projectId.value}/assets/${asset.id}`);
    await loadProjectAssets();
    await loadEpisode();
    info.value = t("projectDetail.assetDeleted", { name: asset.name });
  });
}

/** 导入：先上传到空间资产库，再以返回的存储 uri 建项目资产（草稿） */
async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const kind = assetTabKind.value;
  if (!file || !kind) return;
  if (file.size > 8 * 1024 * 1024) {
    error.value = t("projectDetail.imageTooLarge");
    return;
  }
  uploading.value = true;
  error.value = "";
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error(t("projectDetail.readFileFailed")));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<{ id: string; uri: string }>("/assets/upload", {
      filename: file.name,
      content_type: file.type,
      data_base64: base64,
    });
    await api.post(`/projects/${projectId.value}/assets`, {
      kind,
      name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 50) || t("projectDetail.importAssetDefault"),
      ref_image_uri: asset.uri,
    });
    await loadProjectAssets();
    info.value = t("projectDetail.assetImported");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.importFailed");
  } finally {
    uploading.value = false;
  }
}

/**
 * 项目资产可用性：唯一判定用 `ProjectAssetStatus.FINALIZED`（packages/shared = 2）。
 * 未定稿资产不得当可用参照——后端会按 400105 拒绝该镜投递，绑上去只是把失败推迟到生成时。
 */
const ASSET_FINALIZED = 2;
function assetFinalized(a: ProjectAssetDto): boolean {
  return a.status === ASSET_FINALIZED;
}
/** 可当参考图的资产 = 已定稿 + 有参考图（与 API 侧 asset-gates 同一条判据） */
function assetUsable(a: ProjectAssetDto): boolean {
  return assetFinalized(a) && Boolean(a.ref_image_uri);
}

/** 分镜 ↔ 资产绑定：整体替换（入参需含角色与场景/道具的全部 id）；返回是否真的落库 */
const bindingBusy = ref(false);
async function setShotAssets(ids: string[]): Promise<boolean> {
  const shot = selectedShot.value;
  if (!shot || !selectedEpisodeId.value) return false;
  bindingBusy.value = true;
  try {
    const res = await api.put<{ asset_ids: string[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}/assets`,
      { asset_ids: ids },
    );
    // 绑定结果以服务端回写为准：镜头缩略图与「已上传素材数」都从 shot.character_ids 派生，这里赋值即刷新
    shot.character_ids = res.asset_ids;
    error.value = "";
    info.value = t("projectDetail.materialUpdated", { count: res.asset_ids.length });
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.materialUpdateFailed");
    info.value = "";
    return false;
  } finally {
    bindingBusy.value = false;
  }
}

async function removeShotAsset(id: string): Promise<void> {
  const shot = selectedShot.value;
  if (!shot) return;
  await setShotAssets(shot.character_ids.filter((x) => x !== id));
}

// ══════════ U2：匹配资产（POST match-resources → 轮询 GET match-result）══════════
/**
 * 竞品把 `episode match-resources` 定义为「资产匹配 + 自动拆分镜」的组合任务；我方服务
 * （apps/api/src/modules/script/asset-match.service.ts 的 matchResources）只做前半段：
 * 抽取资产名 → 命中项目资产 → 写集级快照 → 把「已定稿且有参考图」的资产绑到现有分镜，
 * **不会新增/拆分分镜**。所以 UI 只宣称「匹配资产」，并把这条差异写在按钮旁边。
 *
 * 第二条口径：受理成功 ≠ 匹配成功。POST 只代表动作被接受，结果一律以
 * `GET …/match-result` 的 `status` 为准（0 未匹配 / 1 部分未定稿 / 2 全部已匹配 / 3 有缺失），
 * 所以点完按钮要轮询到终态再报结果；等不到终态就说「还在生成」，不把受理当成功。
 */
const matchResult = ref<MatchResultDto | null>(null);
const matchBusy = ref(false);
const matchError = ref("");
const matchNote = ref("");
const MATCH_POLL_TRIES = 8;
const MATCH_POLL_INTERVAL_MS = 900;

function isMatchSettled(result: MatchResultDto): boolean {
  return result.status === 1 || result.status === 2 || result.status === 3;
}
const matchEntries = computed<MatchEntryDto[]>(() => {
  const result = matchResult.value;
  if (!result) return [];
  // 三类数组都按"可能缺失"处理：老版本 / 代理 / 错误响应的形状不完全可信，
  // 少一个数组就让整页 setup 抛错（曾把工作台整块渲染打断），这里兜住
  const list = (v: MatchEntryDto[] | undefined): MatchEntryDto[] => (Array.isArray(v) ? v : []);
  return [...list(result.characters), ...list(result.scenes), ...list(result.props)];
});
const matchStatusLabel = computed<string>(() => {
  const status = matchResult.value?.status ?? 0;
  if (status === 2) return t("projectDetail.ui.matchStatusMatched");
  if (status === 3) return t("projectDetail.ui.matchStatusMissing");
  if (status === 1) return t("projectDetail.ui.matchStatusPartial");
  return t("projectDetail.ui.matchStatusNone");
});
const matchCountsLine = computed<string>(() => {
  const totals = matchResult.value?.totals;
  if (!totals) return "";
  return t("projectDetail.ui.matchCounts", {
    total: totals.total,
    matched: totals.matched,
    unfinalized: totals.unfinalized,
    missing: totals.missing,
  });
});
/** 未匹配项（未定稿 / 缺失）：逐条给可读原因，不只报一个总数 */
const matchUnavailable = computed<MatchEntryDto[]>(() =>
  matchEntries.value.filter((entry) => entry.status !== 2).slice(0, 6),
);
const matchUnavailableMore = computed<number>(() =>
  Math.max(0, matchEntries.value.filter((entry) => entry.status !== 2).length - 6),
);
/** match-result 里 status=2（已匹配且有资产）的资产 id：抽屉预选的唯一来源 */
const matchedAssetIds = computed<string[]>(() =>
  matchEntries.value
    .filter((entry) => entry.status === 2 && Boolean(entry.resource_id))
    .map((entry) => entry.resource_id),
);

async function loadMatchResult(): Promise<void> {
  if (!selectedEpisodeId.value) {
    matchResult.value = null;
    return;
  }
  try {
    const res = await api.get<MatchResultDto>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/match-result`,
    );
    // 只接受形状完整的响应：缺三类数组说明调用打到了别的东西，不能当匹配结果显示
    if (!res || !Array.isArray(res.characters) || !Array.isArray(res.scenes) || !Array.isArray(res.props)) {
      return;
    }
    matchResult.value = res;
  } catch {
    /* 读结果失败不阻塞页面：保持上一次已知状态，点「匹配资产」可重试 */
  }
}

async function pollMatchResult(episodeId: string): Promise<MatchResultDto | null> {
  for (let i = 0; i < MATCH_POLL_TRIES; i += 1) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, MATCH_POLL_INTERVAL_MS));
    try {
      const res = await api.get<MatchResultDto>(
        `/projects/${projectId.value}/episodes/${episodeId}/match-result`,
      );
      if (!res || !Array.isArray(res.characters) || !Array.isArray(res.scenes) || !Array.isArray(res.props)) {
        continue;
      }
      matchResult.value = res;
      if (isMatchSettled(res)) return res;
    } catch {
      /* 结果接口暂时不可用：继续轮询，最后按「未完成」处理 */
    }
  }
  return null;
}

async function runAssetMatch(): Promise<void> {
  const episodeId = selectedEpisodeId.value;
  if (!episodeId || matchBusy.value) return;
  matchBusy.value = true;
  matchError.value = "";
  matchNote.value = t("projectDetail.ui.matchAccepted");
  error.value = "";
  info.value = "";
  try {
    await api.post(`/projects/${projectId.value}/episodes/${episodeId}/match-resources`, {});
    const result = await pollMatchResult(episodeId);
    if (!result) {
      matchNote.value = t("projectDetail.ui.matchStillRunning");
      return;
    }
    matchNote.value = "";
    // 匹配会改写「集级快照 + 分镜资产绑定」，所以两侧都要重取，界面才不会停在旧阶段
    await loadEpisode();
    await loadProjectAssets();
    if (result.status === 2) {
      info.value = t("projectDetail.ui.matchDoneAll", {
        matched: result.totals.matched,
        total: result.totals.total,
      });
    } else if (result.status === 3) {
      info.value = t("projectDetail.ui.matchDoneMissing", {
        matched: result.totals.matched,
        total: result.totals.total,
        missing: result.totals.missing,
      });
    } else if (result.status === 1) {
      info.value = t("projectDetail.ui.matchDonePartial", {
        matched: result.totals.matched,
        total: result.totals.total,
        unfinalized: result.totals.unfinalized,
      });
    } else {
      matchNote.value = t("projectDetail.ui.matchStillRunning");
    }
  } catch (e) {
    matchError.value = e instanceof Error ? e.message : t("projectDetail.ui.matchFailed");
    error.value = matchError.value;
    matchNote.value = "";
  } finally {
    matchBusy.value = false;
  }
}

// ══════════ U2：项目资产抽屉（616×733 覆盖面板，三 tab：角色 / 场景 / 道具）══════════
/**
 * 竞品实测（docs/03-frontend/_ui-audit/ref-facts.md §3.6 + 1424×805 像素扫描）：
 * 面板 x152~768（616×733）、底 rgb(27,27,29)、1px rgb(54,56,63) 描边、r20，
 * 三个 tab（角色 / 场景 / 道具）+ 搜索 +「仅展示主体」复选。
 *
 * 抽屉只做「本镜取材」，所以有自己的 tab 状态（3 个）；页面「资产」视图是 4 tab 的编辑面
 * （多一个「其他」）。「其他」类资产不能因此变成不可绑定：它跟道具同 tab、单独分组展示。
 */
const drawerTab = ref<"character" | "scene" | "prop">("character");
const drawerTabOptions = [
  { key: "character" as const, label: t("projectDetail.assetTabs.character") },
  { key: "scene" as const, label: t("projectDetail.assetTabs.scene") },
  { key: "prop" as const, label: t("projectDetail.assetTabs.prop") },
];
const drawerTabLabel = computed(() => drawerTabOptions.find((o) => o.key === drawerTab.value)?.label ?? "");
const drawerSearch = ref("");
const drawerOnlySubject = ref(false);
const drawerError = ref("");

interface DrawerGroup {
  key: string;
  label: string;
  showLabel: boolean;
  items: ProjectAssetDto[];
}

/** 本集匹配结果里出现的资产 id（status 1/2 都有对应资产；3 缺失没有资产可展示） */
const matchSubjectIds = computed<Set<string>>(() => {
  const set = new Set<string>();
  for (const entry of matchEntries.value) {
    if (entry.status !== 3 && entry.resource_id) set.add(entry.resource_id);
  }
  return set;
});

function drawerAssetsOf(key: "character" | "scene" | "prop" | "other"): ProjectAssetDto[] {
  if (key === "character") {
    return characters.value
      .map((c) => assetMap.value.get(c.id))
      .filter((a): a is ProjectAssetDto => Boolean(a));
  }
  return projectAssets.value[key] ?? [];
}

const drawerGroups = computed<DrawerGroup[]>(() => {
  const kw = drawerSearch.value.trim();
  const keep = (a: ProjectAssetDto): boolean => {
    if (
      kw &&
      !a.name.includes(kw) &&
      !(a.description ?? "").includes(kw) &&
      !(a.prompt ?? "").includes(kw)
    ) {
      return false;
    }
    // 「仅展示主体」= 只留本集匹配结果里出现的主体；已勾选的始终保留，否则取消不掉
    if (drawerOnlySubject.value && !matchSubjectIds.value.has(a.id) && !drawerSelection.value.includes(a.id)) {
      return false;
    }
    return true;
  };
  // 可用（已定稿 + 有参考图）排前面：抽屉是取材面板，不可用的放到最后但不隐藏
  const pick = (list: ProjectAssetDto[]): ProjectAssetDto[] =>
    list.filter(keep).sort((a, b) => Number(assetUsable(b)) - Number(assetUsable(a)));
  const groups: DrawerGroup[] = [
    { key: drawerTab.value, label: drawerTabLabel.value, showLabel: false, items: pick(drawerAssetsOf(drawerTab.value)) },
  ];
  if (drawerTab.value === "prop") {
    const others = pick(drawerAssetsOf("other"));
    if (others.length) {
      groups.push({ key: "other", label: t("projectDetail.assetTabs.other"), showLabel: true, items: others });
    }
  }
  return groups;
});
const drawerHasItems = computed(() => drawerGroups.value.some((g) => g.items.length > 0));
const drawerEmptyTitle = computed(() =>
  drawerSearch.value.trim()
    ? t("projectDetail.ui.drawerEmpty")
    : t("projectDetail.ui.drawerEmptyKind", { kind: drawerTabLabel.value }),
);
/** 预选里来自匹配结果的项（可取消） */
const drawerPreselectedCount = computed(
  () => matchedAssetIds.value.filter((id) => drawerSelection.value.includes(id)).length,
);
function drawerStatusText(a: ProjectAssetDto): string {
  if (!assetFinalized(a)) return t("projectDetail.ui.drawerUnusableDraft");
  if (!a.ref_image_uri) return t("projectDetail.ui.drawerUnusableNoRef");
  return t("projectDetail.ui.statusFinalized");
}

function openDrawer(): void {
  drawerError.value = "";
  const shot = selectedShot.value;
  const bound = [...(shot?.character_ids ?? [])];
  // 预选匹配结果：本镜提示词/描述里出现过、且已匹配（status=2）的资产默认勾上，可逐项取消。
  // 与后端「按名字命中 → 绑已定稿资产」同一口径，不是把整集主体一股脑塞进这一镜。
  const text = shot ? `${shot.video_prompt ?? ""} ${shot.shot_desc ?? ""}` : "";
  const preselected = matchEntries.value
    .filter(
      (entry) =>
        entry.status === 2 &&
        Boolean(entry.resource_id) &&
        entry.name.trim().length > 0 &&
        text.includes(entry.name.trim()),
    )
    .map((entry) => entry.resource_id)
    .filter((id) => !bound.includes(id));
  drawerSelection.value = [...bound, ...preselected];
  // 落在有内容的 tab（当前 tab 空、别的 tab 有东西时才切，避免无故跳 tab）
  if (!drawerAssetsOf(drawerTab.value).length) {
    const firstWithAssets = drawerTabOptions.find((o) => drawerAssetsOf(o.key).length);
    if (firstWithAssets) drawerTab.value = firstWithAssets.key;
  }
  assetDrawer.value = true;
  void loadProjectAssets();
}

function closeDrawer(): void {
  assetDrawer.value = false;
  drawerError.value = "";
}

function toggleDrawerAsset(id: string): void {
  drawerSelection.value = drawerSelection.value.includes(id)
    ? drawerSelection.value.filter((x) => x !== id)
    : [...drawerSelection.value, id];
}

/** 取消「匹配结果」预选的那部分（保留本镜原有绑定与用户手选） */
function clearMatchedPreselect(): void {
  const bound = new Set(selectedShot.value?.character_ids ?? []);
  drawerSelection.value = drawerSelection.value.filter(
    (id) => !matchedAssetIds.value.includes(id) || bound.has(id),
  );
}

async function applyDrawerAssets(): Promise<void> {
  const shot = selectedShot.value;
  if (!shot) {
    drawerError.value = t("projectDetail.ui.pickShotFirst");
    return;
  }
  drawerSaving.value = true;
  drawerError.value = "";
  try {
    const ok = await setShotAssets(drawerSelection.value);
    if (ok) assetDrawer.value = false;
    else drawerError.value = error.value || t("projectDetail.ui.applyFailed");
  } finally {
    drawerSaving.value = false;
  }
}
// ══════════ P3：AI 提取资产（剧本 → 场景/道具草稿）══════════
const extracting = ref(false);
const draftAssets = computed<ProjectAssetDto[]>(() =>
  [...projectAssets.value.scene, ...projectAssets.value.prop, ...projectAssets.value.other].filter((a) => a.status !== 2),
);

/**
 * AI 提取资产：POST /projects/:id/assets/extract（script.controller.ts:835）。
 * 契约（packages/shared/schemas/project.ts:111）：
 * - `episode_id` 省略时用项目 source_text，给了就用该集 title/synopsis/script_text；
 * - `include_characters` 默认 false，为 true 时才把角色也落成草稿（去重同名）；
 * - `overwrite` 默认 false（本页不动它：重跑只补新条目，不覆盖已编辑文本）。
 *
 * 角色空态那张白 CTA 必须带 `include_characters: true`，否则用户点「AI 智能提取资产」
 * 后角色 tab 还是空的——那正是这条入口此前被禁用时掩盖的问题。
 */
async function extractAssets(
  scope: "episode" | "project",
  options: { includeCharacters?: boolean } = {},
): Promise<void> {
  if (extracting.value) return;
  extracting.value = true;
  error.value = "";
  info.value = "";
  try {
    const body: { episode_id?: string; include_characters: boolean } = {
      include_characters: options.includeCharacters === true,
    };
    if (scope === "episode" && selectedEpisodeId.value) body.episode_id = selectedEpisodeId.value;
    const res = await api.post<{
      created: number;
      updated: number;
      skipped: number;
      items: ProjectAssetDto[];
      truncated?: boolean;
    }>(`/projects/${projectId.value}/assets/extract`, body);
    await loadProjectAssets();
    // 角色草稿走 characters 接口，不重取项目就只在数据库里有、界面上看不到
    if (options.includeCharacters) await loadProject();
    const parts = [t("projectDetail.aiExtractPartsCreated", { count: res.created }), t("projectDetail.aiExtractPartsUpdated", { count: res.updated })];
    if (res.skipped) parts.push(t("projectDetail.aiExtractPartsSkipped", { count: res.skipped }));
    info.value = t("projectDetail.aiExtractDone", {
      parts: parts.join("，"),
      truncated: res.truncated ? t("projectDetail.aiExtractTruncated") : "",
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.aiExtractFailed");
  } finally {
    extracting.value = false;
  }
}

/** 角色空态的 AI 提取：带上角色；失败在按钮下方留一条可读错误 + 重试（页面 banner 也照常显示） */
const heroExtractError = ref("");
async function extractCharactersWithAi(): Promise<void> {
  heroExtractError.value = "";
  await extractAssets(selectedEpisodeId.value ? "episode" : "project", { includeCharacters: true });
  if (error.value) heroExtractError.value = error.value;
}

/** 无参考图的草稿资产：定稿也不会被后端采纳（400105），单独统计引导去生成图 */
const draftsWithoutImage = computed(() => draftAssets.value.filter((a) => !a.ref_image_uri));
const draftsWithImage = computed(() => draftAssets.value.filter((a) => !!a.ref_image_uri));

/** 一键定稿：只定稿「已有参考图」的草稿资产；缺图的提示先生成图 */
async function finalizeAllDrafts(): Promise<void> {
  const targets = draftsWithImage.value;
  if (!targets.length) {
    error.value = draftsWithoutImage.value.length
      ? t("projectDetail.batchFinalizeNoRefs")
      : t("projectDetail.batchFinalizeNothing");
    return;
  }
  await run(t("projectDetail.confirmFinalized"), async () => {
    let ok = 0;
    for (const a of targets) {
      try {
        await api.patch(`/projects/${projectId.value}/assets/${a.id}`, { status: 2 });
        ok += 1;
      } catch {
        /* 单个失败不阻塞其余 */
      }
    }
    await loadProjectAssets();
    const missing = draftsWithoutImage.value.length;
    info.value = t("projectDetail.batchFinalized", {
      ok,
      total: targets.length,
      missing: missing ? t("projectDetail.batchFinalizedMissing", { count: missing }) : "",
    });
  });
}

/** mock/失效图片兜底：加载失败时隐藏 img，露出底色占位 */
function hideBrokenImage(event: Event): void {
  const el = event.target as HTMLImageElement | null;
  if (el) el.style.display = "none";
}
// ══════════ P3.5：项目资产参考图生成（generate-image → 轮询候选 → 选图定稿）══════════
const assetCandidates = ref<{ assetId: string; taskId: string; list: Array<{ index: number; url: string }> } | null>(null);
/** 3D 导演台（P8）：真实 three.js 场景 */
const director3dOpen = ref(false);

/** 3D 定格 → 上传 → 写入该镜首帧（P9 闭环） */
const firstFrameBusy = ref(false);
async function onDirectorCaptured(dataUrl: string): Promise<void> {
  const shot = selectedShot.value;
  if (!shot || !selectedEpisodeId.value) return;
  firstFrameBusy.value = true;
  error.value = "";
  try {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma);
    const contentType = meta.includes("image/png") ? "image/png" : "image/jpeg";
    const base64 = dataUrl.slice(comma + 1);
    const uploaded = await api.post<{ id: string; uri: string; url: string }>("/assets/upload", {
      filename: `director3d-shot-${shot.shot_no}.png`,
      content_type: contentType,
      data_base64: base64,
    });
    await api.patch(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}`,
      { first_frame_uri: uploaded.uri },
    );
    await loadEpisode();
    const refreshed = shots.value.find((s) => s.id === shot.id);
    if (refreshed) {
      refreshed.first_frame_uri = uploaded.uri;
      refreshed.first_frame_url = uploaded.url;
    }
    info.value = t("projectDetail.setFirstFrameDone", { no: shot.shot_no });
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.setFirstFrameFailed");
  } finally {
    firstFrameBusy.value = false;
  }
}

/** 清空该镜首帧 */
async function clearFirstFrame(): Promise<void> {
  const shot = selectedShot.value;
  if (!shot || !selectedEpisodeId.value) return;
  await run(t("projectDetail.clearFirstFrameDone"), async () => {
    await api.patch(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}`,
      { first_frame_uri: null },
    );
    await loadEpisode();
    const refreshed = shots.value.find((s) => s.id === shot.id);
    if (refreshed) {
      refreshed.first_frame_uri = null;
      refreshed.first_frame_url = null;
    }
    info.value = t("projectDetail.clearFirstFrameDone");
  });
}
const assetImageBusyId = ref("");

async function generateAssetImage(a: ProjectAssetDto): Promise<void> {
  if (assetImageBusyId.value) return;
  assetImageBusyId.value = a.id;
  error.value = "";
  try {
    const res = await api.post<{ task_id: string; model: string }>(
      `/projects/${projectId.value}/assets/${a.id}/generate-image`,
      {},
    );
    info.value = t("projectDetail.genSubmitted", { model: res.model });
    await pollAssetCandidates(a.id, res.task_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.genFailed");
  } finally {
    assetImageBusyId.value = "";
  }
}

/** 轮询候选图（400105 = 任务尚未成功，继续等；最多 ~90s） */
async function pollAssetCandidates(assetId: string, taskId: string): Promise<void> {
  for (let i = 0; i < 45; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await api.get<{ task_id: string; candidates: Array<{ index: number; url: string }> }>(
        `/projects/${projectId.value}/assets/${assetId}/candidates`,
      );
      if (res.candidates.length) {
        assetCandidates.value = { assetId, taskId: res.task_id ?? taskId, list: res.candidates };
        info.value = t("projectDetail.candidatesReady");
        return;
      }
    } catch {
      /* 任务未成功：继续轮询 */
    }
  }
  error.value = t("projectDetail.genTimeout");
}

async function showAssetCandidates(a: ProjectAssetDto): Promise<void> {
  assetImageBusyId.value = a.id;
  error.value = "";
  try {
    const res = await api.get<{ task_id: string; candidates: Array<{ index: number; url: string }> }>(
      `/projects/${projectId.value}/assets/${a.id}/candidates`,
    );
    assetCandidates.value = { assetId: a.id, taskId: res.task_id, list: res.candidates };
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectDetail.noCandidates");
  } finally {
    assetImageBusyId.value = "";
  }
}

async function selectAssetCandidate(item: { index: number; url: string }): Promise<void> {
  const cur = assetCandidates.value;
  if (!cur) return;
  await run(t("projectDetail.refAdopted"), async () => {
    await api.post(`/projects/${projectId.value}/assets/${cur.assetId}/select`, {
      task_id: cur.taskId,
      index: item.index,
    });
    assetCandidates.value = null;
    await loadProjectAssets();
    info.value = t("projectDetail.refAdopted");
  });
}

function assetImageRunning(a: ProjectAssetDto): boolean {
  return assetImageBusyId.value === a.id;
}
// ══════════ P4-1：时间线导出（本地时间线 + 真实成片播放）══════════
type TimelineClip = { id: string; shotId: string; shotNo: number; name: string; duration: number; taskId: string | null; url: string | null };

const clips = ref<TimelineClip[]>([]);
const playing = ref(false);
const playhead = ref(0);
const pxPerSec = ref(36);
const tlFilter = ref<"all" | "finalized">("all");
let rafId = 0;

const timelineKey = computed(() => `timeline:${projectId.value}:${selectedEpisodeId.value}`);
const totalDuration = computed(() => clips.value.reduce((sum, c) => sum + c.duration, 0));
function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
const playheadLabel = computed(() => fmtTime(playhead.value));
const totalLabel = computed(() => fmtTime(totalDuration.value));
const trackWidth = computed(() => Math.max(320, totalDuration.value * pxPerSec.value));

/** 时间线里的镜头（带出片任务）；「已定稿」筛选 = 有可用的出片结果 */
const timelineShots = computed(() =>
  shots.value.filter((s) => (tlFilter.value === "finalized" ? isShotFinalized(s) : true)),
);
const activeClip = computed<TimelineClip | null>(() => {
  let acc = 0;
  for (const clip of clips.value) {
    if (playhead.value < acc + clip.duration) return clip;
    acc += clip.duration;
  }
  return clips.value.length ? clips.value[clips.value.length - 1] ?? null : null;
});

const timelineLoading = ref(false);

/** 本地缓存（离线兜底 / 快速首帧）：项目页只读，缓存只用于服务端读取失败时的兜底展示 */
function cacheTimeline(): void {
  try {
    localStorage.setItem(timelineKey.value, JSON.stringify(clips.value));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * 读取：优先服务端，失败回退本地缓存。
 *
 * **U3 / D2：项目页时间线只做只读预览。** 编辑面只保留剪辑台（/reelflow/edit/:projectId），
 * 所以这里没有任何写路径——没有防抖保存、没有 addShotClip / moveClip / removeClip /
 * rebuildTimeline / 合成导出。原来那一套在本页是第二条时间线，能力又和编辑台不等，
 * 用户在这里改完再去编辑台会看到另一份数据；现在只有「片段 + 播放头」。
 */
async function loadTimeline(): Promise<void> {
  playhead.value = 0;
  timelineLoading.value = true;
  try {
    const res = await api.get<{ clips: Array<{ clip_id: string; shot_id: string; task_id: string | null; name: string; duration: number }> }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/timeline`,
    );
    clips.value = (res.clips ?? []).map((c) => ({
      id: c.clip_id,
      shotId: c.shot_id,
      shotNo: shots.value.find((s) => s.id === c.shot_id)?.shot_no ?? 0,
      name: c.name,
      duration: c.duration,
      taskId: c.task_id,
      url: null,
    }));
    cacheTimeline();
    void hydrateClipUrls();
  } catch {
    try {
      const raw = localStorage.getItem(timelineKey.value);
      clips.value = raw ? (JSON.parse(raw) as TimelineClip[]) : [];
    } catch {
      clips.value = [];
    }
  } finally {
    timelineLoading.value = false;
  }
}

/** 补齐片段播放地址（签名 URL） */
async function hydrateClipUrls(): Promise<void> {
  for (const clip of clips.value) {
    if (!clip.taskId || clip.url) continue;
    const url = await clipUrl(clip.taskId);
    const target = clips.value.find((c) => c.id === clip.id);
    if (target && url) target.url = url;
  }
}

/** 取某条结果的播放地址（后端签名 URL，1h 有效） */
async function clipUrl(taskId: string): Promise<string | null> {
  try {
    const res = await api.get<{ url: string }>(`/tasks/${taskId}/results/0/download-url`);
    return res.url ?? null;
  } catch {
    return null;
  }
}

/** 当前预览的镜头（点左栏 = 把播放头对到它在时间线里的位置，不改任何数据） */
const previewShotId = ref("");

/** 左栏点镜头：只移动播放头；该镜还没进时间线时给出可行动提示，不假装能「加入」 */
function previewShot(shot: StoryboardDto): void {
  previewShotId.value = shot.id;
  let acc = 0;
  const clip = clips.value.find((c) => c.shotId === shot.id);
  if (!clip) {
    info.value = t("projectDetail.ui.tlPreviewShotMissing");
    return;
  }
  for (const c of clips.value) {
    if (c.id === clip.id) break;
    acc += c.duration;
  }
  playhead.value = acc;
}

/** 「去剪辑台」：编辑面唯一入口。集数用 query 带（编辑台按 project 载入），并在本地留一份 */
const editorHref = computed(() => {
  const base = `/reelflow/edit/${projectId.value}`;
  const ep = selectedEpisodeId.value;
  return ep ? `${base}?ep=${encodeURIComponent(ep)}` : base;
});
function rememberEditorEpisode(): void {
  if (!selectedEpisodeId.value) return;
  try {
    localStorage.setItem(`reelflow:ep:${projectId.value}`, selectedEpisodeId.value);
  } catch {
    /* 隐私模式下写不进去：不影响带 query 的跳转 */
  }
}

function seekTo(seconds: number): void {
  playhead.value = Math.min(Math.max(0, seconds), totalDuration.value);
}

/**
 * 轨道点击定位播放头。原实现用 `event.offsetX`，横向滚动后坐标会带上 scrollLeft 的偏移，
 * 点哪里都会落到错误位置（台账 §2.4 #18）。这里改用当前元素 rect + scrollLeft。
 * 只读视图仍然允许「定位播放头」——它是预览动作，不改数据。
 */
function onTrackSeek(event: MouseEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left + el.scrollLeft;
  seekTo(x / pxPerSec.value);
}

function togglePlay(): void {
  if (!clips.value.length) {
    error.value = t("projectDetail.timelineEmptyAdd");
    return;
  }
  playing.value = !playing.value;
  if (playing.value) {
    const startedAt = Date.now() - playhead.value * 1000;
    const tick = (): void => {
      if (!playing.value) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= totalDuration.value) {
        playhead.value = totalDuration.value;
        playing.value = false;
        return;
      }
      playhead.value = elapsed;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** 换集 / 换项目：重读时间线预览与本集匹配结果（都是读，没有写） */
watch([selectedEpisodeId, projectId], () => {
  previewShotId.value = "";
  void loadTimeline();
  void loadMatchResult();
});
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
});
// ══════════ P6：资产校验（对齐参照 /series-manage/asset-confirm）══════════
const confirmStage = ref<"list" | "generate">("list");
const confirmSelected = ref<string[]>([]);
const confirmSearch = ref("");
const confirmBusy = ref(false);

const confirmEpisodeIndex = computed(() => episodes.value.findIndex((e) => e.id === selectedEpisodeId.value));
const confirmEpisodeLabel = computed(() => {
  const idx = confirmEpisodeIndex.value;
  return idx >= 0 ? t("projectDetail.episodeLabel", { n: episodes.value[idx]?.ep_no ?? idx + 1 }) : t("projectDetail.thisEpisode");
});
/** 校验清单：角色 + 场景/道具/其他（可搜索） */
const confirmAssets = computed<ProjectAssetDto[]>(() => {
  const list = [
    ...characters.value.map((c) => assetMap.value.get(c.id)).filter((a): a is ProjectAssetDto => Boolean(a)),
    ...projectAssets.value.scene,
    ...projectAssets.value.prop,
    ...projectAssets.value.other,
  ];
  const kw = confirmSearch.value.trim();
  return kw ? list.filter((a) => a.name.includes(kw) || (a.description ?? "").includes(kw)) : list;
});
const confirmStats = computed(() => {
  const all = confirmAssets.value;
  return {
    total: all.length,
    drafts: all.filter((a) => a.status !== 2).length,
    withImage: all.filter((a) => Boolean(a.ref_image_uri)).length,
    selected: confirmSelected.value.length,
  };
});
const confirmSelectedAssets = computed(() =>
  confirmAssets.value.filter((a) => confirmSelected.value.includes(a.id)),
);

function toggleConfirm(id: string): void {
  confirmSelected.value = confirmSelected.value.includes(id)
    ? confirmSelected.value.filter((x) => x !== id)
    : [...confirmSelected.value, id];
}
function selectAllConfirm(): void {
  confirmSelected.value =
    confirmSelected.value.length === confirmAssets.value.length ? [] : confirmAssets.value.map((a) => a.id);
}
function selectNoImageConfirm(): void {
  // 角色图走「角色定妆图」链路（generate-image 对 kind=character 会 400101），这里只选场景/道具/其他
  confirmSelected.value = confirmAssets.value
    .filter((a) => !a.ref_image_uri && a.kind !== "character")
    .map((a) => a.id);
}
function prevEpisode(): void {
  const idx = confirmEpisodeIndex.value;
  if (idx > 0) {
    const ep = episodes.value[idx - 1];
    if (ep) void selectEpisode(ep.id);
  }
}
function nextEpisode(): void {
  const idx = confirmEpisodeIndex.value;
  if (idx >= 0 && idx < episodes.value.length - 1) {
    const ep = episodes.value[idx + 1];
    if (ep) void selectEpisode(ep.id);
  }
}

/** 批量定稿 / 取消定稿（仅对有参考图的可定稿） */
async function batchConfirmStatus(status: 1 | 2): Promise<void> {
  const targets = confirmSelectedAssets.value.filter((a) => (status === 2 ? Boolean(a.ref_image_uri) : true));
  if (!targets.length) {
    error.value = status === 2 ? t("projectDetail.confirmFinalizeNoRefs") : t("projectDetail.confirmSelectFirst");
    return;
  }
  confirmBusy.value = true;
  try {
    let ok = 0;
    for (const a of targets) {
      try {
        await api.patch(`/projects/${projectId.value}/assets/${a.id}`, { status });
        ok += 1;
      } catch {
        /* 单条失败不阻塞 */
      }
    }
    await loadProjectAssets();
    await loadProject();
    info.value =
      status === 2
        ? t("projectDetail.confirmFinalized", { ok, total: targets.length })
        : t("projectDetail.confirmUnfinalized", { ok, total: targets.length });
  } finally {
    confirmBusy.value = false;
  }
}

/** 批量生成参考图：逐个提交生成任务（不阻塞等待；完成后到「资产」视图采用） */
async function batchGenerateSelected(): Promise<void> {
  const picked = confirmSelectedAssets.value;
  const targets = picked.filter((a) => a.kind !== "character");
  const skippedCharacters = picked.length - targets.length;
  if (!targets.length) {
    error.value = skippedCharacters
      ? t("projectDetail.confirmGenCharactersOnly")
      : t("projectDetail.confirmGenSelectFirst");
    return;
  }
  confirmBusy.value = true;
  error.value = "";
  try {
    let ok = 0;
    for (const a of targets) {
      try {
        await api.post(`/projects/${projectId.value}/assets/${a.id}/generate-image`, { count: 1 });
        ok += 1;
      } catch {
        /* 单条失败不阻塞 */
      }
    }
    await loadProjectAssets();
    info.value =
      t("projectDetail.confirmGenSubmitted", { ok, total: targets.length, skipped: "" }) +
      (skippedCharacters ? t("projectDetail.confirmGenSkipped", { count: skippedCharacters }) : "");
  } finally {
    confirmBusy.value = false;
  }
}

/** 删除勾选资产（连带解绑） */
async function batchDeleteSelected(): Promise<void> {
  const targets = confirmSelectedAssets.value;
  if (!targets.length) {
    error.value = t("projectDetail.confirmDeleteSelectFirst");
    return;
  }
  confirmBusy.value = true;
  try {
    let ok = 0;
    for (const a of targets) {
      try {
        await api.delete(`/projects/${projectId.value}/assets/${a.id}`);
        ok += 1;
      } catch {
        /* ignore */
      }
    }
    confirmSelected.value = [];
    await loadProjectAssets();
    await loadEpisode();
    info.value = t("projectDetail.confirmDeleted", { count: ok });
  } finally {
    confirmBusy.value = false;
  }
}
/** 资产类型中文名 */
function kindLabel(kind: string): string {
  return (
    {
      character: t("projectDetail.kindLabel.character"),
      scene: t("projectDetail.kindLabel.scene"),
      prop: t("projectDetail.kindLabel.prop"),
      other: t("projectDetail.kindLabel.other"),
    } as Record<string, string>
  )[kind] ?? kind;
}
</script>




<template>
  <div class="episode">
    <!-- ── 顶栏：返回 + 步骤胶囊 + 保存 ── -->
    <header class="ep-head">
      <div class="ep-head__left">
        <NuxtLink to="/projects" class="ctl ctl--icon" :title="t('projectDetail.ui.backToProjects')">←</NuxtLink>
        <div class="picker">
          <button class="ctl ctl--picker" type="button" @click="viewMenu = !viewMenu">
            {{ viewLabel }}<span class="caret">▾</span>
          </button>
          <div v-if="viewMenu" class="picker__menu">
            <button
              v-for="v in viewOptions"
              :key="v.key"
              type="button"
              class="picker__item"
              :class="{ on: tab === v.key }"
              :data-view="v.key"
              @click="setView(v.key)"
            >
              <b>{{ v.label }}</b>
              <em>{{ v.desc }}</em>
            </button>
          </div>
        </div>
        <span class="ep-title">{{ project?.title ?? t("projectDetail.ui.projectFallback") }}</span>
        <Tag v-if="project?.source_type === 1" tone="neutral" size="sm">{{ t("projectDetail.ui.sourceNovel") }}</Tag>
        <Tag v-else-if="project?.source_type === 3" tone="neutral" size="sm">{{ t("projectDetail.ui.sourceImport") }}</Tag>
        <Tag v-else tone="brand" size="sm">{{ t("projectDetail.ui.sourceIdea") }}</Tag>
      </div>
      <div class="ep-head__right">
        <span class="ep-meta">{{ t("projectDetail.ui.epMeta", { ratio: project?.ratio ?? "9:16", episodes: episodes.length, characters: characters.length }) }}</span>
        <Button variant="ghost" size="sm" @click="directorOpen = true">{{ t("projectDetail.ui.director3d") }}</Button>
        <Button size="sm" :disabled="!!busy || !selectedShot" @click="saveSelectedShot">{{ t("projectDetail.ui.save") }}</Button>
        <AccountPills />
      </div>
    </header>

    <!-- ── 提示条 ── -->
    <Transition name="fade">
      <p v-if="error" class="banner banner--error">{{ error }}</p>
    </Transition>
    <Transition name="fade">
      <p v-if="info" class="banner banner--info">{{ info }}</p>
    </Transition>
    <p v-if="busy" class="banner banner--busy"><span class="pulse" />{{ busy }}…</p>

    <!-- ══════════ ① 剧本（分集大纲） ══════════ -->
    <section v-if="tab === 'outline'" class="panel panel--page">
      <div class="panel__head">
        <div>
          <h2>{{ t("projectDetail.ui.scriptTitle") }}</h2>
          <p class="sub">{{ t("projectDetail.ui.scriptSub") }}</p>
        </div>
        <div class="panel__actions">
          <Button :disabled="!!busy" @click="maybeGenerateOutline">
            {{ episodes.length ? t("projectDetail.ui.regen") : t("projectDetail.ui.genOutline") }}
          </Button>
          <Button variant="ghost" :disabled="!!busy || episodes.length === 0" @click="saveOutline">{{ t("projectDetail.ui.confirmOutline") }}</Button>
        </div>
      </div>

      <div v-if="episodes.length" class="ep-grid">
        <article v-for="ep in episodes" :key="ep.id" class="ep-card">
          <div class="ep-card__top">
            <span class="chip">{{ t("projectDetail.ui.epChip", { n: ep.ep_no }) }}</span>
            <Tag :tone="ep.status === 2 ? 'success' : 'neutral'" size="sm">
              {{ ep.status === 2 ? t("projectDetail.ui.epConfirmed") : t("projectDetail.ui.epDraft") }}
            </Tag>
          </div>
          <input v-model="ep.title" class="ep-title-input" maxlength="100" :placeholder="t('projectDetail.ui.epTitlePlaceholder')" @input="saveEpisodeDebounced(ep)" />
          <textarea
            v-model="ep.synopsis"
            class="ep-synopsis"
            maxlength="1000"
            :placeholder="t('projectDetail.ui.epSynopsisPlaceholder')"
            @input="saveEpisodeDebounced(ep)"
          />
          <button type="button" class="mini-link" @click="selectEpisode(ep.id)">{{ t("projectDetail.ui.enterStoryboards") }}</button>
        </article>
      </div>
      <EmptyState
        v-else
        icon="✎"
        :title="t('projectDetail.ui.emptyScriptTitle')"
        :description="t('projectDetail.ui.emptyScriptDesc')"
      >
        <Button :disabled="!!busy" @click="maybeGenerateOutline">{{ t("projectDetail.ui.genOutline") }}</Button>
      </EmptyState>
    </section>

    <!-- ══════════ ② 资产（角色 / 场景 / 道具） ══════════ -->
    <section v-else-if="tab === 'characters'" class="panel panel--page assets-view">
      <div class="av-head">
        <h2>{{ t("projectDetail.ui.assetsHeading") }} <em>({{ assetTab === 'character' ? characters.length : assetItemsNonCharacter.length }})</em></h2>
        <div class="av-tabs">
          <button
            v-for="at in assetTabOptions"
            :key="at.key"
            type="button"
            class="av-tab"
            :class="{ on: assetTab === at.key }"
            @click="assetTab = at.key"
          >
            {{ at.label }}
          </button>
        </div>
        <div class="av-head__right">
          <Button
            v-if="assetTab !== 'character'"
            size="sm"
            variant="ghost"
            :disabled="!!busy"
            @click="openAssetForm(assetTabKind || 'scene')"
          >
            {{ t("projectDetail.ui.newKind", { kind: assetTabLabel }) }}
          </Button>
          <label v-if="assetTab === 'character'" class="inline-field">
            {{ t("projectDetail.ui.lookLock") }}
            <select v-model.number="portraitCount" class="mini-select">
              <option v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ t("projectDetail.ui.nImages", { n }) }}</option>
            </select>
          </label>
          <Button size="sm" :disabled="!!busy" @click="generateCharacters">{{ t("projectDetail.ui.genCharacters") }}</Button>
        </div>
      </div>

      <!-- AI 提取资产（常驻，提取结果落草稿，定稿后才注入分镜） -->
      <div v-if="assetTab !== 'character'" class="ai-extract">
        <div class="ai-extract__text">
          <h3>{{ t("projectDetail.ui.aiExtractTitle") }} <span class="free">{{ t("projectDetail.ui.freeFirst") }}</span></h3>
          <p>{{ t("projectDetail.ui.aiExtractDesc") }}</p>
        </div>
        <div class="ai-extract__ops">
          <Button variant="ghost" :disabled="extracting || !selectedEpisodeId" @click="extractAssets('episode')">{{ t("projectDetail.ui.extractEpisode") }}</Button>
          <Button :disabled="extracting" @click="extractAssets('project')">
            {{ extracting ? t("projectDetail.ui.extracting") : t("projectDetail.ui.aiExtract") }}
          </Button>
        </div>
      </div>
      <p v-if="assetTab !== 'character' && draftAssets.length" class="banner banner--warn">
        {{ t("projectDetail.ui.draftBanner", { draft: draftAssets.length, noImg: draftsWithoutImage.length }) }}
        <button v-if="draftsWithImage.length" class="mini-link" type="button" @click="finalizeAllDrafts">
           {{ t("projectDetail.ui.finalizeAll", { n: draftsWithImage.length }) }}
        </button>
      </p>

      <!-- 角色：有数据 -->
      <div v-if="assetTab === 'character' && characters.length" class="char-grid">
        <article v-for="c in characters" :key="c.id" class="char-card">
          <div class="char-card__pic">
            <img v-if="c.portrait_url" :src="c.portrait_url" :alt="c.name" />
            <div v-else class="char-card__ph"><span>{{ t("projectDetail.ui.notGenerated") }}</span><em>{{ t("projectDetail.ui.lookLock") }}</em></div>
            <Tag class="char-card__tag" :tone="c.status === 2 ? 'success' : 'warning'" size="sm" dot>
              {{ c.status === 2 ? t("projectDetail.ui.statusFinalized") : t("projectDetail.ui.statusDraft") }}
            </Tag>
          </div>
          <div class="char-card__body">
            <b>{{ c.name }}</b>
            <p>{{ c.description || "—" }}</p>
            <div class="char-card__ops">
              <Button size="sm" variant="ghost" :disabled="!!busy" @click="generatePortrait(c)">
                {{ c.portrait_asset_id ? t("projectDetail.ui.regenImage") : t("projectDetail.ui.genLookLock") }}
              </Button>
              <Button v-if="c.portrait_asset_id && c.status !== 2" size="sm" :disabled="!!busy" @click="finalizeCharacter(c)">
                 {{ t("projectDetail.ui.finalize") }}
              </Button>
              <button v-if="c.source_task_id && c.status === 2" type="button" class="mini-btn" @click="loadCandidates(c)">{{ t("projectDetail.ui.candidates") }}</button>
              <button v-if="c.portrait_asset_id && c.status === 2" type="button" class="mini-btn" @click="promoteCharacter(c)">{{ t("projectDetail.ui.toSharedAsset") }}</button>
            </div>
          </div>
        </article>
      </div>

      <!-- 角色：空态（参照三卡：AI 提取 / 生成 / 导入） -->
      <div v-else-if="assetTab === 'character'" class="cta-rows">
        <div class="cta-hero">
          <div class="cta-hero__text">
            <h3>{{ t("projectDetail.ui.aiExtractTitle") }} <span class="free">{{ t("projectDetail.ui.freeFirst") }}</span></h3>
            <p>{{ t("projectDetail.ui.aiExtractDescClean") }}</p>
            <button
              class="btn-white"
              type="button"
              data-extract-hero
              :disabled="extracting || !!busy"
              @click="extractCharactersWithAi"
            >
              ✦ {{ extracting ? t("projectDetail.ui.extracting") : t("projectDetail.ui.aiExtractTitle") }}
            </button>
            <p v-if="heroExtractError" class="cta-hero__err" data-extract-error>
              {{ heroExtractError }}
              <button type="button" class="mini-link" :disabled="extracting || !!busy" @click="extractCharactersWithAi">
                {{ t("common.retry") }}
              </button>
            </p>
          </div>
        </div>
        <div class="cta-two">
          <div class="cta-card">
            <h3>{{ t("projectDetail.ui.genCharTitle") }}</h3>
            <p>{{ t("projectDetail.ui.genCharDesc") }}</p>
            <Button :disabled="!!busy" @click="generateCharacters">{{ t("projectDetail.ui.genCharacters") }}</Button>
          </div>
          <div class="cta-card">
            <h3>{{ t("projectDetail.ui.importCharTitle") }}</h3>
            <p>{{ t("projectDetail.ui.importCharDesc") }}</p>
            <NuxtLink to="/assets" class="ctl ctl--picker">{{ t("projectDetail.ui.goAssetLib") }}</NuxtLink>
          </div>
        </div>
      </div>

      <!-- 场景 / 道具 / 其他：项目资产（P2 已接入 CRUD + 分镜绑定） -->
      <div v-else class="pa-wrap">
        <div v-if="assetItemsNonCharacter.length" class="pa-grid">
          <article v-for="a in assetItemsNonCharacter" :key="a.id" class="pa-card">
            <div class="pa-card__pic">
              <img v-if="assetImage(a)" :src="assetImage(a) || ''" :alt="a.name" />
              <i v-else />
              <Tag class="pa-card__tag" :tone="a.status === 2 ? 'success' : 'warning'" size="sm" dot>
                {{ a.status === 2 ? t("projectDetail.ui.statusFinalized") : t("projectDetail.ui.statusDraftShort") }}
              </Tag>
            </div>
            <div class="pa-card__body">
              <b>{{ a.name }}</b>
              <p>{{ a.description || a.prompt || "—" }}</p>
              <div class="pa-card__ops">
                <Button size="sm" :loading="assetImageRunning(a)" :disabled="!!assetImageBusyId" @click="generateAssetImage(a)">
                  {{ a.ref_image_uri ? t("projectDetail.ui.regenImageShort") : t("projectDetail.ui.genImage") }}
                </Button>
                <button v-if="a.source_task_id" type="button" class="mini-btn" :disabled="!!assetImageBusyId" @click="showAssetCandidates(a)">{{ t("projectDetail.ui.candidates") }}</button>
                <Button size="sm" variant="ghost" :disabled="!!busy" @click="openAssetForm(assetTabKind || 'scene', a)">{{ t("projectDetail.ui.edit") }}</Button>
                <Button v-if="a.status !== 2" size="sm" :disabled="!!busy" @click="patchProjectAsset(a, { status: 2 })">{{ t("projectDetail.ui.finalize") }}</Button>
                <Button v-else size="sm" variant="ghost" :disabled="!!busy" @click="patchProjectAsset(a, { status: 1 })">{{ t("projectDetail.ui.unfinalize") }}</Button>
                <button type="button" class="mini-btn" @click="removeProjectAsset(a)">{{ t("projectDetail.ui.delete") }}</button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="cta-rows">
          <div class="cta-two">
            <div class="cta-card">
              <h3>{{ t("projectDetail.ui.newKind", { kind: assetTabLabel }) }}</h3>
              <p>{{ t("projectDetail.ui.newAssetDesc") }}</p>
              <Button @click="openAssetForm(assetTabKind || 'scene')">{{ t("projectDetail.ui.newKind", { kind: assetTabLabel }) }}</Button>
            </div>
            <div class="cta-card">
              <h3>{{ t("projectDetail.ui.importAssetTitle", { kind: assetTabLabel }) }}</h3>
              <p>{{ t("projectDetail.ui.importAssetDesc") }}</p>
              <label class="ctl ctl--picker import-btn">
                {{ uploading ? t("projectDetail.ui.uploading") : t("projectDetail.ui.importKind", { kind: assetTabLabel }) }}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onImportFile" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ ③ 分镜工作台（三列） ══════════ -->
    <div v-else-if="tab === 'storyboards'" class="work">
      <!-- 左：分镜条 -->
      <aside class="rail">
        <button class="rail-ai" type="button" :disabled="!!busy || !selectedEpisodeId" @click="maybeGenerateStoryboards">
          <span>{{ t("projectDetail.ui.aiSplit") }}</span><i>{{ t("projectDetail.ui.freeFirst") }}</i>
        </button>
        <p class="rail-group">{{ t("projectDetail.ui.railGroupShots", { n: shots.length }) }}</p>
        <div class="rail-list">
          <button
            v-for="s in shots"
            :key="s.id"
            type="button"
            class="shot-chip"
            :class="{ on: s.id === selectedShotId }"
            @click="selectShot(s.id)"
          >
            <span class="shot-chip__no">{{ s.shot_no }}</span>
            <span class="shot-chip__pic">
              <img v-if="shotThumb(s)" :src="shotThumb(s) || ''" alt="" @error="hideBrokenImage" />
              <i v-else />
            </span>
            <span class="shot-chip__state">{{ shotStateLabel(s) }}</span>
          </button>
        </div>
        <button class="rail-add" type="button" disabled :title="t('projectDetail.ui.soonAddShotHint')">
          {{ t("projectDetail.ui.addShot") }}
          <span class="soon-chip">{{ t("common.comingSoon") }}</span>
        </button>
        <p v-if="!shots.length" class="rail-empty">{{ t("projectDetail.ui.railEmpty") }}</p>
      </aside>

      <!-- 中：素材区 -->
      <section class="stage">
        <div class="stage-tabs">
          <button
            v-for="st in stageTabOptions"
            :key="st.key"
            type="button"
            class="stage-tab"
            :class="{ on: stageTab === st.key }"
            @click="stageTab = st.key"
          >
            {{ st.label }}
          </button>
        </div>

        <template v-if="selectedShot">
          <label class="field-label">{{ t("projectDetail.ui.shotDescLabel") }}</label>
          <textarea
            v-model="selectedShot.shot_desc"
            class="stage-desc"
            :placeholder="t('projectDetail.ui.shotDescPlaceholder')"
            @blur="saveSelectedShot"
          />

          <div v-if="stageTab !== 'video'" class="mats">
            <figure v-for="m in boundAssets" :key="m.id" class="mat">
              <button type="button" class="mat__rm" :title="t('projectDetail.ui.removeFromShot')" @click="removeShotAsset(m.id)">✕</button>
              <img v-if="assetImage(m)" :src="assetImage(m) || ''" :alt="m.name" @error="hideBrokenImage" />
              <i v-else />
              <figcaption>
                {{ m.name }}
                <em>{{ m.status === 2 ? t("projectDetail.ui.statusFinalized") : t("projectDetail.ui.statusDraftShort") }}</em>
              </figcaption>
            </figure>
            <p v-if="!boundAssets.length" class="stage-empty">
              <span class="stage-empty__icon">▤</span>
              {{ t("projectDetail.ui.noMaterial") }}<br /><em>{{ t("projectDetail.ui.noMaterialHint") }}</em>
            </p>
          </div>

          <div v-else class="mats">
            <div v-for="b in submittedShots" :key="b.shot_id" class="video-row">
              <Tag v-if="b.task_id" tone="success" size="sm" dot>{{ t("projectDetail.ui.shotSubmitted") }}</Tag>
              <Tag v-else tone="danger" size="sm" dot>{{ batchReason(b) }}</Tag>
              <span class="mono">{{ b.task_id ? b.task_id.slice(-8) : "—" }}</span>
              <Tag v-if="b.task_id && taskMap[b.task_id]" tone="info" size="sm">{{ statusLabel(taskMap[b.task_id].status) }}</Tag>
            </div>
            <p v-if="!submittedShots.length" class="stage-empty">
              <span class="stage-empty__icon">▶</span>
              {{ t("projectDetail.ui.noOutput") }}<br /><em>{{ t("projectDetail.ui.noOutputHint") }}</em>
            </p>
          </div>

          <p class="stage-foot">
            {{ t("projectDetail.ui.localUpload") }} <NuxtLink to="/assets" class="link">{{ t("projectDetail.ui.localUpload") }}</NuxtLink> · {{ t("projectDetail.ui.durationByModel") }}
          </p>
        </template>

        <EmptyState
          v-else
          icon="▤"
          :title="t('projectDetail.ui.emptyShotTitle')"
          :description="t('projectDetail.ui.emptyShotDesc')"
        >
          <Button :disabled="!!busy || !selectedEpisodeId" @click="maybeGenerateStoryboards">{{ t("projectDetail.ui.genStoryboards") }}</Button>
        </EmptyState>
      </section>

      <!-- 右：生成台 -->
      <aside class="gen">
        <div class="gen-tabs">
          <button type="button" class="gen-tab" :class="{ on: genTab === 'image' }" @click="genTab = 'image'">{{ t("projectDetail.ui.tabImage") }}</button>
          <button type="button" class="gen-tab" :class="{ on: genTab === 'video' }" @click="genTab = 'video'">{{ t("projectDetail.ui.tabVideo") }}</button>
        </div>

        <template v-if="genTab === 'video'">
          <div class="mode-tabs">
            <button
              v-for="mt in modeOptions"
              :key="mt.key"
              type="button"
              class="mode-tab"
              :class="{ on: mode === mt.key, off: !modeEnabled(mt.key) }"
              :disabled="!modeEnabled(mt.key) || !!busy"
              :title="mt.hint"
              @click="mode = mt.key"
            >
              {{ mt.label }}
            </button>
          </div>
          <p class="gen-hint">{{ modeHint }}</p>

          <div v-if="mode === 'first_frame' || mode === 'first_last' || selectedShot?.first_frame_uri" class="gen-frame">
            <span class="gen-label">{{ t("projectDetail.ui.firstFrame") }}</span>
            <img
              v-if="selectedShot?.first_frame_url"
              :src="selectedShot.first_frame_url || ''"
              class="gen-frame__img"
              :alt="t('projectDetail.ui.firstFrame')"
              @error="hideBrokenImage"
            />
            <span v-else class="gen-frame__ph">{{ selectedShot?.first_frame_uri ? t("projectDetail.ui.set") : t("projectDetail.ui.notSet") }}</span>
            <span class="gen-frame__ops">
              <button class="mini-link" type="button" :disabled="firstFrameBusy" @click="director3dOpen = true">
                {{ firstFrameBusy ? t("projectDetail.ui.uploading") : t("projectDetail.ui.frame3d") }}
              </button>
              <button
                v-if="selectedShot?.first_frame_uri"
                class="mini-link"
                type="button"
                :disabled="firstFrameBusy"
                @click="clearFirstFrame"
              >
                {{ t("projectDetail.ui.clear") }}
              </button>
            </span>
          </div>

          <div class="gen-row">
            <span class="gen-label">{{ t("projectDetail.ui.modelLabel") }}</span>
            <select v-model="modelName" class="mini-select gen-select">
              <option v-for="m in videoModels" :key="m.name" :value="m.name">{{ m.display_name }}</option>
            </select>
          </div>
          <p class="gen-hint">
            {{ t("projectDetail.ui.refHint") }}
          </p>
          <p v-if="idempotentTaskId" class="gen-hint gen-hint--warn">
            {{ t("projectDetail.ui.idempotentHint", { id: idempotentTaskId.slice(-8) }) }}
          </p>

          <div class="gen-row gen-row--between">
            <span class="gen-label">{{ t("projectDetail.ui.pickMaterial") }}</span>
            <button class="mini-link" type="button" :title="t('projectDetail.ui.director3dTitle')" @click="director3dOpen = true">{{ t("projectDetail.ui.director3dBtn") }}</button>
          </div>
          <p class="gen-quota">
            {{ t("projectDetail.ui.boundCount", { img: boundImageCount, total: boundAssets.length }) }}
          </p>

          <div class="gen-cards">
            <button type="button" class="gen-card" @click="openDrawer"><span>+</span>{{ t("projectDetail.ui.projectAssets") }}</button>
            <button type="button" class="gen-card" disabled :title="t('projectDetail.ui.soonMoreSourcesHint')">
              <span>+</span>{{ t("projectDetail.ui.moreSources") }}
              <span class="soon-chip">{{ t("common.comingSoon") }}</span>
            </button>
          </div>

          <div class="gen-row gen-row--between">
            <span class="gen-label">{{ t("projectDetail.ui.promptLabel") }}</span>
            <span class="gen-row__ops">
              <!-- U2 / P0-3：接通 POST …/match-resources；结果只认 match-result.status（受理 ≠ 匹配） -->
              <button
                class="mini-link match-btn"
                type="button"
                :disabled="matchBusy || !!busy || !selectedEpisodeId"
                :title="t('projectDetail.ui.matchHint')"
                @click="runAssetMatch"
              >
                {{ matchBusy ? t("projectDetail.ui.matching") : t("projectDetail.ui.matchAssets") }}
              </button>
              <button class="mini-link" type="button" disabled :title="t('projectDetail.ui.soonZoomHint')">
                {{ t("projectDetail.ui.zoomEdit") }} <span class="soon-chip">{{ t("common.comingSoon") }}</span>
              </button>
            </span>
          </div>
          <p v-if="matchNote" class="match-note">{{ matchNote }}</p>
          <p v-if="matchError" class="match-note match-note--err">{{ matchError }}</p>
          <!-- 匹配结果：状态 + 三类计数 + 未匹配项的可读原因 -->
          <div v-if="matchResult" class="match-box" :data-match-status="matchResult.status">
            <div class="match-box__head">
              <b>{{ t("projectDetail.ui.matchResultTitle") }}</b>
              <Tag
                :tone="matchResult.status === 2 ? 'success' : matchResult.status === 3 ? 'danger' : 'warning'"
                size="sm"
              >
                {{ matchStatusLabel }}
              </Tag>
              <span class="match-box__spacer" />
              <button class="mini-link" type="button" :disabled="matchBusy" @click="loadMatchResult">
                {{ t("projectDetail.ui.matchRefresh") }}
              </button>
            </div>
            <p v-if="matchCountsLine" class="match-box__counts">{{ matchCountsLine }}</p>
            <ul v-if="matchUnavailable.length" class="match-box__list">
              <li v-for="entry in matchUnavailable" :key="entry.kind + '-' + entry.name + '-' + entry.status">
                <span>{{ entry.name }}</span>
                <em>
                  {{ entry.status === 3 ? t("projectDetail.ui.matchMissing") : t("projectDetail.ui.matchUnfinalized") }}
                </em>
              </li>
            </ul>
            <p v-if="matchUnavailableMore" class="match-box__more">
              {{ t("projectDetail.ui.matchUnavailableMore", { n: matchUnavailableMore }) }}
            </p>
            <p class="match-box__split">{{ t("projectDetail.ui.matchNotSplit") }}</p>
          </div>
          <textarea
            v-if="selectedShot"
            v-model="selectedShot.video_prompt"
            class="gen-prompt"
            :placeholder="t('projectDetail.ui.promptPlaceholder')"
            @blur="saveSelectedShot"
          />
          <textarea v-else class="gen-prompt" disabled :placeholder="t('projectDetail.ui.pickShotFirst')" />

          <p class="gen-foot__note">{{ t("projectDetail.ui.aiNote") }}</p>
          <div class="gen-foot">
            <div class="gen-params">
              <span class="param">{{ selectedShot?.resolution ?? "720p" }}</span>
              <span class="param">
                <input v-model.number="shotDuration" class="param-input" type="number" min="1" max="30" />{{ t("projectDetail.ui.seconds") }}
              </span>
              <span class="param">{{ t("projectDetail.ui.oneItem") }}</span>
            </div>
            <button
              class="gen-btn"
              type="button"
              :disabled="!!busy || !selectedShot"
              @click="selectedShot && submitShot(selectedShot)"
            >
              {{ t("projectDetail.ui.generateNow") }}
              <em v-if="shotQuote !== null">✦ {{ shotQuote }}</em>
            </button>
          </div>

        </template>

        <div v-else class="gen-image-empty">
          <EmptyState
            icon="◫"
            :title="t('projectDetail.ui.imageNotWired')"
            :description="t('projectDetail.ui.imageNotWiredDesc')"
          >
            <Button size="sm" variant="ghost" @click="tab = 'characters'">{{ t("projectDetail.ui.goAssetGen") }}</Button>
          </EmptyState>
        </div>
      </aside>
    </div>

    <!-- ══════════ ④ 导出（投递结果 / 矩阵 / 导出） ══════════ -->
    <section v-else-if="tab === 'batch'" class="panel panel--page">
      <div class="panel__head">
        <div>
          <h2>{{ t("projectDetail.ui.exportTitle") }}</h2>
          <p class="sub">{{ t("projectDetail.ui.exportSub") }}</p>
        </div>
        <div class="panel__actions">
          <Button :disabled="!!busy || shots.length === 0" @click="submitBatch">{{ t("projectDetail.ui.submitBatch", { n: shots.length }) }}</Button>
        </div>
      </div>

      <div class="dispatch-bar">
        <label class="inline-field">
          {{ t("projectDetail.ui.modelLabel") }}
          <select v-model="modelName" class="mini-select gen-select">
            <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
          </select>
        </label>
        <label class="inline-field">
          {{ t("projectDetail.ui.budgetCap") }}
          <input v-model.number="budget" type="number" min="1" class="cell-num" @input="budgetTouched = true" />
        </label>
        <Button size="sm" variant="ghost" :disabled="!!busy || shots.length === 0" @click="prefillBudget">{{ t("projectDetail.ui.prefillByQuote") }}</Button>
        <span class="divider" />
        <Button size="sm" variant="ghost" :disabled="exporting || shots.length === 0" @click="submitExport">
          {{ exporting ? t("projectDetail.ui.exportingShort") : t("projectDetail.ui.exportZip") }}
        </Button>
        <a v-if="exportJob?.download_url" :href="exportJob.download_url" class="link" target="_blank" rel="noreferrer">{{ t("projectDetail.ui.downloadZip") }}</a>
        <Tag v-else-if="exportJob" :tone="exportJob.status === 4 ? 'danger' : 'info'" size="sm">
          {{ exportJob.status === 1 ? t("projectDetail.ui.exportQueued") : exportJob.status === 2 ? t("projectDetail.ui.exportPacking") : t("projectDetail.ui.exportFailedShort") }}
        </Tag>
        <Button v-if="exportJob?.status === 4" size="sm" variant="text" @click="retryExportJob">{{ t("projectDetail.ui.retry") }}</Button>
      </div>

      <p v-if="budgetExceeded" class="banner banner--warn">{{ t("projectDetail.ui.budgetBanner") }}</p>
      <p v-if="batchItems.some((i) => i.code === 745701)" class="banner banner--warn">
        {{ t("projectDetail.ui.balanceBanner") }}
      </p>
      <p v-if="characters.some((c) => c.status !== 2)" class="banner banner--warn">
        {{ t("projectDetail.ui.charBanner", { n: characters.filter((c) => c.status !== 2).length }) }}
        <button class="mini-link" type="button" @click="tab = 'characters'">{{ t("projectDetail.ui.goFinalizeChars") }}</button>
      </p>

      <!-- 真实导出记录（U3 / P1-3）：GET /projects/:id/exports 的投影，分镜 zip + 成片 mp4 混排 -->
      <div class="block export-history" data-export-history>
        <div class="block__head">
          <p class="block-label">{{ t("projectDetail.ui.exportHistoryTitle") }}</p>
          <div class="export-history__ops">
            <span v-if="exportHistoryTotal" class="muted">
              {{ t("projectDetail.ui.exportHistoryTotal", { total: exportHistoryTotal }) }}
            </span>
            <Button
              size="sm"
              variant="ghost"
              :disabled="exportHistoryLoading"
              @click="loadExportHistory(exportHistoryPage)"
            >
              {{ exportHistoryLoading ? t("common.loading") : t("projectDetail.ui.refresh") }}
            </Button>
          </div>
        </div>

        <p v-if="exportHistoryError" class="banner banner--warn" data-export-error>
          {{ exportHistoryError }}
          <button type="button" class="mini-link" @click="loadExportHistory(1)">{{ t("common.retry") }}</button>
        </p>
        <p v-else-if="exportHistoryLoading && !exportHistory.length" class="muted">{{ t("common.loading") }}</p>
        <div v-else-if="exportHistory.length" class="export-table">
          <div class="export-row export-row--head">
            <span>{{ t("projectDetail.ui.exportColKind") }}</span>
            <span>{{ t("projectDetail.ui.exportColEpisode") }}</span>
            <span>{{ t("projectDetail.ui.exportColStatus") }}</span>
            <span>{{ t("projectDetail.ui.exportColTime") }}</span>
            <span>{{ t("projectDetail.ui.exportColDownload") }}</span>
            <span>{{ t("projectDetail.ui.exportColExpires") }}</span>
          </div>
          <div
            v-for="item in exportHistory"
            :key="item.kind + ':' + item.export_id"
            class="export-row"
            :data-export-kind="item.kind"
            :data-export-id="item.export_id"
          >
            <span class="export-row__kind">{{ exportKindLabel(item) }}</span>
            <span>{{ item.episode_no ? t("projectDetail.ui.epChip", { n: item.episode_no }) : "—" }}</span>
            <span>
              <Tag :tone="exportStatusTone(item)" size="sm" dot>{{ exportStatusText(item) }}</Tag>
            </span>
            <span class="mono">{{ fmtDateTime(item.created_at) }}</span>
            <span>
              <a v-if="item.download_url" :href="item.download_url" class="link" target="_blank" rel="noreferrer">
                {{ t("projectDetail.ui.downloadFile") }}
              </a>
              <em v-else class="export-row__none">{{ exportNoDownloadReason(item) }}</em>
            </span>
            <span>
              <em v-if="exportExpired(item)" class="export-row__expired">
                {{ t("projectDetail.ui.exportExpiredTag") }}
              </em>
              <em v-else-if="item.expires_at" class="export-row__none">
                {{ t("projectDetail.ui.exportExpiresAt", { time: fmtDateTime(item.expires_at) }) }}
              </em>
              <em v-else class="export-row__none">{{ t("projectDetail.ui.exportNoExpiry") }}</em>
            </span>
          </div>
        </div>
        <EmptyState
          v-else
          icon="⇩"
          :title="t('projectDetail.ui.exportHistoryEmpty')"
          :description="t('projectDetail.ui.exportHistoryEmptyDesc')"
        />

        <div v-if="exportHistoryTotal > EXPORT_PAGE_SIZE" class="export-pager">
          <button
            type="button"
            class="mini-btn"
            :disabled="exportHistoryLoading || exportHistoryPage <= 1"
            @click="loadExportHistory(exportHistoryPage - 1)"
          >
            ‹ {{ t("projectDetail.ui.prevPage") }}
          </button>
          <span class="muted">{{ exportHistoryPage }} / {{ exportHistoryPages }}</span>
          <button
            type="button"
            class="mini-btn"
            :disabled="exportHistoryLoading || exportHistoryPage >= exportHistoryPages"
            @click="loadExportHistory(exportHistoryPage + 1)"
          >
            {{ t("projectDetail.ui.nextPage") }} ›
          </button>
        </div>
        <p v-if="exportHistoryTruncated" class="export-history__note">
          {{ t("projectDetail.ui.exportHistoryTruncated") }}
        </p>
      </div>

      <div v-if="matrix" class="block">
        <div class="block__head">
          <p class="block-label">{{ t("projectDetail.ui.matrixTitle") }}</p>
          <div class="legend">
            <span><i class="dot success" />{{ t("projectDetail.ui.legendSuccess") }}</span>
            <span><i class="dot running" />{{ t("projectDetail.ui.legendRunning") }}</span>
            <span><i class="dot failed" />{{ t("projectDetail.ui.legendFailed") }}</span>
            <span><i class="dot idle" />{{ t("projectDetail.ui.legendIdle") }}</span>
          </div>
        </div>
        <div v-for="ep in matrix.episodes" :key="ep.id" class="matrix-row">
          <span class="matrix-label">{{ t("projectDetail.ui.matrixEp", { n: ep.ep_no }) }}</span>
          <button
            v-for="shot in ep.shots"
            :key="shot.id"
            type="button"
            class="mcell"
            :class="matrixClass(shot)"
            :title="t('projectDetail.ui.matrixShotTitle', { shot: shot.shot_no, status: shot.status, task: shot.task_status ? t('projectDetail.ui.matrixTaskSuffix', { status: shot.task_status }) : '' })"
            @click="openMatrixShot(ep.id)"
          >
            {{ shot.shot_no }}
          </button>
          <span v-if="ep.shots.length === 0" class="muted">{{ t("projectDetail.ui.noShotsShort") }}</span>
        </div>
      </div>

      <div v-if="batchItems.length" class="block">
        <p class="block-label">{{ t("projectDetail.ui.submitResult") }}</p>
        <div v-for="item in batchItems" :key="item.shot_id" class="batch-row">
          <span class="b-no">{{ t("projectDetail.ui.shotNo", { n: shotNoOf(item.shot_id) }) }}</span>
          <Tag v-if="item.submitted" tone="success" size="sm" dot>{{ t("projectDetail.ui.submittedTag") }}</Tag>
          <Tag v-else tone="danger" size="sm" dot>{{ batchReason(item) }}</Tag>
          <span v-if="item.task_id" class="mono">{{ item.task_id.slice(-8) }}</span>
          <Tag v-if="item.task_id && taskMap[item.task_id]" tone="info" size="sm">
            {{ statusLabel(taskMap[item.task_id].status) }}
          </Tag>
        </div>
      </div>
      <EmptyState
        v-else
        icon="▶"
        :title="t('projectDetail.ui.emptyBatchTitle')"
        :description="t('projectDetail.ui.emptyBatchDesc')"
      />
    </section>

    <!-- ══════════ ⑤ 时间线导出（左素材 / 中预览 / 下时间线） ══════════ -->
    <!-- ══════════ ⑤ 时间线预览（只读；编辑面唯一入口 = 剪辑台 /reelflow/edit/:projectId） ══════════ -->
    <div v-else-if="tab === 'timeline'" class="tl" data-tl-readonly="1">
      <aside class="tl-rail">
        <div class="tl-rail__head">
          <b>{{ t("projectDetail.ui.episodeAssets") }}</b>
          <select v-model="tlFilter" class="mini-select">
            <option value="all">{{ t("projectDetail.assetFilters.all") }}</option>
            <option value="finalized">{{ t("projectDetail.ui.filterFinalized") }}</option>
          </select>
        </div>
        <div class="tl-list">
          <button
            v-for="s in timelineShots"
            :key="s.id"
            type="button"
            class="tl-item"
            :class="{ on: previewShotId === s.id }"
            :data-shot-id="s.id"
            @click="previewShot(s)"
          >
            <span class="tl-item__no">{{ s.shot_no }}</span>
            <span class="tl-item__name">{{ s.shot_desc || t("projectDetail.ui.shotName", { n: s.shot_no }) }}</span>
            <em :class="{ on: isShotFinalized(s) }">{{ shotStateLabel(s) }}</em>
          </button>
          <p v-if="!timelineShots.length" class="tl-empty-sm">{{ t("projectDetail.ui.tlNoShots") }}</p>
        </div>
        <p class="tl-rail__hint">{{ t("projectDetail.ui.tlPreviewRailHint") }}</p>
      </aside>

      <section class="tl-stage">
        <div class="tl-stage__bubble">{{ t("projectDetail.ui.tlPreviewBubble") }}</div>
        <div v-if="activeClip" class="tl-player">
          <video
            v-if="activeClip.url"
            :key="activeClip.id"
            :src="activeClip.url"
            class="tl-video"
            muted
            playsinline
          />
          <div v-else class="tl-player__ph">
            <span>▶</span>
            <p>{{ t("projectDetail.ui.tlNoVideo", { name: activeClip.name }) }}</p>
          </div>
        </div>
        <div v-else class="tl-player__ph tl-player__ph--empty">
          <span>▶</span>
          <p>{{ t("projectDetail.ui.tlPickHint") }}</p>
        </div>
      </section>

      <footer class="tl-bar">
        <div class="tl-bar__head">
          <!-- 只读预览：没有「更新分镜 / 合成导出 / 片段增删排序」，唯一出路是去剪辑台 -->
          <NuxtLink
            class="tl-goto"
            :to="editorHref"
            :data-goto-editor="editorHref"
            @click="rememberEditorEpisode"
          >
            {{ t("projectDetail.ui.goEditor") }} →
          </NuxtLink>
          <button type="button" class="tl-play" @click="togglePlay">{{ playing ? t("projectDetail.ui.pause") : t("projectDetail.ui.play") }}</button>
          <span class="tl-time">{{ playheadLabel }} / {{ totalLabel }}</span>
          <span class="tl-count">{{ t("projectDetail.ui.clipsCount", { n: clips.length }) }}</span>
          <label class="tl-zoom">
            {{ t("projectDetail.ui.zoom") }}
            <input v-model.number="pxPerSec" type="range" min="16" max="120" step="4" />
          </label>
          <span class="tl-spacer" />
          <Tag tone="info" size="sm" dot>{{ t("projectDetail.ui.readOnlyBadge") }}</Tag>
        </div>

        <div class="tl-track" @click="onTrackSeek">
          <div class="tl-ruler">
            <span
              v-for="tick in Math.ceil(totalDuration / 5) + 1"
              :key="tick"
              class="tl-tick"
              :style="{ left: `${(tick - 1) * 5 * pxPerSec}px` }"
            >{{ fmtTime((tick - 1) * 5) }}</span>
          </div>
          <div class="tl-clips" :style="{ width: `${trackWidth}px` }">
            <div
              v-for="clip in clips"
              :key="clip.id"
              class="tl-clip"
              :style="{ width: `${clip.duration * pxPerSec}px` }"
              :class="{ on: activeClip?.id === clip.id }"
              :data-clip-id="clip.id"
            >
              <b>{{ clip.name }}</b>
              <em>{{ clip.duration }}s</em>
            </div>
            <p v-if="!clips.length" class="tl-clips__empty">{{ t("projectDetail.ui.tlPreviewEmpty") }}</p>
            <div class="tl-head" :style="{ left: `${playhead * pxPerSec}px` }" />
          </div>
        </div>
        <p class="tl-note">{{ t("projectDetail.ui.tlPreviewNote") }}</p>
      </footer>
    </div>
    <!-- ══════════ ⑥ 资产校验（对齐参照 /series-manage/asset-confirm） ══════════ -->
    <div v-else class="cf">
      <div class="cf-head">
        <button type="button" class="cf-crumb" :class="{ on: confirmStage === 'list' }" @click="confirmStage = 'list'">
          {{ t("projectDetail.ui.tabCheck") }}
        </button>
        <span class="cf-arrow">➤</span>
        <button type="button" class="cf-crumb" :class="{ on: confirmStage === 'generate' }" @click="confirmStage = 'generate'">
          {{ t("projectDetail.ui.tabGen") }}
        </button>
        <span class="cf-spacer" />
        <input v-model="confirmSearch" class="cf-search" type="search" :placeholder="t('projectDetail.ui.searchAssets')" />
        <Button size="sm" variant="ghost" :disabled="extracting || !selectedEpisodeId" @click="extractAssets('episode')">
          {{ extracting ? t("projectDetail.ui.extracting") : t("projectDetail.ui.reExtract") }}
        </Button>
      </div>

      <div class="cf-toolbar">
        <button type="button" class="cf-ep" :disabled="confirmEpisodeIndex <= 0" @click="prevEpisode">{{ t("projectDetail.ui.prevEp") }}</button>
        <span class="cf-ep-label">{{ confirmEpisodeLabel }}</span>
        <button
          type="button"
          class="cf-ep"
          :disabled="confirmEpisodeIndex < 0 || confirmEpisodeIndex >= episodes.length - 1"
          @click="nextEpisode"
        >
          {{ t("projectDetail.ui.nextEp") }}
        </button>
        <span class="cf-stat">
          {{ t("projectDetail.ui.statsLine", { total: confirmStats.total, drafts: confirmStats.drafts, withImage: confirmStats.withImage, selected: confirmSelected.length }) }}
          {{ confirmStats.selected }}
        </span>
        <span class="cf-spacer" />
        <button type="button" class="mini-btn" :disabled="confirmBusy" @click="selectNoImageConfirm">{{ t("projectDetail.ui.selectNoImage") }}</button>
        <button type="button" class="mini-btn" :disabled="confirmBusy" @click="selectAllConfirm">
          {{ confirmSelected.length === confirmAssets.length ? t("projectDetail.ui.clearAll") : t("projectDetail.ui.selectAll") }}
        </button>
      </div>

      <div v-if="confirmAssets.length" class="cf-list">
        <div class="cf-row cf-row--head">
          <span class="cf-check" />
          <span>{{ t("projectDetail.ui.thAsset") }}</span>
          <span>{{ t("projectDetail.ui.thKind") }}</span>
          <span>{{ t("projectDetail.ui.thPrompt") }}</span>
          <span>{{ t("projectDetail.ui.thStatus") }}</span>
          <span>{{ t("projectDetail.ui.thRef") }}</span>
        </div>
        <label
          v-for="a in confirmAssets"
          :key="a.id"
          class="cf-row"
          :class="{ on: confirmSelected.includes(a.id) }"
        >
          <input class="cf-check" type="checkbox" :checked="confirmSelected.includes(a.id)" @change="toggleConfirm(a.id)" />
          <span class="cf-name">
            {{ a.name }}
            <em>{{ a.description || "—" }}</em>
          </span>
          <span class="cf-kind">{{ kindLabel(a.kind) }}</span>
          <span class="cf-prompt">{{ a.prompt || "—" }}</span>
          <span>
            <Tag :tone="a.status === 2 ? 'success' : 'warning'" size="sm" dot>
              {{ a.status === 2 ? t("projectDetail.ui.statusFinalized") : t("projectDetail.ui.statusDraftShort") }}
            </Tag>
          </span>
          <span class="cf-bound">{{ t("projectDetail.ui.boundShots", { n: a.bound_shot_count ?? 0 }) }}</span>
        </label>
      </div>

      <div v-else class="cf-empty">
        <span>🔍</span>
        <p>{{ t("projectDetail.ui.noResults") }}</p>
        <em>{{ t("projectDetail.ui.noResultsHint") }}</em>
      </div>

      <div class="cf-foot">
        <button type="button" class="mini-btn" :disabled="confirmBusy" @click="batchDeleteSelected">{{ t("projectDetail.ui.deleteSelected") }}</button>
        <span class="cf-spacer" />
        <Button size="sm" variant="ghost" :disabled="confirmBusy" @click="batchConfirmStatus(1)">{{ t("projectDetail.ui.unfinalize") }}</Button>
        <Button size="sm" variant="ghost" :disabled="confirmBusy" @click="batchConfirmStatus(2)">{{ t("projectDetail.ui.batchFinalize") }}</Button>
        <Button
          v-if="confirmStage === 'list'"
          :disabled="confirmBusy || !confirmStats.selected"
          @click="confirmStage = 'generate'"
        >
          {{ t("projectDetail.ui.nextGenImages") }}
        </Button>
        <Button v-else :disabled="confirmBusy || !confirmStats.selected" @click="batchGenerateSelected">
          {{ confirmBusy ? t("projectDetail.ui.exportingShort") : t("projectDetail.ui.submitGenN", { n: confirmStats.selected }) }}
        </Button>
      </div>
    </div>
    <!-- ── 项目资产抽屉（616×733 覆盖面板；三 tab：角色 / 场景 / 道具） ── -->
    <Teleport to="body">
      <div v-if="assetDrawer" class="drawer-mask" @click.self="closeDrawer">
        <aside
          class="drawer"
          role="dialog"
          aria-modal="true"
          :aria-label="t('projectDetail.ui.drawerTitle')"
          data-drawer="project-assets"
        >
          <header class="drawer__head">
            <h3>{{ t("projectDetail.ui.drawerTitle") }}</h3>
            <button type="button" class="ctl ctl--icon" :aria-label="t('common.cancel')" @click="closeDrawer">✕</button>
          </header>

          <div class="drawer__tabs" role="tablist">
            <button
              v-for="dt in drawerTabOptions"
              :key="dt.key"
              type="button"
              class="drawer__tab"
              role="tab"
              :aria-selected="drawerTab === dt.key"
              :class="{ on: drawerTab === dt.key }"
              :data-drawer-tab="dt.key"
              @click="drawerTab = dt.key"
            >
              {{ dt.label }}
            </button>
          </div>

          <div class="drawer__search-row">
            <input
              v-model="drawerSearch"
              class="drawer__search"
              type="search"
              :placeholder="t('projectDetail.ui.drawerSearch', { kind: drawerTabLabel })"
              :aria-label="t('projectDetail.ui.drawerSearch', { kind: drawerTabLabel })"
            />
            <label class="drawer__subject" :title="t('projectDetail.ui.drawerOnlySubjectHint')">
              <input v-model="drawerOnlySubject" type="checkbox" data-drawer-only-subject />
              <span>{{ t("projectDetail.ui.drawerOnlySubject") }}</span>
            </label>
          </div>

          <p class="drawer__note">{{ t("projectDetail.ui.drawerHint") }}</p>

          <p v-if="drawerPreselectedCount" class="drawer__preselect">
            {{ t("projectDetail.ui.drawerPreselect", { n: drawerPreselectedCount }) }}
            <button type="button" class="mini-link" @click="clearMatchedPreselect">
              {{ t("projectDetail.ui.drawerPreselectClear") }}
            </button>
          </p>

          <p class="block-label">{{ t("projectDetail.ui.drawerAll", { n: drawerSelection.length }) }}</p>

          <!-- 三态可读：加载中 / 加载失败（可重试）/ 有数据或空态 -->
          <p v-if="assetsLoading && !drawerHasItems" class="drawer__state">{{ t("common.loading") }}</p>
          <p v-else-if="assetsError && !drawerHasItems" class="drawer__state drawer__state--err">
            {{ assetsError }}
            <button type="button" class="mini-link" @click="loadProjectAssets">{{ t("common.retry") }}</button>
          </p>
          <template v-else>
            <div v-for="group in drawerGroups" :key="group.key" class="drawer__group">
              <p v-if="group.showLabel" class="drawer__group-label">{{ group.label }}</p>
              <div v-if="group.items.length" class="drawer__grid">
                <button
                  v-for="a in group.items"
                  :key="a.id"
                  type="button"
                  class="drawer__pick"
                  :class="{ on: drawerSelection.includes(a.id), 'is-unusable': !assetUsable(a) }"
                  :data-asset-id="a.id"
                  :data-usable="assetUsable(a) ? '1' : '0'"
                  :aria-pressed="drawerSelection.includes(a.id)"
                  @click="toggleDrawerAsset(a.id)"
                >
                  <img v-if="assetImage(a)" :src="assetImage(a) || ''" :alt="a.name" @error="hideBrokenImage" />
                  <i v-else />
                  <b v-if="matchSubjectIds.has(a.id)" class="drawer__badge">
                    {{ t("projectDetail.ui.drawerMatchedBadge") }}
                  </b>
                  <span>{{ a.name }}</span>
                  <em :class="{ ok: assetUsable(a) }">
                    {{ drawerStatusText(a)
                    }}<template v-if="a.bound_shot_count"> · {{ t("projectDetail.ui.boundShots", { n: a.bound_shot_count }) }}</template>
                  </em>
                </button>
              </div>
            </div>
            <div v-if="!drawerHasItems" class="drawer__empty">
              <span>▤</span>
              <p>{{ drawerEmptyTitle }}</p>
              <em>{{ t("projectDetail.ui.drawerEmptyHint") }}</em>
            </div>
          </template>

          <p v-if="drawerError" class="drawer__state drawer__state--err">{{ drawerError }}</p>

          <div class="drawer__ops">
            <Button variant="ghost" @click="closeDrawer">{{ t("projectDetail.ui.cancel") }}</Button>
            <Button :disabled="drawerSaving || bindingBusy || !selectedShot" @click="applyDrawerAssets">
              {{ drawerSaving ? t("projectDetail.ui.saving") : t("projectDetail.ui.apply") }}
            </Button>
          </div>
        </aside>
      </div>
    </Teleport>
    <!-- ── 3D 导演台（P8：three.js 场景 + 机位） ── -->
    <Director3D
      :open="director3dOpen"
      :shot-id="selectedShot?.id ?? ''"
      :shot-no="selectedShot?.shot_no ?? 1"
      :actors="boundAssets.map((a) => ({ id: a.id, name: a.name, image: a.ref_image_uri }))"
      @close="director3dOpen = false"
      @captured="onDirectorCaptured"
    />

    <!-- ── 资产编辑（场景/道具/其他）── -->
    <Modal :open="assetFormOpen" :title="assetFormId ? t('projectDetail.ui.editAsset') : t('projectDetail.ui.newKind', { kind: assetTabLabel })" width="520px" @close="assetFormOpen = false">
      <div class="af-form">
        <label class="af-row"><span>{{ t("projectDetail.ui.fieldName") }}</span><input v-model="assetForm.name" maxlength="50" :placeholder="t('projectDetail.ui.namePlaceholder')" /></label>
        <label class="af-row"><span>{{ t("projectDetail.ui.fieldDesc") }}</span><input v-model="assetForm.description" maxlength="500" :placeholder="t('projectDetail.ui.descPlaceholder')" /></label>
        <label class="af-row"><span>{{ t("projectDetail.ui.promptLabel") }}</span><textarea v-model="assetForm.prompt" maxlength="1000" rows="3" :placeholder="t('projectDetail.ui.promptPlaceholder2')" /></label>
        <label class="af-row"><span>{{ t("projectDetail.ui.fieldRefUri") }}</span><input v-model="assetForm.ref_image_uri" maxlength="500" :placeholder="t('projectDetail.ui.refPlaceholder')" /></label>
        <div class="af-ops">
          <Button variant="ghost" @click="assetFormOpen = false">{{ t("projectDetail.ui.cancel") }}</Button>
          <Button :disabled="!!busy" @click="saveAssetForm">{{ t("projectDetail.ui.save") }}</Button>
        </div>
      </div>
    </Modal>

    <!-- ── 资产参考图候选 ── -->
    <Modal :open="!!assetCandidates" :title="t('projectDetail.ui.pickRef')" width="720px" @close="assetCandidates = null">
      <div class="cand-grid">
        <button
          v-for="item in assetCandidates?.list ?? []"
          :key="item.index"
          type="button"
          class="cand"
          @click="selectAssetCandidate(item)"
        >
          <img :src="item.url" :alt="t('projectDetail.ui.candidateN', { n: item.index + 1 })" />
          <span>{{ t("projectDetail.ui.candidateClick", { n: item.index + 1 }) }}</span>
        </button>
      </div>
    </Modal>

    <!-- ── 定妆图候选 ── -->
    <Modal :open="!!candidates" :title="t('projectDetail.ui.pickLookLock')" width="720px" @close="candidates = null">
      <div class="cand-grid">
        <button
          v-for="item in candidates?.list ?? []"
          :key="item.index"
          type="button"
          class="cand"
          @click="chooseCandidate(item)"
        >
          <img :src="item.url" :alt="t('projectDetail.ui.candidateN', { n: item.index + 1 })" />
          <span>{{ t("projectDetail.ui.candidateN", { n: item.index + 1 }) }}</span>
        </button>
      </div>
      <p v-if="!candidates?.list.length" class="muted">{{ t("projectDetail.ui.noCandidates2") }}</p>
    </Modal>

    <!-- ── 重生成二次确认（大纲 / AI拆分镜 都是整体覆盖）── -->
    <Modal
      :open="!!regenConfirm"
      :title="regenConfirm === 'outline' ? t('projectDetail.ui.genOutline') : t('projectDetail.ui.aiSplit')"
      width="460px"
      @close="regenConfirm = null"
    >
      <p class="confirm-text">
        {{ regenConfirm === "outline" ? t("projectDetail.ui.regenOutlineConfirm") : t("projectDetail.ui.regenShotsConfirm") }}
      </p>
      <template #footer>
        <Button variant="ghost" @click="regenConfirm = null">{{ t("common.cancel") }}</Button>
        <Button :disabled="!!busy" @click="confirmRegenerate">{{ t("common.confirm") }}</Button>
      </template>
    </Modal>

    <!-- ── 3D 导演台（场景快照存服务端；打开即载入本项目最近场景）── -->
    <Director3D
      :open="directorOpen"
      :project-id="projectId"
      :episode-id="selectedEpisodeId || undefined"
      :actors="directorActors"
      @close="directorOpen = false"
    />
  </div>
</template>

<style scoped>
/* ═══════════ 页面骨架 ═══════════ */
.episode {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  box-sizing: border-box;
}

/* 顶栏 */
.ep-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  min-height: 56px;
}
.ep-head__left,
.ep-head__right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ctl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-h);
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel-tint);
  color: var(--text-1);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.ctl:hover {
  background: var(--panel-tint-strong);
}
.ctl--icon {
  width: var(--control-h);
  padding: 0;
  justify-content: center;
  font-weight: 400;
}
.ctl--picker {
  background: var(--panel-tint);
}
.caret {
  font-size: 10px;
  opacity: 0.6;
}
.picker {
  position: relative;
}
.picker__menu {
  position: absolute;
  top: calc(var(--control-h) + 6px);
  left: 0;
  width: 280px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: #15151c;
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
}
.picker__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  text-align: left;
  cursor: pointer;
}
.picker__item b {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.picker__item em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-3);
}
.picker__item:hover {
  background: var(--bg-hover);
}
.picker__item.on {
  background: var(--brand-40);
}
.ep-title {
  margin-left: 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-meta {
  font-size: 13px;
  color: var(--text-3);
  white-space: nowrap;
}

/* 提示条 */
.banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.banner--error {
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid #6b2626;
}
.banner--info {
  background: var(--info-bg);
  color: var(--info);
  border: 1px solid #1d4a76;
}
.banner--warn {
  background: var(--warning-bg);
  color: var(--warning);
  border: 1px solid #6b4d12;
}
.banner--busy {
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  border: 1px solid var(--brand-border);
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand-500);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-base);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ═══════════ 通用面板（剧本 / 资产 / 导出） ═══════════ */
.panel--page {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.panel__head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-1);
}
.sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.panel__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 剧本：分集卡 */
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.ep-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.ep-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chip {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  font-size: 12px;
  font-weight: 700;
}
.ep-title-input {
  width: 100%;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  padding: 2px 0;
  outline: none;
}
.ep-title-input:focus {
  border-bottom-color: var(--brand-500);
}
.ep-synopsis {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.7;
  outline: none;
}

/* ═══════════ 资产视图 ═══════════ */
.av-head {
  display: flex;
  align-items: center;
  gap: 20px;
}
.av-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-1);
}
.av-head h2 em {
  font-style: normal;
  font-weight: 400;
  color: var(--text-3);
}
.av-tabs {
  display: flex;
  gap: 18px;
}
.av-tab {
  padding: 4px 2px 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
}
.av-tab.on {
  /* 竞品 05-project-assets-panel.png y171..174 rgb(231,172,255)：紫字 + 浅紫下划线 */
  color: var(--tab-line);
  font-weight: 700;
  border-bottom-color: var(--tab-line);
}
.av-head__right {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.char-card {
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.char-card__pic {
  position: relative;
  aspect-ratio: 4 / 3;
  background: #0d0d13;
  display: grid;
  place-items: center;
}
.char-card__pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.char-card__ph {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  color: var(--text-4);
  font-size: 13px;
}
.char-card__ph em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-5);
}
.char-card__tag {
  position: absolute;
  top: 8px;
  right: 8px;
}
.char-card__body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.char-card__body b {
  font-size: 15px;
  color: var(--text-1);
}
.char-card__body p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.char-card__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 资产空态：参照三卡（AI 提取 / 生成 / 导入） */
.cta-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cta-hero {
  padding: 26px 28px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: linear-gradient(135deg, #2a2140 0%, #17141f 55%, #121218 100%);
}
.cta-hero h3 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.free {
  padding: 1px 8px;
  border-radius: 6px;
  background: #ffffff;
  color: #6d3bd8;
  font-size: 11px;
  font-weight: 700;
}
/* 「即将开放」chip：对齐竞品把状态直接印在控件上（而不是只写在 title 里，
   触屏/键盘用户读不到 hover 提示）。用于本页 5 个暂未接通的入口。 */
.soon-chip {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid #9b46ff40;
  background: #9b46ff26;
  color: #cf9fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  vertical-align: middle;
}
.rail-add .soon-chip,
.gen-card .soon-chip {
  display: block;
  margin: 4px auto 0;
  width: fit-content;
}
.confirm-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-2);
}
.cta-hero p {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.7;
}
.btn-white {
  height: var(--control-h);
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: #ffffff;
  color: #1a1a1f;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn-white:disabled {
  background: rgba(255, 255, 255, 0.35);
  color: rgba(0, 0, 0, 0.45);
  cursor: not-allowed;
}
/* AI 提取失败：按钮下方就地给可读原因 + 重试（顶部 banner 同时保留，双通道不冲突） */
.cta-hero .cta-hero__err {
  margin: 10px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--danger);
}
.cta-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.cta-card {
  padding: 22px 24px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: linear-gradient(160deg, #1d1926 0%, #14141a 70%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.cta-card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-1);
}
.cta-card p {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.7;
}
.av-empty {
  padding: 32px 0;
}

/* ═══════════ 分镜工作台：三列（对齐竞品 160 / 自适应 / 640 + 8px 缝隙）═══════════ */
.work {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 160px minmax(320px, 1fr) 640px;
  gap: 8px;
}

/* 左：分镜条 */
.rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  overflow: auto;
  min-height: 0;
}
.rail-ai {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--control-h);
  border: 0;
  border-radius: 10px;
  background: var(--brand-40);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.rail-ai:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rail-ai i {
  font-style: normal;
  padding: 1px 6px;
  border-radius: 6px;
  background: #fff;
  color: #6d3bd8;
  font-size: 11px;
}
.rail-group {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.rail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shot-chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
  text-align: left;
}
.shot-chip.on {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}
.shot-chip__no {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.shot-chip__pic {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #0d0d13;
}
.shot-chip__pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.shot-chip__pic i {
  display: block;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 50% 45%, rgba(155, 70, 255, 0.28), transparent 62%);
}
.shot-chip__state {
  font-size: 11px;
  color: var(--text-4);
}
.rail-add {
  height: 44px;
  border: 1px dashed var(--panel-line);
  border-radius: 12px;
  background: none;
  color: var(--text-5);
  font-size: 13px;
  cursor: not-allowed;
}
.rail-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-4);
}

/* 中：素材区 */
.stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  overflow: auto;
  min-height: 0;
}
.stage-tabs {
  display: flex;
  gap: 4px;
}
.stage-tab {
  flex: 1;
  min-width: 0;
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
}
.stage-tab.on {
  background: var(--panel-tint-strong);
  color: var(--text-1);
  font-weight: 700;
}
.field-label {
  font-size: 13px;
  color: var(--text-3);
}
.stage-desc {
  min-height: 104px;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.7;
  outline: none;
}
.stage-desc:focus {
  border-color: var(--brand-500);
}
.mats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.mat {
  margin: 0;
}
.mat img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
}
.mat i {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  background: #0d0d13;
}
.mat figcaption {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stage-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-4);
}
.stage-empty__icon {
  display: block;
  margin-bottom: 8px;
  font-size: 26px;
}
.stage-empty em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-5);
}
.video-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.stage-foot {
  margin: auto 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-4);
}

/* 右：生成台 */
.gen {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  overflow: auto;
  min-height: 0;
}
.gen-tabs {
  display: flex;
  gap: 20px;
  /* 竞品 03-episode-workspace.png 实测：面板头两 tab 之间**没有通栏底线**，
     只有激活项自身 2px 下划线（y=119 x945..1051）。旧值有多余的 1px 通栏线。 */
}
.gen-tab {
  position: relative;
  padding: 6px 2px 10px;
  border: 0;
  background: none;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
}
.gen-tab.on {
  /* 竞品实测：激活文字/图标与下划线是**同一个浅紫**（文本核 rgb(225,176,255)），不是白字 */
  color: var(--tab-line);
  font-weight: 700;
}
.gen-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--tab-line);
}
.mode-tabs {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mode-tabs::-webkit-scrollbar {
  display: none;
}
.mode-tab {
  padding: 4px 2px 6px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-3);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.mode-tab.on {
  color: var(--tab-line);
  font-weight: 700;
  border-bottom-color: var(--tab-line);
}
.mode-tab.off {
  color: var(--text-5);
  cursor: not-allowed;
}
.gen-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gen-row--between {
  justify-content: space-between;
}
.gen-label {
  font-size: 13px;
  color: var(--text-3);
}
.gen-row__ops {
  display: flex;
  gap: 12px;
}
/* ── 匹配资产：按钮 + 结果面板（受理 ≠ 匹配，状态以 match-result 为准）── */
.match-btn:disabled {
  color: var(--text-5);
  cursor: not-allowed;
}
.match-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.match-note--err {
  color: var(--danger);
}
.match-box {
  margin: 0;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.match-box__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
}
.match-box__spacer {
  flex: 1;
}
.match-box__counts {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}
.match-box__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow: auto;
}
.match-box__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-3);
}
.match-box__list li em {
  font-style: normal;
  color: var(--warning);
  flex-shrink: 0;
}
.match-box__more,
.match-box__split {
  margin: 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-4);
}
.gen-select {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.gen-hint,
.gen-quota {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.gen-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.gen-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 92px;
  border-radius: 14px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
}
.gen-card span {
  font-size: 18px;
}
.gen-card:disabled {
  color: var(--text-5);
  cursor: not-allowed;
}
.gen-prompt {
  min-height: 88px;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.7;
  outline: none;
}
.gen-prompt:focus {
  border-color: var(--brand-500);
}
.gen-foot {
  position: sticky;
  bottom: -16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: auto -16px -16px;
  padding: 10px 16px;
  background: linear-gradient(to top, #0e0e14 70%, rgba(14, 14, 20, 0.6));
  backdrop-filter: blur(6px);
}
.gen-params {
  display: flex;
  gap: 8px;
}
.param {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.35);
  font-size: 13px;
  color: var(--text-2);
}
.param-input {
  width: 40px;
  border: 0;
  background: none;
  color: var(--text-1);
  font-size: 13px;
  text-align: center;
  outline: none;
}
.gen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 132px;
  height: 44px;
  border: 0;
  border-radius: 12px;
  background: var(--brand-500);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.gen-btn em {
  font-style: normal;
  opacity: 0.9;
}
.gen-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.gen-foot__note {
  margin: 0;
  text-align: right;
  font-size: 11px;
  color: var(--text-5);
}
.gen-image-empty {
  padding: 20px 0;
}

/* ═══════════ 导出视图 ═══════════ */
.dispatch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-3);
}
.mini-select {
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.cell-num {
  width: 90px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.divider {
  width: 1px;
  height: 18px;
  background: var(--border-2);
}
.link {
  color: var(--brand-300);
  font-size: 13px;
  text-decoration: underline;
}
.mini-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-300);
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
}
.mini-link:disabled {
  color: var(--text-5);
  cursor: not-allowed;
}
.mini-btn {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-2);
  background: none;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.mini-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.block {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.block-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-3);
}
.legend {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-3);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* ── 导出记录（真实 GET /projects/:id/exports）── */
.export-history__ops {
  display: flex;
  align-items: center;
  gap: 10px;
}
.export-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.export-row {
  display: grid;
  grid-template-columns: 132px 92px 96px 152px minmax(120px, 1fr) minmax(120px, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--text-2);
}
.export-row--head {
  color: var(--text-4);
  font-size: 11px;
}
.export-row:not(.export-row--head):nth-child(even) {
  background: rgba(255, 255, 255, 0.03);
}
.export-row__kind {
  color: var(--text-1);
  font-weight: 600;
}
.export-row__none {
  font-style: normal;
  color: var(--text-4);
  font-size: 11px;
}
.export-row__expired {
  font-style: normal;
  color: var(--danger);
  font-size: 11px;
}
.export-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 10px;
}
.export-history__note {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-4);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.dot.success {
  background: var(--success);
}
.dot.running {
  background: var(--warning);
}
.dot.failed {
  background: var(--danger);
}
.dot.idle {
  background: var(--border-3);
}
.matrix-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.matrix-label {
  width: 56px;
  font-size: 12px;
  color: var(--text-3);
}
.mcell {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border-1);
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
}
.mcell:hover {
  transform: scale(1.1);
}
.mcell.success {
  background: var(--success-bg);
  border-color: #1d5c3c;
  color: var(--success);
}
.mcell.running {
  background: var(--warning-bg);
  border-color: #6b4d12;
  color: var(--warning);
}
.mcell.failed {
  background: var(--danger-bg);
  border-color: #6b2626;
  color: var(--danger);
}
.mcell.idle {
  background: var(--bg-sunken);
  color: var(--text-4);
}
.batch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;
}
.b-no {
  width: 60px;
  font-size: 12px;
  color: var(--text-3);
}
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-4);
}
.muted {
  font-size: 12px;
  color: var(--text-3);
}

/* ═══════════ 项目资产抽屉（竞品实测：616×733 @ x152 / y64，r20） ═══════════ */
/*
 * 数值来源：docs/03-frontend/evidence/reelflow/05-project-assets-panel.png 的 1424×805 像素扫描
 *   - 面板外框 x152~767 / y64~796 → 616×733（±0），圆角 20
 *   - 底色 rgb(27,27,29)、1px 描边 rgb(54,56,63)（非 token 色，按实测值落地）
 */
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(0, 0, 0, 0.55);
}
.drawer {
  position: absolute;
  left: 152px;
  top: 64px;
  width: 616px;
  height: 733px;
  max-height: calc(100vh - 72px);
  box-sizing: border-box;
  padding: 16px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  border-radius: 20px;
  border: 1px solid rgb(54, 56, 63);
  background: rgb(27, 27, 29);
  box-shadow: 0 24px 60px #000000a0;
}
.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.drawer__head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
}
/* 三 tab：激活白字 + 2px 紫下划线（竞品同款） */
.drawer__tabs {
  display: flex;
  gap: 20px;
  border-bottom: 1px solid rgb(54, 56, 63);
}
.drawer__tab {
  position: relative;
  height: 34px;
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
}
.drawer__tab.on {
  color: #fff;
  font-weight: 600;
}
.drawer__tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}
.drawer__search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer__search {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgb(54, 56, 63);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.drawer__search:focus {
  border-color: var(--brand-500);
}
/* 「仅展示主体」复选：竞品方框 16 */
.drawer__subject {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  cursor: pointer;
}
.drawer__subject input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand-500);
}
.drawer__note {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.drawer__preselect {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--brand-300);
}
.drawer__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.drawer__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.drawer__group-label {
  margin: 0;
  font-size: 12px;
  color: var(--text-4);
}
.drawer__state {
  margin: 0;
  font-size: 12px;
  color: var(--text-4);
}
.drawer__state--err {
  color: var(--danger);
}
.drawer__empty {
  padding: 32px 0;
  text-align: center;
  color: var(--text-4);
  font-size: 13px;
}
.drawer__empty span {
  display: block;
  font-size: 26px;
  margin-bottom: 8px;
}
.drawer__empty em {
  display: block;
  margin-top: 4px;
  font-style: normal;
  font-size: 11px;
  color: var(--text-5);
}
.drawer__ops {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: auto;
}

/* ═══════════ 响应式 ═══════════ */
@media (max-width: 1400px) {
  .work {
    grid-template-columns: 160px minmax(280px, 1fr) 560px;
  }
}
@media (max-width: 1180px) {
  .work {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  /* 窄屏抽屉不再固定 x152 / 616：贴边留 8px，高度按视口收 */
  .drawer {
    left: 8px;
    top: 8px;
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    max-height: none;
  }
  .rail {
    max-height: 240px;
  }
  .rail-list {
    flex-direction: row;
    overflow-x: auto;
  }
  .shot-chip {
    min-width: 132px;
  }
  .gen {
    min-height: 420px;
  }
}
@media (max-width: 768px) {
  .episode {
    padding: 10px 12px 16px;
  }
  .cta-two {
    grid-template-columns: 1fr;
  }
  .ep-meta {
    display: none;
  }
}
/* ═══════════ 定妆图候选 ═══════════ */
.cand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.cand {
  padding: 0;
  border: 1px solid var(--panel-line);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.28);
  cursor: pointer;
}
.cand:hover {
  border-color: var(--brand-border);
}
.cand img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.cand span {
  display: block;
  padding: 8px;
  font-size: 12px;
  color: var(--text-3);
}/* ═══════════ P2：项目资产（场景/道具/其他）══════════ */
.pa-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pa-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}
.pa-card {
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.pa-card__pic {
  position: relative;
  aspect-ratio: 4 / 3;
  background: #0d0d13;
  display: grid;
  place-items: center;
}
.pa-card__pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pa-card__tag {
  position: absolute;
  top: 8px;
  right: 8px;
}
.pa-card__body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pa-card__body b {
  font-size: 15px;
  color: var(--text-1);
}
.pa-card__body p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pa-card__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.import-btn {
  cursor: pointer;
}
.mat {
  position: relative;
}
.mat__rm {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  z-index: 1;
}
.mat figcaption em {
  font-style: normal;
  margin-left: 6px;
  color: var(--text-5);
  font-size: 10px;
}
.drawer__pick {
  position: relative;
  padding: 0;
  border: 1px solid var(--panel-line);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.28);
  cursor: pointer;
  text-align: left;
}
.drawer__pick.on {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}
.drawer__pick img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}
.drawer__pick i {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #0d0d13;
}
.drawer__pick span {
  display: block;
  padding: 6px 8px 0;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drawer__pick em {
  display: block;
  padding: 2px 8px 6px;
  font-style: normal;
  font-size: 10px;
  color: var(--text-5);
}
.drawer__pick em.ok {
  color: var(--success);
}
/* 未定稿 / 缺参考图：仍然列出（用户要看得见缺什么），但压暗并排在可用项之后 */
.drawer__pick.is-unusable {
  opacity: 0.55;
}
.drawer__badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--brand-500);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}
.af-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.af-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-3);
}
.af-row input,
.af-row textarea {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.32);
  color: var(--text-1);
  font-size: 14px;
  outline: none;
  resize: vertical;
}
.af-row input:focus,
.af-row textarea:focus {
  border-color: var(--brand-500);
}
.af-ops {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}.ai-extract {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: linear-gradient(120deg, #2a2140 0%, #17141f 60%, #121218 100%);
}
.ai-extract h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-extract p {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.ai-extract__ops {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}/* ═══════════ P4-1：时间线导出 ═══════════ */
.tl {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 200px;
  gap: 12px;
}
.tl-rail {
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  overflow: auto;
  min-height: 0;
}
.tl-rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  color: var(--text-1);
}
/* 只读预览：左栏点镜只移动播放头，不再「加入时间线」 */
.tl-rail__hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
/* 「去剪辑台」= 唯一编辑入口 */
.tl-goto {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-300);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}
.tl-goto:hover {
  border-color: var(--brand-500);
  color: var(--text-1);
}
.tl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tl-item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text-2);
  cursor: pointer;
  text-align: left;
}
.tl-item:hover {
  border-color: var(--border-3);
}
.tl-item__no {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.tl-item__name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-item em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-5);
}
.tl-item em.on {
  color: var(--success);
}
.tl-empty-sm {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-4);
  line-height: 1.6;
}
.tl-stage {
  position: relative;
  display: grid;
  place-items: center;
  padding: 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--bg-sunken);
  overflow: hidden;
  min-height: 0;
}
.tl-stage__bubble {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: 380px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--brand-40);
  color: #fff;
  font-size: 12px;
  line-height: 1.6;
}
.tl-player {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.tl-video {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  background: #000;
}
.tl-player__ph {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-4);
  font-size: 13px;
  text-align: center;
}
.tl-player__ph span {
  font-size: 34px;
  opacity: 0.6;
}
.tl-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  min-height: 0;
  overflow: hidden;
}
.tl-bar__head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
}
.tl-play {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.tl-time {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.tl-count {
  color: var(--text-4);
}
.tl-zoom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-4);
}
.tl-zoom input {
  width: 120px;
}
.tl-spacer {
  flex: 1;
}
.tl-track {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  padding: 22px 0 8px;
}
.tl-ruler {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 18px;
  pointer-events: none;
}
.tl-tick {
  position: absolute;
  top: 2px;
  font-size: 10px;
  color: var(--text-5);
  font-variant-numeric: tabular-nums;
  transform: translateX(2px);
}
.tl-clips {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 4px;
  height: 76px;
  padding: 0 0 0 4px;
}
.tl-clip {
  position: relative;
  min-width: 46px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: linear-gradient(160deg, #2a2140, #17141f);
  color: var(--text-2);
  padding: 6px 8px;
  overflow: hidden;
  cursor: default;
}
.tl-clip.on {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}
.tl-clip b {
  display: block;
  font-size: 12px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-clip em {
  font-style: normal;
  font-size: 10px;
  color: var(--text-4);
}
.tl-clips__empty {
  margin: 0;
  padding: 22px 10px;
  font-size: 12px;
  color: var(--text-4);
}
.tl-head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--brand-500);
  pointer-events: none;
}
.tl-note {
  margin: 0;
  font-size: 11px;
  color: var(--text-5);
}
@media (max-width: 1180px) {
  .tl {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) 200px minmax(0, 1fr);
  }
  .tl-rail {
    grid-row: 3;
  }
}.gen-hint--warn {
  color: var(--warning);
}/* ═══════════ P6：资产校验（清单核对 / 批量定稿 / 批量生成） ═══════════ */
.cf {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: var(--panel-tint);
  overflow: hidden;
}
.cf-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cf-crumb {
  padding: 6px 2px;
  border: 0;
  background: none;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.cf-crumb.on {
  /* 竞品 ev4-confirm-head-2x.png 实测：面包屑当前段**没有下划线**，只靠白色+字重区分；
     分隔符是紫色➤（.cf-arrow）。旧值加了一条 2px 紫底线，属于把面包屑当 tab 处理。 */
  color: var(--text-1);
}
.cf-arrow {
  color: var(--brand-500);
  font-size: 14px;
}
.cf-search {
  width: 260px;
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.cf-spacer {
  flex: 1;
}
.cf-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
}
.cf-ep {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.cf-ep:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cf-ep-label {
  padding: 4px 12px;
  border-radius: 8px;
  background: var(--panel-tint-strong);
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
}
.cf-stat {
  margin-left: 6px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.cf-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.18);
}
.cf-row {
  display: grid;
  grid-template-columns: 22px minmax(160px, 1.1fr) 56px minmax(0, 1.6fr) 84px 60px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--panel-line);
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.cf-row:last-child {
  border-bottom: 0;
}
.cf-row.on {
  background: var(--brand-soft);
}
.cf-row--head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #15151c;
  color: var(--text-3);
  font-size: 12px;
  cursor: default;
}
.cf-check {
  width: 14px;
  height: 14px;
  accent-color: var(--brand-500);
}
.cf-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.cf-name em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cf-kind,
.cf-bound {
  font-size: 12px;
  color: var(--text-3);
}
.cf-prompt {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cf-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.18);
  color: var(--text-4);
  font-size: 13px;
}
.cf-empty span {
  font-size: 26px;
  opacity: 0.7;
}
.cf-empty em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-5);
}
.cf-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}.gen-frame {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.25);
}
.gen-frame__img {
  width: 54px;
  height: 30px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
}
.gen-frame__ph {
  flex: 1;
  font-size: 11px;
  color: var(--text-5);
}
.gen-frame__ops {
  margin-left: auto;
  display: flex;
  gap: 10px;
}</style>
