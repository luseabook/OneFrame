<script setup lang="ts">
/**
 * 广告剧工作台（模块 #13 · 竞品 `/ad-drama/workspace`，`rea-reelmate/routes.txt:12`）。
 *
 * 五段（`feature-map.md:267`）：卖点 → 剧情方案(brief) → 剧本 → 分镜 → 资产。
 * 每段都是"一个生成动作 + 一份可编辑结果"，走 `/ad-drama/projects/:id/*` 的 12 个端点
 * （映射见 `ad-drama.controller.ts` 顶部表格，逐条对齐 `routes.txt:680-691`）。
 *
 * 三条实现判断：
 * 1. **进度以服务端 `stages[]` 为准**：前端不自己推断"做到第几步"（否则刷新/多端会不一致）。
 * 2. **每步都显示本次消耗积分**（响应里的 `charge`）：广告剧一次跑完 5 段要花真积分，
 *    不显示消耗等于让用户盲点。
 * 3. **剧本可编辑 + 可重置**：AI 产出的广告脚本必须能人工改（合规/品牌口径），
 *    重置是"回到生成态"而不是删项目（`script/reset` 保留素材与卖点）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "广告剧工作台 · 一帧" });

const api = useApi();
const toast = useToast();
const route = useRoute();
const router = useRouter();

interface Brief {
  id: string;
  title: string;
  logline: string;
  beats: string[];
  selected?: boolean;
}
interface Shot {
  id: string;
  shot_no: number;
  shot_desc: string | null;
  video_prompt: string | null;
  duration_s: number | null;
  status: number;
}
interface AdAsset {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  prompt: string | null;
  ref_image_uri: string | null;
  status: number;
}
interface StageInfo {
  stage: number;
  key: string;
  name: string;
  done: boolean;
}
interface AdProjectDto {
  id: string;
  title: string;
  ratio: string;
  project_mode: number;
}
interface AdInfo {
  project: AdProjectDto;
  material: { name: string; highlight: string; image: string; style: string; ratio: string };
  episode: { id: string; ep_no: number; title: string | null } | null;
  selling_points: string[];
  briefs: Brief[];
  selected_brief: string | null;
  script: { text: string; edited_at?: string } | null;
  storyboard: { template_type?: number; shot_count: number; generated_at?: string } | null;
  shots: Shot[];
  assets: AdAsset[];
  image_tips: Array<{ name: string; prompt: string; asset_id?: string }>;
  asset_meta: { need_voice?: number } | null;
  stage: number;
  status: number;
  status_name: string;
  stages: StageInfo[];
  current_stage: number;
  charges: Array<{ action: string; credits: number; task_id: string; at: string }>;
}

/** 最近项目列表（无 id 参数时作为入口页） */
interface AdListItem {
  id: string;
  title: string;
  status_name?: string;
  updated_at?: string;
}

const projectId = computed(() => String(route.query.id ?? ""));
const info = ref<AdInfo | null>(null);
const loading = ref(false);
const busy = ref("");
const pricing = ref<{ credits: number; breakdown?: unknown } | null>(null);
const recent = ref<AdListItem[]>([]);
const scriptDraft = ref("");
const scriptDirty = ref(false);

const STYLE_LABEL: Record<string, string> = {
  selling_point: "生成卖点",
  brief: "生成剧情方案",
  script: "生成剧本",
  storyboard: "生成分镜",
  asset: "抽取资产",
};

async function load(): Promise<void> {
  if (!projectId.value) {
    await loadRecent();
    return;
  }
  loading.value = true;
  try {
    const data = await api.get<AdInfo>(`/ad-drama/projects/${projectId.value}`);
    info.value = data;
    // 不在用户正在编辑时覆盖草稿（否则轮询/刷新会吞掉修改）
    if (!scriptDirty.value) scriptDraft.value = data.script?.text ?? "";
    await refreshEstimate();
  } catch (err) {
    toast.error((err as Error).message || "项目加载失败");
  } finally {
    loading.value = false;
  }
}

