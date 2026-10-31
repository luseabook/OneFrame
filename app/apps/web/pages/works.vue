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
// i18n（第 8 批补完）：页面骨架与状态名走语言包；作品标题/封面等是后端数据，不翻译
const { t, locale } = useI18n();
useHead({ title: () => t("works.metaTitle") });

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
/**
 * 项目归属组（第 63 批）。
 *
 * 竞品证据：列表项带 `group_id` + `group_name`，换组走
 * `POST /df/script_project/:sp_id/group/edit`，文案是 `project.groupOwnership.*`（归属组）。
 * 分组的 CRUD 在团队域（`/team/group*`），作品页只做"项目 → 组"的归属变更，
 * 所以这里拉一次团队分组列表给下拉用，不新建一套"项目分组"。
 */
const groups = ref<Array<{ id: string; name: string; status: number }>>([]);
const groupFilter = ref("");
const savingGroupId = ref("");

/** 四态 / 画布态的展示名与色调：label 随语言，tone 是视觉语义（不翻译） */
function stateMeta(state: string): { label: string; tone: "neutral" | "brand" | "info" | "success" | "warning" } {
  switch (state) {
    case "draft":
      return { label: t("works.stateDraft"), tone: "neutral" };
    case "producing":
      return { label: t("works.stateProducing"), tone: "brand" };
    case "ready":
      return { label: t("works.stateReady"), tone: "success" };
    case "archived":
      return { label: t("works.statusArchived"), tone: "info" };
    case "canvas":
      return { label: t("works.canvasTag"), tone: "brand" };
    default:
      return { label: state, tone: "neutral" };
  }
}

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
    // 归属组筛选（竞品同名参数 group_id；"0" 由后端解释为"未分组"）
    if (groupFilter.value) q.set("group_id", groupFilter.value);
    const from = fromIso();
    if (from) q.set("from", from);
    const data = await api.get<WorksListDto>(`/works?${q.toString()}`);
    list.value = data.list;
    total.value = data.total;
    hasMore.value = data.has_more;
    tabCounts.value = data.tabs;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("errors.load");
  } finally {
    loading.value = false;
  }
}

/**
 * 拉团队分组列表（停用的组不参与下拉：后端也会拒收停用组）。
 *
 * 路径必须是 `/cam/team/groups`：`TeamController` 的 `@Controller("cam")` + `@Get("team/groups")`。
 * 第 63 批写成了 `/team/groups`，而这里的 `catch` 会把 404 静默吞成"没有分组"，
 * 于是分组下拉从未出现过——第 66 批的 web↔后端路由审计才发现（已在 §17.25 记录）。
 */
async function loadGroups(): Promise<void> {
  try {
    const data = await api.get<{ list: Array<{ id: string; name: string; status: number }> }>("/cam/team/groups");
    groups.value = (data.list ?? []).filter((g) => Number(g.status) === 1);
  } catch {
    // 分组列表是增强功能：拿不到时作品页照常可用，只是不显示下拉
    groups.value = [];
  }
}

/**
 * 换组：`""` / `"0"` 都表示移出分组（后端写 null）。
 * 竞品把"取消分组"表达成 `group_id: "0"`，所以下拉里必须留一个"未分组"选项。
 */
