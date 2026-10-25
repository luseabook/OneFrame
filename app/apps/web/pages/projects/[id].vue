<script setup lang="ts">
import type {
  CharacterDto,
  EpisodeDto,
  ExportDto,
  MatrixDto,
  MatrixShot,
  ModelDto,
  ProjectAssetDto,
  ProjectDto,
  StoryboardDto,
  TaskDto,
} from "~/types/api";
import { statusLabel } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

interface BatchItem {
  shot_id: string;
  task_id: string | null;
  submitted: boolean;
  code?: number;
  reason?: string;
}

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
const tab = ref<"outline" | "characters" | "storyboards" | "batch">("storyboards");
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
const materials = ref<Array<{ id: string; name: string; portrait_url: string | null }>>([]);
const budgetTouched = ref(false);
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    error.value = e instanceof Error ? e.message : "操作失败";
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
  if (!selectedEpisodeId.value && data.episodes[0]) {
    selectedEpisodeId.value = data.episodes[0].id;
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

async function loadMaterials(): Promise<void> {
  try {
    materials.value = await api.get<Array<{ id: string; name: string; portrait_url: string | null }>>(
      `/projects/${projectId.value}/shot-materials`,
    );
  } catch {
    materials.value = [];
  }
}

async function loadMatrix(): Promise<void> {
  try {
    matrix.value = await api.get<MatrixDto>(`/projects/${projectId.value}/matrix`);
  } catch {
    /* ignore */
  }
}

function matrixClass(shot: MatrixShot): string {
  if (shot.task_status === 3 || shot.status === 5) return "success";
  if (shot.task_status === 4 || shot.task_status === 7) return "failed";
  if (shot.task_status === 1 || shot.task_status === 2 || shot.status === 3) return "running";
  return "idle";
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
  await run("生成大纲", async () => {
    const result = await api.post<EpisodeDto[]>(`/projects/${projectId.value}/outline/generate`);
    await loadProject();
    info.value = `已生成 ${result.length} 集大纲，请确认`;
  });
}

async function saveOutline(): Promise<void> {
  await run("确认大纲", async () => {
    await api.put(`/projects/${projectId.value}/outline`, {
      episodes: episodes.value.map((ep) => ({
        ep_no: ep.ep_no,
        title: ep.title ?? `第${ep.ep_no}集`,
        synopsis: ep.synopsis ?? "",
      })),
    });
    await loadProject();
    info.value = "大纲已确认";
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
      info.value = "大纲已自动保存";
    } catch {
      /* 自动保存失败不打断编辑 */
    }
  }, 600);
  saveTimers.set(ep.id, timer);
}

async function prefillBudget(): Promise<void> {
  if (!selectedEpisodeId.value || shots.value.length === 0) return;
  await run("批量报价", async () => {
    const byId = new Map(characters.value.map((c) => [c.id, c]));
    // 续投场景：已投递/成功的镜头不再重复报价，只算「已消耗 + 剩余镜头报价」
    const spentShots = shots.value.filter((shot) => shot.video_task_id !== null);
    const pendingShots = shots.value.filter((shot) => shot.video_task_id === null);
    const buildItem = (shot: (typeof shots.value)[number]) => ({
      mode: "universal_reference",
      model: modelName.value,
      scene: "storyboard_reference_video",
      input: {
        prompt: shot.video_prompt ?? "",
        reference_uris: shot.character_ids
          .map((id) => byId.get(id)?.portrait_url)
          .filter((url): url is string => Boolean(url)),
      },
      options: {
        ratio: shot.ratio ?? project.value?.ratio ?? "9:16",
        resolution: shot.resolution ?? "720p",
        duration: shot.duration_s ?? 5,
        count: 1,
      },
    });
    const items = pendingShots.map(buildItem);
    const quote = items.length
      ? await api.post<{ total_credits: number; balance_after_estimate: number; sufficient: boolean }>(
          "/credits/quote/batch",
          { items },
        )
      : { total_credits: 0, balance_after_estimate: 0, sufficient: true };
    // 已消耗：本集已投递镜头的冻结/结算积分
    const spent = spentShots.reduce((sum, shot) => {
      const task = taskMap.value[shot.video_task_id ?? ""];
      return sum + (task?.credits_settled ?? task?.credits_frozen ?? 0);
    }, 0);
    const suggested = spent + quote.total_credits;
    budget.value = Math.max(1, suggested);
    budgetTouched.value = false;
    info.value =
      spent > 0
        ? `续投预算预填：已消耗 ${spent} + 剩余 ${pendingShots.length} 镜报价 ${quote.total_credits} = ${suggested} 积分`
        : `批量报价 ${quote.total_credits} 积分；预算已预填`;
  });
}

async function promoteCharacter(character: CharacterDto): Promise<void> {
  await run("转存通用资产", async () => {
    const res = await api.post<{ asset_id: string; tags: string[] }>(
      `/projects/${projectId.value}/characters/${character.id}/to-asset`,
      {},
    );
    info.value = `已转存为通用资产（${res.tags.join("、")}），可在资产库跨项目复用`;
  });
}

async function generateCharacters(): Promise<void> {
  await run("生成角色", async () => {
    await api.post(`/projects/${projectId.value}/characters/generate`, { count: 5 });
    await loadProject();
    info.value = "角色已生成；生成定妆图后可定稿";
  });
}

