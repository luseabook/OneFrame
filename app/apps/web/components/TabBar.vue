<script setup lang="ts">
const props = defineProps<{ tabs: Array<{ value: string; label: string; badge?: number }> }>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <div class="tabs" role="tablist">
    <button
      v-for="tab in props.tabs"
      :key="tab.value"
      class="tab"
      :class="{ active: model === tab.value }"
      role="tab"
      :aria-selected="model === tab.value"
      @click="model = tab.value"
    >
      {{ tab.label }}
      <span v-if="tab.badge !== undefined" class="badge">{{ tab.badge }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-1);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  position: relative;
  background: none;
  border: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-3);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--text-1);
}
.tab.active {
  color: var(--brand-600);
}
.tab.active::after {
  content: "";
  position: absolute;
  left: var(--space-3);
  right: var(--space-3);
  bottom: -1px;
  height: 2px;
  background: var(--brand-500);
  border-radius: 2px 2px 0 0;
}
.badge {
  display: inline-block;
  margin-left: 5px;
  padding: 0 6px;
  height: 17px;
  line-height: 17px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.tab.active .badge {
  background: var(--brand-100);
  color: var(--brand-700);
}
</style>
