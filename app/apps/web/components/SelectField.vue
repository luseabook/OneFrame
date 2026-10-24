<script setup lang="ts">
const props = withDefaults(
  defineProps<{ label?: string; options: Array<{ value: string; label: string; disabled?: boolean }>; placeholder?: string; disabled?: boolean }>(),
  { placeholder: "请选择", disabled: false },
);
const model = defineModel<string>({ default: "" });
const id = useId();
</script>

<template>
  <div class="field">
    <label v-if="props.label" :for="id" class="label">{{ props.label }}</label>
    <div class="wrap">
      <select :id="id" v-model="model" class="select" :disabled="props.disabled">
        <option value="" disabled>{{ props.placeholder }}</option>
        <option
          v-for="opt in props.options"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
        >
          {{ opt.label }}
        </option>
      </select>
      <span class="chevron" aria-hidden="true">▾</span>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.label {
  color: var(--text-2);
  font-size: var(--text-sm);
  font-weight: 500;
}
.wrap {
  position: relative;
  display: flex;
}
.select {
  appearance: none;
  width: 100%;
  height: 34px;
  background: var(--bg-surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 0 var(--space-8) 0 var(--space-3);
  font-size: var(--text-base);
  outline: none;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.select:hover:not(:disabled) {
  border-color: var(--border-3);
}
.select:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 3px var(--brand-100);
}
.select:disabled {
  background: var(--bg-sunken);
  color: var(--text-4);
  cursor: not-allowed;
}
.chevron {
  position: absolute;
  right: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-4);
  pointer-events: none;
  font-size: 11px;
}
</style>
