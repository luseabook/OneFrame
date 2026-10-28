<script setup lang="ts">
// 工具箱：对齐参照产品工具箱页（tools.png）
//
// **卡清单来自服务端目录**（`GET /generations/tools` → `tool-catalog.ts`）。
// 为什么不在前端写死：卡是给用户看的入口，mode 是任务脊柱的枚举，两者是同一份事实。
// 前端硬编码一份、后端再硬编码一份的话，每加一张卡都要改两处，而"卡能点但没人接"
// 这类漂移在编译期发现不了（这正是本批之前 8/18 张卡只能置灰的成因）。
//
// 20 张卡的依据（逐条可追）：
//   - 17 条 `/create/*`：`rea-reelmate/routes.txt:25-41`
//   - 「灵感成片」：`routes.txt:42`（/creation-agent，报告点名无独立 /create 路由）
//   - 「音色修改」：`reelmate-feature-map.md §3.5`（报告点名无独立路由的工具）
//   - 「声音克隆」：`competitor_endpoints.tsv` 的 `ai/voice-clone*` 五条（第 93 批）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
// i18n（第 8 批）：服务端目录返回的卡片标题/描述是**后端数据**，不翻译；
// 本页只翻译界面骨架（标题/页签/提示/空态/错误），中文原文与改造前逐字一致。
const { t } = useI18n();
useHead({ title: () => t("tools.metaTitle") });

import type { ToolCardDto, ToolCatalogDto } from "~/types/api";

const api = useApi();

const loading = ref(true);
const loadError = ref("");
const cards = ref<ToolCardDto[]>([]);

type TabKey = "all" | "video" | "image" | "audio";
const tabs = computed<Array<{ key: TabKey; label: string }>>(() => [
  { key: "all", label: t("tools.tabAll") },
  { key: "video", label: t("tools.tabVideo") },
  { key: "image", label: t("tools.tabImage") },
  { key: "audio", label: t("tools.tabAudio") },
]);
const active = ref<TabKey>("all");
const shown = computed(() => (active.value === "all" ? cards.value : cards.value.filter((c) => c.category === active.value)));

const showTip = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await api.get<ToolCatalogDto>("/generations/tools");
    cards.value = data.cards;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : t("tools.loadError");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>{{ t("tools.title") }}</h1>
      <div class="head-right">
        <div v-if="showTip" class="tip">
          <button class="tip-close" type="button" :aria-label="t('tools.tipClose')" @click="showTip = false">✕</button>
          <p class="tip-title">{{ t("tools.tipTitle") }}</p>
          <p class="tip-text">{{ t("tools.tipText") }}</p>
        </div>
        <NuxtLink to="/assets" class="asset-btn">{{ t("tools.assetsLink") }}</NuxtLink>
        <LangSwitcher />
      </div>
    </header>

    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ on: active === tab.key }"
        @click="active = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div v-if="loading" class="state">{{ t("tools.loading") }}</div>
    <div v-else-if="loadError" class="state">
      <p>{{ loadError }}</p>
      <button type="button" class="retry" @click="load">{{ t("common.retry") }}</button>
    </div>

    <div v-else-if="shown.length" class="grid">
      <NuxtLink v-for="card in shown" :key="card.key" :to="card.route" class="tool-card">
        <h3>{{ card.title }}</h3>
        <p>{{ card.desc }}</p>
      </NuxtLink>
    </div>
    <EmptyState
      v-else
      :title="t('tools.emptyTitle')"
      :description="t('tools.emptyDesc')"
      style="margin-top: 80px"
    />
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 64px);
  padding: 20px 24px 40px;
  box-sizing: border-box;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.head-right {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.tip {
  position: relative;
  width: 280px;
  padding: 10px 30px 10px 14px;
  border-radius: 8px;
  background: #2a1744;
  color: #d9d2ff;
}

.tip-close {
  position: absolute;
  top: 6px;
  right: 8px;
  border: 0;
  background: transparent;
  color: #b9aeff;
  font-size: 11px;
  cursor: pointer;
}

.tip-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #a78bfa;
}

.tip-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.85;
}

.asset-btn {
  flex: 0 0 auto;
  height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 18px;
  border-radius: 8px;
  background: #9b46ff;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.asset-btn:hover {
  filter: brightness(1.08);
}

.tabs {
  display: flex;
  gap: 26px;
  margin: 22px 0 0;
}

.tab {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #ffffff99;
  font-size: 14px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text-1);
}

.tab.on {
  background: #232328;
  color: var(--text-1);
  font-weight: 600;
}

.grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  gap: 20px;
  padding: 20px 0 0;
}

.tool-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: 84px;
  padding: 16px 16px;
  border-radius: 16px;
  border: 0;
  background: linear-gradient(180deg, #060608, #020203);
  text-align: left;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.tool-card:hover {
  background: linear-gradient(180deg, #0d0d12, #050507);
  transform: translateY(-1px);
}

h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
}

.tool-card p {
  margin: 0;
  font-size: 13px;
  color: #ffffff80;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  flex: 1;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 13px;
}

.retry {
  height: 30px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid #ffffff24;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
  }
  .head {
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .page {
    padding: 18px 16px 32px;
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .head-right {
    flex-direction: column;
  }
}
</style>
