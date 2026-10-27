<script setup lang="ts">
import type { NovelStepState } from "~/types/api";

/**
 * 改编链 / 原创链共用步进器。
 *
 * 默认清单是改编链七步（分章 → 内容分析 → 章节大纲 → 分集大纲 → 核心角色 → 分集剧本 → 定稿）；
 * 原创链通过 `items` 换成八步（创意方案 → 选定 → 素材 → 总纲 → 分卡章纲 → 集纲 → 剧本 → 定稿）。
 * 两条链复用同一组件而不是各写一套：用户对"我现在在哪一步、还差什么"的心智模型一样，
 * UI 就该一样，差别只在步骤名。
 *
 * 为什么用 `hint` 而不是只画进度条：这条链每一步都是"用户必须点一下"的显式动作，
 * 用户最常问的是"卡在哪、下一步该点什么"，所以未完成的步骤直接把待办文案摆出来，
 * 已完成显示产出数量（如「3 章已解析」）。
 */
const props = defineProps<{
  steps: Record<string, NovelStepState>;
  active: string;
  /** 步骤清单（省略 = 改编链七步） */
  items?: Array<{ key: string; label: string }>;
}>();

defineEmits<{ pick: [key: string] }>();

const DEFAULT_ORDER: Array<{ key: string; label: string }> = [
  { key: "split", label: "分章" },
  { key: "content_analysis", label: "内容分析" },
  { key: "chapter_outline", label: "章节大纲" },
  { key: "episode_outline", label: "分集大纲" },
  { key: "core_character", label: "核心角色" },
  { key: "script", label: "分集剧本" },
  { key: "finalize", label: "定稿" },
];

const items = computed(() =>
  (props.items ?? DEFAULT_ORDER).map((row) => ({
    ...row,
    done: props.steps[row.key]?.done ?? false,
    hint: props.steps[row.key]?.hint ?? "",
  })),
);
</script>

<template>
  <nav class="stepper" aria-label="创作链步骤">
    <button
      v-for="(item, index) in items"
      :key="item.key"
      type="button"
      class="step"
      :class="{ done: item.done, active: active === item.key }"
      :title="item.hint"
      @click="$emit('pick', item.key)"
    >
      <span class="dot" aria-hidden="true">{{ item.done ? "✓" : index + 1 }}</span>
      <span class="label">{{ item.label }}</span>
      <span class="hint">{{ item.hint }}</span>
    </button>
  </nav>
</template>

<style scoped>
.stepper {
  display: grid;
  /* 步数随 items 变化（改编 7 步 / 原创 8 步）：auto-fit 让两者都不用单独写样式 */
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-surface);
}
.step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-3);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    background var(--duration-fast);
}
.step:hover {
  border-color: var(--border-3);
  background: var(--bg-hover);
}
.step.active {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.step.done .dot {
  background: var(--success-bg);
  color: var(--success);
  border-color: #1d5c3c;
}
.dot {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--border-2);
  font-size: 11px;
  color: var(--text-3);
}
.label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}
.step.active .label {
  color: var(--text-1);
}
.hint {
  font-size: var(--text-xs);
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1180px) {
  .stepper {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .stepper {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
