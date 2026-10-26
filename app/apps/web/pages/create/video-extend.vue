<script setup lang="ts">
// 视频续写（工具页）：源视频 + 提示词 → 更长/接续的视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频生成" });
useHead({ title: "视频生成 · 一帧" });
</script>

<template>
  <MediaGenWorkspace initial-mode="extend" />
</template>