async function loadRecent(): Promise<void> {
  loading.value = true;
  try {
    // 复用通用项目列表按模式过滤（竞品列表页 `/ad-drama/workspace` 的入口语义）
    const page = await api.get<{ list: Array<{ id: string; title: string; project_mode: number; updated_at?: string }> }>(
      "/projects?page_size=50",
    );
    recent.value = page.list
      .filter((item) => item.project_mode === 2)
      .map((item) => ({ id: item.id, title: item.title, updated_at: item.updated_at }));
  } catch {
    recent.value = [];
  } finally {
    loading.value = false;
  }
}

async function refreshEstimate(): Promise<void> {
  if (!projectId.value) return;
  try {
    const result = await api.post<{ credits: number; breakdown?: unknown }>(
      `/ad-drama/projects/${projectId.value}/point`,
      {},
    );
    pricing.value = result;
  } catch {
    pricing.value = null;
  }
}

/** 统一的"一个动作 + 消耗提示 + 刷新"包装，避免 5 段各写一遍 try/catch */
type RunResult = { charge?: { credits?: number } } | void;

/**
 * 12 个端点返回值形状各异（有的只回 `script`、有的只回 `briefs`、有的回 `charge`），
 * 这里只关心「有没有 charge」用于提示消耗，其余交给 `load()` 重新拉取权威状态。
 */
async function run(action: string, fn: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = action;
  try {
    const result = (await fn()) as RunResult;
    const credits = result?.charge?.credits;
    toast.success(credits ? `${STYLE_LABEL[action] ?? action}完成，消耗 ${credits} 积分` : "完成");
    await load();
  } catch (err) {
    toast.error((err as Error).message || "操作失败");
  } finally {
    busy.value = "";
  }
}

const genSellingPoints = () =>
  run("selling_point", () => api.post(`/ad-drama/projects/${projectId.value}/selling-point/generate`, {}));

const genBriefs = () => run("brief", () => api.post(`/ad-drama/projects/${projectId.value}/brief/generate`, {}));

const selectBrief = (briefId: string) =>
  run("brief", () => api.post(`/ad-drama/projects/${projectId.value}/brief/select`, { brief_id: briefId }));

const genScript = () => run("script", () => api.post(`/ad-drama/projects/${projectId.value}/script/generate`, {}));

async function saveScript(): Promise<void> {
  if (!scriptDraft.value.trim()) {
    toast.error("剧本不能为空");
    return;
  }
  await run("script", async () => {
    const result = await api.post(`/ad-drama/projects/${projectId.value}/script/edit`, {
      script_text: scriptDraft.value,
    });
    scriptDirty.value = false;
    return result;
  });
}

const resetScript = () => run("script", () => api.post(`/ad-drama/projects/${projectId.value}/script/reset`, {}));

const genStoryboard = (templateType: 1 | 2) =>
  run("storyboard", () => api.post(`/ad-drama/projects/${projectId.value}/storyboard/generate`, { template_type: templateType }));

const extractAssets = (needVoice: 1 | 2) =>
  run("asset", () => api.post(`/ad-drama/projects/${projectId.value}/asset/extract`, { need_voice: needVoice }));

const genImageTips = () =>
  run("asset", () => api.post(`/ad-drama/projects/${projectId.value}/asset/image-tips`, {}));

onMounted(load);
watch(projectId, () => void load());
</script>

