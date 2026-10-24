<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; avatar?: boolean }>(), { rows: 3, avatar: false });
</script>

<template>
  <div class="skeleton" :class="{ withAvatar: avatar }">
    <div v-if="avatar" class="circle" />
    <div class="lines">
      <div v-for="i in rows" :key="i" class="line" :style="{ width: `${100 - (i - 1) * 14}%` }" />
    </div>
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}
.circle {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  flex-shrink: 0;
}
.lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.line {
  height: 12px;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--bg-sunken) 25%, var(--bg-hover) 37%, var(--bg-sunken) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
</style>
