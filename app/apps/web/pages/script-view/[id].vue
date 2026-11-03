<script setup lang="ts">
import type { CharacterDto, EpisodeDto, ProjectDto } from "~/types/api";

/**
 * 剧本查看（对齐竞品 `/script-view/:id`，第 132 批）。
 *
 * 竞品把「剧本管理 `script-manage`」与「剧本查看 `script-view/:id`」拆成两页：
 * 前者是列表/入口，后者是**只读**正文视图（版本/审核态在侧栏，本轮只取已存在的字段）。
 * 我方此前只有 `/projects/:id` 的工作台内嵌剧本视图，缺一个"可分享、可只读"的直达页。
 *
 * 数据来源是既有端点 `GET /v1/projects/:id`（返回 `{project, episodes, characters}`），
 * **不新增后端端点**：这一页要的 project / 分集正文 / 角色，该端点已经一次给全。
 *
 * `:id` 语义：竞品该路由的组件 chunk（`CDpLjKgj.js`）在捕获集里缺失，无法证明它是
 * 剧本 ID 还是项目 ID；本轮按**项目 ID**实现（与 `/projects/:id` 同源）。若后续拿到
 * 响应体证据证明是剧本 ID，只需换数据源，页面结构不动。
 *
 * 三态齐备：加载骨架、空态（无分集/无正文）、错误可重试。只读，不提供保存入口——
 * 编辑一律回 `/projects/:id`，避免两处都能改、版本分叉。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("scriptView.metaTitle") });

const api = useApi();
const route = useRoute();
const projectId = String(route.params.id ?? "");

type ProjectDetailDto = {
  project: ProjectDto;
  episodes: EpisodeDto[];
  characters: CharacterDto[];
};

const detail = ref<ProjectDetailDto | null>(null);
const loading = ref(true);
const error = ref("");
const activeIndex = ref(0);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    detail.value = await api.get<ProjectDetailDto>(`/projects/${projectId}`);
    activeIndex.value = 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("scriptView.loadFailed");
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

const episodes = computed(() => detail.value?.episodes ?? []);
const activeEpisode = computed<EpisodeDto | null>(() => episodes.value[activeIndex.value] ?? null);
const scriptText = computed(() => activeEpisode.value?.script_text ?? "");
const wordCount = computed(() => scriptText.value.replace(/\s+/g, "").length);
const metaLine = computed(() => {
  if (!detail.value) return "";
  return t("scriptView.projectMeta", {
    genre: detail.value.project.genre || t("scriptView.genreUnknown"),
    count: episodes.value.length,
  });
});

onMounted(() => void load());
</script>

<template>
  <div class="sv">
    <header class="sv-head">
      <div class="sv-head__main">
        <h1 class="sv-title">{{ detail?.project.title || t("scriptView.loading") }}</h1>
        <p class="sv-sub">{{ metaLine }}</p>
      </div>
      <div class="sv-actions">
        <Button variant="secondary" size="sm" @click="navigateTo('/script')">
          {{ t("scriptView.back") }}
        </Button>
        <Button size="sm" :disabled="!detail" @click="navigateTo(`/projects/${projectId}`)">
          {{ t("scriptView.edit") }}
        </Button>
      </div>
    </header>

    <div v-if="error" class="sv-alert" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="sv-link" @click="load">{{ t("scriptView.retry") }}</button>
    </div>

    <div v-else-if="loading" class="sv-skel" aria-busy="true">
      <div class="sv-skel__bar" />
      <div class="sv-skel__bar sv-skel__bar--wide" />
      <div class="sv-skel__block" />
    </div>

    <section v-else-if="!detail" class="sv-panel">
      <EmptyState :title="t('scriptView.notFound')" :description="t('scriptView.notFoundDesc')" />
    </section>

    <div v-else class="sv-grid">
      <aside class="sv-episodes" :aria-label="t('scriptView.episodes')">
        <h2 class="sv-side-title">{{ t("scriptView.episodes") }}</h2>
        <p v-if="episodes.length === 0" class="sv-side-empty">{{ t("scriptView.emptyEpisodes") }}</p>
        <button
          v-for="(ep, index) in episodes"
          :key="ep.id"
          type="button"
          class="sv-ep"
          :class="{ 'sv-ep--active': index === activeIndex }"
          @click="activeIndex = index"
        >
          <span class="sv-ep__no">{{ t("scriptView.epNo", { n: ep.ep_no }) }}</span>
          <span class="sv-ep__title">{{ ep.title || t("scriptView.untitled") }}</span>
        </button>

        <template v-if="detail.characters.length > 0">
          <h2 class="sv-side-title sv-side-title--gap">{{ t("scriptView.characters") }}</h2>
          <div class="sv-chars">
            <span
              v-for="c in detail.characters"
              :key="c.id"
              class="sv-char"
              :title="c.description ?? ''"
            >
              {{ c.name }}
            </span>
          </div>
        </template>
      </aside>

      <section class="sv-doc">
        <template v-if="activeEpisode">
          <header class="sv-doc__head">
            <h2 class="sv-doc__title">
              {{ t("scriptView.epNo", { n: activeEpisode.ep_no }) }} · {{ activeEpisode.title || t("scriptView.untitled") }}
            </h2>
            <span class="sv-doc__meta">{{ t("scriptView.wordCount", { n: wordCount }) }}</span>
          </header>
          <p v-if="activeEpisode.synopsis" class="sv-synopsis">{{ activeEpisode.synopsis }}</p>

          <pre v-if="scriptText" class="sv-script">{{ scriptText }}</pre>
          <EmptyState
            v-else
            :title="t('scriptView.emptyScript')"
            :description="t('scriptView.emptyScriptDesc')"
          />
        </template>
        <EmptyState v-else :title="t('scriptView.emptyEpisodes')" :description="t('scriptView.emptyEpisodesDesc')" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.sv {
  padding: 8px 24px 40px;
  color: var(--text-1);
}
.sv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  max-width: 1126px;
  margin: 8px auto 16px;
}
.sv-title {
  margin: 0 0 4px;
  font-size: 22px;
  line-height: 1.3;
  font-weight: 600;
}
.sv-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.sv-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.sv-alert {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1126px;
  margin: 0 auto;
  padding: 10px 14px;
  border: 1px solid var(--danger, #f56c6c);
  border-radius: var(--radius-control);
  color: var(--danger, #f56c6c);
  font-size: 13px;
}
.sv-link {
  border: 0;
  background: transparent;
  color: var(--brand, #9b46ff);
  cursor: pointer;
  font-size: 13px;
}
.sv-skel {
  max-width: 1126px;
  margin: 0 auto;
  display: grid;
  gap: 12px;
}
.sv-skel__bar,
.sv-skel__block {
  border-radius: var(--radius-control);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  animation: sv-pulse 1.4s ease-in-out infinite;
}
.sv-skel__bar {
  height: 18px;
  width: 40%;
}
.sv-skel__bar--wide {
  height: 12px;
  width: 24%;
}
.sv-skel__block {
  height: 420px;
}
@keyframes sv-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
.sv-panel,
.sv-grid {
  max-width: 1126px;
  margin: 0 auto;
}
.sv-grid {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.sv-episodes {
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  padding: 12px;
}
.sv-side-title {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 500;
}
.sv-side-title--gap {
  margin-top: 16px;
}
.sv-side-empty {
  margin: 0;
  color: var(--text-4);
  font-size: 12px;
  line-height: 1.6;
}
.sv-ep {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin-bottom: 4px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}
.sv-ep:hover {
  color: var(--text-1);
  background: rgb(255 255 255 / 4%);
}
.sv-ep--active {
  color: var(--text-1);
  border-color: var(--panel-line);
  background: rgb(255 255 255 / 6%);
}
.sv-ep__no {
  font-size: 12px;
  color: var(--text-3);
}
.sv-ep__title {
  font-size: 13px;
}
.sv-chars {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sv-char {
  padding: 2px 8px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  color: var(--text-2);
  font-size: 12px;
}
.sv-doc {
  min-height: 420px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  padding: 20px 24px;
}
.sv-doc__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.sv-doc__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.sv-doc__meta {
  color: var(--text-3);
  font-size: 12px;
}
.sv-synopsis {
  margin: 0 0 16px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.7;
}
.sv-script {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-1);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.9;
}
@media (max-width: 900px) {
  .sv-grid {
    grid-template-columns: 1fr;
  }
  .sv-head {
    flex-direction: column;
  }
}
</style>