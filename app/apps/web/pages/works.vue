<script setup lang="ts">
import type { WorkDto, WorksListDto } from "~/types/api";

/**
 * 全部项目（作品库）：工坊项目 + 无限画布聚合。
 *
 * 竞品「全部项目」页把两类创作放同一清单（`_acceptance/_gap/fullsite-route-inventory.md:81`），
 * 所以这里做的是**形态 tab + 服务端筛选**，而不是前端过滤：
 * 前端过滤会让"共 N 部"与列表条数对不上（分页只拿到当前页）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "我的作品 · 一帧" });

const api = useApi();
const toast = useToast();
const router = useRouter();

const list = ref<WorkDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 24;
const hasMore = ref(false);
const tabCounts = ref<{ workshop: number; canvas: number }>({ workshop: 0, canvas: 0 });
/** 形态：工坊 / 画布 / 全部（对应后端 tab） */
const tab = ref<"workshop" | "canvas" | "all">("workshop");
/** 归档维度 + 四态 + 关键词 + 时间范围，全部下发到服务端筛选 */
const statusFilter = ref<"active" | "archived" | "all">("active");
const stateFilter = ref<"all" | "draft" | "producing" | "ready">("all");
const keyword = ref("");
const range = ref<"all" | "7d" | "30d">("all");
const loading = ref(true);
const error = ref("");
const busyId = ref("");

const STATE_META: Record<string, { label: string; tone: "neutral" | "brand" | "info" | "success" | "warning" }> = {
  draft: { label: "草稿", tone: "neutral" },
  producing: { label: "制作中", tone: "brand" },
  ready: { label: "已成片", tone: "success" },
  archived: { label: "已归档", tone: "info" },
  canvas: { label: "画布", tone: "brand" },
};

function fromIso(): string | undefined {
  if (range.value === "all") return undefined;
  const days = range.value === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ tab: tab.value, page: String(page.value), page_size: String(pageSize) });
    if (statusFilter.value !== "active") q.set("status", statusFilter.value);
    if (stateFilter.value !== "all") q.set("state", stateFilter.value);
    if (keyword.value.trim()) q.set("keyword", keyword.value.trim());
    const from = fromIso();
    if (from) q.set("from", from);
    const data = await api.get<WorksListDto>(`/works?${q.toString()}`);
    list.value = data.list;
    total.value = data.total;
    hasMore.value = data.has_more;
    tabCounts.value = data.tabs;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function switchTab(next: "workshop" | "canvas" | "all"): void {
  tab.value = next;
  page.value = 1;
  // 画布没有归档/四态概念，切过去时把不适用的筛选归零并提示
  if (next === "canvas") {
    statusFilter.value = "active";
    stateFilter.value = "all";
  }
  void load();
}

function applyFilters(): void {
  page.value = 1;
  void load();
}

function resetFilters(): void {
  statusFilter.value = "active";
  stateFilter.value = "all";
  keyword.value = "";
  range.value = "all";
  page.value = 1;
  void load();
}

function progress(work: WorkDto): number {
  if (!work.shot_count) return 0;
  return Math.round((work.done_count / work.shot_count) * 100);
}

async function archive(work: WorkDto): Promise<void> {
  const next = work.work_state !== "archived";
  busyId.value = work.id;
  try {
    await api.post(`/projects/${work.id}/archive`, { archived: next });
    toast.success(next ? "已归档" : "已恢复");
    await load();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    error.value = msg;
    toast.error(msg);
  } finally {
    busyId.value = "";
  }
}

