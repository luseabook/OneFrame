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
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-4);
  display: grid;
  place-items: center;
  font-size: 22px;
  margin-bottom: var(--space-4);
}
.title {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-base);
  font-weight: 500;
}
.desc {
  margin: var(--space-2) 0 0;
  color: var(--text-4);
  font-size: var(--text-sm);
  max-width: 360px;
}
.action {
  margin-top: var(--space-5);
}
</style>
