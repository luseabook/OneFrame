<script setup lang="ts">
// 图生图风格选择器（`GET /v1/effects` 的展示层）
//
// 为什么不做"默认选中第一项"：
// 剪影生图网关的 `options.effect` 不给就退它内置默认值（3D 童话），
// 前端再自动选中第一项，等于把"默认"换成"看起来是用户选的默认"——
// 用户上传任何照片都会得到同一种风格，却以为是自己的选择。所以空即是空。
import type { ImageEffectDto } from "~/types/api";

const props = withDefaults(
  defineProps<{
    /** 选中的 effect id；空串 = 用户还没选 */
    modelValue: string;
    effects: ImageEffectDto[];
    loading?: boolean;
    error?: string;
  }>(),
  { loading: false, error: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

/** 只做"选中"，不做"再点取消"：误触取消会让「请先选择风格」的拦截突然出现 */
function pick(item: ImageEffectDto): void {
  if (props.modelValue === item.id) return;
  emit("update:modelValue", item.id);
}
</script>

<template>
  <div class="effect-select">
    <span v-if="loading" class="fx-state">风格加载中…</span>
    <span v-else-if="error" class="fx-state fx-error">{{ error }}</span>
    <span v-else-if="!effects.length" class="fx-state">暂无可选风格</span>
    <div v-else class="fx-scroll">
      <button
        v-for="item in effects"
        :key="item.id"
        type="button"
        class="fx-pill"
        :class="{ on: modelValue === item.id }"
        :title="item.title"
        :aria-label="item.title"
        :aria-pressed="modelValue === item.id"
        @click="pick(item)"
      >
        {{ item.title_zh }}
        <span v-if="item.need_face" class="fx-face" title="该风格需要画面中有人脸">人</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.effect-select {
  min-width: 0;
  flex: 1;
}

.fx-state {
  font-size: 12px;
  color: var(--text-3);
}

.fx-error {
  color: var(--danger);
}

.fx-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0;
  scrollbar-width: thin;
}

.fx-pill {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.fx-pill.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}

/* 极小人像角标：只提示「这个风格认脸」，不拦截——不上人脸的图由后端自己判 */
.fx-face {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--panel-line);
  color: var(--text-3);
  font-size: 8px;
  line-height: 10px;
  text-align: center;
  flex: 0 0 auto;
}
</style>