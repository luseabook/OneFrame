<script setup lang="ts">
// 全局轻提示（PRD UI 一致性 / U6 收口）：各页通过 useToast() 触发，集中渲染在**顶部居中**的深色胶囊里，
// 2.6s 自动消失（错误也不常驻、不弹模态）。
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
/* 统一反馈：**顶部居中**、深色、自动消失（U6）。
   旧值是右下角 + 深灰 #333（--dark-elevated）底，与竞品"顶部居中深色条"不一致；
   同屏多页各自弹 toast 时会挡住右下角的主行动（立即生成 / 批量投递）。
   top 72 = 64 顶栏 + 8 间距；宽度用 max-content 而不是固定宽度，
   短句不会拉成一条空条幅，长句在 560 处换行。 */
.toasts {
  position: fixed;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(560px, calc(100vw - 32px));
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 16px;
  border-radius: 10px;
  /* 深色胶囊：比页面底 #0B0B10 亮一档，靠 1px 白 12% 描边分层，不额外上品牌色 */
  background: #1b1b20;
  border: 1px solid #ffffff1f;
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.45;
  box-shadow: 0 12px 32px #00000080;
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
