<script setup lang="ts">
// 文字重绘（工具箱落地页）：源图 + 替换文字 + 字体风格 → 保留画面结构换字的图
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "文字重绘" });
useHead({ title: "文字重绘 · 一帧" });
</script>

<template>
  <ToolWorkspace :tools="['text-repaint']" />
</template>
