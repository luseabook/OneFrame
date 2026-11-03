<script setup lang="ts">
/**
 * 竞品路由承接：`/short-film/:id`（第 132 批）。
 *
 * 竞品把「短剧」作为独立形态挂在 `/short-film/:id`；其页面/响应体证据未捕获，
 * 无法证明它与 `/series-manage/:id` 的差异。按现有信息的最合理映射：我方"短剧项目"
 * 就是脚本项目（`script_projects`，即 `/projects/:id` 工作台），因此这里做**别名承接**，
 * 不再复制一套工作台（两套必然分叉）。
 *
 * 若后续拿到证据表明它是独立形态（例如不同的创建模式/字段集），再升级为独立页；
 * 当前至少保证外部深链不 404、进入后是可用的项目工作台。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const route = useRoute();

onMounted(() => {
  void navigateTo(`/projects/${String(route.params.id ?? "")}`, { replace: true });
});
</script>

<template>
  <div class="sf" aria-busy="true">
    <p class="sf-text">正在进入短剧项目…</p>
  </div>
</template>

<style scoped>
.sf {
  display: grid;
  place-items: center;
  min-height: 40vh;
  color: var(--text-3);
  font-size: 13px;
}
.sf-text {
  margin: 0;
}
</style>