async function generatePortrait(character: CharacterDto): Promise<void> {
  await run("生成定妆图", async () => {
    const res = await api.post<{ task_id: string }>(
      `/projects/${projectId.value}/characters/${character.id}/portrait`,
      { count: portraitCount.value },
    );
    info.value = `定妆图任务已提交（${res.task_id}），完成后自动定稿`;
    startPortraitPoll();
  });
}

async function loadCandidates(character: CharacterDto): Promise<void> {
  await run("加载候选图", async () => {
    const data = await api.get<{ task_id: string; candidates: Array<{ index: number; url: string }> }>(
      `/projects/${projectId.value}/characters/${character.id}/portrait/candidates`,
    );
    candidates.value = { charId: character.id, task_id: data.task_id, list: data.candidates };
  });
}

async function chooseCandidate(item: { index: number }): Promise<void> {
  if (!candidates.value) return;
  await run("选择定妆图", async () => {
    await api.post(
      `/projects/${projectId.value}/characters/${candidates.value!.charId}/portrait/select`,
      { task_id: candidates.value!.task_id, index: item.index },
    );
    candidates.value = null;
    await loadProject();
    info.value = "已切换定妆图并定稿";
  });
}

async function retryExportJob(): Promise<void> {
  if (!exportJob.value || !selectedEpisodeId.value) return;
  await run("重试导出", async () => {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/exports/${exportJob.value!.export_id}/retry`,
    );
    exportJob.value = { ...exportJob.value!, status: 1, error: null, download_url: null };
    info.value = "导出已重新排队";
    startExportPoll();
  });
}

async function finalizeCharacter(character: CharacterDto): Promise<void> {
  await run("定稿", async () => {
    await api.post(`/projects/${projectId.value}/characters/${character.id}/finalize`);
    await loadProject();
    info.value = `${character.name} 已定稿，可被分镜引用`;
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
  await run("生成剧本", async () => {
    await api.post(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/script-draft/generate`,
      {},
    );
    await loadEpisode();
    info.value = "剧本草稿已生成";
  });
}

async function generateStoryboards(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await run("生成分镜", async () => {
    shots.value = await api.post<StoryboardDto[]>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate`,
      { shot_count: shotCount.value },
    );
    await loadEpisode();
    info.value = `已生成 ${shots.value.length} 个分镜`;
  });
}

async function saveShot(shot: StoryboardDto): Promise<void> {
  await run("保存分镜", async () => {
    await api.patch(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}`,
      {
        shot_desc: shot.shot_desc,
        video_prompt: shot.video_prompt,
        duration_s: shot.duration_s,
      },
    );
    info.value = `镜头 ${shot.shot_no} 已保存`;
  });
}