<template>
  <div class="ad-ws">
    <header class="head">
      <div>
        <h1>{{ info?.project.title || "广告剧工作台" }}</h1>
        <p v-if="info" class="muted">
          {{ info.status_name }} · 画幅 {{ info.project.ratio }} · 当前第 {{ info.current_stage }} / 5 段
          <span v-if="pricing"> · 预计还需 {{ pricing.credits }} 积分</span>
        </p>
      </div>
      <div class="head-actions">
        <NuxtLink to="/ad-drama/create" class="link">＋ 新建广告剧</NuxtLink>
      </div>
    </header>

    <!-- 无 id：项目入口列表 -->
    <template v-if="!projectId">
      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="recent.length === 0" class="muted">
        还没有广告剧项目。<NuxtLink to="/ad-drama/create" class="link">从商品图创建第一个</NuxtLink>
      </p>
      <ul v-else class="recent">
        <li v-for="item in recent" :key="item.id">
          <NuxtLink :to="`/ad-drama/workspace?id=${item.id}`">{{ item.title }}</NuxtLink>
          <span class="muted small">{{ item.updated_at ? new Date(item.updated_at).toLocaleString() : "" }}</span>
        </li>
      </ul>
    </template>

    <template v-else-if="info">
      <!-- 五段进度条（以服务端 stages 为准） -->
      <ol class="stages">
        <li v-for="stage in info.stages" :key="stage.key" :class="{ done: stage.done, current: stage.stage === info.current_stage }">
          <span class="idx">{{ stage.stage }}</span>
          <span>{{ stage.name }}</span>
        </li>
      </ol>

      <!-- ① 卖点 -->
      <section class="card">
        <div class="card-head">
          <h2>① 卖点</h2>
          <button type="button" class="btn" :disabled="!!busy" @click="genSellingPoints">
            {{ busy === "selling_point" ? "生成中…" : info.selling_points.length ? "重新生成" : "生成卖点" }}
          </button>
        </div>
        <p class="muted small">商品：{{ info.material.name }} — {{ info.material.highlight }}</p>
        <img v-if="info.material.image" :src="info.material.image" class="thumb" alt="商品图" />
        <ul v-if="info.selling_points.length" class="points">
          <li v-for="(point, index) in info.selling_points" :key="index">{{ point }}</li>
        </ul>
        <p v-else class="muted">还没有卖点。卖点是后续方案与剧本的输入，请先生成。</p>
      </section>

      <!-- ② 剧情方案 -->
      <section class="card">
        <div class="card-head">
          <h2>② 剧情方案</h2>
          <button type="button" class="btn" :disabled="!!busy || info.selling_points.length === 0" @click="genBriefs">
            {{ busy === "brief" ? "生成中…" : info.briefs.length ? "重新生成候选" : "生成候选" }}
          </button>
        </div>
        <div v-if="info.briefs.length" class="briefs">
          <article v-for="brief in info.briefs" :key="brief.id" class="brief" :class="{ selected: brief.id === info.selected_brief }">
            <h3>{{ brief.title }}</h3>
            <p class="muted small">{{ brief.logline }}</p>
            <ol class="beats">
              <li v-for="(beat, index) in brief.beats" :key="index">{{ beat }}</li>
            </ol>
            <button
              type="button"
              class="btn tiny"
              :disabled="!!busy || brief.id === info.selected_brief"
              @click="selectBrief(brief.id)"
            >
              {{ brief.id === info.selected_brief ? "已选定" : "选定此方案" }}
            </button>
          </article>
        </div>
        <p v-else class="muted">先有卖点才能生成方案（竞品 `ad plot` 同样要求先出卖点）。</p>
      </section>

      <!-- ③ 剧本 -->
      <section class="card">
        <div class="card-head">
          <h2>③ 剧本</h2>
          <div class="row">
            <button type="button" class="btn" :disabled="!!busy || !info.selected_brief" @click="genScript">
              {{ busy === "script" ? "生成中…" : info.script ? "重新生成" : "生成剧本" }}
            </button>
            <button v-if="info.script" type="button" class="btn ghost" :disabled="!!busy" @click="resetScript">
              重置
            </button>
          </div>
        </div>
        <textarea
          v-if="info.script"
          v-model="scriptDraft"
          rows="10"
          class="script"
          @input="scriptDirty = true"
        />
        <p v-else class="muted">选定方案后生成剧本；生成后可人工修改（品牌口径/合规）。</p>
        <div v-if="info.script" class="row">
          <button type="button" class="btn primary" :disabled="!!busy || !scriptDirty" @click="saveScript">
            保存修改
          </button>
          <span v-if="scriptDirty" class="muted small">有未保存修改</span>
        </div>
      </section>

      <!-- ④ 分镜 -->
      <section class="card">
        <div class="card-head">
          <h2>④ 分镜</h2>
          <div class="row">
            <button type="button" class="btn" :disabled="!!busy || !info.script" @click="genStoryboard(1)">
              {{ busy === "storyboard" ? "生成中…" : "急速模板" }}
            </button>
            <button type="button" class="btn ghost" :disabled="!!busy || !info.script" @click="genStoryboard(2)">
              至尊模板
            </button>
          </div>
        </div>
        <table v-if="info.shots.length" class="table">
          <thead>
            <tr><th>#</th><th>画面</th><th>提示词</th><th>时长</th></tr>
          </thead>
          <tbody>
            <tr v-for="shot in info.shots" :key="shot.id">
              <td>{{ shot.shot_no }}</td>
              <td>{{ shot.shot_desc }}</td>
              <td class="prompt">{{ shot.video_prompt }}</td>
              <td>{{ shot.duration_s ?? "—" }}s</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">剧本定稿后生成分镜（急速/至尊两档对应竞品 `template_type` 1/2）。</p>
      </section>

      <!-- ⑤ 资产 -->
      <section class="card">
        <div class="card-head">
          <h2>⑤ 资产</h2>
          <div class="row">
            <button type="button" class="btn" :disabled="!!busy || info.shots.length === 0" @click="extractAssets(1)">
              {{ busy === "asset" ? "处理中…" : "抽取资产（含配音）" }}
            </button>
            <button type="button" class="btn ghost" :disabled="!!busy || info.shots.length === 0" @click="extractAssets(2)">
              抽取资产（不配音）
            </button>
            <button v-if="info.assets.length" type="button" class="btn ghost" :disabled="!!busy" @click="genImageTips">
              生成提示词建议
            </button>
          </div>
        </div>
        <div v-if="info.assets.length" class="assets">
          <article v-for="asset in info.assets" :key="asset.id" class="asset">
            <h4>{{ asset.name }} <span class="muted small">{{ asset.kind }}</span></h4>
            <p class="muted small">{{ asset.description }}</p>
            <p v-if="asset.prompt" class="prompt">{{ asset.prompt }}</p>
          </article>
        </div>
        <p v-else class="muted">分镜完成后抽取商品/场景/角色资产，供后续出图出片复用。</p>
        <ul v-if="info.image_tips.length" class="tips">
          <li v-for="(tip, index) in info.image_tips" :key="index">
            <b>{{ tip.name }}</b>：{{ tip.prompt }}
          </li>
        </ul>
      </section>

      <!-- 消耗留痕 -->
      <section v-if="info.charges.length" class="card">
        <h2>本次消耗</h2>
        <table class="table">
          <thead><tr><th>动作</th><th>积分</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="(charge, index) in info.charges" :key="index">
              <td>{{ charge.action }}</td>
              <td>{{ charge.credits }}</td>
              <td>{{ new Date(charge.at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <p v-else-if="loading" class="muted">加载中…</p>
  </div>
</template>

<style scoped>
.ad-ws {
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
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
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
.btn.primary {
  background: var(--brand-1);
  border-color: transparent;
  color: #fff;
}
.btn.ghost {
  color: var(--text-2);
}
.btn.tiny {
  padding: 4px 10px;
  font-size: var(--text-xs);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.thumb {
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  margin: var(--space-2) 0;
}
.points,
.beats,
.tips {
  margin: var(--space-2) 0 0;
  padding-left: 20px;
  color: var(--text-2);
  line-height: 1.7;
}
.briefs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-3);
}
.brief {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}
.brief.selected {
  border-color: #42d392;
}
.brief h3 {
  margin: 0 0 6px;
  font-size: var(--text-sm);
}
.script {
  width: 100%;
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
  font: inherit;
  line-height: 1.7;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.table th,
.table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-1);
  vertical-align: top;
}
.prompt {
  color: var(--text-3);
  max-width: 420px;
}
.assets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-3);
}
.asset {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}
.asset h4 {
  margin: 0 0 6px;
  font-size: var(--text-sm);
}
.recent {
  list-style: none;
  padding: 0;
  margin: 0;
}
.recent li {
  display: flex;
  justify-content: space-between;
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
