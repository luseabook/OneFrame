<script setup lang="ts">
/**
 * 竞品路由承接：`/adjust`（第 134 批）。
 *
 * 竞品只有路由名与组件 chunk（`BGyS1IwC.js`），没有页面/字段证据；从名字与所属账号模块
 * （`fullsite-route-inventory.md` #22 账号/鉴权）判断，它是**账号调整**类页面。
 * 我方对应的真实页面是 `/settings`（资料、绑定、注销、积分），因此做别名承接，
 * 不复制一套设置逻辑（两处必然分叉）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
onMounted(() => {
  void navigateTo("/settings", { replace: true });
});
</script>

<template>
  <div class="adj" aria-busy="true"><p>正在进入账号设置…</p></div>
</template>

<style scoped>
.adj {
  display: grid;
  place-items: center;
  min-height: 40vh;
  color: var(--text-3);
  font-size: 13px;
}
.adj p {
  margin: 0;
}
</style>