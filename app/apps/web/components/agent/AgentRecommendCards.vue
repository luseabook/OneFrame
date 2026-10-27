<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useApi } from "~/composables/useApi";
import type { AgentRecommendCard, AgentRecommendResult } from "~/types/api";

/**
 * 推荐卡（竞品 `GET /df/canvas/agent-recommend-cards`，`routes.txt:378`）。
 *
 * 推荐卡是"冷启动零决策"入口：点一下就把预置 prompt 填进输入框。
 * 空态不显示占位假卡：后端无信号时会下发竞品那 4 张兜底卡，页面只负责渲染；
 * 万一接口也空，就整块隐藏（不占位、不留白）。
 */

const emit = defineEmits<{ (e: "pick", card: AgentRecommendCard): void }>();

const api = useApi();
const cards = ref<AgentRecommendCard[]>([]);
const source = ref<"signals" | "default">("default");
const loading = ref(true);
const error = ref("");

/** tag → 图标（竞品映射 1→image 2→video 3→text 4/5→skill，`d-canvas-agent.md:345`） */
const ICONS: Record<number, string> = { 1: "◫", 2: "▶", 3: "✎", 4: "✦", 5: "✦" };

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const res = await api.get<AgentRecommendResult>("/agent-recommend-cards");
    cards.value = res.list ?? [];
    source.value = res.source ?? "default";
  } catch (e) {
    error.value = (e as Error).message || "推荐卡加载失败";
    cards.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section v-if="loading || cards.length > 0 || error" class="rec">
    <header class="rec__head">
      <span class="rec__title">试试这些</span>
      <span v-if="source === 'signals'" class="rec__badge">按你最近在做的推荐</span>
      <button v-if="error" class="rec__retry" type="button" @click="load">重试</button>
    </header>
    <p v-if="error" class="rec__error">{{ error }}</p>
    <div v-else-if="loading" class="rec__skeleton">
      <span v-for="n in 4" :key="n" class="rec__skeleton-item" />
    </div>
    <div v-else class="rec__grid">
      <button
        v-for="card in cards"
        :key="card.recommend_id"
        class="rec__card"
        type="button"
        :title="card.description"
        @click="emit('pick', card)"
      >
        <span class="rec__icon" aria-hidden="true">{{ ICONS[card.tag] ?? "✦" }}</span>
        <span class="rec__text">
          <span class="rec__name">{{ card.title }}</span>
          <span class="rec__desc">{{ card.description }}</span>
        </span>
        <span class="rec__tag">{{ card.tag_label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.rec {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.rec__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.rec__title {
  color: var(--text-3);
  font-size: var(--text-xs);
}
.rec__badge {
  color: var(--brand-on-soft);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  padding: 0 8px;
}
.rec__retry {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border-2);
  border-radius: 8px;
  color: var(--text-3);
  font-size: var(--text-xs);
  padding: 2px 8px;
  cursor: pointer;
}
.rec__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.rec__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-2);
}
.rec__card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-radius: 12px;
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-2);
  cursor: pointer;
  min-width: 0;
}
.rec__card:hover {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.rec__icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--bg-sunken);
  color: var(--brand-on-soft);
  font-size: var(--text-sm);
}
.rec__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.rec__name {
  color: var(--text-1);
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rec__desc {
  color: var(--text-4);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rec__tag {
  flex: 0 0 auto;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.rec__skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-2);
}
.rec__skeleton-item {
  height: 52px;
  border-radius: 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
