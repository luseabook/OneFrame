<script setup lang="ts">
import type {
  CharacterDto,
  EpisodeDto,
  ExportDto,
  MatrixDto,
  MatrixShot,
  ModelDto,
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
const tab = ref<"outline" | "characters" | "storyboards" | "batch">("outline");
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

</script>

<template>
  <div class="pipeline">
    <!-- ── 页头：项目标题 + 流程步骤 ── -->
    <header class="page-head">
      <div class="head-left">
        <NuxtLink to="/projects" class="back">← 项目列表</NuxtLink>
        <div class="titles">
          <h1>{{ project?.title ?? "项目" }}</h1>
          <p class="meta">
            <span>{{ project?.ratio ?? "9:16" }}</span>
            <span class="sep">·</span>
            <span>{{ episodes.length }} 集</span>
            <span class="sep">·</span>
            <span>{{ characters.length }} 角色</span>
          </p>
        </div>
      </div>
      <div class="head-right">
        <Tag v-if="project?.source_type === 1" tone="neutral">小说改编</Tag>
        <Tag v-else-if="project?.source_type === 3" tone="neutral">导入剧本</Tag>
        <Tag v-else tone="brand">一句话想法</Tag>
      </div>
    </header>

    <!-- ── 步骤条 ── -->
    <nav class="steps" aria-label="流水线步骤">
      <button
        v-for="(s, i) in steps"
        :key="s.key"
        class="step"
        :class="{ active: tab === s.key, done: stepDone(s.key) }"
        @click="tab = s.key"
      >
        <span class="idx">{{ stepDone(s.key) ? "✓" : i + 1 }}</span>
        <span class="label">{{ s.label }}</span>
        <span v-if="s.count !== undefined" class="count">{{ s.count }}</span>
      </button>
    </nav>

    <!-- ── 提示条 ── -->
    <Transition name="fade">
      <p v-if="error" class="banner error">{{ error }}</p>
    </Transition>
    <Transition name="fade">
      <p v-if="info" class="banner info">{{ info }}</p>
    </Transition>
    <p v-if="busy" class="banner busy">
      <span class="pulse" />{{ busy }}…
    </p>

    <!-- ── 主体：左分集 + 右内容 ── -->
    <div class="workspace">
      <aside class="episode-rail">
        <div class="rail-head">
          <span>分集</span>
          <Tag v-if="episodes.length" tone="neutral" size="sm">{{ episodes.length }}</Tag>
        </div>
        <ul class="ep-list">
          <li
            v-for="ep in episodes"
            :key="ep.id"
            class="ep-item"
            :class="{ active: ep.id === selectedEpisodeId }"
            @click="selectEpisode(ep.id)"
          >
            <span class="ep-no">第{{ ep.ep_no }}集</span>
            <span class="ep-title">{{ epShortTitle(ep) }}</span>
            <span class="ep-flag" :data-status="ep.status">{{ ep.status === 2 ? "已确认" : "草稿" }}</span>
          </li>
        </ul>
        <EmptyState
          v-if="episodes.length === 0"
          title="还没有分集"
          description="先在第 ① 步生成大纲，确认分集后再继续。"
        />
      </aside>

      <section class="stage">
        <!-- ① 大纲 -->
        <template v-if="tab === 'outline'">
          <div class="stage-head">
            <div>
              <h2>分集大纲</h2>
              <p class="hint">编辑标题与梗概（自动保存）；确认后进入角色设计。</p>
            </div>
            <div class="actions">
              <Button :disabled="!!busy" @click="generateOutline">
                {{ episodes.length ? "重新生成" : "生成大纲" }}
              </Button>
              <Button variant="ghost" :disabled="!!busy || episodes.length === 0" @click="saveOutline">
                确认大纲
              </Button>
            </div>
          </div>
          <div class="outline-grid">
            <article v-for="ep in episodes" :key="ep.id" class="outline-card">
              <div class="card-top">
                <span class="ep-chip">第{{ ep.ep_no }}集</span>
                <Tag :tone="ep.status === 2 ? 'success' : 'neutral'" size="sm">
                  {{ ep.status === 2 ? "已确认" : "草稿" }}
                </Tag>
              </div>
              <input v-model="ep.title" class="title-input" maxlength="100" placeholder="分集标题" @input="saveEpisodeDebounced(ep)" />
              <textarea
                v-model="ep.synopsis"
                class="synopsis-input"
                maxlength="1000"
                placeholder="本集梗概…"
                @input="saveEpisodeDebounced(ep)"
              />
            </article>
          </div>
          <EmptyState
            v-if="episodes.length === 0"
            icon="✎"
            title="从大纲开始"
            description="AI 会把小说或想法拆成 3~6 集，每集含标题与梗概，可逐条修改。"
          >
            <Button :disabled="!!busy" @click="generateOutline">生成大纲</Button>
          </EmptyState>
        </template>

        <!-- ② 角色 -->
        <template v-else-if="tab === 'characters'">
          <div class="stage-head">
            <div>
              <h2>角色与定妆</h2>
              <p class="hint">定妆图完成后自动定稿；未定稿角色不能进入批量投递。</p>
            </div>
            <div class="actions">
              <label class="inline-field">
                定妆图
                <select v-model.number="portraitCount" class="mini-select">
                  <option v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ n }} 张</option>
                </select>
              </label>
              <Button :disabled="!!busy" @click="generateCharacters">生成角色</Button>
            </div>
          </div>
          <div class="character-grid">
            <article v-for="c in characters" :key="c.id" class="character-card">
              <div class="portrait">
                <img v-if="c.portrait_url" :src="c.portrait_url" :alt="c.name" />
                <div v-else class="placeholder">
                  <span>未生成</span>
                  <span class="small">定妆图</span>
                </div>
                <Tag
                  class="portrait-tag"
                  :tone="c.status === 2 ? 'success' : 'warning'"
                  size="sm"
                  dot
                >
                  {{ c.status === 2 ? "已定稿" : "待定稿" }}
                </Tag>
              </div>
              <div class="char-body">
                <b class="char-name">{{ c.name }}</b>
                <p class="char-desc">{{ c.description || "—" }}</p>
                <div class="char-actions">
                  <Button size="sm" variant="ghost" :disabled="!!busy" @click="generatePortrait(c)">
                    {{ c.portrait_asset_id ? "重新生成" : "生成定妆图" }}
                  </Button>
                  <Button
                    v-if="c.portrait_asset_id && c.status !== 2"
                    size="sm"
                    :disabled="!!busy"
                    @click="finalizeCharacter(c)"
                  >
                    定稿
                  </Button>
                  <button v-if="c.source_task_id && c.status === 2" class="mini-btn" @click="loadCandidates(c)">
                    候选图
                  </button>
                  <button v-if="c.portrait_asset_id && c.status === 2" class="mini-btn" @click="promoteCharacter(c)">
                    转通用资产
                  </button>
                </div>
              </div>
            </article>
          </div>
          <EmptyState
            v-if="characters.length === 0"
            icon="☺"
            title="还没有角色"
            description="从已确认的大纲自动抽取角色卡（≤10 张），再逐个生成定妆图。"
          >
            <Button :disabled="!!busy" @click="generateCharacters">生成角色</Button>
          </EmptyState>
        </template>

        <!-- ③ 分镜 -->
        <template v-else-if="tab === 'storyboards'">
          <div class="stage-head">
            <div>
              <h2>分镜表</h2>
              <p class="hint">逐镜编辑画面与提示词；时长由所选模型枚举约束。</p>
            </div>
            <div class="actions">
              <label class="inline-field">
                镜头数
                <select v-model.number="shotCount" class="mini-select">
                  <option v-for="n in [6, 10, 16, 20]" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
              <Button variant="ghost" :disabled="!!busy || !selectedEpisodeId" @click="generateScriptDraft">
                剧本草稿
              </Button>
              <Button :disabled="!!busy || !selectedEpisodeId" @click="generateStoryboards">生成分镜</Button>
            </div>
          </div>

          <details v-if="episode?.script_text" class="script-box">
            <summary>剧本草稿（点击展开）</summary>
            <pre>{{ episode.script_text }}</pre>
          </details>

          <div v-if="shots.length" class="shot-table">
            <div class="shot-row shot-head">
              <span class="c-no">#</span>
              <span class="c-desc">画面</span>
              <span class="c-prompt">视频提示词</span>
              <span class="c-dur">时长</span>
              <span class="c-char">角色</span>
              <span class="c-op"></span>
            </div>
            <div v-for="shot in shots" :key="shot.id" class="shot-row">
              <span class="c-no shot-no">{{ shot.shot_no }}</span>
              <textarea v-model="shot.shot_desc" class="cell-area" rows="2" />
              <textarea v-model="shot.video_prompt" class="cell-area" rows="2" />
              <input v-model.number="shot.duration_s" type="number" min="1" max="30" class="cell-num" />
              <span class="c-char muted">{{ shot.character_ids.length }} 个</span>
              <button class="mini-btn" @click="saveShot(shot)">保存</button>
            </div>
          </div>
          <EmptyState
            v-else
            icon="▤"
            title="还没有分镜"
            description="选择左侧分集后生成分镜表；默认 10 镜，可调 4~30。"
          />
        </template>

        <!-- ④ 投递 -->
        <template v-else>
          <div class="stage-head">
            <div>
              <h2>批量出片</h2>
              <p class="hint">预算触顶时该镜不投递（745703），余额不足整单拒绝。</p>
            </div>
            <div class="actions">
              <Button :disabled="!!busy || shots.length === 0" @click="submitBatch">
                批量投递 {{ shots.length }} 镜
              </Button>
            </div>
          </div>

          <div class="dispatch-bar">
            <label class="inline-field">
              模型
              <select v-model="modelName" class="mini-select wide">
                <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
              </select>
            </label>
            <label class="inline-field">
              预算上限
              <input v-model.number="budget" type="number" min="1" class="cell-num" @input="budgetTouched = true" />
            </label>
            <Button size="sm" variant="ghost" :disabled="!!busy || shots.length === 0" @click="prefillBudget">
              按报价预填
            </Button>
            <span class="divider" />
            <Button size="sm" variant="ghost" :disabled="exporting || shots.length === 0" @click="submitExport">
              {{ exporting ? "提交中…" : "导出本集 zip" }}
            </Button>
            <a v-if="exportJob?.download_url" :href="exportJob.download_url" class="link" target="_blank" rel="noreferrer">
              下载 zip
            </a>
            <Tag v-else-if="exportJob" :tone="exportJob.status === 4 ? 'danger' : 'info'" size="sm">
              {{ exportJob.status === 1 ? "排队中" : exportJob.status === 2 ? "打包中" : "失败" }}
            </Tag>
            <Button v-if="exportJob?.status === 4" size="sm" variant="text" @click="retryExportJob">重试</Button>
          </div>

          <p v-if="budgetExceeded" class="banner warning">部分镜头因预算触顶未投递（745703）。提高预算后可继续投递。</p>
          <p v-if="batchItems.some((i) => i.code === 745701)" class="banner warning">

            余额不足，部分镜头未投递（745701）。充值后可继续投递剩余镜头。

          </p>

          <p v-if="characters.some((c) => c.status !== 2)" class="banner warning">
            有 {{ characters.filter((c) => c.status !== 2).length }} 个角色未定稿，其绑定镜头会被拒绝（400105）。
            <button class="banner-link" @click="tab = 'characters'">去完成角色定稿 →</button>
          </p>

          <div v-if="materials.length" class="materials">
            <p class="block-label">分镜素材</p>
            <div class="material-grid">
              <figure v-for="material in materials" :key="material.id" class="material">
                <img v-if="material.portrait_url" :src="material.portrait_url" :alt="material.name" />
                <figcaption>{{ material.name }}</figcaption>
              </figure>
            </div>
          </div>

          <div v-if="matrix" class="matrix">
            <div class="matrix-head">
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
                class="cell"
                :class="matrixClass(shot)"
                :title="`镜${shot.shot_no} · 状态${shot.status}${shot.task_status ? ' · 任务' + shot.task_status : ''}`"
                @click="openMatrixShot(ep.id)"
              >
                {{ shot.shot_no }}
              </button>
              <span v-if="ep.shots.length === 0" class="muted">无分镜</span>
            </div>
          </div>

          <div v-if="batchItems.length" class="batch-list">
            <div v-for="item in batchItems" :key="item.shot_id" class="batch-row">
              <span class="b-no">镜 {{ shots.find((s) => s.id === item.shot_id)?.shot_no ?? "-" }}</span>
              <Tag v-if="item.submitted" tone="success" size="sm" dot>已提交</Tag>
              <Tag v-else tone="danger" size="sm" dot>
                {{
                  item.code === 400105
                    ? "资产未定稿"
                    : item.code === 745703
                      ? "超预算"
                      : item.code === 745701
                        ? "余额不足"
                        : "未提交"
                }}
              </Tag>
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
        </template>
      </section>
    </div>

    <Modal :open="!!candidates" title="选择定妆图" width="720px" @close="candidates = null">
      <div class="candidate-grid">
        <button
          v-for="item in candidates?.list ?? []"
          :key="item.index"
          class="candidate"
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
.pipeline {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 32px 64px;
}

