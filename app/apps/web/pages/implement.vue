<script setup lang="ts">
import type { ProjectAssetDto, ProjectDto } from "~/types/api";

/**
 * 道具资源库（竞品 `/implement`，第 135 批，按逆向证据重写）。
 *
 * 证据（2026-11-04 实时逆向 `www.reelmate.cn` 当前构建）：
 * - 路由 `/implement` 的组件是 `ciINcGzs.js` → 通用列表组件 `mRxBn2Ja.js`，
 *   只传了一个 prop：`resource-type = Duf00Fwb.resourceType.implement`（枚举值 3）；
 * - `/refer-video` 复用**同一个列表组件**，`resource-type = referenceVideo`（枚举 4）；
 * - 列表接口是 `GET /web/v1/df/resources/list`，参数
 *   `sp_id / page / page_size / resource_type / status / sort_field / sort_direction / is_subject / name`；
 * - `Duf00Fwb.js` 的枚举：role=1 / setting=2 / **implement=3** / referenceVideo=4 / referenceImage=5。
 *
 * 所以 `/implement` 不是 CLI 页，而是**「道具」资源库**（与角色 role、场景 setting 同族）。
 * 我方对应能力是项目资产 `project_assets.kind = "prop"`，端点为
 * `GET /projects/:id/assets?kind=prop`；本页按项目列出道具，不新增后端。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("implementPage.metaTitle") });

const api = useApi();
const route = useRoute();
const toast = useToast();

const projects = ref<ProjectDto[]>([]);
const selectedProjectId = ref(String(route.query.project ?? ""));
const assets = ref<ProjectAssetDto[]>([]);
const loadingProjects = ref(true);
const loadingAssets = ref(false);
const error = ref("");
const keyword = ref("");

async function loadProjects(): Promise<void> {
  loadingProjects.value = true;
  error.value = "";
  try {
    const res = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=100");
    projects.value = res.list;
    if (!selectedProjectId.value || !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = projects.value[0]?.id ?? "";
    }
    await loadAssets();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("implementPage.loadFailed");
  } finally {
    loadingProjects.value = false;
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
      `/df/resources/list?sp_id=${selectedProjectId.value}&resource_type=3&page=1&page_size=100`,
    );
    assets.value = res.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("implementPage.loadFailed");
    assets.value = [];
  } finally {
    loadingAssets.value = false;
  }
}

watch(selectedProjectId, () => {
  void loadAssets();
});

const visibleAssets = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return assets.value;
  return assets.value.filter((a) =>
    `${a.name} ${a.description ?? ""} ${a.prompt ?? ""}`.toLowerCase().includes(k),
  );
});

function statusLabel(status: number): string {
  return status === 2 ? t("implementPage.statusFinalized") : t("implementPage.statusDraft");
}

onMounted(() => void loadProjects());
</script>

<template>
  <div class="im">
    <header class="im-head">
      <div>
        <h1 class="im-title">{{ t("implementPage.title") }}</h1>
        <p class="im-sub">{{ t("implementPage.sub") }}</p>
      </div>
      <div class="im-actions">
        <SelectField
          class="im-project"
          label=""
          :options="projects.map((p) => ({ value: p.id, label: p.title }))"
          :model-value="selectedProjectId"
          @update:model-value="selectedProjectId = String($event)"
        />
        <Button variant="secondary" size="sm" :disabled="loadingProjects" @click="loadProjects">
          {{ t("implementPage.refresh") }}
        </Button>
      </div>
    </header>

    <p v-if="error" class="im-alert" role="alert">{{ error }}</p>
    <p v-else-if="loadingProjects || loadingAssets" class="im-muted">{{ t("implementPage.loading") }}</p>

    <EmptyState
      v-else-if="projects.length === 0"
      :title="t('implementPage.noProject')"
      :description="t('implementPage.noProjectDesc')"
    >
      <NuxtLink class="im-btn" to="/script">{{ t("implementPage.goCreate") }}</NuxtLink>
    </EmptyState>

    <template v-else>
      <div class="im-toolbar">
        <input v-model="keyword" class="im-search" type="search" :placeholder="t('implementPage.search')" />
        <span class="im-count">{{ t("implementPage.count", { n: assets.length }) }}</span>
        <NuxtLink class="im-link" :to="`/projects/${selectedProjectId}`">{{ t("implementPage.goProject") }}</NuxtLink>
      </div>

      <EmptyState
        v-if="visibleAssets.length === 0"
        :title="t('implementPage.empty')"
        :description="t('implementPage.emptyDesc')"
      >
        <NuxtLink class="im-btn" :to="`/projects/${selectedProjectId}`">{{ t("implementPage.goProject") }}</NuxtLink>
      </EmptyState>

      <section v-else class="im-grid">
        <article v-for="asset in visibleAssets" :key="asset.id" class="im-card">
          <div class="im-card__thumb">
            <img v-if="asset.portrait_url" :src="asset.portrait_url" alt="" />
            <span v-else class="im-card__ph">{{ t("implementPage.noImage") }}</span>
          </div>
          <div class="im-card__body">
            <h2 class="im-card__name">{{ asset.name }}</h2>
            <p class="im-card__desc">{{ asset.description || asset.prompt || t("implementPage.noDesc") }}</p>
            <p class="im-card__meta">
              <span class="im-badge" :class="{ 'im-badge--ok': asset.status === 2 }">{{ statusLabel(asset.status) }}</span>
              <span v-if="asset.bound_shot_count">{{ t("implementPage.bound", { n: asset.bound_shot_count }) }}</span>
            </p>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.im {
  max-width: 1126px;
  margin: 0 auto;
  padding: 24px 24px 56px;
  color: var(--text-1);
}
.im-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.im-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
}
.im-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.7;
}
.im-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.im-project {
  min-width: 220px;
}
.im-alert {
  padding: 10px 14px;
  border: 1px solid var(--danger, #f56c6c);
  border-radius: var(--radius-control);
  color: var(--danger, #f56c6c);
  font-size: 13px;
}
.im-muted {
  color: var(--text-3);
  font-size: 13px;
}
.im-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.im-search {
  height: 32px;
  width: 260px;
  padding: 0 10px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.im-search::placeholder {
  color: var(--text-4);
}
.im-count {
  color: var(--text-3);
  font-size: 12px;
}
.im-link {
  margin-left: auto;
  color: var(--brand, #9b46ff);
  font-size: 12.5px;
  text-decoration: none;
}
.im-btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  background: #fff;
  color: #1a1a1f;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
}
.im-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.im-card {
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  overflow: hidden;
}
.im-card__thumb {
  aspect-ratio: 1;
  background: rgb(0 0 0 / 35%);
  display: grid;
  place-items: center;
}
.im-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.im-card__ph {
  color: var(--text-4);
  font-size: 12px;
}
.im-card__body {
  padding: 12px 14px 14px;
}
.im-card__name {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.im-card__desc {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.im-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-4);
  font-size: 11.5px;
}
.im-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
  color: var(--text-3);
}
.im-badge--ok {
  color: var(--success, #67c23a);
}
@media (max-width: 1000px) {
  .im-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 700px) {
  .im-grid {
    grid-template-columns: 1fr;
  }
  .im-head {
    flex-direction: column;
  }
}
</style>