<script setup lang="ts">
/**
 * 画布图标集（内联 SVG，不引第三方图标库）
 *
 * 为什么自己画：参照站的图标是 20/24px 的线性图标，形状简单；
 * 引一个图标库会带来整套 bundle 和版本风险，收益不匹配。
 * 统一用 currentColor + 1.6 描边，跟全站线性图标风格一致。
 */
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="cv-icon"
  >
    <!-- 选择（箭头） -->
    <template v-if="name === 'select'">
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </template>
    <!-- 抓手 -->
    <template v-else-if="name === 'hand'">
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-6-3-6-7v-2.5a1.5 1.5 0 0 1 3 0" />
    </template>
    <!-- 连线 -->
    <template v-else-if="name === 'link'">
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M7.8 16.2c1.6-1.6 1.4-4.6 3.2-6.4 1.3-1.3 3.2-1.6 4.8-1" />
    </template>
    <!-- 小地图 -->
    <template v-else-if="name === 'map'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 8h4v4H8zM14 12h3v4h-3z" />
    </template>
    <!-- 适配视图 -->
    <template v-else-if="name === 'fit'">
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </template>
    <!-- 整理画布 -->
    <template v-else-if="name === 'organize'">
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="4" width="7" height="6" rx="1.5" />
      <rect x="3" y="14" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
    </template>
    <!-- 缩小 / 放大 -->
    <template v-else-if="name === 'minus'">
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <!-- 撤销 / 重做 -->
    <template v-else-if="name === 'undo'">
      <path d="M9 7H5v4" />
      <path d="M5 11a7 7 0 1 0 7-7" />
    </template>
    <template v-else-if="name === 'redo'">
      <path d="M15 7h4v4" />
      <path d="M19 11a7 7 0 1 1-7-7" />
    </template>
    <!-- 删除 -->
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M10 11v6M14 11v6" />
    </template>
    <!-- 复制 -->
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </template>
    <!-- 保存 -->
    <template v-else-if="name === 'save'">
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h7V3M8 14h8v7H8z" />
    </template>
    <!-- 下载（批量下载 / 下载记录） -->
    <template v-else-if="name === 'download'">
      <path d="M12 4v10" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </template>
    <!-- 重新加载 -->
    <template v-else-if="name === 'reload'">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </template>
    <!-- 返回 -->
    <template v-else-if="name === 'back'">
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </template>
    <!-- 关闭 -->
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12M18 6L6 18" />
    </template>
    <!-- 历史版本 -->
    <template v-else-if="name === 'history'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </template>
    <!-- 钉住 -->
    <template v-else-if="name === 'pin'">
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" />
      <path d="M12 14v6" />
    </template>
    <!-- 折叠/展开 -->
    <template v-else-if="name === 'chevron-down'">
      <path d="M6 9l6 6 6-6" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="M9 6l6 6-6 6" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <path d="M15 6l-6 6 6 6" />
    </template>
    <!-- 锁定 -->
    <template v-else-if="name === 'lock'">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </template>
    <!-- 更多 -->
    <template v-else-if="name === 'more'">
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <!-- 播放（预览） -->
    <template v-else-if="name === 'play'">
      <path d="M8 5.5l10 6.5-10 6.5z" />
    </template>
    <!-- 加号（添加节点，圆形按钮用） -->
    <template v-else-if="name === 'plus-lg'">
      <path d="M12 6v12M6 12h12" stroke-width="2" />
    </template>

    <!-- ── 节点类型图标 ─────────────────────────────────── -->
    <template v-else-if="name === 'node-text'">
      <path d="M5 6h14M5 11h10M5 16h6" />
    </template>
    <template v-else-if="name === 'node-table'">
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M3.5 10h17M9.5 10v9M15 10v9" />
    </template>
    <template v-else-if="name === 'node-image'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-5 4 4 3-2.5 4 3.5" />
    </template>
    <template v-else-if="name === 'node-video'">
      <rect x="3" y="6" width="12.5" height="12" rx="2" />
      <path d="M15.5 11l5-3v8l-5-3z" />
    </template>
    <template v-else-if="name === 'node-audio'">
      <path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 10.5v3" />
    </template>
    <template v-else-if="name === 'node-clip'">
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 7v10M17 7v10M10.5 10.5v3M13.5 10.5v3" />
    </template>
    <template v-else-if="name === 'node-asset'">
      <circle cx="12" cy="9" r="3.2" />
      <path d="M5.5 19c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
    </template>
    <template v-else-if="name === 'node-script'">
      <path d="M6 4h9l4 4v12H6z" />
      <path d="M15 4v4h4M9 12h7M9 16h5" />
    </template>
    <template v-else-if="name === 'node-director'">
      <path d="M4 8l16-3M4 8v9a2 2 0 0 0 2 2h9l5-4V8" />
      <circle cx="9" cy="13" r="2" />
    </template>
    <template v-else-if="name === 'node-3d'">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </template>
    <template v-else-if="name === 'node-group'">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 2.5" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </template>

    <!-- 兜底：未知图标不渲染可见形状，避免误用 -->
    <template v-else>
      <circle cx="12" cy="12" r="8" stroke-dasharray="2 3" />
    </template>
  </svg>
</template>

<style scoped>
.cv-icon {
  display: block;
  flex: none;
}
</style>
