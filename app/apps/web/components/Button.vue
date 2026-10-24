<script setup lang="ts">
withDefaults(
  defineProps<{ variant?: "primary" | "ghost"; disabled?: boolean }>(),
  { variant: "primary", disabled: false },
);
</script>

<template>
  <button class="btn" :class="variant" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  border: 0;
  border-radius: var(--radius-m);
  padding: 10px 20px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn.primary {
  background: var(--color-primary);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
.btn.ghost {
  background: transparent;
  color: var(--text-1);
  border: 1px solid var(--color-border);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
