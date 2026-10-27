<script setup lang="ts">
// 文字重绘（工具箱落地页）：源图 + 替换文字 + 字体风格 → 保留画面结构换字的图
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.textRepaint" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.textRepaint") }) });
</script>

<template>
  <ToolWorkspace :tools="['text-repaint']" />
</template>
