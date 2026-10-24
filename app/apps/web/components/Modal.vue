<script setup lang="ts">
defineProps<{ title?: string; width?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="title || $slots.default" class="mask" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-modal="true" :style="width ? { width } : undefined">
        <div v-if="title" class="head">
          <span class="title">{{ title }}</span>
          <button class="x" aria-label="关闭" @click="emit('close')">✕</button>
        </div>
        <div class="body"><slot /></div>
        <div v-if="$slots.footer" class="foot"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 17, 21, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  animation: fade var(--duration-base) var(--ease-out);
}
.panel {
  width: min(480px, 92vw);
  max-height: 86vh;
  overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}
.title {
  font-size: var(--text-lg);
  font-weight: 600;
}
.x {
  background: none;
  border: 0;
  color: var(--text-3);
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  line-height: 1;
}
.x:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.body {
  color: var(--text-2);
  font-size: var(--text-base);
}
.foot {
  margin-top: var(--space-6);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
