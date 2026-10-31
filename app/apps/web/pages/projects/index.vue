<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

// 项目页（对齐参照产品：顶部「项目 / 已导出」+ 空状态 + 底部悬浮「创建项目」）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
// i18n（第 8 批补完）：页面骨架与剧目类型名走语言包；项目标题等是后端数据，不翻译
const { t, locale } = useI18n();
useHead({ title: () => t('projects.metaTitle') });

const api = useApi();
const router = useRouter();
const route = useRoute();

const list = ref<ProjectDto[]>([]);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const showCreate = ref(false);
const tab = ref<"projects" | "exports">("projects");

const PAGE_SIZE = 50;
/** 当前已请求到第几页（「加载更多」时递增） */
const page = ref(1);
/** 最近一页实际返回条数：小于 PAGE_SIZE 说明已到底，不再显示「加载更多」 */
const lastCount = ref(0);
const hasMore = computed(() => lastCount.value >= PAGE_SIZE && list.value.length < total.value);
/**
 * 从剪辑台「创建项目」进来会带 `redirect=reelflow`（见 reelflow/list.vue）。
 * onMounted 末尾会用 `router.replace("/projects")` 抹掉 query，所以要在那之前存下来，
 * 建项成功后据此跳回剪辑台。
 */
const redirectTo = ref("");

/** 剧目类型展示名（1 国内仿真人剧 / 2 海外仿真人剧 / 3 2D3D 动漫） */
function dramaLabel(type: number): string {
  switch (type) {
    case 1:
      return t('projects.dramaDomestic');
    case 2:
      return t('projects.dramaOverseas');
    case 3:
      return t('projects.dramaAnime');
    default:
      return t('projects.shortDrama');
  }
}
// 封面按剧目类型给不同色相，保证卡片可区分
const DRAMA_COVER: Record<number, string> = {
  1: "linear-gradient(135deg, #3a2030, #16121c)",
  2: "linear-gradient(135deg, #14303e, #0e161c)",
  3: "linear-gradient(135deg, #2f1a44, #15101f)",
};

/**
 * 拉取一页项目。
 * - reset=true：回到第 1 页重拉（首次进页）；
 * - reset=false：沿用递增后的 page 追加下一页（「加载更多」，不整页替换）。
 */
async function load(reset = true): Promise<void> {
  const appending = !reset;
  if (reset) {
    page.value = 1;
    list.value = [];
  }
  if (appending) loadingMore.value = true;
  else loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: String(page.value), page_size: String(PAGE_SIZE) });
    const data = await api.get<{ list: ProjectDto[]; total: number }>(`/projects?${q.toString()}`);
    const incoming = data.list ?? [];
    lastCount.value = incoming.length;
    total.value = data.total ?? 0;
    if (appending) {
      // 分页期间可能有新项目插到最前（按创建时间倒序），按 id 去重避免重复卡
      const seen = new Set(list.value.map((item) => item.id));
      list.value = [...list.value, ...incoming.filter((item) => !seen.has(item.id))];
    } else {
      list.value = incoming;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("errors.load");
    if (appending) {
      // 追加失败回退游标，让「加载更多」重试的是同一页
      page.value = Math.max(1, page.value - 1);
    }
  } finally {
    if (appending) loadingMore.value = false;
    else loading.value = false;
  }
}

/** 追加下一页（正在加载或已无更多时按钮本就隐藏/禁用，这里再兜一层） */
function loadMore(): void {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  page.value += 1;
  void load(false);
}

function openCreate(): void {
  showCreate.value = true;
}

function onCreated(project: ProjectDto): void {
  showCreate.value = false;
  // 从剪辑台进来建的项目：建完直接进剪辑台（空时间线）；否则落到项目工作台
  if (redirectTo.value === "reelflow") {
    void router.push(`/reelflow/edit/${project.id}`);
    return;
  }
  void router.push(`/projects/${project.id}`);
}

onMounted(async () => {
  // 必须在下面 router.replace 抹掉 query 之前取，否则 redirect=reelflow 会丢
  redirectTo.value = String(route.query.redirect ?? "");
  await load();
  // 侧栏「剧本创作」/首页入口：/projects?create=1 直接打开新建项目弹窗
  if (String(route.query.create ?? "") === "1") {
    showCreate.value = true;
    void router.replace("/projects");
  }
});
</script>

