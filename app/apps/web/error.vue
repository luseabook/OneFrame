<script setup lang="ts">
// 404 / 错误页：对齐参照产品 404 形态（reference-alignment-spec §9.4）
// 参照证据：纯深色背景 + 页面中央偏上一个胶囊「页面未找到」，无插画、无页脚。
import type { NuxtError } from "#app";

const props = defineProps<{ error: NuxtError }>();
useHead({ title: "页面未找到 · 一帧" });

// 参照站没有返回按钮；为了让胶囊不是死路，胶囊本身可点（视觉上仍是纯胶囊）
function goHome(): void {
  void clearError({ redirect: "/" });
}
</script>

<template>
  <main class="notfound">
    <button class="pill" type="button" title="返回首页" @click="goHome">
      {{ props.error?.statusCode === 404 || !props.error?.statusCode ? "页面未找到" : "出错了" }}
    </button>
  </main>
</template>

<style scoped>
.notfound {
  min-height: 100vh;
  background: var(--bg-app);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 100px 16px 0;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 24px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  background: #1a1a1f;
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.pill:hover {
  border-color: var(--border-3);
}
</style>
