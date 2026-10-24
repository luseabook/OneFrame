<script setup lang="ts">
// 工具布局：独立双栏页（无侧栏），左上返回 + 标题，对齐竞品「视频生成」页
const route = useRoute();
const title = computed(() => (route.meta.toolTitle as string) || "视频生成");
</script>

<template>
  <div class="tool-page">
    <header class="head">
      <button class="back" aria-label="返回" @click="$router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
        </svg>
      </button>
      <h1>{{ title }}</h1>
    </header>
    <main class="body">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.tool-page {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  min-height: 64px;
}
.back {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.back svg {
  width: 20px;
  height: 20px;
}
.back:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.body {
  flex: 1;
  min-width: 0;
}
</style>
