<script setup lang="ts">
import type { AssetDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

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

async function load(): Promise<void> {
  loading.value = true;
  try {
    const suffix = folderFilter.value ? `&folder_id=${folderFilter.value}` : "";
    const data = await api.get<{ list: AssetDto[]; total: number }>(
      `/assets?page=1&page_size=60&deleted=${showDeleted.value}${suffix}`,
    );
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

onMounted(async () => {
  await Promise.all([load(), loadFolders()]);
});
</script>

<template>
  <main class="page">
    <div class="head">
      <h1>资产库</h1>
      <div class="actions">
        <span class="muted">共 {{ total }} 个 · 图片会自动压缩到 ≤1600px</span>
        <select v-model="folderFilter" class="input" @change="load">
          <option value="">全部目录</option>
          <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
        </select>
        <Button variant="ghost" @click="createFolder">新建目录</Button>
        <Button variant="ghost" @click="switchDeleted">{{ showDeleted ? "返回资产库" : "回收站" }}</Button>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
        <Button v-if="!showDeleted" :disabled="uploading" @click="fileInput?.click()">{{ uploading ? "上传中…" : "上传图片" }}</Button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="grid">
      <article v-for="asset in list" :key="asset.id" class="card">
        <img :src="asset.url" :alt="asset.name" loading="lazy" />
        <div class="meta">
          <span class="name">{{ asset.name }}</span>
          <button v-if="showDeleted" class="mini" @click="restore(asset)">恢复</button>
          <button v-else class="mini" @click="remove(asset)">删除</button>
        </div>
      </article>
    </div>
    <p v-if="!loading && list.length === 0" class="muted">还没有图片。上传后可用于图生视频、角色参考。</p>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-raised);
}
.card img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
}
.mini {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  flex: none;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
</style>
