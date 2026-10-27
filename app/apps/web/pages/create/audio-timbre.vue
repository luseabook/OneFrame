<script setup lang="ts">
// 音色修改（工具箱落地页）：源音轨 + 目标音色 → 同台词不同音色的音轨
//
// 卡片依据：参照站「音色修改」是报告点名但**无独立 `/create` 路由**的工具
// （`docs/01-product/reelmate-feature-map.md §3.5`），本批以 mode=`audio_timbre_modify` 承载。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "音色修改" });
useHead({ title: "音色修改 · 一帧" });
</script>

<template>
  <ToolWorkspace :tools="['audio-timbre']" />
</template>
