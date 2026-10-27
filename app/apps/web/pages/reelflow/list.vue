<script setup lang="ts">
import type { WorkDto } from "~/types/api";

/**
 * ReelFlow 剪辑台 · 项目列表（对齐竞品 /reelflow/list）
 *
 * 竞品实测（docs/03-frontend/reference-reelflow-spec.md §4.1 FLOW:66-76）：
 *   无侧栏、无大标题；顶部仅一行 tab：`项目 (N)`（激活：白字 + 2px 紫下划线）/ `已导出`，
 *   位于左上；空态居中插画 + `点击下方创建一个新项目` + 底部居中悬浮胶囊 `创建项目`；
 *   有数据时按日分组（`今天` 14px `--text-3`），卡片约 330×250（缩略图区 + 标题 + 最后编辑于 + ⋮）。
 *
 * 数据源用 /works 而不是 /projects：剪辑台关心的是「这部剧能不能剪」，
 * /works 已经带 episode_count / shot_count / done_count / 封面 + 本次新增的
 * timeline_duration_s / timeline_episode_count，一张请求就能把卡片填满。
 *
 * 为什么不用「⋯」更多菜单做假按钮：竞品那套（重命名/删除）我们后端已有
 * PATCH/DELETE /projects/:id，但列表页删除属于破坏性操作且与剪辑无关，
 * 这里只保留「继续剪辑 / 去分镜创作」两个真实去向，不放点了没反应的菜单。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });
const { t, locale } = useI18n();
useHead({ title: () => t("reelflow.metaTitle") });

const api = useApi();
const router = useRouter();

const list = ref<WorkDto[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref("");
const tab = ref<"projects" | "exported">("projects");

const PAGE_SIZE = 48;

// ── 封面配色（按剧目类型给不同色相，保证卡片可区分；与 /projects 一致）──
const COVER: Record<number, string> = {
  1: "linear-gradient(135deg, #3a2030, #16121c)",
  2: "linear-gradient(135deg, #14303e, #0e161c)",
  3: "linear-gradient(135deg, #2f1a44, #15101f)",
};

// 剧型文案复用 `home.dramaType.*`（同一套枚举，避免再造一份同义翻译）
const dramaKeys: Record<number, string> = { 1: "domestic", 2: "overseas", 3: "anime" };
const dramaLabel = (type: number): string =>
  dramaKeys[type] ? t(`home.dramaType.${dramaKeys[type]}`) : t("reelflow.dramaFallback");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({ page: "1", page_size: String(PAGE_SIZE) });
    const data = await api.get<{ list: WorkDto[]; total: number }>(`/works?${q.toString()}`);
    list.value = data.list ?? [];
    total.value = data.total ?? 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("reelflow.loadFailed");
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

// ── 按日分组（今天 / 昨天 / 更早）──────────────────────────
function dayKey(iso: string | undefined): string {
  if (!iso) return t("reelflow.earlier");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("reelflow.earlier");
  const now = new Date();
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return t("reelflow.today");
  if (diffDays === 1) return t("reelflow.yesterday");
  if (diffDays <= 7) return t("reelflow.last7");
  return t("reelflow.earlier");
}

interface Group {
  label: string;
  items: WorkDto[];
}

const groups = computed<Group[]>(() => {
  const order = [t("reelflow.today"), t("reelflow.yesterday"), t("reelflow.last7"), t("reelflow.earlier")];
  const buckets = new Map<string, WorkDto[]>();
  for (const item of list.value) {
    const key = dayKey(item.updated_at ?? item.created_at);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  return order
    .filter((label) => (buckets.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, items: buckets.get(label) ?? [] }));
});

/** 「已导出」tab：只留已经剪过并且成片过的（有时间线时长 > 0），按长度倒序 */
const exported = computed(() =>
  [...list.value]
    .filter((w) => (w.timeline_duration_s ?? 0) > 0)
    .sort((a, b) => (b.timeline_duration_s ?? 0) - (a.timeline_duration_s ?? 0)),
);