/* ── 页头 ── */
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.head-left {
  min-width: 0;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-3);
  font-size: var(--text-sm);
  transition: color var(--duration-fast);
}
.back:hover {
  color: var(--text-1);
}
.titles h1 {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin: 6px 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  display: flex;
  gap: 6px;
  align-items: center;
}
.sep {
  color: var(--border-3);
}
.head-right {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* ── 步骤条（参照 §1：深色分段条；选中态用品牌软底，不用亮色实体令牌）── */
.steps {
  display: flex;
  gap: 6px;
  padding: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  margin-bottom: var(--space-4);
  overflow-x: auto;
  scrollbar-width: none;
}
.steps::-webkit-scrollbar {
  display: none;
}
.step {
  flex: 1;
  min-width: 148px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px var(--space-4);
  background: none;
  border: 0;
  border-radius: var(--radius-xl);
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast);
}
.step:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.step.active {
  background: var(--brand-soft);
  color: var(--text-1);
  font-weight: 600;
}
.step.done .idx {
  background: var(--success);
  border-color: var(--success);
  color: #0a0a0e;
}
.idx {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.step.active .idx {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}
.count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}

/* ── 提示条 ── */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}
.banner.error {
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid #6b2626;
}
.banner.info {
  background: var(--info-bg);
  color: var(--info);
  border: 1px solid #1d4a76;
}
.banner.warning {
  background: var(--warning-bg);
  color: var(--warning);
  border: 1px solid #6b4d12;
}
.banner.busy {
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  border: 1px solid var(--brand-border);
}
.banner-link {
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
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

/* ── 工作区 ── */
.workspace {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
.episode-rail {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  position: sticky;
  top: calc(var(--header-h) + var(--space-4));
}
.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}
.ep-list {
  margin: 0;
  padding: var(--space-2);
  list-style: none;
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}
.ep-item {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 2px var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.ep-item:hover {
  background: var(--bg-hover);
}
.ep-item.active {
  background: var(--brand-soft);
}
.ep-no {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-1);
}
.ep-item.active .ep-no {
  color: var(--brand-on-soft);
}
.ep-title {
  grid-column: 2;
  color: var(--text-3);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-flag {
  grid-column: 2;
  font-size: 11px;
  color: var(--text-4);
}
.ep-flag[data-status="2"] {
  color: var(--success);
}

.stage {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: 24px;
  min-height: 480px;
}
.stage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.stage-head h2 {
  font-size: var(--text-lg);
  font-weight: 600;
}
.hint {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-shrink: 0;
}

/* ── 大纲 ── */
.outline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}
.outline-card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: var(--space-4);
  background: var(--bg-raised);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.outline-card:focus-within {
  border-color: var(--brand-border);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}
.ep-chip {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-on-soft);
  background: var(--brand-soft);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.title-input {
  width: 100%;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-1);
  padding: var(--space-1) 0;
  outline: none;
}
.title-input:focus {
  border-bottom-color: var(--brand-500);
}
.synopsis-input {
  width: 100%;
  min-height: 88px;
  border: 0;
  background: transparent;
  resize: vertical;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.7;
  padding: var(--space-1) 0;
  outline: none;
}

