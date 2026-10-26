<script setup lang="ts">
/**
 * 裸壳布局（blank）
 *
 * 为什么需要它：画布族（/canvas 列表 + /canvas/:id 编辑器）是「全屏应用界面」，
 * 参照站实测同样无侧栏（docs/03-frontend/reference-alignment-spec.md §1.1 注：
 * /reelflow/*、/create/*、/canvas 属编辑器族，使用独立无侧栏布局）。
 *
 * 如果套 `app` 壳，编辑器会被 240px 侧栏 + 64px 顶栏挤掉 304px 宽高，
 * 100dvh 的画布世界坐标和框选/缩放全部失真；列表页也会出现"两层顶栏"。
 *
 * 因此这里只做两件事：铺满视口高度 + 给底色。
 * 具体 chrome（列表页的轻量返回条、编辑器的浮层顶栏）由页面自己决定，
 * 布局层不预设任何 chrome，否则页面想换形态就得跟布局打架。
 */
</script>

<template>
  <div class="blank-shell">
    <slot />
  </div>
</template>

<style scoped>
.blank-shell {
  /* 先写 100vh 兜底（老浏览器），再写 100dvh 覆盖：移动端地址栏收起/展开时
     dvh 才会跟着变，只写 vh 会留一条白边或截断底部工具条。 */
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text-1);
}

/* 页面根节点默认撑满布局：blank 下页面是唯一子元素，
   让 .canvas-list / .canvas-view 的 height:100% 有确定的父高可依 */
.blank-shell > :deep(*) {
  flex: 1;
  min-width: 0;
}
</style>
