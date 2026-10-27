<script setup lang="ts">
/**
 * 视频转绘工作台（模块 #14 · 竞品 `/video-redraw/workspace`，`rea-reelmate/routes.txt:122`）。
 *
 * 四段（`feature-map.md:268`：已有视频 → 重绘成动漫）：
 *   ① 切集 `episode/create` / `episode/batch_create`
 *   ② 分镜计划 `storyboard/plan`（按源视频时间轴切镜）
 *   ③ 重绘生成 `resources/generate`（按分镜产出重绘参考图/视频，走报价 + 任务记账）
 *   ④ 绑定 `asset/bind`（把产物绑到分镜，快照语义）
 *
 * 三条实现判断：
 * 1. **进度以 `video_redraw_stage` 为准**（服务端算），前端不猜；
 * 2. **切集区间落服务端 `episode_ranges`**：分镜计划据此默认取时间轴，避免"切完集又问一次时间"；
 * 3. **生成前先报价**：`project/point` 只试算不冻结；提交时把上次报价的 `quote_id` 带上
 *    （若后端返回），保证"看到的价格就是扣的价格"。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("redraw.workspace.metaTitle") });

const api = useApi();
const toast = useToast();
const route = useRoute();

interface RedrawProjectInfo {
  id: string;
  title: string;
  ratio: string;
  source: { uri: string; kind: string; duration_s: number | null; asset_id: string | null };
  style: string;
  redraw_strength: number;
  video_redraw_stage: number;
  video_redraw_stage_status: number;
  latest_flow: { task_count: number; latest_at: string | null } | null;
  progress: {
    episodes: number;
    storyboards: number;
    storyboards_submitted: number;
    redraw_assets: number;
    bound_storyboards: number;
  };
}

interface Episode {
  id: string;
  ep_no: number;
  title: string | null;
  status: number;
}

interface Shot {
  id: string;
  shot_no: number;
  shot_desc: string | null;
  video_prompt: string | null;
  duration_s: number | null;
  status: number;
  asset_ids?: string[];
  image_task_id?: string | null;
  video_task_id?: string | null;
}

interface BindResult {
  project_id: string;
  bound: number;
  binds: Array<{ storyboard_id: string; project_asset_ids: string[] }>;
}

const projectId = computed(() => String(route.query.id ?? ""));
const info = ref<RedrawProjectInfo | null>(null);
const episodes = ref<Episode[]>([]);
const activeEpisodeId = ref("");
const shots = ref<Shot[]>([]);
const loading = ref(false);
const busy = ref("");
const quote = ref<{ credits?: number; quote_id?: string } | null>(null);
/**
 * 最近一次 `resources/generate` 返回的配对（分镜 → 重绘产物）。
 *
 * 为什么需要它：重绘产物是**项目资产**，生成时才知道哪张图属于哪个分镜；
 * 而分镜上的 `asset_ids`（storyboard_assets 绑定）此时还是空的。
 * 所以"生成→绑定"必须用这一次的响应做配对，否则绑定会拿到空数组、`bound=0`
 * （用户看到"绑定成功"但实际一个都没绑，比报错更难查）。
 */
const lastPairs = ref<Array<{ storyboard_id: string; project_asset_id: string }>>([]);
const recent = ref<Array<{ id: string; title: string }>>([]);
const batchForm = reactive({ count: 3, episode_duration_s: 60 });
const shotDuration = ref(3);

/** 四段（与服务端 `stageOf` 的 1..4 对齐） */
// 阶段名走 i18n（computed：常量在 setup 期固化，切语言不更新）
const STAGES = computed(() => [
  { stage: 1, name: t("redraw.workspace.stages.1") },
  { stage: 2, name: t("redraw.workspace.stages.2") },
  { stage: 3, name: t("redraw.workspace.stages.3") },
  { stage: 4, name: t("redraw.workspace.stages.4") },
]);

