<script setup lang="ts">
import type { MarketConfigDto, MarketScriptListDto, MarketWorkDto } from "~/types/api";

/**
 * 剧本集市（`/novel-market`）—— 对照竞品 `/novel-market`（`routes.txt:62`）与
 * `df/novel_market/scripts` 列表端点（`routes.txt:614`）。
 *
 * 三件事在这里体现：
 * 1. **只列能买到的**：后端默认只返回 `3 在售` / `6 预售中`（草稿/待审/驳回/下架不出现），
 *    所以列表不需要前端再过滤状态。
 * 2. **抽成比例由后端下发**（`config.commission_bps`）：卡片上"作者得多少"直接按它算，
 *    前端不写死 20%，运营拍板改常量后页面自动跟随。
 * 3. **分类/标签筛选是真筛选**：命中集合在后端由 taxonomy 存储求交，前端不做事后过滤。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t } = useI18n();
const api = useApi();
const toast = useToast();

const loading = ref(true);
const errorMsg = ref("");
const list = ref<MarketWorkDto[]>([]);
const total = ref(0);
const config = ref<MarketConfigDto | null>(null);

const keyword = ref("");
const categoryId = ref("");
const selectedTagIds = ref<string[]>([]);
const page = ref(1);
const pageSize = 12;

async function loadConfig() {
  config.value = await api.get<MarketConfigDto>("/market/scripts/config");
}

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const params = new URLSearchParams();
    params.set("page", String(page.value));
    params.set("page_size", String(pageSize));
    if (keyword.value.trim()) params.set("keyword", keyword.value.trim());
    if (categoryId.value) params.set("category_id", categoryId.value);
    if (selectedTagIds.value.length > 0) params.set("tag_ids", selectedTagIds.value.join(","));
    const res = await api.get<MarketScriptListDto>(`/market/scripts?${params.toString()}`);
    list.value = res.list;
    total.value = res.total;
  } catch (e) {
    errorMsg.value = (e as Error).message || t("market.loadFailed");
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function toggleTag(id: string) {
  const idx = selectedTagIds.value.indexOf(id);
  if (idx >= 0) selectedTagIds.value.splice(idx, 1);
  else selectedTagIds.value.push(id);
}

function resetFilters() {
  keyword.value = "";
  categoryId.value = "";
  selectedTagIds.value = [];
  page.value = 1;
  void load();
}

function applyFilters() {
  page.value = 1;
  void load();
}

function changePage(next: number) {
  if (next < 1) return;
  page.value = next;
  void load();
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

/** 作者实收（按后端下发的抽成比例算，前端不写死） */
function creatorRevenue(price: number): number {
  const bps = config.value?.commission_bps ?? 0;
  return price - Math.floor((price * bps) / 10000);
}

function commissionText(): string {
  const bps = config.value?.commission_bps;
  return bps === undefined ? "—" : `${bps / 100}%`;
}

