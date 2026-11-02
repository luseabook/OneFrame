<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

/**
 * 剧本创作（对齐竞品 /script-manage 的**创作入口**部分）
 *
 * 范围决策 D5（2026-11-02）：本项目只要竞品的**创作能力**——用第三方 API 做自己的生产链，
 * 不做剧本交易/广场/买断/分成。所以这一页只保留：
 *   灵感输入（题材 + 四个入口 chip + 两条灵感建议）+ 我的剧本列表。
 * 竞品的「剧本广场」tab 属于交易域，按 D5 移除，不再拉 /market/scripts。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const { t } = useI18n();
useHead({ title: () => t("scriptPage.metaTitle") });

const prompt = ref("");
const createOpen = ref(false);
const createIdea = ref("");
/** 题材下拉（竞品 hero 工具条上的「国内剧本 ▾」）：决定新建项目的剧目类型 */
const dramaType = ref(1);
const dramaOptions = computed(() => [
  { value: 1, label: t("projectModal.drama.domestic") },
  { value: 2, label: t("projectModal.drama.overseas") },
  { value: 3, label: t("projectModal.drama.anime") },
]);

const projects = ref<ProjectDto[]>([]);
const projectsTotal = ref(0);
const projectsLoading = ref(true);
const projectsError = ref("");
const keyword = ref("");

const suggestions = computed(() => [t("scriptPage.suggest1"), t("scriptPage.suggest2")]);

async function loadProjects(): Promise<void> {
  projectsLoading.value = true;
  projectsError.value = "";
  try {
    const res = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=24");
    projects.value = res.list;
    projectsTotal.value = res.total;
  } catch (e) {
    projectsError.value = e instanceof Error ? e.message : t("scriptPage.loadFailed");
    projects.value = [];
  } finally {
    projectsLoading.value = false;
  }
}

const visibleProjects = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return projects.value;
  return projects.value.filter((p) => (p.title || "").toLowerCase().includes(k));
});

function startCreate(idea?: string): void {
  createIdea.value = (idea ?? prompt.value).trim();
  createOpen.value = true;
}

function onCreated(project: ProjectDto): void {
  createOpen.value = false;
  prompt.value = "";
  void navigateTo(`/projects/${project.id}`);
}

onMounted(() => void loadProjects());
</script>

<template>
  <div class="sp">
    <section class="sp-hero">
      <h1 class="sp-hero__title">{{ t("scriptPage.heroTitle") }}</h1>

      <div class="sp-box">
        <textarea
          v-model="prompt"
          class="sp-box__input"
          rows="3"
          :placeholder="t('scriptPage.promptPlaceholder')"
        />
        <div class="sp-box__bar">
          <button type="button" class="sp-chip" :title="t('scriptPage.chipIdeaHint')" @click="startCreate()">+</button>
          <button type="button" class="sp-chip" @click="startCreate()">{{ t("scriptPage.chipIdea") }}</button>
          <button type="button" class="sp-chip" @click="startCreate()">{{ t("scriptPage.chipSplit") }}</button>
          <button type="button" class="sp-chip" @click="startCreate()">{{ t("scriptPage.chipContinue") }}</button>
          <select v-model.number="dramaType" class="sp-select" :aria-label="t('scriptPage.dramaLabel')">
            <option v-for="d in dramaOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
          <span class="sp-spacer" />
          <button type="button" class="sp-send" :aria-label="t('scriptPage.send')" @click="startCreate()">↑</button>
        </div>
      </div>

      <div class="sp-suggests">
        <button v-for="s in suggestions" :key="s" type="button" class="sp-suggest" @click="prompt = s; startCreate(s)">
          {{ s }}
        </button>
      </div>
    </section>

    <div class="sp-tabs">
      <span class="sp-tab on">{{ t("scriptPage.tabMine", { n: projectsTotal }) }}</span>
      <span class="sp-spacer" />
      <input v-model="keyword" class="sp-search" type="search" :placeholder="t('scriptPage.searchPlaceholder')" />
    </div>

    <p v-if="projectsLoading" class="sp-state">{{ t("scriptPage.loading") }}</p>
    <div v-else-if="projectsError" class="sp-state sp-state--err">
      <span>{{ projectsError }}</span>
      <button type="button" class="sp-retry" @click="loadProjects">{{ t("scriptPage.retry") }}</button>
    </div>
    <p v-else-if="!visibleProjects.length" class="sp-state">{{ t("scriptPage.emptyMine") }}</p>
    <div v-else class="sp-grid">
      <NuxtLink v-for="p in visibleProjects" :key="p.id" :to="`/projects/${p.id}`" class="sp-card">
        <span class="sp-card__cover" :style="{ backgroundImage: 'linear-gradient(150deg, #2a2338, #14121c)' }">
          <em class="sp-card__price">{{ p.ratio }}</em>
        </span>
        <b class="sp-card__title">{{ p.title }}</b>
        <span class="sp-card__meta">{{ t("scriptPage.mineMeta") }}</span>
      </NuxtLink>
    </div>

    <CreateProjectModal
      v-model:open="createOpen"
      :initial-title="createIdea"
      :initial-drama-type="dramaType"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
