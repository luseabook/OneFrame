<script setup lang="ts">
/**
 * 竞品路由别名：`/film/projects/:id/tasks`（第 132 批）。
 *
 * 竞品把影视版的任务表挂在项目下的独立路由；我方同一个任务表就是 `/film/:id`
 * （`pages/film/[id].vue` 的表格：行=任务、列=字段、审核版本链、派工）。
 * 台账已把该条判为「等价视图（🔶）」，这里补的是**入口**：外部深链不再 404。
 *
 * 不复制一份任务表实现：两处渲染同一张表必然分叉（字段/状态/权限各改一半）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const route = useRoute();

onMounted(() => {
  void navigateTo(`/film/${String(route.params.id ?? "")}`, { replace: true });
});
</script>

<template>
  <div class="ft" aria-busy="true">
    <p class="ft-text">正在进入影视任务表…</p>
  </div>
</template>

<style scoped>
.ft {
  display: grid;
  place-items: center;
  min-height: 40vh;
  color: var(--text-3);
  font-size: 13px;
}
.ft-text {
  margin: 0;
}
</style>