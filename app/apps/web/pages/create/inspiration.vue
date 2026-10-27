<script setup lang="ts">
// 灵感成片（工具箱落地页）：创意 → Agent 规划 → 出片
//
// 走 agent 域（`/agent/task/create`），不新增生成端点（ADR-003）。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.inspiration" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.inspiration") }) });
</script>

<template>
  <InspirationWorkspace />
</template>