/* ── 角色 ── */
.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--space-4);
}
.character-card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
  overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.character-card:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
}
.portrait {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--bg-sunken);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--text-4);
  font-size: var(--text-sm);
}
.placeholder .small {
  font-size: 11px;
}
.portrait-tag {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}
.char-body {
  padding: var(--space-3);
}
.char-name {
  font-size: var(--text-base);
}
.char-desc {
  margin: var(--space-1) 0 var(--space-3);
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.char-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* ── 分镜表 ── */
.script-box {
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-sunken);
}
.script-box summary {
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-2);
  font-weight: 500;
}
.script-box pre {
  margin: var(--space-3) 0 0;
  white-space: pre-wrap;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.8;
  font-family: var(--font-sans);
}
.shot-table {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
  overflow: hidden;
}
.shot-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1.1fr) minmax(0, 1.3fr) 72px 60px 52px;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-1);
}
.shot-row:last-child {
  border-bottom: 0;
}
.shot-row:hover:not(.shot-head) {
  background: var(--bg-hover);
}
.shot-head {
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: var(--text-xs);
  font-weight: 600;
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}
.shot-no {
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
  font-size: var(--text-sm);
  padding-top: 6px;
}
.cell-area {
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  line-height: 1.6;
  padding: 4px 6px;
  resize: vertical;
  outline: none;
}
.cell-area:hover {
  border-color: var(--border-2);
}
.cell-area:focus {
  border-color: var(--brand-500);
  background: var(--bg-raised);
  box-shadow: 0 0 0 2px var(--brand-soft);
}
.cell-num {
  width: 100%;
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 6px;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.cell-num:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px var(--brand-soft-strong);
}
.c-char {
  font-size: var(--text-xs);
  padding-top: 6px;
}

