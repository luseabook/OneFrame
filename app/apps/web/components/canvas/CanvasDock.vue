<script setup lang="ts">
/**
 * 底部悬浮 dock（模式 / 视图 / 缩放）
 *
 * 数值全部来自参照站 `.cv-secondary`（站点 CSS `canvas.DPyO0cqt.css` 实测）：
 *   容器：border-radius 100px / gap 8 / padding 4px 16px 4px 4px / backdrop-filter blur(4px)
 *   分组：.cv-secondary__group{gap:4px}
 *   分隔：.cv-secondary__divider{width:1px;height:20px}
 *   按钮：--glass-icon-button-size:32px; --glass-icon-button-padding:6px
 *   滑块：width 80 / height 4 / thumb 16（min 10 max 800 step 1）
 *   百分比：min-width 34 / font-size 12 / line-height 16 / tabular-nums
 * 外层 .canvas-bottom-secondary-dock{left:16px;bottom:16px;position:absolute}
 *
 * 为什么保留滑块：参照站有它，且它是"一步跳到任意倍率"的唯一入口；
 * 只有 +/- 的话用户从 800% 回 100% 要点十几次。
 *
 * 关于「选择 | 抓手」模式组：契约 §3.3 冻结的 props 只有 zoom/minimapOpen，
 * 没有 mode。但参照站该组就在 dock 里（不在左侧工具栏）。因此这里把 `mode`
 * 做成**可选 prop + 可选 emit**（纯增量，不改任何已冻结的名字）：
 * 页面传了就完全受控，没传就退化为本地态，至少视觉与点击反馈是对的。
 */
const props = withDefaults(
  defineProps<{
    /** 当前缩放百分比（整数，如 100 表示 1.0 倍） */
    zoom: number;
    minimapOpen: boolean;
    /** 可选：传入则模式组受控（契约外增量，页面不传也能用） */
    mode?: "select" | "connect" | "pan";
  }>(),
  { mode: "select" },
);

const emit = defineEmits<{
  zoomIn: [];
  zoomOut: [];
  setZoom: [z: number];
  fitView: [];
  organize: [];
  "toggle:minimap": [];
  /** 契约外增量：模式切换（页面不监听则退化为本地态） */
  "update:mode": [m: "select" | "connect" | "pan"];
}>();

/** 参照站滑块量程，页面侧 setZoom 会做 clamp，这里只是把 UI 边界对齐 */
const MIN_ZOOM = 10;
const MAX_ZOOM = 800;

/** 页面没接管 mode 时的本地兜底，保证按钮点下去有可见反馈 */
const localMode = ref<"select" | "connect" | "pan">(props.mode);

watch(
  () => props.mode,
  (m) => {
    localMode.value = m;
  },
);

const activeMode = computed(() => localMode.value);
const percentText = computed(() => `${Math.round(props.zoom)}%`);
const sliderValue = computed(() => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(props.zoom))));
const canZoomOut = computed(() => props.zoom > MIN_ZOOM);
const canZoomIn = computed(() => props.zoom < MAX_ZOOM);

function setMode(m: "select" | "pan"): void {
  localMode.value = m;
  emit("update:mode", m);
}

function onSlide(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(v)) emit("setZoom", v);
}
</script>