async function changeGroup(work: WorkDto, next: string): Promise<void> {
  savingGroupId.value = work.id;
  try {
    await api.post(`/projects/${work.id}/group`, { group_id: next === "0" ? null : next });
    toast.success(t("works.groupChanged"));
    await load();
  } catch (e) {
    const msg = e instanceof Error ? e.message : t("errors.operation");
    toast.error(msg);
  } finally {
    savingGroupId.value = "";
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
  groupFilter.value = "";
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
    toast.success(next ? t("works.archivedDone") : t("works.restoredDone"));
    await load();
  } catch (e) {
    const msg = e instanceof Error ? e.message : t("errors.operation");
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
    error.value = e instanceof Error ? e.message : t("works.addFailed");
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
    toast.success(t("works.duplicateDone", { title: work.title, episodes: res.episodes, characters: res.characters }));
    await router.push(`/projects/${res.id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : t("works.duplicateFailed");
    error.value = msg;
    toast.error(msg);
  } finally {
    busyId.value = "";
  }
}

onMounted(() => {
  void load();
  void loadGroups();
});
</script>

<template>
  <div class="works">
    <header class="head">
      <div class="head-main">
        <h1>{{ t("works.title") }}</h1>
        <p class="sub">
          {{ t("works.sub") }}
        </p>
      </div>
      <div class="head-actions">
        <Button @click="router.push('/projects')">{{ t("works.newWork") }}</Button>
      </div>
    </header>

    <!-- 形态 tab：工坊 / 画布 / 全部（对应后端 tab=workshop|canvas|all） -->
    <nav class="tabs">
      <button
        v-for="tabItem in [
          { key: 'workshop' as const, label: t('works.tabWorkshop') },
          { key: 'canvas' as const, label: t('works.tabCanvas') },
          { key: 'all' as const, label: t('works.tabAll') },
        ]"
        :key="tabItem.key"
        type="button"
        class="tab"
        :class="{ on: tab === tabItem.key }"
        @click="switchTab(tabItem.key)"
      >
        {{ tabItem.label }}
        <span class="tab-count">{{ tabCounts[tabItem.key === "all" ? "workshop" : tabItem.key] ?? 0 }}</span>
      </button>
      <span class="total">{{ t("works.totalWorks", { count: total }) }}</span>
    </nav>

    <!-- 二级筛选：状态 / 四态 / 时间 / 关键词（画布视图下归档与四态不适用） -->
    <div class="filters">
      <select v-if="tab !== 'canvas'" v-model="statusFilter" class="mini-select" @change="applyFilters">
        <option value="active">{{ t("works.statusActive") }}</option>
        <option value="archived">{{ t("works.statusArchived") }}</option>
        <option value="all">{{ t("works.statusAllStatus") }}</option>
      </select>
      <select v-if="tab !== 'canvas'" v-model="stateFilter" class="mini-select" @change="applyFilters">
        <option value="all">{{ t("works.stateAll") }}</option>
        <option value="draft">{{ t("works.stateDraft") }}</option>
        <option value="producing">{{ t("works.stateProducing") }}</option>
        <option value="ready">{{ t("works.stateReady") }}</option>
      </select>
      <select v-if="tab !== 'canvas' && groups.length" v-model="groupFilter" class="mini-select" @change="applyFilters">
        <option value="">{{ t("works.groupAll") }}</option>
        <option value="0">{{ t("works.groupNone") }}</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <select v-model="range" class="mini-select" @change="applyFilters">
        <option value="all">{{ t("works.rangeAll") }}</option>
        <option value="7d">{{ t("works.range7d") }}</option>
        <option value="30d">{{ t("works.range30d") }}</option>
      </select>
      <input
        v-model="keyword"
        class="mini-input"
        :placeholder="t('works.searchPlaceholder')"
        maxlength="40"
        @keyup.enter="applyFilters"
      />
      <Button size="sm" variant="ghost" :disabled="loading" @click="applyFilters">{{ t("works.filter") }}</Button>
      <Button size="sm" variant="text" :disabled="loading" @click="resetFilters">{{ t("works.reset") }}</Button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" avatar />

    <template v-else>
      <div v-if="list.length" class="grid">
        <article v-for="w in list" :key="`${w.kind ?? 'workshop'}-${w.id}`" class="work-card">
          <!-- 画布项目：只读投影，跳画布编辑器，不提供归档/续做 -->
          <template v-if="w.kind === 'canvas'">
            <NuxtLink :to="`/canvas/${w.id}`" class="cover">
              <img v-if="w.cover_uri" :src="w.cover_uri" :alt="w.title" loading="lazy" />
              <div v-else class="cover-empty">
                <span>{{ t("works.canvasWithNodes", { count: w.node_count ?? 0 }) }}</span>
              </div>
              <Tag class="state-tag" tone="brand" size="sm" dot>{{ t("works.canvasTag") }}</Tag>
            </NuxtLink>
            <div class="body">
              <NuxtLink :to="`/canvas/${w.id}`" class="title">{{ w.title }}</NuxtLink>
              <p class="meta">
                {{ t("works.nodeCount", { count: w.node_count ?? 0 }) }}
                <span class="sep">·</span>
                {{ w.creation_mode === 1 ? t("works.creationStudio") : t("works.creationCanvas") }}
              </p>
              <p v-if="w.failed_nodes" class="meta warn">{{ t("works.failedNodes", { count: w.failed_nodes }) }}</p>
              <p v-if="w.creator_nick" class="meta">{{ t("works.creator", { name: w.creator_nick }) }}</p>
              <p class="time">
                {{ t("works.lastEdited", { date: new Date(w.last_edited_at ?? w.updated_at ?? w.created_at).toLocaleString(locale) }) }}
              </p>
            </div>
          </template>

          <template v-else>
            <NuxtLink :to="`/projects/${w.id}`" class="cover">
              <img v-if="w.cover_uri" :src="w.cover_uri" :alt="w.title" loading="lazy" />
              <div v-else class="cover-empty">
                <span>{{ w.ratio }}</span>
              </div>
              <Tag class="state-tag" :tone="w.is_sample ? 'brand' : (stateMeta(w.work_state).tone ?? 'neutral')" size="sm" dot>
                {{ w.is_sample ? t("works.sample") : stateMeta(w.work_state).label }}
              </Tag>
            </NuxtLink>

            <div class="body">
              <NuxtLink :to="`/projects/${w.id}`" class="title">{{ w.title }}</NuxtLink>
              <p class="meta">
                {{ t("works.episodes", { count: w.episode_count }) }}
                <span class="sep">·</span>
                {{ t("works.shotsDone", { done: w.done_count, total: w.shot_count }) }}
              </p>
              <div v-if="w.shot_count" class="prog">
                <Progress :value="progress(w)" :tone="progress(w) === 100 ? 'success' : 'brand'" />
              </div>
              <p v-if="w.group_name" class="meta group-line">{{ t("works.group", { name: w.group_name }) }}</p>
              <p class="time">{{ new Date(w.created_at).toLocaleDateString(locale) }}</p>

              <div class="ops">
                <!-- 换组：竞品是「归属组」弹层；我方用就地下拉（分组数量在团队域里是十几级，弹层过重） -->
                <select
                  v-if="!w.is_sample && groups.length"
                  class="mini-select group-select"
                  :value="w.group_id ?? '0'"
                  :disabled="savingGroupId === w.id"
                  :title="t('works.changeGroup')"
                  @change="changeGroup(w, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="0">{{ t("works.groupNone") }}</option>
                  <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
                <Button
                  v-if="w.is_sample"
                  size="sm"
                  :disabled="busyId === w.id"
                  @click="duplicateSample(w)"
                >
                  {{ t("works.duplicate") }}
                </Button>
                <Button v-else size="sm" variant="ghost" :disabled="busyId === w.id" @click="addEpisode(w)">
                  {{ t("works.addEpisode") }}
                </Button>
                <Button
                  v-if="!w.is_sample"
                  size="sm"
                  variant="text"
                  :disabled="busyId === w.id"
                  @click="archive(w)"
                >
                  {{ w.work_state === "archived" ? t("works.restore") : t("works.archive") }}
                </Button>
              </div>
            </div>
          </template>
        </article>
      </div>

      <div v-else class="empty-wrap">
        <EmptyState
          icon="▦"
          :title="tab === 'canvas' ? t('works.emptyCanvasTitle') : t('works.emptyWorksTitle')"
          :description="
            tab === 'canvas'
              ? t('works.emptyCanvasDesc')
              : t('works.emptyWorksDesc')
          "
        >
          <Button @click="router.push(tab === 'canvas' ? '/canvas' : '/projects')">
            {{ tab === "canvas" ? t("works.emptyCanvasCta") : t("works.emptyWorksCta") }}
          </Button>
        </EmptyState>
      </div>

      <div v-if="total > pageSize" class="pager">
        <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">{{ t("common.prevPage") }}</Button>
        <span>{{ t("common.pageNo", { page }) }}</span>
        <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">{{ t("common.nextPage") }}</Button>
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
  background: var(--tab-line);
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
/* 归属组（第 63 批）：卡片上的"分组名"行与就地换组下拉 */
.group-line {
  color: var(--text-3);
}
.group-select {
  max-width: 120px;
  font-size: var(--text-xs);
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
