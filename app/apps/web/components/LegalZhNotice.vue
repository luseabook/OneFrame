<script setup lang="ts">
/**
 * 「本页法律文本以中文版为准」提示（conventions.md §8.1 第 3 款）。
 *
 * 触发条件：**界面语言不是中文**时显示。中文用户看不到它——中文版就是正文本身，再提示一句是噪音。
 *
 * 为什么需要这条：`/terms` `/privacy` `/report` 的正文是中文写死的、且只有中文版经法务审定。
 * 这三个页面现在会服务端渲染（§8），非中文用户从 `/en/terms` 这类入口进来时，
 * 会看到一个英文标题、中文正文的页面；不给提示，用户会以为页面加载失败或翻译没做完。
 * 提示语本身走语言包（5 语各一条），保证"用用户的语言说明这件事"。
 */
const { t, locale } = useI18n();
const visible = computed(() => locale.value !== "zh-CN");
</script>

<template>
  <p v-if="visible" class="legal-zh-notice" role="note">
    {{ t("shell.zhOnlyNotice") }}
  </p>
</template>

<style scoped>
/* 只消费层二令牌（tokens.css），不自造色板与字号档位 */
.legal-zh-notice {
  margin: 0 0 20px;
  padding: 10px 14px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: var(--text-sm-lh);
}
</style>
