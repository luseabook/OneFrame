<script setup lang="ts">
import type { AssetDto, ProjectAssetDto, ProjectDto } from "~/types/api";

/**
 * 参考视频资源库（竞品 `/refer-video`，第 136 批，按逆向证据对齐）。
 *
 * 逆向事实（2026-11-04 实时抓取）：
 * - `/refer-video` 与 `/implement` 复用同一列表组件 `mRxBn2Ja.js`，仅 `resource-type` 不同：
 *   `referenceVideo = 4` / `implement = 3`（`Duf00Fwb.js` 枚举）；
 * - 列表接口 `GET /web/v1/df/resources/list`，参数
 *   `sp_id / page / page_size / resource_type / status / sort_field / sort_direction / is_subject / name`。
 *
 * 本页因此按“项目 + resource_type=4”取资源：后端 `project_assets.resource_type` 为生成列
 * （kind → 1/2/3/4/5/8），新端点 `/df/resources/list` 与 `/df/resources/add` 与竞品同形状。
 * 上传流程：文件 → `POST /assets/upload` 落到存储 → `POST /df/resources/add` 建参考视频资源。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("referVideo.metaTitle") });

const api = useApi();
const route = useRoute();
const toast = useToast();

const projects = ref<ProjectDto[]>([]);
const selectedProjectId = ref(String(route.query.project ?? ""));
const assets = ref<ProjectAssetDto[]>([]);
const loading = ref(true);
const loadingAssets = ref(false);
const uploading = ref(false);
const busyId = ref("");
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const MAX_VIDEO_BYTES = 32 * 1024 * 1024;

async function loadProjects(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const res = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=100");
    projects.value = res.list;
    if (!selectedProjectId.value || !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = projects.value[0]?.id ?? "";
    }
    await loadAssets();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("referVideo.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function loadAssets(): Promise<void> {
  if (!selectedProjectId.value) {
    assets.value = [];
    return;
  }
  loadingAssets.value = true;
  try {
    const res = await api.get<{ list: ProjectAssetDto[]; total: number }>(
      `/df/resources/list?sp_id=${selectedProjectId.value}&resource_type=4&page=1&page_size=100`,
    );
    assets.value = res.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("referVideo.loadFailed");
    assets.value = [];
  } finally {
    loadingAssets.value = false;
  }
}

watch(selectedProjectId, () => {
  void loadAssets();
});

function pickFile(): void {
  fileInput.value?.click();
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    toast.error(t("referVideo.invalidType"));
    return;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    toast.error(t("referVideo.tooLarge"));
    return;
  }
  uploading.value = true;
  error.value = "";
  try {
    const dataBase64 = await readBase64(file);
    const asset = await api.post<AssetDto>("/assets/upload", {
      filename: file.name,
      content_type: file.type,
      data_base64: dataBase64,
    });
    await api.post("/df/resources/add", {
      sp_id: selectedProjectId.value,
      resource_type: 4,
      name: file.name.slice(0, 50),
      file_uri: asset.uri,
      content_type: file.type,
    });
    toast.success(t("referVideo.uploaded"));
    await loadAssets();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("referVideo.uploadFailed");
  } finally {
    uploading.value = false;
  }
}

async function removeAsset(asset: ProjectAssetDto): Promise<void> {
  if (busyId.value || !window.confirm(t("referVideo.deleteConfirm", { name: asset.name }))) return;
  busyId.value = asset.id;
  try {
    await api.post("/df/resources/batch-delete", {
      sp_id: selectedProjectId.value,
      resource_ids: [asset.id],
    });
    await loadAssets();
    toast.success(t("referVideo.deleted"));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t("referVideo.actionFailed"));
  } finally {
    busyId.value = "";
  }
}

onMounted(() => void loadProjects());
</script>

<template>
  <div class="rv">
    <header class="rv-head">
      <div>
        <h1 class="rv-title">{{ t("referVideo.title") }}</h1>
        <p class="rv-sub">{{ t("referVideo.sub") }}</p>
      </div>
      <div class="rv-actions">
        <SelectField
          class="rv-project"
          label=""
          :options="projects.map((p) => ({ value: p.id, label: p.title }))"
          :model-value="selectedProjectId"
          @update:model-value="selectedProjectId = String($event)"
        />
        <Button size="sm" :disabled="uploading || !selectedProjectId" @click="pickFile">
          {{ uploading ? t("referVideo.uploading") : t("referVideo.upload") }}
        </Button>
        <input ref="fileInput" class="rv-file" type="file" accept="video/*" @change="onFileChange" />
      </div>
    </header>

    <div class="rv-tools">
      <NuxtLink class="rv-btn rv-btn--ghost" to="/create/video-refer">{{ t("referVideo.openRefer") }}</NuxtLink>
      <NuxtLink class="rv-btn rv-btn--ghost" to="/video-redraw/create">{{ t("referVideo.openRedraw") }}</NuxtLink>
    </div>

    <p v-if="error" class="rv-err" role="alert">{{ error }}</p>
    <p v-else-if="loading || loadingAssets" class="rv-muted">{{ t("referVideo.loading") }}</p>

    <EmptyState
      v-else-if="projects.length === 0"
      :title="t('referVideo.noProject')"
      :description="t('referVideo.noProjectDesc')"
    >
      <NuxtLink class="rv-btn" to="/script">{{ t("referVideo.goCreate") }}</NuxtLink>
    </EmptyState>

    <EmptyState
      v-else-if="assets.length === 0"
      :title="t('referVideo.empty')"
      :description="t('referVideo.emptyDesc')"
    >
      <Button size="sm" :disabled="uploading" @click="pickFile">{{ t("referVideo.upload") }}</Button>
    </EmptyState>

    <section v-else class="rv-grid">
      <article v-for="asset in assets" :key="asset.id" class="rv-card">
        <div class="rv-card__thumb">
          <video
            v-if="asset.file_url || asset.file_uri"
            :src="asset.file_url || asset.file_uri || ''"
            controls
            preload="metadata"
          />
          <span v-else class="rv-card__ph">{{ t("referVideo.noPreview") }}</span>
        </div>
        <div class="rv-card__body">
          <h2 class="rv-card__name">{{ asset.name || t("referVideo.untitled") }}</h2>
          <p class="rv-card__meta">{{ asset.created_at }}</p>
          <div class="rv-card__actions">
            <NuxtLink class="rv-card__link" :to="`/create/video-refer?asset=${asset.id}`">
              {{ t("referVideo.useAsReference") }} →
            </NuxtLink>
            <button type="button" class="rv-card__del" :disabled="busyId === asset.id" @click="removeAsset(asset)">
              {{ t("referVideo.delete") }}
            </button>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.rv {
  max-width: 1126px;
  margin: 0 auto;
  padding: 24px 24px 56px;
  color: var(--text-1);
}
.rv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.rv-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
}
.rv-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.7;
}
.rv-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.rv-project {
  min-width: 220px;
}
.rv-file {
  display: none;
}
.rv-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}
.rv-btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: #fff;
  color: #1a1a1f;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
}
.rv-btn--ghost {
  background: transparent;
  border: 1px solid var(--panel-line);
  color: var(--text-2);
}
.rv-muted {
  color: var(--text-3);
  font-size: 13px;
}
.rv-err {
  padding: 10px 14px;
  border: 1px solid var(--danger, #f56c6c);
  border-radius: var(--radius-control);
  color: var(--danger, #f56c6c);
  font-size: 13px;
}
.rv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.rv-card {
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  overflow: hidden;
}
.rv-card__thumb {
  aspect-ratio: 16 / 9;
  background: rgb(0 0 0 / 35%);
  display: grid;
  place-items: center;
}
.rv-card__thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rv-card__ph {
  color: var(--text-4);
  font-size: 12px;
}
.rv-card__body {
  padding: 12px 14px 16px;
}
.rv-card__name {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rv-card__meta {
  margin: 0 0 10px;
  color: var(--text-4);
  font-size: 11.5px;
}
.rv-card__link {
  color: var(--brand, #9b46ff);
  font-size: 12.5px;
  text-decoration: none;
}
.rv-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rv-card__del {
  border: 0;
  background: transparent;
  color: var(--danger, #f56c6c);
  font-size: 12px;
  cursor: pointer;
}
@media (max-width: 900px) {
  .rv-grid {
    grid-template-columns: 1fr;
  }
  .rv-head {
    flex-direction: column;
  }
}
</style>