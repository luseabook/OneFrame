<script setup lang="ts">
withDefaults(defineProps<{ title?: string; subtitle?: string; padded?: boolean; hoverable?: boolean }>(), {
  padded: true,
  hoverable: false,
});
</script>

<template>
  <section class="card" :class="{ hoverable }">
    <header v-if="title || $slots.header || $slots.actions" class="head">
      <div class="titles">
        <slot name="header">
          <h3 v-if="title" class="title">{{ title }}</h3>
        </slot>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
    </header>
    <div class="body" :class="{ padded }"><slot /></div>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.card.hoverable {
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.card.hoverable:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-1);
}
.titles {
  min-width: 0;
}
.title {
  font-size: var(--text-base);
  font-weight: 600;
}
.subtitle {
  margin: 2px 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
.body.padded {
  padding: var(--space-5);
}
</style>
