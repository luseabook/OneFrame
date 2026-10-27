<script setup lang="ts">
// 视频超清（工具箱落地页）
//
// 为什么这一页带 6 个 tab：参照站只有 `/create/video-upscale` 一条路由
// （`rea-reelmate/routes.txt:41`），而「去字幕 / 切片 / 帧率时长统一 / 音画分离」
// 在竞品侧是**画布节点上的后处理动作**、没有独立工具页。我方把这族能力收在同一张
// 「视频超清」卡的落地页里：能力都有真实 mode + 报价 + 适配器分派，不为竞品没有路由的
// 功能臆造卡片（ADR-013 决策 2）。竞品对应交互的取证登记在 report-tools.md。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频超清" });
useHead({ title: "视频超清 · 一帧" });
</script>

<template>
  <ToolWorkspace
    :tools="[
      'video-upscale',
      'de-subtitle-auto',
      'de-subtitle-region',
      'video-slicing',
      'fps-unify',
      'audio-separation',
    ]"
  />
</template>