async function copyShareLink(work: MarketWorkDto) {
  const url = `${window.location.origin}/novel-market/${work.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success(t("market.copied"));
  } catch {
    toast.error(t("market.copyFailed"));
  }
}

onMounted(async () => {
  try {
    await loadConfig();
    await load();
  } catch (e) {
    errorMsg.value = (e as Error).message || t("market.configFailed");
    loading.value = false;
  }
});
</script>

<template>
  <div class="mk-page">
    <header class="mk-head">
      <div>
        <h1 class="mk-title">{{ t("market.title") }}</h1>
        <p class="mk-sub">{{ t("market.sub", { rate: commissionText() }) }}</p>
      </div>
      <div class="mk-head-actions">
        <button type="button" class="mk-btn" :disabled="loading" @click="load">{{ t("market.refresh") }}</button>
        <NuxtLink to="/novel-market/manage" class="mk-btn mk-btn-primary">{{ t("market.publishMine") }}</NuxtLink>
      </div>
    </header>

    <section class="mk-filters">
      <input
        v-model="keyword"
        class="mk-input"
        type="search"
        :placeholder="t('market.searchPlaceholder')"
        @keyup.enter="applyFilters"
      >
      <select v-model="categoryId" class="mk-input mk-select" @change="applyFilters">
        <option value="">{{ t("market.allCategories") }}</option>
        <option v-for="c in config?.categories ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <button type="button" class="mk-btn" @click="applyFilters">{{ t("market.search") }}</button>
      <button type="button" class="mk-btn mk-btn-ghost" @click="resetFilters">{{ t("market.reset") }}</button>
    </section>

    <section v-if="(config?.tags ?? []).length > 0" class="mk-tags">
      <span class="mk-tags-label">{{ t("market.tags") }}</span>
      <button
        v-for="tag in config?.tags ?? []"
        :key="tag.id"
        type="button"
        class="mk-tag"
        :class="{ 'mk-tag-active': selectedTagIds.includes(tag.id) }"
        @click="toggleTag(tag.id); applyFilters()"
      >
        {{ tag.name }}
      </button>
    </section>

    <!-- 加载态 -->
    <p v-if="loading" class="mk-state">{{ t("market.loading") }}</p>

    <!-- 错误态：给出可执行的下一步，不留白屏 -->
    <div v-else-if="errorMsg" class="mk-state mk-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="mk-btn" @click="load">{{ t("common.retry") }}</button>
    </div>

    <!-- 空态 -->
    <p v-else-if="list.length === 0" class="mk-state">
      {{ t("market.emptyPrefix") }}
      <NuxtLink to="/novel-market/manage" class="mk-link">{{ t("market.emptyCta") }}</NuxtLink>。
    </p>

    <ul v-else class="mk-grid">
      <li v-for="work in list" :key="work.id" class="mk-card">
        <NuxtLink :to="`/novel-market/${work.id}`" class="mk-card-link">
          <div class="mk-cover">
            <img v-if="work.cover_uri" :src="work.cover_uri" :alt="work.title" class="mk-cover-img">
            <span v-else class="mk-cover-ph">{{ work.kind_name }}</span>
            <span class="mk-badge" :class="work.status === 6 ? 'mk-badge-presale' : 'mk-badge-onsale'">
              {{ work.status_name }}
            </span>
          </div>
          <h2 class="mk-card-title">{{ work.title }}</h2>
          <p class="mk-card-summary">{{ work.summary || t("market.noSummary") }}</p>
          <p class="mk-card-meta">
            <span class="mk-price">{{ t("market.priceCredits", { credits: work.price_credits.toLocaleString() }) }}</span>
            <span v-if="work.preorder_price_credits !== null" class="mk-presale">
              {{ t("market.deposit", { credits: work.preorder_price_credits.toLocaleString() }) }}
            </span>
            <span class="mk-sales">{{ t("market.sold", { count: work.sales_count }) }}</span>
          </p>
          <p class="mk-card-author">
            {{ work.author?.nickname || t("market.anonymous") }} · {{ t("market.authorRevenue", { credits: creatorRevenue(work.price_credits).toLocaleString() }) }}
          </p>
        </NuxtLink>
        <button type="button" class="mk-copy" @click="copyShareLink(work)">{{ t("market.copyLink") }}</button>
      </li>
    </ul>

    <footer v-if="!loading && !errorMsg && total > pageSize" class="mk-pager">
      <button type="button" class="mk-btn" :disabled="page <= 1" @click="changePage(page - 1)">{{ t("market.prev") }}</button>
      <span class="mk-pager-info">{{ t("market.pagerInfo", { page, pages: totalPages, total }) }}</span>
      <button type="button" class="mk-btn" :disabled="page >= totalPages" @click="changePage(page + 1)">{{ t("market.next") }}</button>
    </footer>
  </div>
</template>

<style scoped>
.mk-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  color: var(--text-2);
}
.mk-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.mk-title {
  margin: 0;
  font-size: 20px;
  color: var(--text-1);
}
.mk-sub {
  margin: var(--space-1) 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.mk-head-actions {
  display: flex;
  gap: var(--space-2);
}
.mk-btn {
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.mk-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mk-btn-primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: var(--text-1);
}
.mk-btn-ghost {
  background: transparent;
}
.mk-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.mk-input {
  background: var(--bg-sunken);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 12px;
  min-width: 220px;
}
.mk-select {
  min-width: 150px;
}
.mk-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.mk-tags-label {
  font-size: 12px;
  color: var(--text-3);
}
.mk-tag {
  background: transparent;
  border: 1px solid var(--border-2);
  color: var(--text-2);
  border-radius: var(--radius-full);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.mk-tag-active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.mk-state {
  padding: var(--space-8);
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
}
.mk-state-error {
  color: var(--danger);
  border-color: var(--danger);
}
.mk-link {
  color: var(--brand-on-soft);
}
.mk-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}
.mk-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
}
.mk-card:hover {
  border-color: var(--border-3);
}
.mk-card-link {
  display: block;
  padding: var(--space-3);
  text-decoration: none;
  color: inherit;
}
.mk-cover {
  position: relative;
  height: 118px;
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin-bottom: var(--space-3);
}
.mk-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mk-cover-ph {
  color: var(--text-4);
  font-size: 13px;
}
.mk-badge {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.mk-badge-onsale {
  background: var(--success-bg);
  color: var(--success);
}
.mk-badge-presale {
  background: var(--warning-bg);
  color: var(--warning);
}
.mk-card-title {
  margin: 0 0 var(--space-1);
  font-size: 15px;
  color: var(--text-1);
}
.mk-card-summary {
  margin: 0 0 var(--space-2);
  font-size: 12px;
  color: var(--text-3);
  min-height: 34px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mk-card-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
.mk-price {
  color: var(--brand-on-soft);
  font-weight: 600;
}
.mk-presale {
  color: var(--warning);
}
.mk-sales {
  color: var(--text-4);
  margin-left: auto;
}
.mk-card-author {
  margin: var(--space-1) 0 0;
  font-size: 12px;
  color: var(--text-4);
}
.mk-copy {
  position: absolute;
  right: var(--space-2);
  bottom: var(--space-2);
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-3);
  font-size: 11px;
  border-radius: var(--radius-md);
  padding: 3px 8px;
  cursor: pointer;
}
.mk-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}
.mk-pager-info {
  font-size: 12px;
  color: var(--text-3);
}
</style>