<template>
  <!--
    @pointerdown.stop：见 CanvasEmptyGuide.vue 的说明——stage 会 setPointerCapture，
    不阻断的话 dock 按钮收不到 click（实测：真实鼠标点不动，el.click() 可以）。
    滑块同样依赖这一点：不 stop 的话 pointerdown 被 stage 抢走，滑块拖不动。
  -->
  <div class="canvas-dock" @pointerdown.stop @dblclick.stop>
    <div class="canvas-dock__bar cv-chrome">
      <!-- 模式组：选择 | 抓手（连线模式由左侧工具栏负责，见 CanvasToolbar 注释） -->
      <div class="canvas-dock__group">
        <button
          type="button"
          class="cv-glass-btn dock-mode-select cv-tip"
          :class="{ 'cv-glass-btn--active': activeMode === 'select' }"
          data-tip="选择 V"
          aria-label="选择"
          :aria-pressed="activeMode === 'select' ? 'true' : 'false'"
          @click="setMode('select')"
        >
          <CanvasIcon name="select" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn dock-mode-pan cv-tip"
          :class="{ 'cv-glass-btn--active': activeMode === 'pan' }"
          data-tip="抓手 H（空格临时切换）"
          aria-label="抓手"
          :aria-pressed="activeMode === 'pan' ? 'true' : 'false'"
          @click="setMode('pan')"
        >
          <CanvasIcon name="hand" :size="18" />
        </button>
      </div>

      <span class="canvas-dock__divider" aria-hidden="true" />

      <!-- 视图组：小地图开关 / 整理画布 / 适配视图 -->
      <div class="canvas-dock__group">
        <button
          type="button"
          class="cv-glass-btn dock-minimap cv-tip"
          :class="{ 'cv-glass-btn--active': minimapOpen }"
          data-tip="小地图"
          aria-label="小地图开关"
          :aria-pressed="minimapOpen ? 'true' : 'false'"
          @click="emit('toggle:minimap')"
        >
          <CanvasIcon name="map" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn dock-organize cv-tip"
          data-tip="整理画布"
          aria-label="整理画布"
          @click="emit('organize')"
        >
          <CanvasIcon name="organize" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn dock-fit cv-tip"
          data-tip="适配视图"
          aria-label="适配视图"
          @click="emit('fitView')"
        >
          <CanvasIcon name="fit" :size="18" />
        </button>
      </div>

      <span class="canvas-dock__divider" aria-hidden="true" />

      <!-- 缩放组：- / 滑块 / + / 百分比 -->
      <div class="canvas-dock__group">
        <button
          type="button"
          class="cv-glass-btn dock-zoom-out cv-tip"
          data-tip="缩小"
          aria-label="缩小"
          :disabled="!canZoomOut"
          @click="emit('zoomOut')"
        >
          <CanvasIcon name="minus" :size="18" />
        </button>
        <input
          class="canvas-dock__slider"
          type="range"
          :min="MIN_ZOOM"
          :max="MAX_ZOOM"
          step="1"
          :value="sliderValue"
          aria-label="缩放"
          @input="onSlide"
        />
        <button
          type="button"
          class="cv-glass-btn dock-zoom-in cv-tip"
          data-tip="放大"
          aria-label="放大"
          :disabled="!canZoomIn"
          @click="emit('zoomIn')"
        >
          <CanvasIcon name="plus" :size="18" />
        </button>
      </div>

      <!-- 百分比可点：回到 100%（参照站是弹出倍率菜单，这里做最小可用版） -->
      <button
        type="button"
        class="canvas-dock__percent dock-zoom-percent"
        aria-label="重置为 100%"
        :title="`当前 ${percentText}，点击回到 100%`"
        @click="emit('setZoom', 100)"
      >
        {{ percentText }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 外层定位：参照站 .canvas-bottom-secondary-dock 的 left/bottom 16 */
.canvas-dock {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 30;
  display: flex;
  align-items: center;
  pointer-events: none;
}
.canvas-dock > * {
  pointer-events: auto;
}

/* 胶囊容器：圆角 100，左内距 4 右内距 16（右边留给百分比文字） */
.canvas-dock__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px 4px 4px;
  border-radius: 100px;
  user-select: none;
}
.canvas-dock__group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.canvas-dock__divider {
  flex: none;
  width: 1px;
  height: 20px;
  background: var(--panel-tint-strong);
}

/* 滑块：80×4，thumb 16 圆点 */
.canvas-dock__slider {
  appearance: none;
  -webkit-appearance: none;
  width: 80px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--bg-active);
  outline: none;
  cursor: pointer;
}
.canvas-dock__slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: var(--text-1);
  box-shadow: 0 1px 4px #0000004d;
  cursor: pointer;
}
.canvas-dock__slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: var(--text-1);
  box-shadow: 0 1px 4px #0000004d;
  cursor: pointer;
}

.canvas-dock__percent {
  min-width: 34px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  line-height: 16px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.canvas-dock__percent:hover {
  color: var(--text-1);
}

@media (max-width: 1280px) {
  /* 窄屏先牺牲滑块（+/- 仍可用），避免 dock 挤到检查器上 */
  .canvas-dock__slider {
    display: none;
  }
}
</style>
