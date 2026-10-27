<script setup lang="ts">
// 视频参考（工具页）：参考视频 + 提示词 → 同运镜/同节奏的新视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.video" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.video") }) });
</script>

<template>
  <MediaGenWorkspace initial-mode="reference" />
</template>
