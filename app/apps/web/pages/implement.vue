<script setup lang="ts">
/**
 * 竞品路由承接：`/implement`（第 134 批）。
 *
 * 竞品该路由与 `/cli` 同属「MCP & CLI」模块（`fullsite-route-inventory.md:60`）：
 * 组件名 `ImplementList`，没有后端端点，能力由 CLI/Skill 包承载。我方 `/cli` 页
 * 已把安装、能力、38 组命令展示完整，因此这里做别名承接，不另造一个“实施列表”。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
onMounted(() => {
  void navigateTo("/cli", { replace: true });
});
</script>

<template>
  <div class="imp" aria-busy="true"><p>正在进入 CLI 工具页…</p></div>
</template>

<style scoped>
.imp {
  display: grid;
  place-items: center;
  min-height: 40vh;
  color: var(--text-3);
  font-size: 13px;
}
.imp p {
  margin: 0;
}
</style>