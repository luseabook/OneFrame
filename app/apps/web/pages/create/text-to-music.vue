<script setup lang="ts">
// 文生音乐（工具箱落地页）：音乐描述 + 时长/是否纯伴奏 → 配乐音轨
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.textToMusic" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.textToMusic") }) });
</script>

<template>
  <ToolWorkspace :tools="['text-to-music']" />
</template>