async function addEpisode(work: WorkDto): Promise<void> {
  busyId.value = work.id;
  try {
    await api.post(`/projects/${work.id}/episodes`, { count: 1 });
    await router.push(`/projects/${work.id}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "新增失败";
  } finally {
    busyId.value = "";
  }
}

/**
 * 示例作品 → 复制为我的项目（PRD 增补 §3.2 首次体验）。
 * 复制骨架+角色，不复制分镜，用户可直接在副本上动手而不影响示例。
 */
async function duplicateSample(work: WorkDto): Promise<void> {
  busyId.value = work.id;
  try {
    const res = await api.post<{ id: string; episodes: number; characters: number }>(
      `/projects/${work.id}/duplicate`,
    );
    toast.success(`已复制「${work.title}」：${res.episodes} 集 · ${res.characters} 个角色`);
    await router.push(`/projects/${res.id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "复制失败";
    error.value = msg;
    toast.error(msg);
  } finally {
    busyId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="works">
    <header class="head">
      <div class="head-main">
        <h1>全部项目</h1>
        <p class="sub">
          工坊项目与无限画布在同一清单里；筛选走服务端，分页总数与列表一致。
        </p>
      </div>
      <div class="head-actions">
        <Button @click="router.push('/projects')">+ 新建作品</Button>
      </div>
    </header>

    <!-- 形态 tab：工坊 / 画布 / 全部（对应后端 tab=workshop|canvas|all） -->
    <nav class="tabs">
      <button
        v-for="t in [
          { key: 'workshop' as const, label: '工坊项目' },
          { key: 'canvas' as const, label: '画布项目' },
          { key: 'all' as const, label: '全部' },
        ]"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ on: tab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
        <span class="tab-count">{{ tabCounts[t.key === "all" ? "workshop" : t.key] ?? 0 }}</span>
      </button>
      <span class="total">共 {{ total }} 部</span>
    </nav>

    <!-- 二级筛选：状态 / 四态 / 时间 / 关键词（画布视图下归档与四态不适用） -->
    <div class="filters">
      <select v-if="tab !== 'canvas'" v-model="statusFilter" class="mini-select" @change="applyFilters">
        <option value="active">未归档</option>
        <option value="archived">已归档</option>
        <option value="all">全部状态</option>
      </select>
      <select v-if="tab !== 'canvas'" v-model="stateFilter" class="mini-select" @change="applyFilters">
        <option value="all">全部进度</option>
        <option value="draft">草稿</option>
        <option value="producing">制作中</option>
        <option value="ready">已成片</option>
      </select>
      <select v-model="range" class="mini-select" @change="applyFilters">
        <option value="all">不限时间</option>
        <option value="7d">近 7 天</option>
        <option value="30d">近 30 天</option>
      </select>
      <input
        v-model="keyword"
        class="mini-input"
        placeholder="按标题搜索"
        maxlength="40"
        @keyup.enter="applyFilters"
      />
      <Button size="sm" variant="ghost" :disabled="loading" @click="applyFilters">筛选</Button>
      <Button size="sm" variant="text" :disabled="loading" @click="resetFilters">重置</Button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" avatar />

    <template v-else>
      <div v-if="list.length" class="grid">
        <article v-for="w in list" :key="`${w.kind ?? 'workshop'}-${w.id}`" class="work-card">
          <!-- 画布项目：只读投影，跳画布编辑器，不提供归档/续做 -->
          <template v-if="w.kind === 'canvas'">
            <NuxtLink :to="`/canvas/${w.id}`" class="cover">
              <div class="cover-empty">
                <span>画布 · {{ w.node_count ?? 0 }} 节点</span>
              </div>
              <Tag class="state-tag" tone="brand" size="sm" dot>画布</Tag>
            </NuxtLink>
            <div class="body">
              <NuxtLink :to="`/canvas/${w.id}`" class="title">{{ w.title }}</NuxtLink>
              <p class="meta">
                {{ w.node_count ?? 0 }} 个节点
                <span class="sep">·</span>
                {{ w.creation_mode === 1 ? "制片工坊画布" : "无限画布" }}
              </p>
              <p v-if="w.failed_nodes" class="meta warn">失败节点 {{ w.failed_nodes }}</p>
              <p class="time">最后编辑 {{ new Date(w.updated_at ?? w.created_at).toLocaleString("zh-CN") }}</p>
            </div>
          </template>

          <template v-else>
            <NuxtLink :to="`/projects/${w.id}`" class="cover">
              <img v-if="w.cover_uri" :src="w.cover_uri" :alt="w.title" loading="lazy" />
              <div v-else class="cover-empty">
                <span>{{ w.ratio }}</span>
              </div>
              <Tag class="state-tag" :tone="w.is_sample ? 'brand' : (STATE_META[w.work_state]?.tone ?? 'neutral')" size="sm" dot>
                {{ w.is_sample ? "示例模板" : (STATE_META[w.work_state]?.label ?? w.work_state) }}
              </Tag>
            </NuxtLink>

            <div class="body">
              <NuxtLink :to="`/projects/${w.id}`" class="title">{{ w.title }}</NuxtLink>
              <p class="meta">
                {{ w.episode_count }} 集
                <span class="sep">·</span>
                {{ w.done_count }}/{{ w.shot_count }} 镜已出片
              </p>
              <div v-if="w.shot_count" class="prog">
                <Progress :value="progress(w)" :tone="progress(w) === 100 ? 'success' : 'brand'" />
              </div>
              <p class="time">{{ new Date(w.created_at).toLocaleDateString("zh-CN") }}</p>

              <div class="ops">
                <Button
                  v-if="w.is_sample"
                  size="sm"
                  :disabled="busyId === w.id"
                  @click="duplicateSample(w)"
                >
                  复制为我的项目
                </Button>
                <Button v-else size="sm" variant="ghost" :disabled="busyId === w.id" @click="addEpisode(w)">
                  续做一集
                </Button>
                <Button
                  v-if="!w.is_sample"
                  size="sm"
                  variant="text"
                  :disabled="busyId === w.id"
                  @click="archive(w)"
                >
                  {{ w.work_state === "archived" ? "恢复" : "归档" }}
                </Button>
              </div>
            </div>
          </template>
        </article>
      </div>

      <div v-else class="empty-wrap">
        <EmptyState
          icon="▦"
          :title="tab === 'canvas' ? '还没有画布项目' : '还没有作品'"
          :description="
            tab === 'canvas'
              ? '到「无限画布」新建一张画布，它也会出现在这里。'
              : '从一句话或一段小说开始，AI 帮你拆成 3~6 集并生成分镜，一集可出片。'
          "
        >
          <Button @click="router.push(tab === 'canvas' ? '/canvas' : '/projects')">
            {{ tab === "canvas" ? "去新建画布" : "新建第一部作品" }}
          </Button>
        </EmptyState>
      </div>

      <div v-if="total > pageSize" class="pager">
        <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
        <span>第 {{ page }} 页</span>
        <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 页内容容器：与 home/tools 同一套 padding 节奏，最大宽度对齐 projects/index.vue */
.works {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 72px 80px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.head-main {
  min-width: 0;
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-1);
}
.sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* tabs：沿用 projects/index.vue 的下划线范式（激活 2px brand + text-1） */
.tabs {
  display: flex;
  align-items: center;
  gap: 28px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: var(--space-6);
}
.tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--text-1);
}
.tab.on {
  color: var(--text-1);
}
.tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}
.total {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
/* tab 上的计数（工坊 / 画布），与 total 区分：一个是形态内数量，一个是筛选后总数 */
.tab-count {
  margin-left: 4px;
  color: var(--text-4);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 二级筛选行：与 assets.vue 同一套 mini 控件节奏 */
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.mini-select,
.mini-input {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.mini-input {
  min-width: 180px;
}
.mini-select:focus,
.mini-input:focus {
  border-color: var(--brand-500);
}
.meta.warn {
  color: var(--warning);
}

.err {
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
/* 卡片范式 C：实底面板 + 1px 白 8% 边框 + 16 圆角，hover 只提亮边框，不加投影光晕 */
.work-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition:
    border-color var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.work-card:hover {
  border-color: var(--border-3);
  transform: translateY(-2px);
}
.cover {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  background: var(--bg-sunken);
  overflow: hidden;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-slow) var(--ease-out);
}
.work-card:hover .cover img {
  transform: scale(1.03);
}
.cover-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-4);
  font-size: var(--text-sm);
  background: linear-gradient(135deg, var(--bg-sunken), var(--bg-hover));
}
.state-tag {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
}
.body {
  padding: var(--space-3) var(--space-4) var(--space-4);
}
.title {
  display: block;
  font-weight: 600;
  font-size: var(--text-base);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title:hover {
  color: var(--brand-300);
}
.meta {
  margin: var(--space-1) 0 var(--space-2);
  color: var(--text-3);
  font-size: var(--text-xs);
}
.sep {
  color: var(--border-3);
  margin: 0 3px;
}
.prog {
  margin-bottom: var(--space-2);
}
.time {
  margin: 0 0 var(--space-3);
  color: var(--text-4);
  font-size: var(--text-xs);
}
.ops {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-8);
  color: var(--text-3);
  font-size: var(--text-sm);
}
/* 空态：复用 EmptyState，整块上下居中（参照项目页范式） */
.empty-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 420px;
}

/* 窄屏：页内容左右留白降级（与 home/tools 一致） */
@media (max-width: 1024px) {
  .works {
    padding: 24px;
  }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }
}
@media (max-width: 768px) {
  .works {
    padding: 16px;
  }
  .head {
    flex-direction: column;
    gap: var(--space-3);
  }
  .tabs {
    gap: 20px;
  }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