<template>
  <div class="projects-page">
    <nav class="tabs">
      <button type="button" class="tab" :class="{ active: tab === 'projects' }" @click="tab = 'projects'">
        {{ t("projects.tabProjects") }}
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'exports' }" @click="tab = 'exports'">
        {{ t("projects.tabExports") }}
      </button>
    </nav>

    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="tab === 'projects'">
      <Skeleton v-if="loading" :rows="4" />

      <div v-else-if="list.length" class="grid">
        <NuxtLink v-for="item in list" :key="item.id" :to="`/projects/${item.id}`" class="proj-card">
          <div class="cover" :style="{ background: DRAMA_COVER[item.drama_type] ?? DRAMA_COVER[1] }">
            <span class="ratio-chip">{{ item.ratio }}</span>
            <span v-if="item.is_sample" class="flag">{{ t("projects.sampleFlag") }}</span>
            <span v-else-if="item.archived_at" class="flag muted">{{ t("projects.archivedFlag") }}</span>
            <span class="cover-title">{{ item.title }}</span>
          </div>
          <div class="body">
            <p class="title" :title="item.title">{{ item.title }}</p>
            <p class="meta">
              {{ dramaLabel(item.drama_type) }}
              <span class="sep">·</span>
              {{ new Date(item.created_at).toLocaleDateString(locale) }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <div v-else class="empty">
        <span class="empty-art" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
            <path d="M12 9.5v5.5M9.5 12H14.5" opacity="0.7" />
          </svg>
        </span>
        <p class="empty-text">{{ t("projects.emptyCreate") }}</p>
        <p v-if="total === 0" class="empty-hint">{{ t("projects.emptyHint") }}</p>
      </div>

      <!-- 加载更多：本页满 50 条且未达 total 时才出现，追加而非整页替换 -->
      <div v-if="!loading && hasMore" class="more">
        <button type="button" class="more-btn" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t("common.loading") : t("common.loadMore") }}
        </button>
      </div>
    </template>

    <div v-else class="empty exports">
      <span class="empty-art small" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5" />
          <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
        </svg>
      </span>
      <p class="empty-text">{{ t("projects.exportsEmpty") }}</p>
      <p class="empty-hint">{{ t("projects.exportsHint") }}</p>
    </div>

    <div class="fab-wrap">
      <button type="button" class="fab" @click="openCreate">
        <span class="fab-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        {{ t("projects.create") }}
      </button>
    </div>

    <CreateProjectModal v-model:open="showCreate" @created="onCreated" />
  </div>
</template>

<style scoped>
.projects-page {
  position: relative;
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 0 120px;
  min-height: calc(100vh - 160px);
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  gap: 28px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: 24px;
}

.tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: #9d9d9f;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.tab.active {
  color: #ffffff;
}

/* GL9：下划线白 2px、宽=文字宽（旧值紫 var(--brand-500)） */
.tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--tab-line);
}

.err {
  padding: 10px 14px;
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

.proj-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.15s, transform 0.15s;
}

.proj-card:hover {
  border-color: var(--border-3);
  transform: translateY(-2px);
}

.cover {
  position: relative;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: flex-end;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(#ffffff14 1px, transparent 1px);
  background-size: 12px 12px;
  -webkit-mask-image: linear-gradient(160deg, transparent 30%, #000);
  mask-image: linear-gradient(160deg, transparent 30%, #000);
}

.cover-title {
  position: relative;
  z-index: 1;
  color: #ffffffd0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ratio-chip {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: #00000066;
  color: #ffffffb0;
  font-size: 11px;
}

.flag {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--brand-500);
  color: #fff;
  font-size: 11px;
}

.flag.muted {
  background: #ffffff24;
  color: #ffffffc0;
}

.body {
  padding: 10px 14px 14px;
}

.title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
}

.sep {
  color: var(--border-3);
  margin: 0 4px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 420px;
  text-align: center;
}

.empty-art {
  width: 92px;
  height: 92px;
  color: #ffffff8a;
  filter: drop-shadow(0 10px 30px #7e70ff33);
}

.empty-art.small {
  width: 64px;
  height: 64px;
}

.empty-art svg {
  width: 100%;
  height: 100%;
}

.empty-text {
  margin: 6px 0 0;
  color: var(--text-2);
  font-size: 14px;
}

.empty-hint {
  margin: 0;
  color: var(--text-4);
  font-size: 12px;
}

/* 加载更多（居中胶囊，与底部「创建项目」区分开：更矮、无投影） */
.more {
  display: flex;
  justify-content: center;
  padding: 20px 0 4px;
}

.more-btn {
  height: 38px;
  padding: 0 22px;
  border-radius: 999px;
  border: 1px solid var(--border-2);
  background: var(--panel-tint);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.more-btn:hover:not(:disabled) {
  border-color: var(--border-3);
  color: var(--text-1);
}

.more-btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.fab-wrap {
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 20;
}

.fab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 26px;
  border-radius: 999px;
  border: 1px solid #ffffff24;
  background: linear-gradient(180deg, #24242c, #19191f);
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 18px 40px #00000080;
}

.fab:hover {
  border-color: var(--brand-500);
}

.fab-icon {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  color: var(--brand-300);
}

.fab-icon svg {
  width: 100%;
  height: 100%;
}
</style>
