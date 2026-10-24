<script setup lang="ts">
// 根布局：全站深色（与竞品 ReelMate 一致），按路由切换壳层
// default = 公共页（落地/登录/协议），app = 工作台壳，tool = 生成工具（独立双栏，无侧栏）
const route = useRoute();

const workspacePaths = [
  "/home",
  "/projects",
  "/assets",
  "/tasks",
  "/credits",
  "/settings",
  "/pricing",
  "/admin",
];
const toolPaths = ["/create"];

function matchAny(paths: string[]): boolean {
  return paths.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}

const layoutName = computed(() => {
  if (matchAny(toolPaths)) return "tool";
  if (matchAny(workspacePaths)) return "app";
  return "default";
});
</script>

<template>
  <div class="theme-dark">
    <NuxtLayout :name="layoutName">
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<style>
html,
body {
  background: var(--dark-base);
}
.theme-dark,
.theme-dark body {
  min-height: 100vh;
  background: var(--dark-base);
  color: var(--text-1);
}
</style>
