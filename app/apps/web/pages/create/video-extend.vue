<script setup lang="ts">
// 视频续写（工具页）：源视频 + 提示词 → 更长/接续的视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.video" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.video") }) });
</script>

<template>
  <MediaGenWorkspace initial-mode="extend" />
</template>
