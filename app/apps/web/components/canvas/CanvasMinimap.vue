<script setup lang="ts">
import type { CanvasNodeDto } from "~/types/canvas";
import { NODE_TYPE_META } from "~/types/canvas";

/**
 * 画布小地图
 *
 * 数值来源：参照站 `.canvas-view .vue-flow__minimap.canvas-minimap`（站点 CSS 实测）
 *   width:188px; height:120px; border-radius:12px; padding:0; overflow:hidden;
 *   background:var(--bg-popup-00); border:1px solid var(--border-trans-04);
 *   box-shadow:0 8px 32px #0006; left:16px; bottom:calc(64px + timeline)
 * 任务书要求 180×120，因此宽度做成可覆盖的 `--minimap-w`（默认 180），
 * 其余（圆角 12 / 1px 边框 / 阴影 / 内边距 0）与参照站一致。
 *
 * 为什么不用 SVG 之外的东西画：节点矩形 + 视口框都是纯几何图形，
 * 一个 `<svg>` + `<rect>` 就能画完，还能用 viewBox 自动做等比缩放，
 * 省掉"自己算 scale 再乘一遍"的坐标错误。
 *
 * 为什么自己算世界包围盒而不是用固定世界尺寸：画布是无限的，
 * 固定 viewBox 会导致节点拖远后全部跑出小地图；按节点 + 视口求并集才能
 * 保证"当前看的东西一定在小地图里"。
 */
const props = defineProps<{
  nodes: CanvasNodeDto[];
  viewport: { x: number; y: number; zoom: number };
  stage: { w: number; h: number };
}>();

const emit = defineEmits<{
  /** 点击小地图 → 把该点对应的世界坐标交给页面居中 */
  jump: [worldX: number, worldY: number];
}>();

/** 小地图逻辑尺寸（与 CSS 里 --minimap-w/--minimap-h 保持一致） */
const MAP_W = 180;
const MAP_H = 120;
/** 内容内缩，避免节点贴着边框看不清 */
const PAD = 8;

/** 节点实际宽度：节点没存 width 时回退类型默认宽，否则矩形会缩成一条线 */
function nodeWidth(n: CanvasNodeDto): number {
  if (typeof n.width === "number" && n.width > 0) return n.width;
  const meta = NODE_TYPE_META[n.node_type as keyof typeof NODE_TYPE_META];
  return meta?.width ?? 260;
}
/** 节点高度：DTO 的 height 可能为空，给一个与节点卡片视觉接近的兜底 */
function nodeHeight(n: CanvasNodeDto): number {
  if (typeof n.height === "number" && n.height > 0) return n.height;
  return 96;
}

/** 当前视口在世界坐标里的矩形（viewport.x/y 是屏幕平移量） */
const viewRect = computed(() => {
  const z = props.viewport.zoom || 1;
  return {
    x: -props.viewport.x / z,
    y: -props.viewport.y / z,
    w: Math.max(1, props.stage.w) / z,
    h: Math.max(1, props.stage.h) / z,
  };
});

/**
 * 世界包围盒 = 所有节点 ∪ 当前视口。
 * 至少给一个最小尺寸（视口本身），避免"0 个节点 + stage 还没测量"时除以 0。
 */
const world = computed(() => {
  const v = viewRect.value;
  let minX = v.x;
  let minY = v.y;
  let maxX = v.x + v.w;
  let maxY = v.y + v.h;
  for (const n of props.nodes) {
    const w = nodeWidth(n);
    const h = nodeHeight(n);
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + w > maxX) maxX = n.x + w;
    if (n.y + h > maxY) maxY = n.y + h;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
});

/** 等比缩放：取较小的比例，保证内容完整可见且不变形 */
const scale = computed(() => {
  const w = world.value.w;
  const h = world.value.h;
  return Math.min((MAP_W - PAD * 2) / w, (MAP_H - PAD * 2) / h);
});

/** 内容在画布里的实际绘制尺寸与居中偏移（等比缩放后可能一侧留白） */
const layout = computed(() => {
  const s = scale.value;
  const dw = world.value.w * s;
  const dh = world.value.h * s;
  return {
    s,
    dx: (MAP_W - dw) / 2,
    dy: (MAP_H - dh) / 2,
    dw,
    dh,
  };
});

interface MiniRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** 世界坐标 → 小地图像素 */
function toMini(wx: number, wy: number): { x: number; y: number } {
  const { s, dx, dy } = layout.value;
  return {
    x: dx + (wx - world.value.x) * s,
    y: dy + (wy - world.value.y) * s,
  };
}

const rects = computed<MiniRect[]>(() => {
  const { s } = layout.value;
  return props.nodes.map((n) => {
    const p = toMini(n.x, n.y);
    const meta = NODE_TYPE_META[n.node_type as keyof typeof NODE_TYPE_META];
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      w: Math.max(2, nodeWidth(n) * s),
      h: Math.max(2, nodeHeight(n) * s),
      color: meta?.color ?? "var(--cv-edge)",
    };
  });
});

