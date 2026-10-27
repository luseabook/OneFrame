<script setup lang="ts">

const { t } = useI18n();
import type { CanvasNodeType } from "~/types/canvas";
import { NODE_TYPE_META, TOOLBAR_NODE_TYPES } from "~/types/canvas";

/**
 * 左侧竖排工具栏
 *
 * 结构与数值全部对齐参照站 `.canvas-navbar`（`_acceptance/ref-authed/canvas.html`
 * + 站点实际 CSS `canvas.DPyO0cqt.css`）：
 *   .canvas-navbar{ border-radius:100px; border:1px solid; backdrop-filter:blur(4px);
 *                   flex-direction:column; gap:4px; padding:4px;
 *                   position:absolute; top:50%; left:16px; transform:translateY(-50%) }
 *   .canvas-navbar__divider{ width:20px; height:1px }
 *   .add-icon-button{ width/height:40px; border-radius:50% }
 * 所以这里是「一个竖排胶囊容器 + 圆形 40 的 + + 20×1 分隔线 + 图标按钮」，
 * 不是一列各自独立的圆按钮——独立按钮会丢失参照站那种"整体一块玻璃"的观感。
 *
 * 「+」的图标细节照抄参照站：默认图标是 ×，被 CSS 旋转 45° 后视觉上变成 +；
 * hover/展开时转回 0° 变回 ×。这样同一个按钮天然表达"开/关"，不需要两套图标。
 */
const props = defineProps<{
  mode: "select" | "connect" | "pan";
  /** 当前选中节点数：>0 时在图层按钮上挂角标，避免用户找不到"我选了几个" */
  activeCount: number;
}>();

const emit = defineEmits<{
  "update:mode": [m: "select" | "connect" | "pan"];
  add: [type: CanvasNodeType];
  /** 图层树（本迭代未实现，页面会弹 toast 说明） */
  layers: [];
  /** 打开模板库 */
  templates: [];
  /** 打开素材库 */
  materials: [];
  /** 打开下载记录（批量下载产生的下载单，可反复取链接） */
  downloads: [];
  /** 切换批注模式 */
  comments: [];
}>();

const rootEl = ref<HTMLElement | null>(null);
const menuOpen = ref(false);

const types = TOOLBAR_NODE_TYPES;

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
}

function pick(type: CanvasNodeType): void {
  emit("add", type);
  // 选完立即收起：连续加节点的主路径是再点一次「+」，保持浮层开着会挡住画布
  menuOpen.value = false;
}

function toggleConnect(): void {
  emit("update:mode", props.mode === "connect" ? "select" : "connect");
}

/** 点外面收起浮层：浮层没有遮罩（参照站也没有），靠文档级 pointerdown 兜底 */
function onDocPointerDown(ev: PointerEvent): void {
  if (!menuOpen.value) return;
  const el = rootEl.value;
  if (el && ev.target instanceof Node && !el.contains(ev.target)) menuOpen.value = false;
}

function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") menuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
});

/** 图标名：threeDWorld 是 node-3d，其余直接拼（与 CanvasNode.vue 保持同一套映射） */
function iconOf(t: CanvasNodeType): string {
  return t === "threeDWorld" ? "node-3d" : `node-${t}`;
}
</script>

