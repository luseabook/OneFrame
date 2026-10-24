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

definePageMeta({ ssr: false, requiresAuth: true });

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
    const items = shots.value.map((shot) => ({
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
    }));
    const quote = await api.post<{ total_credits: number; balance_after_estimate: number; sufficient: boolean }>(
      "/credits/quote/batch",
      { items },
    );
    budget.value = Math.max(1, quote.total_credits);
    budgetTouched.value = false;
    info.value = `批量报价 ${quote.total_credits} 积分；预算已预填`;
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
    info.value = `已提交 ${res.items.filter((i) => i.submitted).length} 个镜头`;
    startTaskPoll();
    await loadEpisode();
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
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (exportTimer) clearInterval(exportTimer);
});
</script>

<template>
  <main class="page">
    <div class="head">
      <NuxtLink to="/projects" class="back">← 项目列表</NuxtLink>
      <div class="title">
        <h1>{{ project?.title ?? "项目" }}</h1>
        <span class="muted">{{ project?.ratio }} · {{ episodes.length }} 集 · {{ characters.length }} 角色</span>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'outline' }" @click="tab = 'outline'">① 大纲</button>
      <button :class="{ active: tab === 'characters' }" @click="tab = 'characters'">② 角色</button>
      <button :class="{ active: tab === 'storyboards' }" @click="tab = 'storyboards'">③ 分镜</button>
      <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'">④ 投递</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="info" class="info">{{ info }}</p>
    <p v-if="busy" class="muted">处理中：{{ busy }}…</p>

    <div class="body">
      <aside class="panel episodes">
        <h2>分集</h2>
        <ul>
          <li
            v-for="ep in episodes"
            :key="ep.id"
            class="ep"
            :class="{ active: ep.id === selectedEpisodeId }"
            @click="selectedEpisodeId = ep.id; loadEpisode()"
          >
            <span>第{{ ep.ep_no }}集</span>
            <span class="muted">{{ ep.title }}</span>
          </li>
        </ul>
        <p v-if="episodes.length === 0" class="muted">先生成大纲。</p>
      </aside>

      <section class="panel content">
        <template v-if="tab === 'outline'">
          <div class="actions">
            <Button :disabled="!!busy" @click="generateOutline">生成大纲</Button>
            <Button variant="ghost" :disabled="!!busy || episodes.length === 0" @click="saveOutline">确认大纲</Button>
          </div>
          <div class="episode-cards">
            <article v-for="ep in episodes" :key="ep.id" class="box">
              <div class="row">
                <span class="tag">第{{ ep.ep_no }}集</span>
                <span class="badge" :data-status="ep.status">{{ ep.status === 2 ? "已确认" : "草稿" }}</span>
              </div>
              <input v-model="ep.title" class="input" maxlength="100" @input="saveEpisodeDebounced(ep)" />
              <textarea v-model="ep.synopsis" class="input textarea" maxlength="1000" @input="saveEpisodeDebounced(ep)" />
            </article>
          </div>
        </template>

        <template v-else-if="tab === 'characters'">
          <div class="actions">
            <Button :disabled="!!busy" @click="generateCharacters">生成角色</Button>
            <label class="inline">
              定妆图数量
              <select v-model.number="portraitCount" class="input small">
                <option v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
            <span class="muted">定妆图完成后自动定稿；未定稿角色不能进入批量投递。</span>
          </div>
          <div class="character-grid">
            <article v-for="c in characters" :key="c.id" class="box character">
              <div class="portrait">
                <img v-if="c.portrait_url" :src="c.portrait_url" :alt="c.name" />
                <span v-else class="muted">未生成定妆图</span>
              </div>
              <div class="row">
                <b>{{ c.name }}</b>
                <span class="badge" :data-status="c.status === 2 ? 3 : 1">{{ c.status === 2 ? "已定稿" : "草稿" }}</span>
              </div>
              <p class="muted">{{ c.description }}</p>
              <div class="actions">
                <Button variant="ghost" :disabled="!!busy" @click="generatePortrait(c)">
                  {{ c.portrait_asset_id ? "重新生成" : "生成定妆图" }}
                </Button>
                <Button
                  v-if="c.portrait_asset_id && c.status !== 2"
                  :disabled="!!busy"
                  @click="finalizeCharacter(c)"
                >
                  定稿
                </Button>
                <button v-if="c.source_task_id && c.status === 2" class="mini" @click="loadCandidates(c)">候选图</button>
                <NuxtLink v-if="c.source_task_id" class="mini" to="/tasks">任务详情</NuxtLink>
              </div>
            </article>
          </div>
        </template>

        <template v-else-if="tab === 'storyboards'">
          <div class="actions">
            <Button variant="ghost" :disabled="!!busy || !selectedEpisodeId" @click="generateScriptDraft">
              生成剧本草稿
            </Button>
            <label class="inline">
              镜头数
              <select v-model.number="shotCount" class="input small">
                <option v-for="n in [6, 10, 16, 20]" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
            <Button :disabled="!!busy || !selectedEpisodeId" @click="generateStoryboards">生成分镜</Button>
          </div>
          <div v-if="episode?.script_text" class="script">
            <h3>剧本草稿</h3>
            <pre>{{ episode.script_text }}</pre>
          </div>
          <div class="shots">
            <div class="shot head-row">
              <span>#</span><span>画面</span><span>视频提示词</span><span>时长</span><span>角色</span><span></span>
            </div>
            <div v-for="shot in shots" :key="shot.id" class="shot">
              <span>{{ shot.shot_no }}</span>
              <textarea v-model="shot.shot_desc" class="input mini-area" />
              <textarea v-model="shot.video_prompt" class="input mini-area" />
              <input v-model.number="shot.duration_s" type="number" min="1" max="30" class="input tiny" />
              <span class="muted">{{ shot.character_ids.length }} 个</span>
              <button class="mini" @click="saveShot(shot)">保存</button>
            </div>
          </div>
          <p v-if="shots.length === 0" class="muted">选择分集后生成分镜。</p>
        </template>

        <template v-else>
          <div class="actions">
            <label class="inline">
              模型
              <select v-model="modelName" class="input">
                <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
              </select>
            </label>
            <label class="inline">
              预算上限
              <input v-model.number="budget" type="number" min="1" class="input small" @input="budgetTouched = true" />
            </label>
            <Button variant="ghost" :disabled="!!busy || shots.length === 0" @click="prefillBudget">按报价预填</Button>
            <Button :disabled="!!busy || shots.length === 0 || !allShotsSelected" @click="submitBatch">
              批量投递（{{ shots.length }} 镜）
            </Button>
            <Button variant="ghost" :disabled="exporting || shots.length === 0" @click="submitExport">
              {{ exporting ? "提交中…" : "导出本集 zip" }}
            </Button>
            <a v-if="exportJob?.download_url" :href="exportJob.download_url" class="download" target="_blank" rel="noreferrer">
              下载 zip
            </a>
            <span v-else-if="exportJob" class="muted">
              导出：{{ exportJob.status === 1 ? "排队中" : exportJob.status === 2 ? "打包中" : exportJob.status === 4 ? "失败" : "" }}
            </span>
            <Button v-if="exportJob?.status === 4" variant="ghost" @click="retryExportJob">重试导出</Button>
          </div>
          <p v-if="budgetExceeded" class="error">预算不足，部分镜头未投递（745703）。</p>
          <div v-if="materials.length > 0" class="materials">
            <span class="muted">分镜素材</span>
            <div class="material-grid">
              <div v-for="material in materials" :key="material.id" class="material">
                <img v-if="material.portrait_url" :src="material.portrait_url" :alt="material.name" />
                <span>{{ material.name }}</span>
              </div>
            </div>
          </div>
          <div v-if="matrix" class="matrix">
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
            <div class="legend muted">
              <span><i class="dot success" />成功</span><span><i class="dot running" />在途</span><span><i class="dot failed" />失败</span><span><i class="dot idle" />未投递</span>
            </div>
          </div>
          <div class="batch-list">
            <div v-for="item in batchItems" :key="item.shot_id" class="batch-item">
              <span class="muted">镜头 {{ shots.find((s) => s.id === item.shot_id)?.shot_no ?? "-" }}</span>
              <span v-if="item.submitted" class="ok">已提交</span>
              <span v-else class="error">{{ item.code === 400105 ? "资产未定稿" : item.code === 745703 ? "超预算" : "未提交" }}</span>
              <span v-if="item.task_id" class="muted">{{ item.task_id }}</span>
              <span v-if="item.task_id && taskMap[item.task_id]" class="badge" :data-status="taskMap[item.task_id].status">
                {{ statusLabel(taskMap[item.task_id].status) }}
              </span>
            </div>
          </div>
          <p v-if="batchItems.length === 0" class="muted">确认角色定稿、生成分镜后，在此选择模型与预算批量出片。</p>
        </template>
      </section>
    </div>
    <Modal :open="!!candidates" title="选择定妆图" @close="candidates = null">
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
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.back {
  color: var(--text-3);
  font-size: 12px;
}
.title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
h1 {
  margin: 0;
  font-size: 20px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--text-2);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.active {
  border-color: var(--color-primary);
  color: var(--text-1);
}
.body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 16px;
}
h2 {
  margin: 0 0 10px;
  font-size: 14px;
}
.episodes ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ep {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-radius: var(--radius-m);
  cursor: pointer;
  font-size: 13px;
}
.ep:hover,
.ep.active {
  background: var(--color-bg);
}
.content {
  min-height: 420px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.episode-cards,
.character-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.box {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tag {
  font-size: 12px;
  color: var(--text-2);
}
.badge {
  font-size: 11px;
  color: var(--text-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 1px 8px;
}
.badge[data-status="2"],
.badge[data-status="3"] {
  color: #4ade80;
  border-color: #4ade80;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 6px 8px;
  font-size: 12px;
  outline: none;
  width: 100%;
}
.textarea {
  min-height: 70px;
  resize: vertical;
}
.character .portrait {
  height: 160px;
  border-radius: var(--radius-m);
  background: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.character .portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
}
.inline .input {
  width: auto;
}
.small {
  width: 90px !important;
}
.script {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 10px;
  margin-bottom: 12px;
}
.script h3 {
  margin: 0 0 6px;
  font-size: 13px;
}
.script pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text-2);
  max-height: 180px;
  overflow: auto;
}
.shots {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  overflow: hidden;
}
.shot {
  display: grid;
  grid-template-columns: 28px 1.4fr 1.4fr 60px 60px 60px;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
  align-items: center;
  font-size: 12px;
}
.shot:last-child {
  border-bottom: 0;
}
.head-row {
  background: var(--color-bg);
  color: var(--text-3);
}
.mini-area {
  min-height: 44px;
  resize: vertical;
}
.tiny {
  width: 56px !important;
}
.download {
  color: var(--color-primary);
  font-size: 12px;
}
.materials {
  margin-bottom: 12px;
}
.material-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.material {
  width: 100px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
}
.material img {
  width: 100px;
  height: 70px;
  object-fit: cover;
  border-radius: var(--radius-s);
  border: 1px solid var(--color-border);
}
.matrix {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 10px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.matrix-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.matrix-label {
  width: 60px;
  font-size: 12px;
  color: var(--text-3);
}
.cell {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.cell.success {
  background: #14532d;
  border-color: #4ade80;
  color: #bbf7d0;
}
.cell.running {
  background: #713f12;
  border-color: #fbbf24;
  color: #fde68a;
}
.cell.failed {
  background: #7f1d1d;
  border-color: #ef4444;
  color: #fecaca;
}
.cell.idle {
  background: #1f2937;
  color: #9ca3af;
}
.legend {
  display: flex;
  gap: 12px;
  font-size: 11px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
}
.dot.success { background: #4ade80; }
.dot.running { background: #fbbf24; }
.dot.failed { background: #ef4444; }
.dot.idle { background: #4b5563; }
.candidate-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.candidate {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  background: none;
  padding: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-2);
  font-size: 12px;
}
.candidate img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--radius-s);
}
.candidate:hover {
  border-color: var(--color-primary);
}
.mini {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.batch-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.batch-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-s);
  padding: 8px 10px;
  font-size: 12px;
}
.ok {
  color: #4ade80;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
.info {
  color: var(--text-2);
  font-size: 12px;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
  }
  .episode-cards,
  .character-grid {
    grid-template-columns: 1fr;
  }
}
</style>
