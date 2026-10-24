<script setup lang="ts">
const props = withDefaults(
  defineProps<{ label?: string; type?: string; placeholder?: string; maxlength?: number }>(),
  { type: "text", placeholder: "", maxlength: undefined },
);
const model = defineModel<string>({ default: "" });
const id = useId();
</script>

<template>
  <div class="field">
    <label v-if="props.label" :for="id" class="label">{{ props.label }}</label>
    <input
      :id="id"
      v-model="model"
      class="input"
      :type="props.type"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
    />
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  color: var(--text-2);
  font-size: 13px;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
}
.input:focus {
  border-color: var(--color-primary);
}
</style>
