<script setup lang="ts">
// 涂抹重绘（工具箱落地页）：源图 + 蒙版 + 重绘描述 → 只改蒙版区域的图
//
// mode 是 `inpaint`（既有图像编辑 mode，不新增枚举）；蒙版走 `reference_uris[1]`。
definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "涂抹重绘" });
useHead({ title: "涂抹重绘 · 一帧" });
</script>

<template>
  <ToolWorkspace :tools="['inpaint']" />
</template>
