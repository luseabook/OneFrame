<script setup lang="ts">
const props = withDefaults(
  defineProps<{ label?: string; placeholder?: string; maxlength?: number; rows?: number; hint?: string; error?: string }>(),
  { rows: 4, placeholder: "", maxlength: undefined },
);
const model = defineModel<string>({ default: "" });
const id = useId();
</script>

<template>
  <div class="field" :class="{ invalid: !!props.error }">
    <label v-if="props.label" :for="id" class="label">{{ props.label }}</label>
    <textarea
      :id="id"
      v-model="model"
      class="area"
      :rows="props.rows"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
    />
    <div class="foot">
      <p v-if="props.error" class="msg error">{{ props.error }}</p>
      <p v-else-if="props.hint" class="msg hint">{{ props.hint }}</p>
      <span v-if="props.maxlength" class="count">{{ model.length }}/{{ props.maxlength }}</span>
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
.area {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: var(--space-3);
  font-size: var(--text-base);
  line-height: 1.6;
  outline: none;
  resize: vertical;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.area::placeholder {
  color: var(--text-4);
}
.area:hover {
  border-color: var(--border-3);
}
.area:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 3px var(--brand-100);
}
.invalid .area {
  border-color: var(--danger);
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
.count {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
