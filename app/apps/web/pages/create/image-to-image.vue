<script setup lang="ts">
// 图生图（工具页）：参考图 + 提示词 → 新图；复用图片生成工作台
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "图片生成" });
useHead({ title: "图片生成 · 一帧" });
</script>

<template>
  <ImageGenWorkspace initial-mode="image2image" />
</template>
