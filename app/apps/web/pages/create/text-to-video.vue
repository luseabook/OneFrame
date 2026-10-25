<script setup lang="ts">
// 文生视频（工具页）：统一使用参照产品「视频生成」左右分栏工作台
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频生成" });
useHead({ title: "视频生成 · 一帧" });
</script>

<template>
  <VideoGenWorkspace initial-mode="text2video" />
</template>
