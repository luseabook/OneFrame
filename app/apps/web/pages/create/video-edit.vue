<script setup lang="ts">
// 视频编辑（工具页）：源视频 + 编辑描述 → 改内容后的视频
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.video" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.video") }) });
</script>

<template>
  <MediaGenWorkspace initial-mode="edit" />
</template>
