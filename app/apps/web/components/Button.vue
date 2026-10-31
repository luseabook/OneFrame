<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "text";
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
    type?: "button" | "submit";
  }>(),
  { variant: "primary", size: "md", disabled: false, loading: false, block: false, type: "button" },
);
</script>

<template>
  <button
    class="btn"
    :class="[variant, size, { block, loading }]"
    :disabled="disabled || loading"
    :type="type"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <span class="label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  /* GL6：控件圆角 10px（竞品白按钮 y514→y523 左缘 x383→374 横跨 9–10px；旧值 6px 偏尖） */
  border-radius: var(--radius-control);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
/* GL7：高度只有 32 / 40 / 48 三档（竞品按钮 40、大号渐变 CTA 48） */
.btn.sm {
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}
.btn.md {
  height: var(--control-h-md);
  padding: 0 var(--space-4);
  font-size: var(--text-base);
}
.btn.lg {
  height: var(--control-h-lg);
  padding: 0 var(--space-6);
  font-size: var(--text-lg);
  border-radius: var(--radius-control);
}
.btn.block {
  width: 100%;
}

.primary {
  background: var(--brand-500);
  color: #fff;
}
/* GL7：竞品 hover **变亮** #A05AFF（--brand-02hover）；旧值 #8a3ae6 是变暗，方向相反 */
.primary:hover:not(:disabled) {
  background: var(--brand-hover);
}
.primary:active:not(:disabled) {
  background: var(--brand-pressed);
}

.secondary {
  background: #7e70ff1f;
  color: var(--brand-300);
  border-color: #7e70ff45;
}
.secondary:hover:not(:disabled) {
  background: #7e70ff33;
  border-color: #7e70ff66;
}

.ghost {
  background: var(--bg-surface);
  color: var(--text-2);
  border-color: var(--border-2);
}
.ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-1);
  border-color: var(--border-3);
}

.danger {
  background: var(--danger);
  color: #fff;
}
.danger:hover:not(:disabled) {
  background: #e04d4d;
}

.text {
  background: transparent;
  color: var(--text-2);
  padding: 0 var(--space-1);
}
.text:hover:not(:disabled) {
  color: var(--brand-400);
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* GL7/C4：竞品 primary 的 disabled 是「品牌紫 40% + 文字白 60%」，
   而不是整体 opacity（后者会把文字和图标一起调灰、看起来像被蒙了一层） */
.primary:disabled {
  opacity: 1;
  background: #9b46ff66;
  color: #ffffff99;
}
.btn.loading .label {
  opacity: 0.8;
}
.spinner {
  width: 13px;
  height: 13px;
  border: 2px solid currentcolor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
