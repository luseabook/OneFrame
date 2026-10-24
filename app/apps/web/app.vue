<script setup lang="ts">
// 根布局：按路由切换「深色营销布局」与「浅色工作台布局」
const route = useRoute();

const workspacePaths = [
  "/projects",
  "/create",
  "/assets",
  "/tasks",
  "/credits",
  "/settings",
  "/pricing",
  "/admin",
];

const isWorkspace = computed(() =>
  workspacePaths.some((p) => route.path === p || route.path.startsWith(`${p}/`)),
);
</script>

<template>
  <div :class="isWorkspace ? 'theme-light' : 'theme-dark'">
    <NuxtLayout :name="isWorkspace ? 'app' : 'default'">
      <NuxtPage />
    </NuxtLayout>
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
  background: var(--dark-base);
  color: var(--text-inverse);
}
.theme-light,
.theme-light body {
  min-height: 100vh;
  background: var(--bg-app);
}
</style>