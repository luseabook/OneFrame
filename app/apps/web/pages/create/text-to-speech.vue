<script setup lang="ts">
// 文生语音（工具箱落地页）：台词文本 + 音色/语速 → 配音音轨
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "文生语音" });
useHead({ title: "文生语音 · 一帧" });
</script>

<template>
  <ToolWorkspace :tools="['text-to-speech']" />
</template>
