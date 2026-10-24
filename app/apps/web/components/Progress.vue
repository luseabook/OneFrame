<script setup lang="ts">
withDefaults(defineProps<{ value?: number; max?: number; tone?: "brand" | "success" | "warning" | "danger" }>(), {
  value: 0,
  max: 100,
  tone: "brand",
});
</script>

<template>
  <div class="wrap">
    <div class="track">
      <div class="fill" :class="tone" :style="{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }" />
    </div>
    <span v-if="$slots.default" class="text"><slot /></span>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
}
.track {
  flex: 1;
  height: 6px;
  background: var(--bg-sunken);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width var(--duration-slow) var(--ease-out);
}
.brand {
  background: var(--brand-500);
}
.success {
  background: var(--success);
}
.warning {
  background: var(--warning);
}
.danger {
  background: var(--danger);
}
.text {
  font-size: var(--text-xs);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
</style>
