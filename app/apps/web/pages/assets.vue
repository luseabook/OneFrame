<script setup lang="ts">
import type { AssetDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("assets.metaTitle") });

const api = useApi();
/**
 * 三个视图共用 /assets 路由（不改 layouts/app.vue 侧栏，由 Lead 决定是否加分入口）：
 * 1. 资产：空间级资产库（原有行为，未改动）；
 * 2. 主体库：角色/场景/道具的一致性载体（subject 6 端点）；
 * 3. 抽取与匹配：项目维度的抽取流水线 + 资产×分镜匹配（extraction / asset-match 端点）。
 */
const tab = ref<"assets" | "subjects" | "quality">("assets");
// tab 文案走 i18n：computed 而不是常量，语言切换时标签跟着变
const TABS = computed(() => [
  { value: "assets" as const, label: t("assets.tabAssets") },
  { value: "subjects" as const, label: t("assets.tabSubjects") },
  { value: "quality" as const, label: t("assets.tabQuality") },
]);
const list = ref<AssetDto[]>([]);
const total = ref(0);
const loading = ref(false);
const uploading = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const showDeleted = ref(false);
const folders = ref<Array<{ id: string; name: string }>>([]);
const folderFilter = ref("");
const tagFilter = ref("");

async function load(): Promise<void> {
  loading.value = true;
  try {
    const parts = [`page=1`, `page_size=60`, `deleted=${showDeleted.value}`];
    if (folderFilter.value) parts.push(`folder_id=${folderFilter.value}`);
    if (tagFilter.value) parts.push(`tag=${encodeURIComponent(tagFilter.value)}`);
    const data = await api.get<{ list: AssetDto[]; total: number }>(`/assets?${parts.join("&")}`);
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("assets.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function compress(file: File): Promise<{ data_base64: string; content_type: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("compress failed");
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return { data_base64: dataUrl.split(",")[1] ?? "", content_type: "image/jpeg" };
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    const { data_base64, content_type } = await compress(file);
    await api.post("/assets/upload", { filename: file.name.slice(0, 200), content_type, data_base64 });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("assets.uploadFailed");
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

async function restore(asset: AssetDto): Promise<void> {
  try {
    await api.post(`/assets/${asset.id}/restore`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("assets.restoreFailed");
  }
}

async function switchDeleted(): Promise<void> {
  showDeleted.value = !showDeleted.value;
  await load();
}

async function remove(asset: AssetDto): Promise<void> {
  if (!confirm(t("assets.deleteConfirm", { name: asset.name }))) return;
  try {
    await api.delete(`/assets/${asset.id}`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("assets.deleteFailed");
  }
}

async function loadFolders(): Promise<void> {
  try {
    folders.value = await api.get<Array<{ id: string; name: string }>>("/asset-folders");
  } catch {
    folders.value = [];
  }
}

async function createFolder(): Promise<void> {
  const name = prompt(t("assets.newFolderPrompt"));
  if (!name) return;
  try {
    await api.post("/asset-folders", { name });
    await loadFolders();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("assets.folderFailed");
  }
}

function applyTag(tag: string): void {
  tagFilter.value = tagFilter.value === tag ? "" : tag;
  void load();
}

onMounted(async () => {
  await Promise.all([load(), loadFolders()]);
});
</script>

<template>
  <div class="assets">
    <header class="head">
      <div class="head-main">
        <h1>{{ tab === "assets" ? (showDeleted ? t("assets.titleRecycle") : t("assets.titleAssets")) : tab === "subjects" ? t("assets.tabSubjects") : t("assets.tabQuality") }}</h1>
        <p class="sub">
          {{
            tab === "assets"
              ? t("assets.subAssets", { total })
              : tab === "subjects"
                ? t("assets.subSubjects")
                : t("assets.subQuality")
          }}
        </p>
      </div>
      <div v-if="tab === 'assets'" class="head-actions">
        <Button variant="ghost" size="sm" @click="switchDeleted">
          {{ showDeleted ? t("assets.backToAssets") : t("assets.recycleBin") }}
        </Button>
        <Button variant="ghost" size="sm" @click="createFolder">{{ t("assets.newFolder") }}</Button>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
        <Button v-if="!showDeleted" size="sm" :disabled="uploading" @click="fileInput?.click()">
          {{ uploading ? t("assets.uploading") : t("assets.uploadImage") }}
        </Button>
      </div>
    </header>

    <!-- 视图切换：资产 / 主体库 / 抽取与匹配 -->
    <nav class="tabs" role="tablist">
      <button
        v-for="item in TABS"
        :key="item.value"
        class="tab"
        :class="{ on: tab === item.value }"
        role="tab"
        :aria-selected="tab === item.value"
        @click="tab = item.value"
      >
        {{ item.label }}
      </button>
    </nav>

    <SubjectLibrary v-if="tab === 'subjects'" />
    <ProjectQualityPanel v-else-if="tab === 'quality'" />

    <template v-else>
    <!-- 过滤条 -->
    <div class="filters">
      <select v-model="folderFilter" class="mini-select" @change="load">
        <option value="">{{ t("assets.allFolders") }}</option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
      </select>
      <button
        v-if="tagFilter"
        class="tag-chip on"
        @click="applyTag(tagFilter)"
      >
        {{ tagFilter }} ✕
      </button>
      <span v-else class="hint">{{ t("assets.filterHint") }}</span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" />

    <template v-else>
      <div v-if="list.length" class="grid">
        <article v-for="asset in list" :key="asset.id" class="asset-card">
          <div class="thumb">
            <img :src="asset.url" :alt="asset.name" loading="lazy" />
          </div>
          <div class="body">
            <p class="name" :title="asset.name">{{ asset.name }}</p>
            <div class="tags">
              <button
                v-for="tag in asset.tags ?? []"
                :key="tag"
                class="tag-chip"
                @click="applyTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
            <div class="ops">
              <Button v-if="showDeleted" size="sm" variant="ghost" @click="restore(asset)">{{ t("assets.restore") }}</Button>
              <Button v-else size="sm" variant="text" @click="remove(asset)">{{ t("assets.delete") }}</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="empty-wrap">
        <EmptyState
          :icon="showDeleted ? '♻' : '▣'"
          :title="showDeleted ? t('assets.emptyRecycleTitle') : t('assets.emptyAssetsTitle')"
          :description="
            showDeleted ? t('assets.emptyRecycleDesc') : t('assets.emptyAssetsDesc')
          "
        >
          <Button v-if="!showDeleted" :disabled="uploading" @click="fileInput?.click()">{{ t("assets.uploadImage") }}</Button>
        </EmptyState>
      </div>
    </template>
    </template>
  </div>
</template>

<style scoped>
/* 页内容容器：与 home/tools 同一套 padding 节奏，最大宽度对齐 projects/index.vue */
.assets {
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

/* 视图切换（资产 / 主体库 / 抽取与匹配）：下划线式 tab，不改侧栏结构 */
.tabs {
  display: flex;
  gap: var(--space-5);
  border-bottom: 1px solid var(--border-1);
  margin-bottom: var(--space-4);
}
.tab {
  position: relative;
  padding: 8px 0 10px;
  border: none;
  background: none;
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--text-1);
}
.tab.on {
  color: var(--text-1);
  font-weight: 600;
}
.tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--brand-500);
  border-radius: var(--radius-full);
}

.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  min-height: 28px;
}
.mini-select {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.mini-select:focus {
  border-color: var(--brand-500);
}
.hint {
  color: var(--text-4);
  font-size: var(--text-xs);
}
/* 品牌软底：深色主题下用品牌 alpha 叠加，不用 --brand-50/100/200 亮色实体（否则白块） */
.tag-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  font-size: 11px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}
.tag-chip:hover {
  background: var(--brand-soft-strong);
  border-color: var(--brand-500);
}
.tag-chip.on {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
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
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--space-4);
}
/* 卡片范式 C：实底面板 + 1px 白 8% 边框 + 16 圆角，hover 只提亮边框，不加投影光晕 */
.asset-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color var(--duration-base) var(--ease-out);
}
.asset-card:hover {
  border-color: var(--border-3);
}
.thumb {
  aspect-ratio: 4 / 3;
  background: var(--bg-sunken);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-slow) var(--ease-out);
}
.asset-card:hover .thumb img {
  transform: scale(1.04);
}
.body {
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.name {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: var(--space-2);
  min-height: 22px;
}
.ops {
  display: flex;
  justify-content: flex-end;
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
  .assets {
    padding: 24px;
  }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}
@media (max-width: 768px) {
  .assets {
    padding: 16px;
  }
  .head {
    flex-direction: column;
    gap: var(--space-3);
  }
  .head-actions {
    flex-wrap: wrap;
  }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  }
}
</style>