/** 视口框在小地图里的位置 */
const viewBox = computed(() => {
  const v = viewRect.value;
  const p = toMini(v.x, v.y);
  const { s } = layout.value;
  return {
    x: p.x,
    y: p.y,
    w: Math.max(4, v.w * s),
    h: Math.max(4, v.h * s),
  };
});

const isEmpty = computed(() => props.nodes.length === 0);

/**
 * 视口外遮罩路径：整张地图挖掉视口框。
 *
 * 参照站用的是 `.vue-flow__minimap-mask` 一条 `fill-rule:evenodd` 的 path
 * （外框顺时针 + 视口框，靠奇偶规则挖洞），fill 是 `#1b1b1db8`。
 * 这里照抄同一手法而不是叠四块矩形：四块矩形在视口贴边/超出时会互相重叠，
 * 半透明叠加处会明显更深，露出接缝。
 */
const maskPath = computed(() => {
  const v = viewBox.value;
  const outer = `M0,0 h${MAP_W} v${MAP_H} h${-MAP_W} z`;
  const inner = `M${v.x},${v.y} h${v.w} v${v.h} h${-v.w} z`;
  return `${outer} ${inner}`;
});

/**
 * 点击跳转：把点击点反算回世界坐标。
 * 用 getBoundingClientRect 而不是 offsetX/offsetY——SVG 子元素上
 * offsetX 是相对被点元素的，点到节点矩形上会算错。
 */
function onClick(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return;
  const box = el.getBoundingClientRect();
  const px = ev.clientX - box.left;
  const py = ev.clientY - box.top;
  const { s, dx, dy } = layout.value;
  if (s <= 0) return;
  const wx = world.value.x + (px - dx) / s;
  const wy = world.value.y + (py - dy) / s;
  emit("jump", wx, wy);
}
</script>

<template>
  <div class="canvas-minimap" :class="{ 'is-empty': isEmpty }">
    <div class="canvas-minimap__panel cv-chrome" role="img" aria-label="画布小地图" @click="onClick">
      <svg
        class="canvas-minimap__svg"
        :viewBox="`0 0 ${MAP_W} ${MAP_H}`"
        :width="MAP_W"
        :height="MAP_H"
        preserveAspectRatio="xMidYMid meet"
      >
        <!-- 节点矩形：颜色用各类型主色，低透明度避免盖住视口框 -->
        <g class="canvas-minimap__nodes">
          <rect
            v-for="r in rects"
            :key="r.id"
            class="canvas-minimap__node"
            :x="r.x"
            :y="r.y"
            :width="r.w"
            :height="r.h"
            rx="1.5"
            :fill="r.color"
          />
        </g>

        <!-- 视口外压暗（evenodd 挖洞），让"当前看的是哪块"一眼可读 -->
        <path class="canvas-minimap__mask" :d="maskPath" fill-rule="evenodd" />

        <!-- 视口框亮边 -->
        <rect
          class="canvas-minimap__view"
          :x="viewBox.x"
          :y="viewBox.y"
          :width="viewBox.w"
          :height="viewBox.h"
          rx="2"
        />
      </svg>

      <!-- 空态：没有节点时小地图没有信息量，给一句话比给空白更诚实 -->
      <p v-if="isEmpty" class="canvas-minimap__empty">暂无节点</p>
    </div>
  </div>
</template>

<style scoped>
.canvas-minimap {
  /* 位置：参照站 left:16 / bottom:calc(64px + timeline)。dock 高 40 + 16 底距，
     再留 8 间隙 → 64，正好是参照站的 64 基数（timeline 本迭代没有，按 0 计） */
  position: absolute;
  left: 16px;
  bottom: 64px;
  z-index: 25;
  pointer-events: none;
}

.canvas-minimap__panel {
  position: relative;
  width: var(--minimap-w, 180px);
  height: var(--minimap-h, 120px);
  padding: 0;
  border-radius: var(--radius-xl);
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  /* 参照站 minimap 的 svg 底是 --fill-light-02（白 8%） */
  background: var(--bg-hover);
}

.canvas-minimap__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.canvas-minimap__node {
  opacity: 0.55;
}

/* 视口外压暗：参照站 mask 的 fill 是 #1b1b1db8，这里用表面色 + alpha，
   比纯黑更贴合玻璃面板（纯黑会把面板压成脏灰色） */
.canvas-minimap__mask {
  fill: var(--bg-surface);
  fill-opacity: 0.72;
  pointer-events: none;
}

/* 视口框：亮边 + 外发光，确保在任何节点配色上都可辨识 */
.canvas-minimap__view {
  fill: none;
  stroke: var(--text-1);
  stroke-width: 1.5;
  opacity: 0.9;
  pointer-events: none;
}

.canvas-minimap__empty {
  position: absolute;
  inset: 0;
  margin: 0;
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--text-4);
  pointer-events: none;
}
</style>
