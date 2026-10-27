<script setup lang="ts">
// 文生音效（工具箱落地页）：音效描述 + 时长 → 音效音轨
//
// 路由名与参照站一致（`/create/text-to-sound`，routes.txt:34）；
// 我方 mode 叫 `text2sfx`（与 `text2music` 共用 MusicAdapter 的 kind 差异）。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.textToSound" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.textToSound") }) });
</script>

<template>
  <ToolWorkspace :tools="['text-to-sound']" />
</template>
