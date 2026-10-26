<script setup lang="ts">
// 视频参考（工具页）：参考视频 + 提示词 → 同运镜/同节奏的新视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频生成" });
useHead({ title: "视频生成 · 一帧" });
</script>

<template>
  <MediaGenWorkspace initial-mode="reference" />
</template>
