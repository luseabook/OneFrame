<script setup lang="ts">
// 自动配乐（工具箱落地页）：成片 + 风格 → 带 BGM 的成片（人声段自动压低）
//
// 注意产物是**视频**不是音轨：这条工具的产品语义是「成片自动匹配 BGM 与节奏点」，
// 用户要能直接发布（见 tool-catalog.ts 里 auto-bgm 的 result_media=video）。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.autoBgm" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.autoBgm") }) });
</script>

<template>
  <ToolWorkspace :tools="['auto-bgm']" />
</template>
