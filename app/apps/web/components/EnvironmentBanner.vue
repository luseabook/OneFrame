<script setup lang="ts">
/**
 * 全局「演示环境」声明条（`docs/03-frontend/conventions.md` 披露口径 / OPS-12）。
 *
 * 为什么必须有它：`LLM_MODE=mock` 时大纲/剧本/分镜是**结构正确、内容为假**的确定性文案，
 * 界面看不出任何异常。此前唯一有标识的是小说详情页的角标（`pages/novel/[id].vue:470`），
 * 而 LLM 产物主要落在项目详情页 —— 用户从那里进去看到的是"像真的一样"的结果。
 * Architect 据此定了 B 方案（具名逃生舱），前提就是这条声明必须**真的可见**。
 *
 * 三条硬约束（不可妥协）：
 * 1. **顶栏常驻**：放在壳层，不在某个页面里 —— 换页面不消失；
 * 2. **不可关闭**：没有关闭按钮、不写 localStorage。可关的 banner 等于没有，
 *    用户点掉一次就再也看不到，而"内容是假的"这件事不会因此变真；
 * 3. **移动端不得隐藏**：样式里没有任何 `display:none` 的断点，窄屏只是换行。
 *
 * 数据来源：`/v1/me` 响应的**根部** `llm_mode`（`MeResponse.llm_mode`），
 * 由 `useAuth().me()` 映射进 `state.llmMode` —— 注意它**不在 `user` 对象里**，
 * 写成 `user.llm_mode` 会永远读不到（部署实测响应形如
 * `{ user, space, credits, vip, bindings, llm_mode }`）。
 * 未登录 / 尚未调过 me 时为 null → **一律不渲染**，宁可少一条提示，也不谎报。
 */
const auth = useAuth();
const { t } = useI18n();

const isMock = computed(() => auth.state.value.llmMode === "mock");
</script>

<template>
  <p v-if="isMock" class="env-banner" data-env-banner role="status" aria-live="polite">
    <span class="dot" aria-hidden="true" />
    <span class="text">{{ t("shell.mockBanner") }}</span>
  </p>
</template>

<style scoped>
/* 只消费层二令牌（tokens.css）；不设任何隐藏断点 */
.env-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 7px 16px;
  background: var(--warning-bg);
  border-bottom: 1px solid var(--warning);
  color: var(--text-1);
  font-size: var(--text-sm);
  line-height: var(--text-sm-lh);
  /* 窄屏允许换行，但不隐藏 */
  flex-wrap: wrap;
}
.dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
}
.text {
  min-width: 0;
}
</style>
