<script setup lang="ts">
import type { AssetDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "资产库 · 一帧" });

const api = useApi();
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
    error.value = e instanceof Error ? e.message : "加载失败";
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
    error.value = e instanceof Error ? e.message : "上传失败";
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
    error.value = e instanceof Error ? e.message : "恢复失败";
  }
}

async function switchDeleted(): Promise<void> {
  showDeleted.value = !showDeleted.value;
  await load();
}

async function remove(asset: AssetDto): Promise<void> {
  if (!confirm(`删除资产 ${asset.name}？`)) return;
  try {
    await api.delete(`/assets/${asset.id}`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除失败";
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
  const name = prompt("新目录名称");
  if (!name) return;
  try {
    await api.post("/asset-folders", { name });
    await loadFolders();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建目录失败";
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
      <div>
        <h1>{{ showDeleted ? "回收站" : "资产库" }}</h1>
        <p class="sub">
          共 {{ total }} 个 · 上传图片自动压缩到 ≤1600px；删除后保留 7 天可恢复。
        </p>
      </div>
      <div class="actions">
        <Button variant="ghost" size="sm" @click="switchDeleted">
          {{ showDeleted ? "返回资产库" : "回收站" }}
        </Button>
        <Button variant="ghost" size="sm" @click="createFolder">新建目录</Button>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
        <Button v-if="!showDeleted" size="sm" :disabled="uploading" @click="fileInput?.click()">
          {{ uploading ? "上传中…" : "上传图片" }}
        </Button>
      </div>
    </header>

    <!-- 过滤条 -->
    <div class="filters">
      <select v-model="folderFilter" class="mini-select" @change="load">
        <option value="">全部目录</option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
      </select>
      <button
        v-if="tagFilter"
        class="tag-chip on"
        @click="applyTag(tagFilter)"
      >
        {{ tagFilter }} ✕
      </button>
      <span v-else class="hint">点资产卡片上的标签可快速筛选</span>
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
              <Button v-if="showDeleted" size="sm" variant="ghost" @click="restore(asset)">恢复</Button>
              <Button v-else size="sm" variant="text" @click="remove(asset)">删除</Button>
            </div>
          </div>
        </article>
      </div>

      <EmptyState
        v-else
        :icon="showDeleted ? '♻' : '▣'"
        :title="showDeleted ? '回收站是空的' : '还没有资产'"
        :description="
          showDeleted
            ? '删除的资产会保留 7 天，期间可从这里恢复。'
            : '上传参考图，或从任务结果转存；角色定妆图转存后可在任意项目复用。'
        "
      >
        <Button v-if="!showDeleted" :disabled="uploading" @click="fileInput?.click()">上传图片</Button>
      </EmptyState>
    </template>
  </div>
</template>

<style scoped>
.assets {
  max-width: 1360px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
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
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
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
.tag-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--brand-200);
  background: var(--brand-50);
  color: var(--brand-700);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.tag-chip:hover {
  background: var(--brand-100);
}
.tag-chip.on {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
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
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--space-3);
}
.asset-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}
.asset-card:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
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
</style>
