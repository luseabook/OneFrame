<script setup lang="ts">
// 视频对口型（工具箱落地页）：目标视频 + 人声音频 → 唇形重驱动后的视频
//
// 页面本体由 `/generations/tools` 目录驱动（`tool-catalog.ts` 单一数据源），
// 这里只声明用哪个工具、以及工具页标题。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.lipSync" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.lipSync") }) });
</script>

<template>
  <ToolWorkspace :tools="['lip-sync']" />
</template>
