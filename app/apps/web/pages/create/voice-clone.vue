<script setup lang="ts">
// 声音克隆（工具箱落地页）：一段参考音频 + 朗读文本 → 克隆音色读出这段文本
// 「我的音色」列表在同一个工作台的产物历史里（mode=voice_clone），不另开页面
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.voiceClone" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.voiceClone") }) });
</script>

<template>
  <ToolWorkspace :tools="['voice-clone']" />
</template>
