<script setup lang="ts">
// 全局轻提示（PRD UI 一致性）：各页通过 useToast() 触发，集中渲染在右下角
type ToastItem = { id: number; type: "success" | "error" | "info"; text: string };

const items = ref<ToastItem[]>([]);
let seq = 0;

function push(type: ToastItem["type"], text: string, duration = 2600): void {
  const id = ++seq;
  items.value = [...items.value, { id, type, text }];
  setTimeout(() => {
    items.value = items.value.filter((i) => i.id !== id);
  }, duration);
}

function remove(id: number): void {
  items.value = items.value.filter((i) => i.id !== id);
}

// 暴露到全局，供 useToast() 取用
const toast = { push, success: (t: string) => push("success", t), error: (t: string) => push("error", t), info: (t: string) => push("info", t) };
if (import.meta.client) {
  (globalThis as unknown as { __of_toast?: typeof toast }).__of_toast = toast;
}
</script>

<template>
  <Teleport to="body">
    <div class="toasts" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="item in items" :key="item.id" class="toast" :class="item.type" @click="remove(item.id)">
          <span class="dot" />
          <span class="text">{{ item.text }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--space-6);
  bottom: var(--space-6);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 220px;
  max-width: 380px;
  padding: 10px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--dark-elevated);
  border: 1px solid #3f3f45;
  color: var(--text-inverse);
  font-size: var(--text-sm);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  cursor: pointer;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.success .dot {
  background: var(--success);
}
.error .dot {
  background: var(--danger);
}
.info .dot {
  background: var(--info);
}
.success {
  border-color: #2a5c42;
}
.error {
  border-color: #6b2b2b;
}
.text {
  line-height: 1.45;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
