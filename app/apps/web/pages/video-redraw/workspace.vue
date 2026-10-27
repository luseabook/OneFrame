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
useHead({ title: "视频转绘工作台 · 一帧" });

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
const recent = ref<Array<{ id: string; title: string }>>([]);
const batchForm = reactive({ count: 3, episode_duration_s: 60 });
const shotDuration = ref(3);

/** 四段（与服务端 `stageOf` 的 1..4 对齐） */
const STAGES = [
  { stage: 1, name: "切集" },
  { stage: 2, name: "分镜计划" },
  { stage: 3, name: "重绘生成" },
  { stage: 4, name: "绑定完成" },
];

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
    toast.error((err as Error).message || "项目加载失败");
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
    toast.success("完成");
    await load();
  } catch (err) {
    toast.error((err as Error).message || "操作失败");
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
  run("generate", () =>
    api.post(`/video-redraw/projects/${projectId.value}/resources/generate`, {
      episode_id: activeEpisodeId.value || undefined,
      target,
      ...(quote.value?.quote_id ? { quote_id: quote.value.quote_id } : {}),
    }),
  );

const bindAll = () =>
  run("bind", async () => {
    // 用"本集全部分镜 + 本集已产出的重绘资产"自动绑定：一段一段手点不现实
    const body = {
      episode_id: activeEpisodeId.value,
      binds: shots.value.map((shot) => ({
        storyboard_id: shot.id,
        project_asset_ids: (shot.asset_ids ?? []).slice(0, 20),
      })),
    };
    const result = await api.post<BindResult>(`/video-redraw/projects/${projectId.value}/asset/bind`, body);
    if (result?.bound !== undefined) toast.success(`已绑定 ${result.bound} 个分镜`);
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
        <h1>{{ info?.title || "视频转绘工作台" }}</h1>
        <p v-if="info" class="muted">
          风格 {{ info.style }} · 强度 {{ info.redraw_strength }} ·
          源视频 {{ info.source.duration_s ? `${Math.round(info.source.duration_s)}s` : "时长未知" }}
          <span v-if="quote"> · 预计本集重绘 {{ quote.credits ?? "—" }} 积分</span>
        </p>
      </div>
      <NuxtLink to="/video-redraw/create" class="link">＋ 新建转绘</NuxtLink>
    </header>

    <template v-if="!projectId">
      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="recent.length === 0" class="muted">
        还没有转绘项目。<NuxtLink to="/video-redraw/create" class="link">上传一段视频开始</NuxtLink>
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
          <h2>① 切集</h2>
          <span class="muted small">已切 {{ info.progress.episodes }} 集</span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy" @click="createEpisode">
            {{ busy === "episode" ? "处理中…" : "按默认时长切一集" }}
          </button>
          <label class="inline">
            等分集数
            <input v-model.number="batchForm.count" type="number" min="1" max="50" class="num" />
          </label>
          <label class="inline">
            每集时长(s)
            <input v-model.number="batchForm.episode_duration_s" type="number" min="1" max="3600" class="num" />
          </label>
          <button type="button" class="btn ghost" :disabled="!!busy" @click="batchEpisodes">批量切集</button>
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
            第 {{ ep.ep_no }} 集{{ ep.title ? ` · ${ep.title}` : "" }}
          </button>
        </div>
      </section>

      <!-- ② 分镜计划 -->
      <section class="card">
        <div class="card-head">
          <h2>② 分镜计划</h2>
          <span class="muted small">
            本集 {{ shots.length }} 镜 · 已提交生成 {{ info.progress.storyboards_submitted }} 镜
          </span>
        </div>
        <div class="row">
          <label class="inline">
            单镜时长(s)
            <input v-model.number="shotDuration" type="number" min="1" max="60" class="num" />
          </label>
          <button type="button" class="btn" :disabled="!!busy || !activeEpisodeId" @click="planStoryboards">
            {{ busy === "plan" ? "规划中…" : "按时间轴切镜（覆盖式）" }}
          </button>
          <span class="muted small">覆盖式：重复规划会替换本集分镜，不会叠加。</span>
        </div>
        <table v-if="shots.length" class="table">
          <thead><tr><th>#</th><th>画面</th><th>时长</th><th>已绑产物</th></tr></thead>
          <tbody>
            <tr v-for="shot in shots" :key="shot.id">
              <td>{{ shot.shot_no }}</td>
              <td>{{ shot.shot_desc }}</td>
              <td>{{ shot.duration_s ?? "—" }}s</td>
              <td>{{ shot.asset_ids?.length ? `${shot.asset_ids.length} 个` : "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">还没有分镜。先切集，再按源视频时间轴生成分镜计划。</p>
      </section>

      <!-- ③ 重绘生成 -->
      <section class="card">
        <div class="card-head">
          <h2>③ 重绘生成</h2>
          <span class="muted small">
            已产出 {{ info.progress.redraw_assets }} 个重绘资产
            <template v-if="info.latest_flow"> · 最近任务 {{ info.latest_flow.task_count }} 个</template>
          </span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy || !activeEpisodeId" @click="generateResources('image')">
            {{ busy === "generate" ? "提交中…" : "生成本集重绘参考图" }}
          </button>
          <button type="button" class="btn ghost" :disabled="!!busy || !activeEpisodeId" @click="generateResources('video')">
            生成重绘视频
          </button>
          <span class="muted small">生成走积分报价 + 任务记账；无供应商 Key 时按 mock 返回。</span>
        </div>
      </section>

      <!-- ④ 绑定 -->
      <section class="card">
        <div class="card-head">
          <h2>④ 绑定</h2>
          <span class="muted small">已绑 {{ info.progress.bound_storyboards }} / {{ info.progress.storyboards }} 镜</span>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="!!busy || shots.length === 0" @click="bindAll">
            {{ busy === "bind" ? "绑定中…" : "把本集产物绑到分镜" }}
          </button>
          <span class="muted small">快照语义：每次绑定覆盖该分镜的资产集合，与剪辑台时间线一致。</span>
        </div>
      </section>
    </template>

    <p v-else-if="loading" class="muted">加载中…</p>
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
