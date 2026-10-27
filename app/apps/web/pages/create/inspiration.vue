<script setup lang="ts">
// 灵感成片（工具箱落地页）：创意 → Agent 规划 → 出片
//
// 走 agent 域（`/agent/task/create`），不新增生成端点（ADR-003）。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "灵感成片" });
useHead({ title: "灵感成片 · 一帧" });
</script>

<template>
  <InspirationWorkspace />
</template>
