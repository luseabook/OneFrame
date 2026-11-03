<script setup lang="ts">
import type {
  CharacterDto,
  EpisodeDto,
  NovelChapterDto,
  NovelChapterSummaryDto,
  NovelCounts,
  NovelDto,
  ProjectDto,
} from "~/types/api";

/**
 * 剧本查看（对齐竞品 `/script-view/:id`，第 132 批）。
 *
 * 竞品把「剧本管理 `script-manage`」与「剧本查看 `script-view/:id`」拆成两页：
 * 前者是列表/入口，后者是**只读**正文视图。我方此前只有 `/projects/:id` 的内嵌剧本视图，
 * 缺一个"可直达、可只读"的页面。
 *
 * `:id` 的语义在竞品侧无法取证（组件 chunk `CDpLjKgj.js` 从未被捕获），所以这里**不做单假设**：
 * 先按项目 ID 取（`GET /projects/:id`，返回 project+episodes+characters）；
 * 取不到再按小说 ID 取（`GET /novel/:id` + 章节列表/正文）。两条路都走真实端点，
 * 不猜字段、不造数据；哪条命中就渲染哪种形态，互斥且只读。
 *
 * 只读页不提供保存入口：编辑一律回 `/projects/:id`（或 `/novel/:id`），避免两处都能改、版本分叉。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("scriptView.metaTitle") });

const api = useApi();
const route = useRoute();
const scriptId = String(route.params.id ?? "");

type ProjectDetailDto = {
  project: ProjectDto;
  episodes: EpisodeDto[];
  characters: CharacterDto[];
};
type NovelDetailDto = { novel: NovelDto; counts: NovelCounts };

const mode = ref<"project" | "novel">("project");
const projectDetail = ref<ProjectDetailDto | null>(null);
const novelDetail = ref<NovelDetailDto | null>(null);
const novelChapters = ref<NovelChapterSummaryDto[]>([]);
const activeIndex = ref(0);
const novelContent = ref("");
const chapterLoading = ref(false);
const loading = ref(true);
const error = ref("");

async function loadProject(): Promise<ProjectDetailDto> {
  return api.get<ProjectDetailDto>(`/projects/${scriptId}`);
}

async function loadNovel(): Promise<void> {
  const detail = await api.get<NovelDetailDto>(`/novel/${scriptId}`);
  const chapters = await api.get<{ list: NovelChapterSummaryDto[]; total: number }>(
    `/novel/${scriptId}/chapters?page=1&page_size=200`,
  );
  novelDetail.value = detail;
  novelChapters.value = chapters.list;
  activeIndex.value = 0;
  await loadNovelChapter(0);
}

async function loadNovelChapter(index: number): Promise<void> {
  activeIndex.value = index;
  const chapter = novelChapters.value[index];
  if (!chapter) {
    novelContent.value = "";
    return;
  }
  chapterLoading.value = true;
  try {
    const detail = await api.get<NovelChapterDto>(`/novel/${scriptId}/chapters/${chapter.chapter_no}`);
    novelContent.value = detail.content ?? "";
  } catch (e) {
    novelContent.value = "";
    error.value = e instanceof Error ? e.message : t("scriptView.loadFailed");
  } finally {
    chapterLoading.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  mode.value = "project";
  projectDetail.value = null;
  novelDetail.value = null;
  novelChapters.value = [];
  novelContent.value = "";
  try {
    projectDetail.value = await loadProject();
  } catch {
    // 项目 ID 不成立 → 再按小说 ID 试一次；两条都失败才报错
    try {
      mode.value = "novel";
      await loadNovel();
    } catch (e) {
      error.value = e instanceof Error ? e.message : t("scriptView.loadFailed");
    }
  } finally {
    loading.value = false;
  }
}

const episodes = computed(() => projectDetail.value?.episodes ?? []);
const activeEpisode = computed<EpisodeDto | null>(() => episodes.value[activeIndex.value] ?? null);
const projectScript = computed(() => activeEpisode.value?.script_text ?? "");
const projectWordCount = computed(() => projectScript.value.replace(/\s+/g, "").length);
const novelWordCount = computed(() => novelContent.value.replace(/\s+/g, "").length);
const hasContent = computed(() =>
  mode.value === "project" ? projectScript.value.length > 0 : novelContent.value.length > 0,
);
const title = computed(() =>
  mode.value === "project" ? projectDetail.value?.project.title ?? "" : novelDetail.value?.novel.title ?? "",
);
const metaLine = computed(() => {
  if (mode.value === "project" && projectDetail.value) {
    return t("scriptView.projectMeta", {
      genre: projectDetail.value.project.genre || t("scriptView.genreUnknown"),
      count: episodes.value.length,
    });
  }
  if (mode.value === "novel" && novelDetail.value) {
    return t("scriptView.novelMeta", {
      chapters: novelDetail.value.counts.chapters,
      episodes: novelDetail.value.novel.episode_count,
    });
  }
  return "";
});
const backPath = computed(() => (mode.value === "project" ? "/script" : "/novel"));
const editPath = computed(() =>
  mode.value === "project" ? `/projects/${scriptId}` : `/novel/${scriptId}`,
);

onMounted(() => void load());
</script>

<template>
  <div class="sv">
    <header class="sv-head">
      <div class="sv-head__main">
        <h1 class="sv-title">{{ title || t("scriptView.loading") }}</h1>
        <p class="sv-sub">{{ metaLine }}</p>
      </div>
      <div class="sv-actions">
        <Button variant="secondary" size="sm" @click="navigateTo(backPath)">
          {{ mode === "project" ? t("scriptView.back") : t("scriptView.backNovel") }}
        </Button>
        <Button size="sm" :disabled="!title" @click="navigateTo(editPath)">
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

    <section v-else-if="!title" class="sv-panel">
      <EmptyState :title="t('scriptView.notFound')" :description="t('scriptView.notFoundDesc')" />
    </section>

    <div v-else class="sv-grid">
      <aside class="sv-episodes" :aria-label="mode === 'project' ? t('scriptView.episodes') : t('scriptView.chapters')">
        <template v-if="mode === 'project'">
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

          <template v-if="projectDetail && projectDetail.characters.length > 0">
            <h2 class="sv-side-title sv-side-title--gap">{{ t("scriptView.characters") }}</h2>
            <div class="sv-chars">
              <span
                v-for="c in projectDetail.characters"
                :key="c.id"
                class="sv-char"
                :title="c.description ?? ''"
              >
                {{ c.name }}
              </span>
            </div>
          </template>
        </template>

        <template v-else>
          <h2 class="sv-side-title">{{ t("scriptView.chapters") }}</h2>
          <p v-if="novelChapters.length === 0" class="sv-side-empty">{{ t("scriptView.emptyChapters") }}</p>
          <button
            v-for="(ch, index) in novelChapters"
            :key="ch.id"
            type="button"
            class="sv-ep"
            :class="{ 'sv-ep--active': index === activeIndex }"
            @click="loadNovelChapter(index)"
          >
            <span class="sv-ep__no">{{ t("scriptView.chapterNo", { n: ch.chapter_no }) }}</span>
            <span class="sv-ep__title">{{ ch.title || t("scriptView.untitled") }}</span>
          </button>
        </template>
      </aside>

      <section class="sv-doc">
        <template v-if="mode === 'project'">
          <template v-if="activeEpisode">
            <header class="sv-doc__head">
              <h2 class="sv-doc__title">
                {{ t("scriptView.epNo", { n: activeEpisode.ep_no }) }} · {{ activeEpisode.title || t("scriptView.untitled") }}
              </h2>
              <span class="sv-doc__meta">{{ t("scriptView.wordCount", { n: projectWordCount }) }}</span>
            </header>
            <p v-if="activeEpisode.synopsis" class="sv-synopsis">{{ activeEpisode.synopsis }}</p>
            <pre v-if="projectScript" class="sv-script">{{ projectScript }}</pre>
            <EmptyState
              v-else
              :title="t('scriptView.emptyScript')"
              :description="t('scriptView.emptyScriptDesc')"
            />
          </template>
          <EmptyState v-else :title="t('scriptView.emptyEpisodes')" :description="t('scriptView.emptyEpisodesDesc')" />
        </template>

        <template v-else>
          <header v-if="novelChapters[activeIndex]" class="sv-doc__head">
            <h2 class="sv-doc__title">
              {{ t("scriptView.chapterNo", { n: novelChapters[activeIndex].chapter_no }) }} ·
              {{ novelChapters[activeIndex].title || t("scriptView.untitled") }}
            </h2>
            <span class="sv-doc__meta">{{ t("scriptView.wordCount", { n: novelWordCount }) }}</span>
          </header>
          <p v-if="chapterLoading" class="sv-synopsis">{{ t("scriptView.loading") }}</p>
          <pre v-else-if="hasContent" class="sv-script">{{ novelContent }}</pre>
          <EmptyState
            v-else
            :title="t('scriptView.emptyChapter')"
            :description="t('scriptView.emptyChapterDesc')"
          />
        </template>
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
  max-height: 72vh;
  overflow-y: auto;
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