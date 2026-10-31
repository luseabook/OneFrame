<script setup lang="ts">
defineProps<{ title?: string; description?: string; icon?: string }>();
</script>

<template>
  <div class="empty">
    <div class="icon" aria-hidden="true">{{ icon ?? "◍" }}</div>
    <p class="title">{{ title ?? "暂无内容" }}</p>
    <p v-if="description" class="desc">{{ description }}</p>
    <div v-if="$slots.default" class="action"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-16) var(--space-6);
  text-align: center;
}
.icon {
  /* GL17：竞品的空态是「插画（≈80×64，**无圆底板**）+ 一行灰字」（task.png y300–400）。
     旧值是 48×48 实心圆底 + 500 字重标题 + 描述 + 按钮，三层比竞品重。 */
  width: auto;
  height: auto;
  background: transparent;
  color: var(--text-4);
  display: grid;
  place-items: center;
  font-size: 40px;
  line-height: 1;
  opacity: 0.7;
  margin-bottom: var(--space-4);
}
.title {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
  font-weight: 400;
}
.desc {
  margin: var(--space-2) 0 0;
  color: var(--text-4);
  font-size: 12px;
  max-width: 360px;
}
.action {
  margin-top: var(--space-5);
}
</style>