async function load(): Promise<void> {
  if (!projectId.value) {
    await loadRecent();
    return;
  }
  loading.value = true;
  try {
    const [detail, project] = await Promise.all([
      api.get<RedrawProjectInfo>(`/video-redraw/projects/${projectId.value}`),
      api.get<{ episodes: Episode[] }>(`/projects/${projectId.value}`),
    ]);
    info.value = detail;
    episodes.value = project.episodes ?? [];
    if (!activeEpisodeId.value && episodes.value.length > 0) {
      activeEpisodeId.value = episodes.value[0]!.id;
    }
    if (activeEpisodeId.value) await loadShots(activeEpisodeId.value);
    await refreshPoint();
  } catch (err) {
    toast.error((err as Error).message || t("redraw.workspace.loadFailed"));
  } finally {
    loading.value = false;
  }
}

async function loadRecent(): Promise<void> {
  loading.value = true;
  try {
    const page = await api.get<{ list: Array<{ id: string; title: string }> }>("/video-redraw/projects?page_size=20");
    recent.value = page.list ?? [];
  } catch {
    recent.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadShots(episodeId: string): Promise<void> {
  try {
    const detail = await api.get<{ storyboards: Shot[] }>(`/projects/${projectId.value}/episodes/${episodeId}`);
    shots.value = detail.storyboards ?? [];
  } catch {
    shots.value = [];
  }
}

async function refreshPoint(): Promise<void> {
  if (!projectId.value) return;
  try {
    quote.value = await api.post<{ credits?: number; quote_id?: string }>(
      `/video-redraw/projects/${projectId.value}/point`,
      { target: "image", shots: Math.max(1, shots.value.length || info.value?.progress.storyboards || 1) },
    );
  } catch {
    quote.value = null;
  }
}

async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = key;
  try {
    await fn();
    toast.success(t("redraw.workspace.done"));
    await load();
  } catch (err) {
    toast.error((err as Error).message || t("redraw.workspace.opFailed"));
  } finally {
    busy.value = "";
  }
}

const createEpisode = () =>
  run("episode", async () => {
    const created = await api.post<{ id: string }>(`/video-redraw/projects/${projectId.value}/episodes`, {});
    if (created?.id) activeEpisodeId.value = created.id;
  });

const batchEpisodes = () =>
  run("episode", () =>
    api.post(`/video-redraw/projects/${projectId.value}/episodes/batch`, {
      count: batchForm.count,
      episode_duration_s: batchForm.episode_duration_s,
    }),
  );

const planStoryboards = () =>
  run("plan", () =>
    api.post(`/video-redraw/projects/${projectId.value}/storyboard/plan`, {
      episode_id: activeEpisodeId.value,
      shot_duration_s: shotDuration.value,
    }),
  );

const generateResources = (target: "image" | "video") =>
  run("generate", async () => {
    const result = await api.post<{
      tasks?: Array<{ storyboard_id: string; project_asset_id: string; task_id: string }>;
    }>(`/video-redraw/projects/${projectId.value}/resources/generate`, {
      episode_id: activeEpisodeId.value || undefined,
      target,
      ...(quote.value?.quote_id ? { quote_id: quote.value.quote_id } : {}),
    });
    lastPairs.value = (result?.tasks ?? []).map((item) => ({
      storyboard_id: item.storyboard_id,
      project_asset_id: item.project_asset_id,
    }));
    return result;
  });

const bindAll = () =>
  run("bind", async () => {
    // 用"本集全部分镜 + 本集已产出的重绘资产"自动绑定：一段一段手点不现实
    // 优先用"本次生成"的配对（此时分镜上的 asset_ids 还是空的），
    // 没有生成记录时回退到分镜已有绑定
    const byShot = new Map<string, string[]>();
    for (const pair of lastPairs.value) {
      const list = byShot.get(pair.storyboard_id) ?? [];
      list.push(pair.project_asset_id);
      byShot.set(pair.storyboard_id, list);
    }
    const body = {
      episode_id: activeEpisodeId.value,
      binds: shots.value.map((shot) => ({
        storyboard_id: shot.id,
        project_asset_ids: (byShot.get(shot.id) ?? shot.asset_ids ?? []).slice(0, 20),
      })),
    };
    const result = await api.post<BindResult>(`/video-redraw/projects/${projectId.value}/asset/bind`, body);
    if (result?.bound !== undefined) toast.success(t("redraw.workspace.boundToast", { count: result.bound }));
  });

async function selectEpisode(id: string): Promise<void> {
  activeEpisodeId.value = id;
  await loadShots(id);
  await refreshPoint();
}

const stageDone = (stage: number): boolean => (info.value?.video_redraw_stage ?? 1) > stage;

onMounted(load);
watch(projectId, () => void load());
</script>

<template>
  <div class="rw">
    <header class="head">
      <div>
        <h1>{{ info?.title || t("redraw.workspace.titleFallback") }}</h1>
        <p v-if="info" class="muted">
          {{
            t("redraw.workspace.meta", {
              style: info.style,
              strength: info.redraw_strength,
              source: t("redraw.workspace.sourceDuration", {
                duration: info.source.duration_s ? `${Math.round(info.source.duration_s)}s` : t("redraw.workspace.durationUnknown"),
              }),
              quote: quote ? t("redraw.workspace.quote", { credits: quote.credits ?? "—" }) : "",
            })
          }}
        </p>
      </div>
      <NuxtLink to="/video-redraw/create" class="link">{{ t("redraw.workspace.newProject") }}</NuxtLink>
    </header>

    <template v-if="!projectId">
      <p v-if="loading" class="muted">{{ t("redraw.workspace.loading") }}</p>
      <p v-else-if="recent.length === 0" class="muted">
        {{ t("redraw.workspace.empty") }} <NuxtLink to="/video-redraw/create" class="link">{{ t("redraw.workspace.emptyCreate") }}</NuxtLink>
      </p>
      <ul v-else class="recent">
        <li v-for="item in recent" :key="item.id">
          <NuxtLink :to="`/video-redraw/workspace?id=${item.id}`">{{ item.title }}</NuxtLink>
        </li>
      </ul>
    </template>

    <template v-else-if="info">
      <ol class="stages">
        <li v-for="stage in STAGES" :key="stage.stage" :class="{ done: stageDone(stage.stage), current: info.video_redraw_stage === stage.stage }">
          <span class="idx">{{ stage.stage }}</span>{{ stage.name }}
        </li>
      </ol>

      <!-- ① 切集 -->
      <section class="card">
        <div class="card-head">
          <h2>{{ t("redraw.workspace.stepEpisode") }}</h2>
          <span class="muted small">{{ t("redraw.workspace.episodesDone", { count: info.progress.episodes }) }}</span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy" @click="createEpisode">
            {{ busy === "episode" ? t("redraw.workspace.loading") : t("redraw.workspace.cutDefault") }}
          </button>
          <label class="inline">
            {{ t("redraw.workspace.evenCount") }}
            <input v-model.number="batchForm.count" type="number" min="1" max="50" class="num" />
          </label>
          <label class="inline">
            {{ t("redraw.workspace.episodeDuration") }}
            <input v-model.number="batchForm.episode_duration_s" type="number" min="1" max="3600" class="num" />
          </label>
          <button type="button" class="btn ghost" :disabled="!!busy" @click="batchEpisodes">{{ t("redraw.workspace.cutBatch") }}</button>
        </div>
        <div v-if="episodes.length" class="chips">
          <button
            v-for="ep in episodes"
            :key="ep.id"
            type="button"
            class="chip"
            :class="{ on: ep.id === activeEpisodeId }"
            @click="selectEpisode(ep.id)"
          >
            {{ t("redraw.workspace.episodeChip", { no: ep.ep_no }) }}{{ ep.title ? ` · ${ep.title}` : "" }}
          </button>
        </div>
      </section>

      <!-- ② 分镜计划 -->
      <section class="card">
        <div class="card-head">
          <h2>{{ t("redraw.workspace.stepPlan") }}</h2>
          <span class="muted small">
            {{ t("redraw.workspace.shotsProgress", { shots: shots.length, submitted: info.progress.storyboards_submitted }) }}
          </span>
        </div>
        <div class="row">
          <label class="inline">
            {{ t("redraw.workspace.shotDuration") }}
            <input v-model.number="shotDuration" type="number" min="1" max="60" class="num" />
          </label>
          <button type="button" class="btn" :disabled="!!busy || !activeEpisodeId" @click="planStoryboards">
            {{ busy === "plan" ? t("redraw.workspace.planning") : t("redraw.workspace.planCover") }}
          </button>
          <span class="muted small">{{ t("redraw.workspace.planHint") }}</span>
        </div>
        <table v-if="shots.length" class="table">
          <thead><tr><th>{{ t("redraw.workspace.thNo") }}</th><th>{{ t("redraw.workspace.thVisual") }}</th><th>{{ t("redraw.workspace.thDuration") }}</th><th>{{ t("redraw.workspace.thBound") }}</th></tr></thead>
          <tbody>
            <tr v-for="shot in shots" :key="shot.id">
              <td>{{ shot.shot_no }}</td>
              <td>{{ shot.shot_desc }}</td>
              <td>{{ shot.duration_s ?? "—" }}s</td>
              <td>{{ shot.asset_ids?.length ? t("redraw.workspace.assetCount", { count: shot.asset_ids.length }) : "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">{{ t("redraw.workspace.needEpisode") }}</p>
      </section>

      <!-- ③ 重绘生成 -->
      <section class="card">
        <div class="card-head">
          <h2>{{ t("redraw.workspace.stepGenerate") }}</h2>
          <span class="muted small">
            {{ t("redraw.workspace.redrawAssets", { count: info.progress.redraw_assets }) }}<template v-if="info.latest_flow">{{
              t("redraw.workspace.latestTask", { count: info.latest_flow.task_count })
            }}</template>
          </span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy || !activeEpisodeId" @click="generateResources('image')">
            {{ busy === "generate" ? t("redraw.workspace.submitting") : t("redraw.workspace.generate") }}
          </button>
          <button type="button" class="btn ghost" :disabled="!!busy || !activeEpisodeId" @click="generateResources('video')">
            {{ t("redraw.workspace.generateVideo") }}
          </button>
          <span class="muted small">{{ t("redraw.workspace.generateHint") }}</span>
        </div>
      </section>

      <!-- ④ 绑定 -->
      <section class="card">
        <div class="card-head">
          <h2>{{ t("redraw.workspace.stepBind") }}</h2>
          <span class="muted small">{{ t("redraw.workspace.bindCount", { bound: info.progress.bound_storyboards, total: info.progress.storyboards }) }}</span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy || shots.length === 0" @click="bindAll">
            {{ busy === "bind" ? t("redraw.workspace.binding") : t("redraw.workspace.bind") }}
          </button>
          <span class="muted small">{{ t("redraw.workspace.bindHint") }}</span>
        </div>
      </section>
    </template>

    <p v-else-if="loading" class="muted">{{ t("redraw.workspace.loading") }}</p>
  </div>
</template>

<style scoped>
.rw {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.stages {
  display: flex;
  gap: var(--space-2);
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-4);
  flex-wrap: wrap;
}
.stages li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: var(--text-sm);
}
.stages li.current {
  border-color: var(--brand-1);
  color: var(--text-1);
}
.stages li.done {
  background: rgba(66, 211, 146, 0.12);
  border-color: transparent;
  color: #42d392;
}
.stages .idx {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg-sunken);
  text-align: center;
  line-height: 18px;
  font-size: 11px;
}
.card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
}
.card h2 {
  margin: 0;
  font-size: var(--text-md);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
}
.row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-2);
}
.num {
  width: 70px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
}
.btn {
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  font: inherit;
}
.btn.ghost {
  color: var(--text-2);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.chips {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}
.chip {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
}
.chip.on {
  border-color: var(--brand-1);
  color: var(--text-1);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  margin-top: var(--space-3);
}
.table th,
.table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-1);
}
.recent {
  list-style: none;
  padding: 0;
  margin: 0;
}
.recent li {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-1);
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
