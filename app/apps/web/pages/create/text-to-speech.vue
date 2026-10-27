<script setup lang="ts">
// 文生语音（工具箱落地页）：台词文本 + 音色/语速 → 配音音轨
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.textToSpeech" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.textToSpeech") }) });
</script>

<template>
  <ToolWorkspace :tools="['text-to-speech']" />
</template>
