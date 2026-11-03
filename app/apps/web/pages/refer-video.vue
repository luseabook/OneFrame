<script setup lang="ts">
import type { AssetDto } from "~/types/api";

/**
 * 参考视频（竞品 `/refer-video`，第 134 批）。
 *
 * 竞品该路由属于「视频拉片 / 翻译 / 音频后处理」模块（`fullsite-route-inventory.md:71`），
 * 组件名是 `ReferVideoList`；但“拉片/翻译”的具体映射未取证。我方不造一个假的分析器，
 * 而是把**已有的视频资产**列出来，作为参考素材入口，链到已有的参考视频/转绘工具：
 * - `/create/video-refer`：参考图/视频生视频；
 * - `/video-redraw/create`：视频转绘。
 *
 * 数据来自 `GET /assets`（资产列表），客户端按 `kind==="video"` 过滤——后端没有 kind 过滤参数，
 * 这是现有契约的边界，不为此新增端点。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("referVideo.metaTitle") });

const api = useApi();
const loading = ref(true);
const error = ref("");
const assets = ref<AssetDto[]>([]);

onMounted(async () => {
  try {
    const res = await api.get<{ list: AssetDto[]; total: number }>("/assets?page=1&page_size=100");
    assets.value = res.list.filter((a) => String(a.kind).toLowerCase() === "video");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("referVideo.loadFailed");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="rv">
    <header class="rv-head">
      <div>
        <h1 class="rv-title">{{ t("referVideo.title") }}</h1>
        <p class="rv-sub">{{ t("referVideo.sub") }}</p>
      </div>
      <div class="rv-actions">
        <NuxtLink class="rv-btn" to="/create/video-refer">{{ t("referVideo.openRefer") }}</NuxtLink>
        <NuxtLink class="rv-btn rv-btn--ghost" to="/video-redraw/create">{{ t("referVideo.openRedraw") }}</NuxtLink>
      </div>
    </header>

    <p v-if="error" class="rv-err" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="rv-muted">{{ t("referVideo.loading") }}</p>

    <EmptyState
      v-else-if="assets.length === 0"
      :title="t('referVideo.empty')"
      :description="t('referVideo.emptyDesc')"
    >
      <NuxtLink class="rv-btn" to="/assets">{{ t("referVideo.goAssets") }}</NuxtLink>
    </EmptyState>

    <section v-else class="rv-grid">
      <article v-for="asset in assets" :key="asset.id" class="rv-card">
        <div class="rv-card__thumb">
          <video v-if="asset.url" :src="asset.url" controls preload="metadata" />
          <span v-else class="rv-card__ph">{{ t("referVideo.noPreview") }}</span>
        </div>
        <div class="rv-card__body">
          <h2 class="rv-card__name">{{ asset.name || t("referVideo.untitled") }}</h2>
          <p class="rv-card__meta">{{ asset.created_at }}</p>
          <NuxtLink class="rv-card__link" :to="`/create/video-refer?asset=${asset.id}`">
            {{ t("referVideo.useAsReference") }} →
          </NuxtLink>
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
  margin-bottom: 20px;
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
  gap: 8px;
  flex-shrink: 0;
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
@media (max-width: 900px) {
  .rv-grid {
    grid-template-columns: 1fr;
  }
  .rv-head {
    flex-direction: column;
  }
}
</style>