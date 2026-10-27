<script setup lang="ts">
// 参考生视频（工具页）：多图参考 → 视频
//
// 工作台本来就带「参考生视频」模式（`modeTabs` + `universal_reference`），
// 缺的只是一个能进来的入口页；单独写一套参考生视频页面会让两种入口的实现漂移。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "shell.toolTitles.video" });
const { t } = useI18n();
useHead({ title: () => t("shell.titleSuffix", { title: t("shell.toolTitles.video") }) });
</script>

<template>
  <VideoGenWorkspace initial-mode="reference" />
</template>
