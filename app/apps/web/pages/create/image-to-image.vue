<script setup lang="ts">
// 图生图（工具页）：参考图 + 提示词 → 新图；复用图片生成工作台
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.image" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.image") }) });
</script>

<template>
  <ImageGenWorkspace initial-mode="image2image" />
</template>
