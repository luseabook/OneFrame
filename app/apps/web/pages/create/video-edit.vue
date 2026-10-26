<script setup lang="ts">
// 视频编辑（工具页）：源视频 + 编辑描述 → 改内容后的视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频生成" });
useHead({ title: "视频生成 · 一帧" });
</script>

<template>
  <MediaGenWorkspace initial-mode="edit" />
</template>