function fmtEdited(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 秒 → 00:00（超过 1 小时给 00:00:00） */
function fmtDuration(seconds: number | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function createProject(): Promise<void> {
  // 竞品「创建项目」直接进空编辑器；我们复用已有的建项弹窗（在 /projects），
  // 建完跳到剪辑台——这样不用在剪辑台里再实现一份建项表单。
  await router.push("/projects?create=1");
}

function openEditor(item: WorkDto): void {
  void router.push(`/reelflow/edit/${item.id}`);
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="rl">
    <!-- 顶栏：只做返回 + 品牌名（竞品此页无顶栏，但我们从工作台进来需要一个出口） -->
    <header class="rl-top">
      <NuxtLink to="/home" class="rl-back" :title="t('reelflow.backHomeTitle')">{{ t("reelflow.backHome") }}</NuxtLink>
      <span class="rl-brand">{{ t("reelflow.brand") }}</span>
      <span class="rl-spacer" />
      <NuxtLink to="/projects" class="rl-link">{{ t("reelflow.allProjects") }}</NuxtLink>
    </header>

    <!-- tab 行：项目 (N) / 已导出（竞品左上角，白字 + 2px 紫下划线） -->
    <nav class="rl-tabs">
      <button type="button" class="rl-tab" :class="{ active: tab === 'projects' }" @click="tab = 'projects'">
        {{ t("reelflow.tabProjects", { count: total }) }}
      </button>
      <button type="button" class="rl-tab" :class="{ active: tab === 'exported' }" @click="tab = 'exported'">
        {{ t("reelflow.tabExported") }}
      </button>
    </nav>

    <p v-if="error" class="rl-err">{{ error }}</p>

    <div class="rl-scroll">
      <Skeleton v-if="loading" :rows="4" />

      <!-- 项目 tab -->
      <template v-else-if="tab === 'projects'">
        <section v-for="group in groups" :key="group.label" class="rl-group">
          <p class="rl-group__label">{{ group.label }}</p>
          <div class="rl-grid">
            <article
              v-for="item in group.items"
              :key="item.id"
              class="rl-card"
              :data-project-id="item.id"
              :role="'button'"
              tabindex="0"
              @click="openEditor(item)"
              @keydown.enter="openEditor(item)"
            >
              <div class="rl-cover" :style="{ background: COVER[item.drama_type] ?? COVER[1] }">
                <img v-if="item.cover_uri" :src="item.cover_uri" alt="" class="rl-cover__img" />
                <span class="rl-cover__play" aria-hidden="true">▶</span>
                <span class="rl-cover__ratio">{{ item.ratio }}</span>
                <span v-if="item.is_sample" class="rl-cover__flag">{{ t("reelflow.sample") }}</span>
              </div>
              <div class="rl-card__body">
                <p class="rl-card__title" :title="item.title">{{ item.title }}</p>
                <p class="rl-card__meta">
                  <span>{{ dramaLabel(item.drama_type) }}</span>
                  <span class="rl-dot">·</span>
                  <span>{{ t("reelflow.episodes", { count: item.episode_count }) }}</span>
                  <span class="rl-dot">·</span>
                  <span>{{ fmtDuration(item.timeline_duration_s) }}</span>
                </p>
                <p class="rl-card__edited">{{ t("reelflow.editedAt", { time: fmtEdited(item.updated_at ?? item.created_at) }) }}</p>
                <div class="rl-card__foot">
                  <span class="rl-badge" :class="item.work_state">
                    {{
                      item.work_state === "ready"
                        ? t("reelflow.stateReady")
                        : item.work_state === "producing"
                          ? t("reelflow.stateProducing")
                          : item.work_state === "archived"
                            ? t("reelflow.stateArchived")
                            : t("reelflow.stateDraft")
                    }}
                  </span>
                  <span class="rl-card__shots">{{ t("reelflow.shots", { done: item.done_count, total: item.shot_count }) }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <!-- 空态：居中插画 + 文案 + 底部悬浮胶囊（竞品同款） -->
        <div v-if="!groups.length" class="rl-empty">
          <span class="rl-empty__art" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
              <path d="M7 9.5v5M12 9.5v5M17 9.5v5" opacity="0.5" />
            </svg>
          </span>
          <p class="rl-empty__text">{{ t("reelflow.emptyCreate") }}</p>
          <p class="rl-empty__hint">{{ t("reelflow.emptyHint") }}</p>
        </div>
      </template>

      <!-- 已导出 tab -->
      <template v-else>
        <div v-if="exported.length" class="rl-grid">
          <article
            v-for="item in exported"
            :key="item.id"
            class="rl-card"
            :data-project-id="item.id"
            role="button"
            tabindex="0"
            @click="openEditor(item)"
            @keydown.enter="openEditor(item)"
          >
            <div class="rl-cover" :style="{ background: COVER[item.drama_type] ?? COVER[1] }">
              <img v-if="item.cover_uri" :src="item.cover_uri" alt="" class="rl-cover__img" />
              <span class="rl-cover__play" aria-hidden="true">▶</span>
              <span class="rl-cover__ratio">{{ fmtDuration(item.timeline_duration_s) }}</span>
            </div>
            <div class="rl-card__body">
              <p class="rl-card__title" :title="item.title">{{ item.title }}</p>
              <p class="rl-card__meta">
                <span>{{ t("reelflow.clippedEpisodes", { count: item.timeline_episode_count ?? 0 }) }}</span>
                <span class="rl-dot">·</span>
                <span>{{ t("reelflow.finalDuration", { duration: fmtDuration(item.timeline_duration_s) }) }}</span>
              </p>
              <p class="rl-card__edited">{{ t("reelflow.editedAt", { time: fmtEdited(item.updated_at ?? item.created_at) }) }}</p>
            </div>
          </article>
        </div>
        <div v-else class="rl-empty">
          <span class="rl-empty__art" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5" />
              <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
            </svg>
          </span>
          <p class="rl-empty__text">{{ t("reelflow.exportedEmptyTitle") }}</p>
          <p class="rl-empty__hint">{{ t("reelflow.exportedEmptyHint") }}</p>
        </div>
      </template>
    </div>

    <!-- 底部居中悬浮胶囊「创建项目」（竞品约 236×68 全圆） -->
    <div class="rl-fab-wrap">
      <button type="button" class="rl-fab" @click="createProject">
        <span class="rl-fab__icon" aria-hidden="true">＋</span>
        {{ t("reelflow.createProject") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rl {
  position: relative;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  overflow: hidden;
}

/* 顶栏（轻量：竞品此页无顶栏，这里只保留返回出口） */
.rl-top {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 24px;
}
.rl-back {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--panel-tint);
  color: var(--text-2);
  font-size: 13px;
}
.rl-back:hover {
  color: var(--text-1);
  background: var(--panel-tint-strong);
}
.rl-brand {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}
.rl-spacer {
  flex: 1;
}
.rl-link {
  font-size: 13px;
  color: var(--text-3);
}
.rl-link:hover {
  color: var(--text-1);
}

/* tab：激活 = 白字 + 2px 紫下划线 */
.rl-tabs {
  display: flex;
  gap: 28px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}
.rl-tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.rl-tab.active {
  color: var(--text-1);
}
.rl-tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}

.rl-err {
  margin: 12px 24px 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
}

.rl-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 120px;
}

.rl-group {
  margin-bottom: 24px;
}
.rl-group__label {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--text-3);
}

/* 卡片 ~330 宽（竞品实测），自适应铺开 */
.rl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 330px));
  gap: 24px;
}

