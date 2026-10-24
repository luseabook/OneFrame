<script setup lang="ts">
import type { WorkDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "我的作品 · 一帧" });

const api = useApi();
const toast = useToast();
const router = useRouter();

const list = ref<WorkDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 24;
const filter = ref<"all" | "producing" | "ready" | "archived">("all");
const loading = ref(true);
const error = ref("");
const busyId = ref("");

const STATE_META: Record<string, { label: string; tone: "neutral" | "brand" | "info" | "success" | "warning" }> = {
  draft: { label: "草稿", tone: "neutral" },
  producing: { label: "制作中", tone: "brand" },
  ready: { label: "已成片", tone: "success" },
  archived: { label: "已归档", tone: "info" },
};

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
    if (filter.value === "archived") q.set("status", "archived");
    const data = await api.get<{ list: WorkDto[]; total: number }>(`/works?${q.toString()}`);
    // 前端再按状态细分（后端只区分归档/非归档）
    list.value =
      filter.value === "all" || filter.value === "archived"
        ? data.list
        : data.list.filter((w) => w.work_state === filter.value);
    total.value = data.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
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

const tabs = [
  { key: "all" as const, label: "全部" },
  { key: "producing" as const, label: "制作中" },
  { key: "ready" as const, label: "已成片" },
  { key: "archived" as const, label: "已归档" },
];

function switchFilter(key: typeof filter.value): void {
  filter.value = key;
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<template>
  <div class="works">
    <header class="head">
      <div>
        <h1>我的作品</h1>
        <p class="sub">以「剧」为单位查看成果；制作明细在任务中心。</p>
      </div>
      <Button @click="router.push('/projects')">+ 新建作品</Button>
    </header>

    <nav class="filter">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="f-tab"
        :class="{ on: filter === t.key }"
        @click="switchFilter(t.key)"
      >
        {{ t.label }}
      </button>
      <span class="total">共 {{ total }} 部</span>
    </nav>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" avatar />

    <template v-else>
      <div v-if="list.length" class="grid">
        <article v-for="w in list" :key="w.id" class="work-card">
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
        </article>
      </div>

      <EmptyState
        v-else
        icon="▦"
        title="还没有作品"
        description="从一句话或一段小说开始，AI 帮你拆成 3~6 集并生成分镜，一集可出片。"
      >
        <Button @click="router.push('/projects')">新建第一部作品</Button>
      </EmptyState>

      <div v-if="total > pageSize" class="pager">
        <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
        <span>第 {{ page }} 页</span>
        <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.works {
  max-width: 1360px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-5);
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
}
.sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.filter {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-1);
  padding-bottom: var(--space-2);
}
.f-tab {
  background: none;
  border: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.f-tab:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.f-tab.on {
  background: var(--brand-50);
  color: var(--brand-700);
  font-weight: 600;
}
.total {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
}

.err {
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
.work-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.work-card:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
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
  color: var(--brand-600);
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
  margin-top: var(--space-6);
  color: var(--text-3);
  font-size: var(--text-sm);
}
</style>