<template>
  <!--
    @pointerdown.stop：见 CanvasEmptyGuide.vue 的说明——stage 会 setPointerCapture，
    不阻断的话「+」和浮层按钮收不到 click（实测：真实鼠标点不开浮层，el.click() 可以）。
  -->
  <div ref="rootEl" class="canvas-toolbar" @pointerdown.stop @dblclick.stop>
    <!-- 圆形「+」：40px，展开时转回 × -->
    <button
      type="button"
      class="tool-add"
      :class="{ 'is-open': menuOpen }"
      :aria-label="t('canvasUi.addNode')"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      aria-haspopup="menu"
      @click="toggleMenu"
    >
      <CanvasIcon name="close" :size="20" />
    </button>

    <span class="canvas-toolbar__divider" aria-hidden="true" />

    <!-- 连线模式：契约要求 toolbar 负责 select/connect/pan 的切换入口，
         参照站的连线是右键/快捷键，这里补一个显式按钮让 connect 可发现 -->
    <button
      type="button"
      class="tool-link cv-glass-btn cv-tip"
      :class="{ 'cv-glass-btn--active': mode === 'connect' }"
      :data-tip="t('canvasUi.connectTip')"
      :aria-label="t('canvasUi.connect')"
      :aria-pressed="mode === 'connect' ? 'true' : 'false'"
      @click="toggleConnect"
    >
      <CanvasIcon name="link" :size="20" />
    </button>

    <!-- 图层 -->
    <button
      type="button"
      class="tool-layers cv-glass-btn cv-tip"
      :data-tip="t('canvasUi.layers')"
      :aria-label="t('canvasUi.layers')"
      @click="emit('layers')"
    >
      <CanvasIcon name="node-group" :size="20" />
      <span v-if="activeCount > 0" class="tool-layers__badge">{{ activeCount }}</span>
    </button>

    <!-- 模板库：存为模板 / 套用模板 -->
    <button
      type="button"
      class="tool-templates cv-glass-btn cv-tip"
      :data-tip="t('canvasUi.templates')"
      :aria-label="t('canvasUi.templates')"
      @click="emit('templates')"
    >
      <CanvasIcon name="copy" :size="20" />
    </button>

    <!-- 素材库 -->
    <button
      type="button"
      class="tool-materials cv-glass-btn cv-tip"
      :data-tip="t('canvasUi.materials')"
      :aria-label="t('canvasUi.materials')"
      @click="emit('materials')"
    >
      <CanvasIcon name="node-image" :size="20" />
    </button>

    <!-- 下载记录：批量下载的下载单（链接 24h 过期，但下载单一直在） -->
    <button
      type="button"
      class="tool-downloads cv-glass-btn cv-tip"
      :data-tip="t('canvasUi.downloads')"
      :aria-label="t('canvasUi.downloads')"
      @click="emit('downloads')"
    >
      <CanvasIcon name="download" :size="20" />
    </button>

    <!-- 批注模式 -->
    <button
      type="button"
      class="tool-comments cv-glass-btn cv-tip"
      :data-tip="t('canvasUi.comment')"
      :aria-label="t('canvasUi.comment')"
      @click="emit('comments')"
    >
      <CanvasIcon name="node-text" :size="20" />
    </button>

    <!-- 类型选择浮层：8 个类型（TOOLBAR_NODE_TYPES）。
         按钮内**只放类型名一个文本节点**，说明文字走 title 属性：
         E2E 用 `button:has-text('视频')` 做子串匹配，DOM 里多一段说明文字
         会让「视频」同时命中「视频合成」等相邻项，选择器立刻歧义。 -->
    <div v-if="menuOpen" class="tool-menu" role="menu" :aria-label="t('canvasUi.menuAria')">
      <p class="tool-menu__head">{{ t("canvasUi.menuHead") }}</p>
      <button
        v-for="t in types"
        :key="t"
        type="button"
        class="tool-menu__item"
        role="menuitem"
        :data-type="t"
        :title="NODE_TYPE_META[t].hint"
        @click="pick(t)"
      >
        <span class="tool-menu__icon">
          <CanvasIcon :name="iconOf(t)" :size="20" />
        </span>
        <span class="tool-menu__title">{{ NODE_TYPE_META[t].label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 竖排胶囊：位置/圆角/内距全按参照站 .canvas-navbar */
.canvas-toolbar {
  position: absolute;
  top: 50%;
  left: 16px;
  z-index: 90;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--cv-chrome-border);
  border-radius: 100px;
  background: var(--cv-chrome-bg);
  box-shadow: var(--cv-chrome-shadow);
  backdrop-filter: blur(4px);
  user-select: none;
}

/* 圆形「+」：40px，白底深字（参照站 add-icon-button 是浅底 + ink 文字） */
.tool-add {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--text-1);
  color: var(--bg-app);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
/* × 旋转 45° = +；展开后转回 0° 变 ×（参照站 add-icon-button__icon 的做法） */
.tool-add :deep(.cv-icon) {
  transform: rotate(45deg);
  transition: transform var(--duration-slow) var(--ease-out);
}
.tool-add:hover {
  background: var(--text-2);
}
.tool-add:hover :deep(.cv-icon),
.tool-add.is-open :deep(.cv-icon) {
  transform: rotate(0deg);
}
.tool-add:active {
  transform: scale(0.96);
}

/* 20×1 分隔线，参照站 canvas-navbar__divider */
.canvas-toolbar__divider {
  flex: none;
  width: 20px;
  height: 1px;
  background: var(--cv-chrome-border);
}

.tool-link,
.tool-layers {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}
.tool-layers {
  position: relative;
}
.tool-layers__badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: var(--text-1);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 浮层：贴工具栏右侧，不遮住「+」本身 */
.tool-menu {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 240px;
  padding: 12px 8px 8px;
  border: 1px solid var(--cv-chrome-border);
  border-radius: 20px;
  background: var(--bg-surface);
  box-shadow: var(--cv-chrome-shadow);
  z-index: 91;
}
.tool-menu__head {
  margin: 0;
  padding: 0 8px 4px;
  height: 16px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-4);
}
.tool-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-xl);
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.tool-menu__item:hover {
  background: var(--bg-hover);
}
.tool-menu__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--text-2);
}
.tool-menu__title {
  font-size: 13px;
  line-height: 20px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tool-menu__item:hover .tool-menu__title {
  color: var(--text-1);
}
</style>
