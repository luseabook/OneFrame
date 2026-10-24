<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
    size?: "sm" | "md";
    dot?: boolean;
  }>(),
  { tone: "neutral", size: "md", dot: false },
);
</script>

<template>
  <span class="tag" :class="[tone, size]">
    <span v-if="dot" class="dot" />
    <slot />
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: var(--radius-full);
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;
}
.md {
  height: 22px;
  padding: 0 9px;
  font-size: var(--text-xs);
}
.sm {
  height: 18px;
  padding: 0 7px;
  font-size: 11px;
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentcolor;
}
.neutral {
  background: var(--bg-sunken);
  color: var(--text-3);
  border-color: var(--border-1);
}
.brand {
  background: var(--brand-50);
  color: var(--brand-700);
  border-color: var(--brand-200);
}
.success {
  background: var(--success-bg);
  color: var(--success);
  border-color: #1d5c3c;
}
.warning {
  background: var(--warning-bg);
  color: var(--warning);
  border-color: #6b4d12;
}
.danger {
  background: var(--danger-bg);
  color: var(--danger);
  border-color: #6b2626;
}
.info {
  background: var(--info-bg);
  color: var(--info);
  border-color: #1d4a76;
}
</style>