.sp {
  /* 竞品实测（1424×805）：内容区 x240→x264 起、宽 1126（侧栏 240 + 左右 24） */
  padding: 8px 24px 40px;
  color: var(--text-1);
}
.sp-hero {
  width: 100%;
  max-width: 1126px;
  margin: 8px auto 0;
  text-align: center;
}
.sp-hero__title {
  /* 竞品 slogan 盒：宽 1126 / 高 40（y80），到输入卡 12px 间距 */
  font-size: 28px;
  line-height: 40px;
  font-weight: 600;
  letter-spacing: 1px;
  margin: 0 0 12px;
  background: linear-gradient(92deg, #fff, #cbb6ff 60%, #9b46ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sp-box {
  /* 竞品输入壳：1088×184（外）/ 卡 1080×176 / 文本域 1062×122 / 工具条 32 */
  text-align: left;
  display: flex;
  flex-direction: column;
  min-height: 176px;
  border-radius: 16px;
  border: 1px solid var(--panel-line);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  padding: 12px 9px;
}
.sp-box__input {
  width: 100%;
  resize: vertical;
  min-height: 122px;
  margin-bottom: 4px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-1);
  font-size: 14px;
  line-height: 1.6;
}
.sp-box__input::placeholder {
  color: var(--text-3);
}
.sp-box__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  height: 32px;
}
.sp-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.sp-chip:hover {
  color: var(--text-1);
  border-color: var(--brand, #9b46ff);
}
.sp-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.sp-spacer {
  flex: 1;
}
.sp-send {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 0;
  background: var(--brand, #9b46ff);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
.sp-suggests {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  min-height: 40px;
  flex-wrap: wrap;
  justify-content: center;
}
.sp-suggest {
  max-width: 420px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-tabs {
  /* 竞品 tab 面板顶边 y424：samples 底 376 + 48 */
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 48px 0 12px;
  border-bottom: 1px solid var(--panel-line);
}
.sp-tab {
  position: relative;
  padding: 10px 2px;
  font-size: 14px;
}
.sp-tab.on {
  color: var(--text-1);
  font-weight: 600;
}
.sp-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand, #9b46ff);
}
.sp-search {
  width: 220px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
}
.sp-state {
  padding: 40px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 13px;
}
.sp-state--err {
  color: var(--danger, #ff6b6b);
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
}
.sp-retry {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
}
.sp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.sp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-decoration: none;
  color: inherit;
}
.sp-card__cover {
  position: relative;
  display: block;
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  border: 1px solid var(--panel-line);
  background-size: cover;
  background-position: center;
}
.sp-card__price {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(0 0 0 / 55%);
  color: #ffd479;
  font-size: 11px;
  font-style: normal;
}
.sp-card__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-card__meta {
  font-size: 11px;
  color: var(--text-3);
}
</style>
