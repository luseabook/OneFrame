<script setup lang="ts">
defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="panel" role="dialog" aria-modal="true">
        <div class="head">
          <span class="title">{{ title }}</span>
          <button class="x" aria-label="关闭" @click="emit('close')">✕</button>
        </div>
        <div class="body"><slot /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.panel {
  width: min(420px, 92vw);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 20px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title {
  font-weight: 600;
}
.x {
  background: none;
  border: 0;
  color: var(--text-2);
  cursor: pointer;
  font-size: 14px;
}
</style>
