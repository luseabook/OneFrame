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
  /* GL9：竞品 Tab 容器**无全宽底线**（只有选中项下方有 2px 白线，pricing-full.png） */
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
/* GL9：选中 = **白字 #FFFFFF**（旧值紫色 #8a3ae6 在深底上对比度仅 3.1:1，
   且是"另一个产品"的语言） */
.tab.active {
  color: #ffffff;
}
/* GL9：下划线白 2px，宽度 = 文字宽度、**左右无内缩**（旧值 left/right 各缩 12px） */
.tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--tab-line);
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
  background: #7e70ff1f;
  color: var(--brand-300);
}
</style>