/* ── 投递 ── */
.dispatch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  margin-bottom: var(--space-4);
}
.inline-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-3);
  font-size: var(--text-sm);
}
.mini-select {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.mini-select.wide {
  min-width: 180px;
}
.divider {
  width: 1px;
  height: 18px;
  background: var(--border-2);
}
.link {
  color: var(--brand-300);
  font-size: var(--text-sm);
  text-decoration: underline;
}
.block-label {
  margin: 0 0 var(--space-2);
  color: var(--text-3);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.materials {
  margin-bottom: var(--space-4);
}
.material-grid {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.material {
  margin: 0;
  width: 104px;
}
.material img {
  width: 104px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-1);
}
.material figcaption {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 矩阵 */
.matrix {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.matrix-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}
.legend {
  display: flex;
  gap: var(--space-3);
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
  gap: var(--space-1);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}
.matrix-label {
  width: 56px;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.cell {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  transition: transform var(--duration-fast);
}
.cell:hover {
  transform: scale(1.12);
}
.cell.success {
  background: var(--success-bg);
  border-color: #1d5c3c;
  color: var(--success);
}
.cell.running {
  background: var(--warning-bg);
  border-color: #6b4d12;
  color: var(--warning);
}
.cell.failed {
  background: var(--danger-bg);
  border-color: #6b2626;
  color: var(--danger);
}
.cell.idle {
  background: var(--bg-sunken);
  color: var(--text-4);
}

/* 批次结果 */
.batch-list {
  border-top: 1px solid var(--border-1);
  padding-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.batch-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: var(--text-sm);
}
.b-no {
  width: 60px;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-4);
}

/* 通用小件 */
.mini-btn {
  background: none;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: var(--text-xs);
  padding: 2px 8px;
  cursor: pointer;
}
.mini-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
  border-color: var(--border-3);
}
.muted {
  color: var(--text-3);
  font-size: var(--text-xs);
}

/* 候选图 */
.candidate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-3);
}
.candidate {
  padding: 0;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--bg-raised);
  cursor: pointer;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.candidate:hover {
  border-color: var(--brand-border);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.candidate img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.candidate span {
  display: block;
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-3);
}

@media (max-width: 1100px) {
  .pipeline {
    padding: 20px 24px 56px;
  }
  .workspace {
    grid-template-columns: 1fr;
  }
  .episode-rail {
    position: static;
  }
  .ep-list {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    max-height: none;
  }
  .ep-item {
    min-width: 150px;
  }
}
@media (max-width: 760px) {
  .pipeline {
    padding: 16px 16px 48px;
  }
  .stage {
    padding: var(--space-4);
  }
  .stage-head {
    flex-direction: column;
  }
  .shot-row {
    grid-template-columns: 32px minmax(0, 1fr) 60px;
  }
  .c-prompt,
  .c-char {
    display: none;
  }
}
</style>