.rl-card {
  border-radius: 16px;
  border: 1px solid #ffffff12;
  background: var(--panel-tint);
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    transform var(--duration-fast);
}
.rl-card:hover {
  border-color: var(--border-3);
  transform: translateY(-2px);
}

/* 缩略图区 ~310×140 */
.rl-cover {
  position: relative;
  aspect-ratio: 16 / 7.2;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.rl-cover__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rl-cover__play {
  position: relative;
  z-index: 1;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #00000070;
  color: #ffffffcc;
  font-size: 14px;
  backdrop-filter: blur(2px);
}
.rl-cover__ratio {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: #00000080;
  color: #ffffffc0;
  font-size: 11px;
}
.rl-cover__flag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--brand-500);
  color: #fff;
  font-size: 11px;
}

.rl-card__body {
  padding: 10px 14px 14px;
}
.rl-card__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rl-card__meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.rl-dot {
  color: var(--border-3);
}
.rl-card__edited {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-4);
}
.rl-card__foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rl-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--bg-sunken);
  color: var(--text-3);
  border: 1px solid var(--border-1);
}
.rl-badge.ready {
  background: var(--success-bg);
  color: var(--success);
  border-color: #1d5c3c;
}
.rl-badge.producing {
  background: var(--brand-soft);
  color: var(--brand-300);
  border-color: var(--brand-border);
}
.rl-card__shots {
  font-size: 11px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}

/* 空态 */
.rl-empty {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}
.rl-empty__art {
  width: 84px;
  height: 84px;
  color: #ffffff8a;
  filter: drop-shadow(0 10px 30px #7e70ff33);
}
.rl-empty__art svg {
  width: 100%;
  height: 100%;
}
.rl-empty__text {
  margin: 4px 0 0;
  color: var(--text-2);
  font-size: 14px;
}
.rl-empty__hint {
  margin: 0;
  color: var(--text-4);
  font-size: 12px;
}

/* 悬浮胶囊 */
.rl-fab-wrap {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 20;
}
.rl-fab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 28px;
  border-radius: 999px;
  border: 1px solid #ffffff24;
  background: linear-gradient(180deg, #24242c, #19191f);
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 18px 40px #00000080;
}
.rl-fab:hover {
  border-color: var(--brand-500);
}
.rl-fab__icon {
  color: var(--brand-300);
  font-size: 16px;
}
</style>
