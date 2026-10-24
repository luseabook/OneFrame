<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label?: string;
    type?: string;
    placeholder?: string;
    maxlength?: number;
    hint?: string;
    error?: string;
    disabled?: boolean;
    required?: boolean;
  }>(),
  { type: "text", placeholder: "", maxlength: undefined },
);
const model = defineModel<string>({ default: "" });
const id = useId();
</script>

<template>
  <div class="field" :class="{ invalid: !!props.error }">
    <label v-if="props.label" :for="id" class="label">
      {{ props.label }}
      <span v-if="props.required" class="req">*</span>
    </label>
    <input
      :id="id"
      v-model="model"
      class="input"
      :type="props.type"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
      :disabled="props.disabled"
    />
    <p v-if="props.error" class="msg error">{{ props.error }}</p>
    <p v-else-if="props.hint" class="msg hint">{{ props.hint }}</p>
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
.req {
  color: var(--danger);
  margin-left: 2px;
}
.input {
  height: 34px;
  background: var(--bg-surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 0 var(--space-3);
  font-size: var(--text-base);
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.input::placeholder {
  color: var(--text-4);
}
.input:hover:not(:disabled) {
  border-color: var(--border-3);
}
.input:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 3px #7e70ff2e;
}
.input:disabled {
  background: var(--bg-sunken);
  color: var(--text-4);
  cursor: not-allowed;
}
.invalid .input {
  border-color: var(--danger);
}
.invalid .input:focus {
  box-shadow: 0 0 0 3px var(--danger-bg);
}
.msg {
  margin: 0;
  font-size: var(--text-xs);
}
.hint {
  color: var(--text-3);
}
.error {
  color: var(--danger);
}
</style>
