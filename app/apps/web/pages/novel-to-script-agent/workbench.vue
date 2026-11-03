<script setup lang="ts">
/**
 * 竞品路由别名：`/novel-to-script-agent/workbench`（第 132 批）。
 *
 * 竞品的"小说改编工作台"在进入具体本子之前先落到工作台入口；我方同形态的页面是
 * `/novel`（本子列表 + 上传/粘贴 → 建本子 → 进 `/novel/:id` 工作台，见 `pages/novel/index.vue`
 * 文件头注释：它本来就写明对照 workbench）。
 *
 * 这一页只做路由承接：L0「入口存在」对齐，不复制一套列表逻辑（两处列表必然分叉）。
 * 带 `?id=` 时直接进对应本子，保持外部旧链接可用。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const route = useRoute();

onMounted(() => {
  const id = String(route.query.id ?? "").trim();
  void navigateTo(id ? `/novel/${id}` : "/novel", { replace: true });
});
</script>

<template>
  <div class="nw" aria-busy="true">
    <p class="nw-text">正在进入小说改编工作台…</p>
  </div>
</template>

<style scoped>
.nw {
  display: grid;
  place-items: center;
  min-height: 40vh;
  color: var(--text-3);
  font-size: 13px;
}
.nw-text {
  margin: 0;
}
</style>