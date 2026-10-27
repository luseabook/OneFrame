<script setup lang="ts">
// 视频特效（工具箱落地页）：源视频 + 特效模板 → 只改观感不改内容的视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.videoEffects" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.videoEffects") }) });
</script>

<template>
  <ToolWorkspace :tools="['video-effects']" />
</template>
