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
  border-radius: var(--radius-md);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.btn.sm {
  height: 28px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}
.btn.md {
  height: 34px;
  padding: 0 var(--space-4);
  font-size: var(--text-base);
}
.btn.lg {
  height: 42px;
  padding: 0 var(--space-6);
  font-size: var(--text-lg);
  border-radius: var(--radius-lg);
}
.btn.block {
  width: 100%;
}

.primary {
  background: var(--brand-500);
  color: #fff;
}
.primary:hover:not(:disabled) {
  background: var(--brand-600);
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