async function submitBatch(): Promise<void> {
  if (!selectedEpisodeId.value) return;
  await run("批量投递", async () => {
    const res = await api.post<{ budget_exceeded: boolean; items: BatchItem[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate-videos`,
      {
        shot_ids: shots.value.map((s) => s.id),
        budget_credits_max: budget.value,
        model: modelName.value,
      },
    );
    batchItems.value = res.items;
    budgetExceeded.value = res.budget_exceeded;
    const okCount = res.items.filter((i) => i.submitted).length;
    const notReady = res.items.filter((i) => i.code === 400105).length;
    const overBudget = res.items.filter((i) => i.code === 745703).length;
    // 全部失败时给出可行动的原因，而不是只报「已提交 0 个镜头」
    if (okCount === 0 && notReady > 0) {
      error.value = `全部镜头未投递：${notReady} 个镜头的绑定角色未定稿。请先到「角色」步骤生成定妆图并定稿，再回来投递。`;
      info.value = "";
    } else if (okCount === 0 && overBudget > 0) {
      error.value = `全部镜头未投递：预算上限不足以覆盖 ${overBudget} 个镜头，请提高预算后再试。`;
      info.value = "";
    } else {
      const parts = [`已提交 ${okCount} 个镜头`];
      if (notReady > 0) parts.push(`${notReady} 个因角色未定稿跳过`);
      if (overBudget > 0) parts.push(`${overBudget} 个因超预算跳过`);
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
    info.value = "导出任务已提交，正在打包…";
    startExportPoll();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "导出失败";
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
        info.value = data.status === 3 ? "导出完成，可下载 zip" : "导出失败：没有可用视频";
      }
    } catch {
      /* ignore */
    }
    if (tries > 30 && exportTimer) clearInterval(exportTimer);
  }, 1500);
}

onMounted(async () => {
  await run("加载项目", async () => {
    await loadProject();
    await loadModels();
    await loadMatrix();
    await loadMaterials();
    await loadProjectAssets();
  });
  // 首次进入空项目时给一条可行动提示（PRD 增补 §3.2 空态引导）
  if (!episodes.value.length) {
    info.value = "这个项目还没有分集：先在第 ① 步点「生成大纲」，确认后进入角色与分镜。";
  } else if (characters.value.length && shots.value.length === 0) {
    info.value = "大纲与角色已就绪：切到第 ③ 步「生成分镜」，再批量投递即可出片。";
  }
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (exportTimer) clearInterval(exportTimer);
});

// ── 流水线步骤（UI 编排层）──
const steps = computed(() => [
  { key: "outline" as const, label: "大纲", count: episodes.value.length || undefined },
  { key: "characters" as const, label: "角色", count: characters.value.length || undefined },
  { key: "storyboards" as const, label: "分镜", count: shots.value.length || undefined },
  { key: "batch" as const, label: "投递", count: batchItems.value.length || undefined },
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
  return rest || "未命名";
}

// ══════════ 视图切换（剧本 / 资产 / 分镜 / 导出）══════════
const viewMenu = ref(false);
const viewOptions = [
  { key: "outline" as const, label: "剧本", desc: "分集大纲与梗概，确认后进入资产" },
  { key: "characters" as const, label: "资产", desc: "角色定妆（场景/道具需 AI 提取链路）" },
  { key: "storyboards" as const, label: "分镜", desc: "单集工作台：分镜条 / 素材区 / 生成台" },
  { key: "batch" as const, label: "导出", desc: "批量投递、分镜矩阵与整集 zip" },
];
const viewLabel = computed(() => viewOptions.find((v) => v.key === tab.value)?.label ?? "分镜");
function setView(key: "outline" | "characters" | "storyboards" | "batch"): void {
  tab.value = key;
  viewMenu.value = false;
}

// ══════════ 资产视图 ══════════
const assetTab = ref<"character" | "scene" | "prop" | "other">("character");
const assetTabOptions = [
  { key: "character" as const, label: "角色" },
  { key: "scene" as const, label: "场景" },
  { key: "prop" as const, label: "道具" },
  { key: "other" as const, label: "其他" },
];
const assetTabLabel = computed(() => assetTabOptions.find((a) => a.key === assetTab.value)?.label ?? "角色");
const assetItems = computed(() => (assetTab.value === "character" ? characters.value : []));
const assetDrawer = ref(false);

// ══════════ 分镜工作台（三列）══════════
const stageTab = ref<"all" | "image" | "video">("all");
const stageTabOptions = [
  { key: "all" as const, label: "全部" },
  { key: "image" as const, label: "图片" },
  { key: "video" as const, label: "视频" },
];
const genTab = ref<"image" | "video">("video");
const mode = ref("reference");
// 参照站有 5 种生成模式；我们后端目前只有 storyboard_reference_video 一种，其余显式标注未接入
const modeOptions = [
  { key: "reference", label: "参考生视频", enabled: true, hint: "角色定妆图作为参考，逐镜生成（已接入）" },
  { key: "first_frame", label: "首帧生视频", enabled: false, hint: "需首帧图 + 图生视频模型（后续）" },
  { key: "text", label: "文生视频", enabled: false, hint: "需文生视频模型（后续）" },
  { key: "first_last", label: "首尾帧生视频", enabled: false, hint: "需首尾帧模型（后续）" },
  { key: "ai_edit", label: "AI改视频", enabled: false, hint: "需视频编辑模型（后续）" },
];
const selectedShotId = ref("");
const selectedShot = computed<StoryboardDto | null>(
  () => shots.value.find((s) => s.id === selectedShotId.value) ?? null,
);
function selectShot(id: string): void {
  selectedShotId.value = id;
}
function shotThumb(shot: StoryboardDto): string | null {
  const first = characters.value.find((c) => c.id === shot.character_ids[0]);
  return first?.portrait_url ?? null;
}
/** 中列素材：优先展示该镜绑定角色的定妆图，否则回退到项目分镜素材 */
const stageMaterials = computed(() => {
  if (stageTab.value === "video") return [];
  const byId = new Map(characters.value.map((c) => [c.id, c]));
  const bound = (selectedShot.value?.character_ids ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CharacterDto => Boolean(c));
  if (bound.length) return bound.map((c) => ({ id: c.id, name: c.name, portrait_url: c.portrait_url }));
  return materials.value;
});
const submittedShots = computed(() => batchItems.value);
function batchReason(item: BatchItem): string {
  if (item.code === 400105) return "资产未定稿";
  if (item.code === 745703) return "超预算";
  if (item.code === 745701) return "余额不足";
  return "未提交";
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
function buildQuoteItem(shot: StoryboardDto) {
  const byId = new Map(characters.value.map((c) => [c.id, c]));
  return {
    mode: "universal_reference",
    model: modelName.value,
    scene: "storyboard_reference_video",
    input: {
      prompt: shot.video_prompt ?? "",
      reference_uris: shot.character_ids
        .map((id) => byId.get(id)?.portrait_url)
        .filter((url): url is string => Boolean(url)),
    },
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
  await run("投递镜头", async () => {
    const res = await api.post<{ budget_exceeded: boolean; items: BatchItem[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/generate-videos`,
      { shot_ids: [shot.id], budget_credits_max: budget.value, model: modelName.value },
    );
    const kept = batchItems.value.filter((b) => b.shot_id !== shot.id);
    batchItems.value = [...kept, ...res.items];
    if (res.budget_exceeded) budgetExceeded.value = true;
    const item = res.items[0];
    if (item?.submitted) {
      info.value = `镜头 ${shot.shot_no} 已投递，可在「导出」视图查看进度`;
    } else {
      error.value = `镜头 ${shot.shot_no} 未投递：${item ? batchReason(item) : "未知原因"}`;
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

async function loadProjectAssets(): Promise<void> {
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
  } catch {
    // 后端未就绪（P2 接口未上线）时不阻塞其它视图：保持空列表，UI 会走空态
    projectAssets.value = { scene: [], prop: [], other: [] };
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
    error.value = "请填写资产名称";
    return;
  }
  await run(assetFormId.value ? "保存资产" : "新建资产", async () => {
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
    info.value = "资产已保存";
  });
}

async function patchProjectAsset(asset: ProjectAssetDto, body: Record<string, unknown>): Promise<void> {
  await run("更新资产", async () => {
    await api.patch(`/projects/${projectId.value}/assets/${asset.id}`, body);
    await loadProjectAssets();
    info.value = body.status === 2 ? `「${asset.name}」已定稿，可作为参考图注入分镜` : "已更新";
  });
}

async function removeProjectAsset(asset: ProjectAssetDto): Promise<void> {
  await run("删除资产", async () => {
    await api.delete(`/projects/${projectId.value}/assets/${asset.id}`);
    await loadProjectAssets();
    await loadEpisode();
    info.value = `已删除「${asset.name}」`;
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
    error.value = "图片需 ≤8MB";
    return;
  }
  uploading.value = true;
  error.value = "";
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<{ id: string; uri: string }>("/assets/upload", {
      filename: file.name,
      content_type: file.type,
      data_base64: base64,
    });
    await api.post(`/projects/${projectId.value}/assets`, {
      kind,
      name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 50) || "导入资产",
      ref_image_uri: asset.uri,
    });
    await loadProjectAssets();
    info.value = "已导入，定稿后会作为参考图注入分镜生成";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "导入失败";
  } finally {
    uploading.value = false;
  }
}

/** 分镜 ↔ 资产绑定：整体替换（入参需含角色与场景/道具的全部 id） */
async function setShotAssets(ids: string[]): Promise<void> {
  const shot = selectedShot.value;
  if (!shot || !selectedEpisodeId.value) return;
  await run("更新素材", async () => {
    const res = await api.put<{ asset_ids: string[] }>(
      `/projects/${projectId.value}/episodes/${selectedEpisodeId.value}/storyboards/${shot.id}/assets`,
      { asset_ids: ids },
    );
    shot.character_ids = res.asset_ids;
    info.value = `素材已更新（${res.asset_ids.length} 个）`;
  });
}

async function removeShotAsset(id: string): Promise<void> {
  const shot = selectedShot.value;
  if (!shot) return;
  await setShotAssets(shot.character_ids.filter((x) => x !== id));
}

/** 抽屉：按当前 tab 列出可绑定资产 */
const drawerAssets = computed<ProjectAssetDto[]>(() => {
  if (assetTab.value === "character") {
    return characters.value.map((c) => assetMap.value.get(c.id)).filter((a): a is ProjectAssetDto => Boolean(a));
  }
  return projectAssets.value[assetTab.value] ?? [];
});
function openDrawer(): void {
  drawerSelection.value = [...(selectedShot.value?.character_ids ?? [])];
  // 默认落在有内容的 tab：当前 kind 为空时回到「角色」（参照抽屉也以角色为主）
  const kind = assetTab.value;
  if (kind !== "character" && (projectAssets.value[kind] ?? []).length === 0) assetTab.value = "character";
  assetDrawer.value = true;
}
function toggleDrawerAsset(id: string): void {
  drawerSelection.value = drawerSelection.value.includes(id)
    ? drawerSelection.value.filter((x) => x !== id)
    : [...drawerSelection.value, id];
}
async function applyDrawerAssets(): Promise<void> {
  drawerSaving.value = true;
  try {
    await setShotAssets(drawerSelection.value);
    assetDrawer.value = false;
  } finally {
    drawerSaving.value = false;
  }
}
</script>


<template>
  <div class="episode">
    <!-- ── 顶栏：返回 + 步骤胶囊 + 保存 ── -->
    <header class="ep-head">
      <div class="ep-head__left">
        <NuxtLink to="/projects" class="ctl ctl--icon" title="返回项目列表">←</NuxtLink>
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
        <span class="ep-title">{{ project?.title ?? "项目" }}</span>
        <Tag v-if="project?.source_type === 1" tone="neutral" size="sm">小说改编</Tag>
        <Tag v-else-if="project?.source_type === 3" tone="neutral" size="sm">导入剧本</Tag>
        <Tag v-else tone="brand" size="sm">一句话想法</Tag>
      </div>
      <div class="ep-head__right">
        <span class="ep-meta">{{ project?.ratio ?? "9:16" }} · {{ episodes.length }} 集 · {{ characters.length }} 角色</span>
        <Button size="sm" :disabled="!!busy || !selectedShot" @click="saveSelectedShot">保存</Button>
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
          <h2>剧本 · 分集大纲</h2>
          <p class="sub">编辑标题与梗概（自动保存）；确认后进入资产与分镜。</p>
        </div>
        <div class="panel__actions">
          <Button :disabled="!!busy" @click="generateOutline">
            {{ episodes.length ? "重新生成" : "生成大纲" }}
          </Button>
          <Button variant="ghost" :disabled="!!busy || episodes.length === 0" @click="saveOutline">确认大纲</Button>
        </div>
      </div>

      <div v-if="episodes.length" class="ep-grid">
        <article v-for="ep in episodes" :key="ep.id" class="ep-card">
          <div class="ep-card__top">
            <span class="chip">第{{ ep.ep_no }}集</span>
            <Tag :tone="ep.status === 2 ? 'success' : 'neutral'" size="sm">
              {{ ep.status === 2 ? "已确认" : "草稿" }}
            </Tag>
          </div>
          <input v-model="ep.title" class="ep-title-input" maxlength="100" placeholder="分集标题" @input="saveEpisodeDebounced(ep)" />
          <textarea
            v-model="ep.synopsis"
            class="ep-synopsis"
            maxlength="1000"
            placeholder="本集梗概…"
            @input="saveEpisodeDebounced(ep)"
          />
          <button type="button" class="mini-link" @click="selectEpisode(ep.id)">进入分镜 →</button>
        </article>
      </div>
      <EmptyState
        v-else
        icon="✎"
        title="从大纲开始"
        description="AI 会把剧本或想法拆成 3~6 集，每集含标题与梗概，可逐条修改。"
      >
        <Button :disabled="!!busy" @click="generateOutline">生成大纲</Button>
      </EmptyState>
    </section>

    <!-- ══════════ ② 资产（角色 / 场景 / 道具） ══════════ -->
    <section v-else-if="tab === 'characters'" class="panel panel--page assets-view">
      <div class="av-head">
        <h2>资产 <em>({{ assetItems.length }})</em></h2>
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
            新建{{ assetTabLabel }}
          </Button>
          <label v-if="assetTab === 'character'" class="inline-field">
            定妆图
            <select v-model.number="portraitCount" class="mini-select">
              <option v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ n }} 张</option>
            </select>
          </label>
          <Button size="sm" :disabled="!!busy" @click="generateCharacters">生成角色</Button>
        </div>
      </div>

      <!-- 角色：有数据 -->
      <div v-if="assetTab === 'character' && characters.length" class="char-grid">
        <article v-for="c in characters" :key="c.id" class="char-card">
          <div class="char-card__pic">
            <img v-if="c.portrait_url" :src="c.portrait_url" :alt="c.name" />
            <div v-else class="char-card__ph"><span>未生成</span><em>定妆图</em></div>
            <Tag class="char-card__tag" :tone="c.status === 2 ? 'success' : 'warning'" size="sm" dot>
              {{ c.status === 2 ? "已定稿" : "待定稿" }}
            </Tag>
          </div>
          <div class="char-card__body">
            <b>{{ c.name }}</b>
            <p>{{ c.description || "—" }}</p>
            <div class="char-card__ops">
              <Button size="sm" variant="ghost" :disabled="!!busy" @click="generatePortrait(c)">
                {{ c.portrait_asset_id ? "重新生成" : "生成定妆图" }}
              </Button>
              <Button v-if="c.portrait_asset_id && c.status !== 2" size="sm" :disabled="!!busy" @click="finalizeCharacter(c)">
                定稿
              </Button>
              <button v-if="c.source_task_id && c.status === 2" type="button" class="mini-btn" @click="loadCandidates(c)">候选图</button>
              <button v-if="c.portrait_asset_id && c.status === 2" type="button" class="mini-btn" @click="promoteCharacter(c)">转通用资产</button>
            </div>
          </div>
        </article>
      </div>

      <!-- 角色：空态（参照三卡：AI 提取 / 生成 / 导入） -->
      <div v-else-if="assetTab === 'character'" class="cta-rows">
        <div class="cta-hero">
          <div class="cta-hero__text">
            <h3>AI 智能提取资产 <span class="free">首次免费</span></h3>
            <p>AI 分析剧本，提取出镜的角色/场景/道具，并生成出镜资产提示词（后端链路建设中）</p>
            <button class="btn-white" type="button" disabled title="需要资产提取后端（P2）">✦ AI 智能提取资产</button>
          </div>
        </div>
        <div class="cta-two">
          <div class="cta-card">
            <h3>生成角色</h3>
            <p>从已确认的大纲自动抽取角色卡，再逐个生成定妆图</p>
            <Button :disabled="!!busy" @click="generateCharacters">生成角色</Button>
          </div>
          <div class="cta-card">
            <h3>导入角色</h3>
            <p>手动上传出镜该剧本的角色形象（可先用资产库上传，再绑定到分镜）</p>
            <NuxtLink to="/assets" class="ctl ctl--picker">去资产库</NuxtLink>
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
                {{ a.status === 2 ? "已定稿" : "草稿" }}
              </Tag>
            </div>
            <div class="pa-card__body">
              <b>{{ a.name }}</b>
              <p>{{ a.description || a.prompt || "—" }}</p>
              <div class="pa-card__ops">
                <Button size="sm" variant="ghost" :disabled="!!busy" @click="openAssetForm(assetTabKind || 'scene', a)">编辑</Button>
                <Button v-if="a.status !== 2" size="sm" :disabled="!!busy" @click="patchProjectAsset(a, { status: 2 })">定稿</Button>
                <Button v-else size="sm" variant="ghost" :disabled="!!busy" @click="patchProjectAsset(a, { status: 1 })">取消定稿</Button>
                <button type="button" class="mini-btn" @click="removeProjectAsset(a)">删除</button>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="cta-rows">
          <div class="cta-hero">
            <div class="cta-hero__text">
              <h3>AI 智能提取资产 <span class="free">首次免费</span></h3>
              <p>AI 分析剧本，提取出镜的角色/场景/道具并生成资产提示词（提取链路 P3 接入；当前可先手动新建/导入）</p>
              <button class="btn-white" type="button" disabled title="需要资产提取后端（P3）">✦ AI 智能提取资产</button>
            </div>
          </div>
          <div class="cta-two">
            <div class="cta-card">
              <h3>新建{{ assetTabLabel }}</h3>
              <p>手填名称/描述/提示词，可填参考图 uri；定稿后会作为参考图注入分镜生成</p>
              <Button @click="openAssetForm(assetTabKind || 'scene')">新建{{ assetTabLabel }}</Button>
            </div>
            <div class="cta-card">
              <h3>导入{{ assetTabLabel }}</h3>
              <p>从本地导入一张图片作为参考图（jpg/png/webp，≤8MB），导入后为草稿态</p>
              <label class="ctl ctl--picker import-btn">
                {{ uploading ? "上传中…" : `导入${assetTabLabel}` }}
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
        <button class="rail-ai" type="button" :disabled="!!busy || !selectedEpisodeId" @click="generateStoryboards">
          <span>AI拆分镜</span><i>首次免费</i>
        </button>
        <p class="rail-group">分镜({{ shots.length }})</p>
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
              <img v-if="shotThumb(s)" :src="shotThumb(s)!" alt="" />
              <i v-else />
            </span>
            <span class="shot-chip__state">{{ s.video_task_id ? "已投递" : s.status === 5 ? "已定稿" : "未定稿" }}</span>
          </button>
        </div>
        <button class="rail-add" type="button" disabled title="新增空白分镜需要后端支持（P1.5）">+ 添加分镜</button>
        <p v-if="!shots.length" class="rail-empty">先点上方「AI拆分镜」按本集剧本拆分镜头</p>
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
          <label class="field-label">分镜描述</label>
          <textarea
            v-model="selectedShot.shot_desc"
            class="stage-desc"
            placeholder="请填写分镜描述，记录分镜对应的画面内容"
            @blur="saveSelectedShot"
          />

          <div v-if="stageTab !== 'video'" class="mats">
            <figure v-for="m in boundAssets" :key="m.id" class="mat">
              <button type="button" class="mat__rm" title="移出本镜" @click="removeShotAsset(m.id)">✕</button>
              <img v-if="assetImage(m)" :src="assetImage(m) || ''" :alt="m.name" />
              <i v-else />
              <figcaption>
                {{ m.name }}
                <em>{{ m.status === 2 ? "已定稿" : "草稿" }}</em>
              </figcaption>
            </figure>
            <p v-if="!boundAssets.length" class="stage-empty">
              <span class="stage-empty__icon">▤</span>
              暂无素材<br /><em>点右侧「项目资产」勾选角色/场景/道具作为本镜参考</em>
            </p>
          </div>

          <div v-else class="mats">
            <div v-for="b in submittedShots" :key="b.shot_id" class="video-row">
              <Tag v-if="b.task_id" tone="success" size="sm" dot>已投递</Tag>
              <Tag v-else tone="danger" size="sm" dot>{{ batchReason(b) }}</Tag>
              <span class="mono">{{ b.task_id ? b.task_id.slice(-8) : "—" }}</span>
              <Tag v-if="b.task_id && taskMap[b.task_id]" tone="info" size="sm">{{ statusLabel(taskMap[b.task_id].status) }}</Tag>
            </div>
            <p v-if="!submittedShots.length" class="stage-empty">
              <span class="stage-empty__icon">▶</span>
              暂无出片<br /><em>填写提示词后点「立即生成」</em>
            </p>
          </div>

          <p class="stage-foot">
            或 <NuxtLink to="/assets" class="link">本地上传</NuxtLink> · 时长由所选模型枚举约束
          </p>
        </template>

        <EmptyState
          v-else
          icon="▤"
          title="还没有分镜"
          description="选择左上「AI拆分镜」按本集剧本生成分镜表；生成后可逐镜编辑。"
        >
          <Button :disabled="!!busy || !selectedEpisodeId" @click="generateStoryboards">生成分镜</Button>
        </EmptyState>
      </section>

      <!-- 右：生成台 -->
      <aside class="gen">
        <div class="gen-tabs">
          <button type="button" class="gen-tab" :class="{ on: genTab === 'image' }" @click="genTab = 'image'">图片生成</button>
          <button type="button" class="gen-tab" :class="{ on: genTab === 'video' }" @click="genTab = 'video'">视频生成</button>
        </div>

        <template v-if="genTab === 'video'">
          <div class="mode-tabs">
            <button
              v-for="mt in modeOptions"
              :key="mt.key"
              type="button"
              class="mode-tab"
              :class="{ on: mode === mt.key, off: !mt.enabled }"
              :disabled="!mt.enabled || !!busy"
              :title="mt.enabled ? mt.hint : mt.hint"
              @click="mode = mt.key"
            >
              {{ mt.label }}
            </button>
          </div>

          <div class="gen-row">
            <span class="gen-label">模型</span>
            <select v-model="modelName" class="mini-select gen-select">
              <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
            </select>
          </div>
          <p class="gen-hint">
            为保证生成效果，请确保角色定妆图已生成并定稿；未定稿角色绑定的镜头会被拒绝（400105）
          </p>

          <div class="gen-row gen-row--between">
            <span class="gen-label">选择素材</span>
            <button class="mini-link" type="button" disabled title="3D 导演台（P4）">3D导演台</button>
          </div>
          <p class="gen-quota">
            已上传素材数：图片 {{ boundImageCount }}/30 · 视频 0/10 · 音频 0/10 · 总素材 {{ boundAssets.length }}/50
          </p>

          <div class="gen-cards">
            <button type="button" class="gen-card" @click="openDrawer"><span>+</span>项目资产</button>
            <button type="button" class="gen-card" disabled title="更多素材源（P2）"><span>+</span>更多素材源</button>
          </div>

          <div class="gen-row gen-row--between">
            <span class="gen-label">提示词</span>
            <span class="gen-row__ops">
              <button class="mini-link" type="button" disabled title="按提示词自动匹配项目资产（P3）">匹配资产</button>
              <button class="mini-link" type="button" disabled title="放大编辑（P2）">放大编辑</button>
            </span>
          </div>
          <textarea
            v-if="selectedShot"
            v-model="selectedShot.video_prompt"
            class="gen-prompt"
            placeholder="上传并@一个或多个主体、图片，涵盖每个要素及其关系，描述想要生成的视频内容"
            @blur="saveSelectedShot"
          />
          <textarea v-else class="gen-prompt" disabled placeholder="先选择左侧分镜" />

          <p class="gen-foot__note">内容由 AI 生成，请仔细甄别 · 失败/取消不扣积分</p>
          <div class="gen-foot">
            <div class="gen-params">
              <span class="param">{{ selectedShot?.resolution ?? "720p" }}</span>
              <span class="param">
                <input v-model.number="shotDuration" class="param-input" type="number" min="1" max="30" />秒
              </span>
              <span class="param">1个</span>
            </div>
            <button
              class="gen-btn"
              type="button"
              :disabled="!!busy || !selectedShot"
              @click="selectedShot && submitShot(selectedShot)"
            >
              立即生成
              <em v-if="shotQuote !== null">✦ {{ shotQuote }}</em>
            </button>
          </div>

        </template>

        <div v-else class="gen-image-empty">
          <EmptyState
            icon="◫"
            title="图片生成暂未接入"
            description="当前后端只提供分镜视频生成（storyboard_reference_video）。图片生成（定妆图）在「资产」视图的角色卡上操作。"
          >
            <Button size="sm" variant="ghost" @click="tab = 'characters'">去资产生成定妆图</Button>
          </EmptyState>
        </div>
      </aside>
    </div>

    <!-- ══════════ ④ 导出（投递结果 / 矩阵 / 导出） ══════════ -->
    <section v-else class="panel panel--page">
      <div class="panel__head">
        <div>
          <h2>导出与投递</h2>
          <p class="sub">预算触顶时该镜不投递（745703），余额不足整单拒绝；导出为整集 zip。</p>
        </div>
        <div class="panel__actions">
          <Button :disabled="!!busy || shots.length === 0" @click="submitBatch">批量投递 {{ shots.length }} 镜</Button>
        </div>
      </div>

      <div class="dispatch-bar">
        <label class="inline-field">
          模型
          <select v-model="modelName" class="mini-select gen-select">
            <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
          </select>
        </label>
        <label class="inline-field">
          预算上限
          <input v-model.number="budget" type="number" min="1" class="cell-num" @input="budgetTouched = true" />
        </label>
        <Button size="sm" variant="ghost" :disabled="!!busy || shots.length === 0" @click="prefillBudget">按报价预填</Button>
        <span class="divider" />
        <Button size="sm" variant="ghost" :disabled="exporting || shots.length === 0" @click="submitExport">
          {{ exporting ? "提交中…" : "导出本集 zip" }}
        </Button>
        <a v-if="exportJob?.download_url" :href="exportJob.download_url" class="link" target="_blank" rel="noreferrer">下载 zip</a>
        <Tag v-else-if="exportJob" :tone="exportJob.status === 4 ? 'danger' : 'info'" size="sm">
          {{ exportJob.status === 1 ? "排队中" : exportJob.status === 2 ? "打包中" : "失败" }}
        </Tag>
        <Button v-if="exportJob?.status === 4" size="sm" variant="text" @click="retryExportJob">重试</Button>
      </div>

      <p v-if="budgetExceeded" class="banner banner--warn">部分镜头因预算触顶未投递（745703）。提高预算后可继续投递。</p>
      <p v-if="batchItems.some((i) => i.code === 745701)" class="banner banner--warn">
        余额不足，部分镜头未投递（745701）。充值后可继续投递剩余镜头。
      </p>
      <p v-if="characters.some((c) => c.status !== 2)" class="banner banner--warn">
        有 {{ characters.filter((c) => c.status !== 2).length }} 个角色未定稿，其绑定镜头会被拒绝（400105）。
        <button class="mini-link" type="button" @click="tab = 'characters'">去完成角色定稿 →</button>
      </p>

      <div v-if="matrix" class="block">
        <div class="block__head">
          <p class="block-label">分镜矩阵</p>
          <div class="legend">
            <span><i class="dot success" />成功</span>
            <span><i class="dot running" />在途</span>
            <span><i class="dot failed" />失败</span>
            <span><i class="dot idle" />未投递</span>
          </div>
        </div>
        <div v-for="ep in matrix.episodes" :key="ep.id" class="matrix-row">
          <span class="matrix-label">第{{ ep.ep_no }}集</span>
          <button
            v-for="shot in ep.shots"
            :key="shot.id"
            type="button"
            class="mcell"
            :class="matrixClass(shot)"
            :title="`镜${shot.shot_no} · 状态${shot.status}${shot.task_status ? ' · 任务' + shot.task_status : ''}`"
            @click="openMatrixShot(ep.id)"
          >
            {{ shot.shot_no }}
          </button>
          <span v-if="ep.shots.length === 0" class="muted">无分镜</span>
        </div>
      </div>

      <div v-if="batchItems.length" class="block">
        <p class="block-label">投递结果</p>
        <div v-for="item in batchItems" :key="item.shot_id" class="batch-row">
          <span class="b-no">镜 {{ shotNoOf(item.shot_id) }}</span>
          <Tag v-if="item.submitted" tone="success" size="sm" dot>已提交</Tag>
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
        title="准备批量出片"
        description="确认角色定稿并生成分镜后，选择模型与预算，一键投递全部镜头。"
      />
    </section>

    <!-- ── 项目资产抽屉（角色 / 场景 / 道具） ── -->
    <Teleport to="body">
      <div v-if="assetDrawer" class="drawer-mask" @click.self="assetDrawer = false">
        <aside class="drawer">
          <header class="drawer__head">
            <h3>项目资产</h3>
            <button type="button" class="ctl ctl--icon" @click="assetDrawer = false">✕</button>
          </header>
          <div class="av-tabs drawer__tabs">
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
          <input class="drawer__search" type="search" :placeholder="`搜索你想要的${assetTabLabel}`" />
          <p class="drawer__note">
            勾选的资产会作为本镜参考图注入生成；仅「已定稿 + 有参考图」的资产会被后端采纳，否则该镜投递会被拒绝（400105）。
          </p>
          <p class="block-label">全部素材（已选 {{ drawerSelection.length }}）</p>
          <div v-if="drawerAssets.length" class="drawer__grid">
            <button
              v-for="a in drawerAssets"
              :key="a.id"
              type="button"
              class="drawer__pick"
              :class="{ on: drawerSelection.includes(a.id) }"
              @click="toggleDrawerAsset(a.id)"
            >
              <img v-if="assetImage(a)" :src="assetImage(a) || ''" :alt="a.name" />
              <i v-else />
              <span>{{ a.name }}</span>
              <em>{{ a.status === 2 ? "已定稿" : "草稿" }}</em>
            </button>
          </div>
          <div v-else class="drawer__empty">
            <span>▤</span>
            <p>未搜索到相关资源</p>
          </div>
          <div class="drawer__ops">
            <Button variant="ghost" @click="assetDrawer = false">取消</Button>
            <Button :disabled="drawerSaving" @click="applyDrawerAssets">{{ drawerSaving ? "保存中…" : "应用到当前分镜" }}</Button>
          </div>
        </aside>
      </div>
    </Teleport>
    <!-- ── 资产编辑（场景/道具/其他）── -->
    <Modal :open="assetFormOpen" :title="assetFormId ? '编辑资产' : `新建${assetTabLabel}`" width="520px" @close="assetFormOpen = false">
      <div class="af-form">
        <label class="af-row"><span>名称</span><input v-model="assetForm.name" maxlength="50" placeholder="例如：雨夜街头 / 旧怀表" /></label>
        <label class="af-row"><span>描述</span><input v-model="assetForm.description" maxlength="500" placeholder="一句话说明外观与用途" /></label>
        <label class="af-row"><span>提示词</span><textarea v-model="assetForm.prompt" maxlength="1000" rows="3" placeholder="生图提示词（可选）" /></label>
        <label class="af-row"><span>参考图 uri</span><input v-model="assetForm.ref_image_uri" maxlength="500" placeholder="可留空；用「导入」上传会自动填" /></label>
        <div class="af-ops">
          <Button variant="ghost" @click="assetFormOpen = false">取消</Button>
          <Button :disabled="!!busy" @click="saveAssetForm">保存</Button>
        </div>
      </div>
    </Modal>

    <!-- ── 定妆图候选 ── -->
    <Modal :open="!!candidates" title="选择定妆图" width="720px" @close="candidates = null">
      <div class="cand-grid">
        <button
          v-for="item in candidates?.list ?? []"
          :key="item.index"
          type="button"
          class="cand"
          @click="chooseCandidate(item)"
        >
          <img :src="item.url" :alt="`候选 ${item.index + 1}`" />
          <span>候选 {{ item.index + 1 }}</span>
        </button>
      </div>
      <p v-if="!candidates?.list.length" class="muted">没有可用候选图。</p>
    </Modal>
  </div>
</template>

<style scoped>
/* ═══════════ 页面骨架 ═══════════ */
.episode {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 16px;
  height: calc(100vh - var(--header-h));
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
  color: var(--text-1);
  font-weight: 700;
  border-bottom-color: var(--brand-500);
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

/* ═══════════ 分镜工作台：三列 ═══════════ */
.work {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 176px minmax(320px, 1fr) 460px;
  gap: 12px;
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
  border-bottom: 1px solid var(--panel-line);
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
  color: var(--text-1);
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
  background: var(--brand-500);
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
  color: var(--text-1);
  font-weight: 700;
  border-bottom-color: var(--brand-500);
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

/* ═══════════ 项目资产抽屉 ═══════════ */
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(0, 0, 0, 0.55);
  display: flex;
}
.drawer {
  width: 520px;
  max-width: 92vw;
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  background: #12121a;
  border-right: 1px solid var(--panel-line);
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
.drawer__tabs {
  border-bottom: 1px solid var(--panel-line);
}
.drawer__search {
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.drawer__note {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-4);
}
.drawer__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.drawer__item {
  margin: 0;
}
.drawer__item img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
}
.drawer__item i {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  background: #0d0d13;
}
.drawer__item figcaption {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
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
.drawer__ops {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: auto;
}

/* ═══════════ 响应式 ═══════════ */
@media (max-width: 1360px) {
  .work {
    grid-template-columns: 164px minmax(280px, 1fr) 420px;
  }
}
@media (max-width: 1180px) {
  .work {
    grid-template-columns: 1fr;
    overflow: auto;
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
}</style>
