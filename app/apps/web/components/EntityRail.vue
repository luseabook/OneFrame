<script setup lang="ts">
import { computed } from "vue";

/**
 * 资产域三视图窄轨（对齐竞品 /asset 的 64px 左轨）
 *
 * 竞品实测（1424×805）：/asset 左侧是一条 64px 窄轨，三项是「剧本 / 资产 / 剧集」，
 * 即资产页把"同一个创作上下文里的三个实体"放在一条竖轨上，而不是散在全局侧栏。
 *
 * 我们保留全局侧栏（自己的 IA 不能为单页拆掉），把这条轨放在内容区左侧，
 * 语义与顺序 1:1：剧本 → /script，资产 → /assets，剧集 → /works。
 */
const props = defineProps<{ active: "script" | "assets" | "series" }>();
const { t } = useI18n();

const items = computed(() => [
  { key: "script" as const, to: "/script", label: t("entityRail.script"), icon: "✎" },
  { key: "assets" as const, to: "/assets", label: t("entityRail.assets"), icon: "▤" },
  { key: "series" as const, to: "/works", label: t("entityRail.series"), icon: "▦" },
]);
</script>

<template>
  <nav class="entity-rail" :aria-label="t('entityRail.aria')">
    <NuxtLink
      v-for="it in items"
      :key="it.key"
      :to="it.to"
      class="entity-rail__item"
      :class="{ on: props.active === it.key }"
      :aria-current="props.active === it.key ? 'page' : undefined"
    >
      <span class="entity-rail__icon" aria-hidden="true">{{ it.icon }}</span>
      <span class="entity-rail__label">{{ it.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.entity-rail {
  /* 竞品实测：x8 / y64 / 64×733（贴到视口底部 8px）。
     我们用 fixed 才能拿到"视口高 - 顶栏"的固定高度；左侧用侧栏 token，避免折叠后压住侧栏。 */
  position: fixed;
  left: calc(var(--sidebar-w, 240px) + 8px);
  top: 64px;
  bottom: 8px;
  z-index: 20;
  width: 64px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 4px;
  border-radius: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
}
.entity-rail__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  border-radius: 8px;
  color: var(--text-3);
  text-decoration: none;
  font-size: 11px;
  line-height: 1.2;
}
.entity-rail__item:hover {
  color: var(--text-1);
  background: rgb(194 204 241 / 8%);
}
.entity-rail__item.on {
  color: var(--text-1);
  background: rgb(155 70 255 / 16%);
  box-shadow: inset 2px 0 0 var(--brand, #9b46ff);
}
.entity-rail__icon {
  font-size: 15px;
}
.entity-rail__label {
  white-space: nowrap;
}
</style>
