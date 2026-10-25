<script setup lang="ts">
// 根布局：全站深色（与竞品 ReelMate 一致），按路由切换壳层
// default = 公共页（落地/登录/协议），app = 工作台壳，tool = 生成工具（独立双栏，无侧栏）
// admin = 运营后台专用壳层（与用户端菜单/积分/页脚完全隔离）
const route = useRoute();

const workspacePaths = [
  "/home",
  "/works",
  "/projects",
  "/tools",
  "/assets",
  "/tasks",
  "/credits",
  "/settings",
  "/pricing",
];
const adminPaths = ["/admin"];
const adminLoginPaths = ["/admin/login"];
const toolPaths = ["/create"];
// 落地页自带独立导航与页脚（含法务入口与 ICP），不再套公共壳层，避免出现两层顶栏/两层页脚
const barePaths = ["/"];

function matchAny(paths: string[]): boolean {
  return paths.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}

const layoutName = computed(() => {
  if (matchAny(barePaths)) return "";
  if (matchAny(adminLoginPaths)) return "admin-login";
  if (matchAny(adminPaths)) return "admin";
  if (matchAny(toolPaths)) return "tool";
  if (matchAny(workspacePaths)) return "app";
  return "default";
});
</script>

<template>
  <div class="theme-dark">
    <NuxtLayout v-if="layoutName" :name="layoutName">
      <NuxtPage />
    </NuxtLayout>
    <NuxtPage v-else />
    <ToastHost />
  </div>
</template>

<style>
html,
body {
  background: var(--bg-app);
}
.theme-dark,
.theme-dark body {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
}
</style>
