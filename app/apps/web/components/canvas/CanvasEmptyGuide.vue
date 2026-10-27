<script setup lang="ts">

const { t } = useI18n();
import type { CanvasNodeType } from "~/types/canvas";
import { NODE_TYPE_META } from "~/types/canvas";

/**
 * 空画布引导（`nodes.length === 0` 时才由页面渲染）
 *
 * 结构照参照站 `.canvas-empty-guide`（`_acceptance/ref-authed/canvas.html`）：
 *   .canvas-empty-guide{ flex-direction:column; align-items:center; gap:32px;
 *                        position:absolute; top:calc(50% - 17px); left:50%;
 *                        transform:translate(-50%,-50%) }
 *   __copy   主文案区（参照站是 flex row，本实现按任务书要求改为上下两行）
 *   __nodes  两行 chip（__nodes-row flex-wrap justify-center gap 8）
 *   __node   单个 chip（参照站 padding 10px 16px，--node-min-width 88 / 第二行 130）
 *   __node--tutorial 高亮渐变胶囊（ink 字 + 白色外发光，font-weight 700）
 *
 * 尺寸按任务书给定值：chip 高 36 / 圆角 8 / 底 #191A21 / 1px 边框 / 间距 8。
 * 注意 #191A21 正好是 tokens.css 的 `--bg-surface`（层二语义令牌），
 * 所以这里写 `var(--bg-surface)` 而不是十六进制——既满足"不写死色值"，
 * 又与任务书给的值逐位相同。
 *
 * chip 文字保持**纯类型名**（不加后缀、不加 emoji）：E2E 用
 * `.canvas-empty-guide button:has-text('文本')` 定位，混入额外字符会让选择器歧义。
 */
withDefaults(defineProps<{ tutorialOpen: boolean }>(), { tutorialOpen: false });

const emit = defineEmits<{
  select: [type: CanvasNodeType];
  "toggle-tutorial": [];
  /** 新手引导条目 key（引导内容依赖 agent 域，本迭代只上报选择） */
  "select-tutorial": [key: string];
}>();

interface Chip {
  /** 展示文案（必须与 E2E 选择器一致） */
  label: string;
  /** 点击后创建的节点类型：视频合成→clip，剧本拆资产/拆分镜→script */
  type: CanvasNodeType;
  icon: string;
  /** 参照站给长标签留的更大最小宽度 */
  minWidth: number;
}

/** 第一行：六个基础节点类型（顺序照参照站 DOM） */
const row1: Chip[] = [
  { label: t("canvasUi.nodeText"), type: "text", icon: "node-text", minWidth: 88 },
  { label: t("canvasUi.nodeTable"), type: "table", icon: "node-table", minWidth: 88 },
  { label: t("canvasUi.nodeImage"), type: "image", icon: "node-image", minWidth: 88 },
  { label: t("canvasUi.nodeVideo"), type: "video", icon: "node-video", minWidth: 88 },
  { label: t("canvasUi.nodeAudio"), type: "audio", icon: "node-audio", minWidth: 88 },
  { label: t("canvasUi.nodeClip"), type: "clip", icon: "node-clip", minWidth: 116 },
];

/** 第二行：两个剧本派生能力（都是 script 节点，靠 runPhase 区分）+ 新手引导 */
const row2: Chip[] = [
  { label: t("canvasUi.nodeScriptAssets"), type: "script", icon: "node-asset", minWidth: 130 },
  { label: t("canvasUi.nodeScriptShots"), type: "script", icon: "node-script", minWidth: 130 },
];

/**
 * 新手引导条目：参照站空态截图里浮层未展开，具体条目不可见，
 * 这里按画布主路径给最小集合；文案与 key 只用于上报，不改任何契约名字。
 */
const tutorials: Array<{ key: string; label: string; icon: string }> = [
  { key: "add-node", label: t("canvasUi.tutorialAddNode"), icon: "plus-lg" },
  { key: "connect", label: t("canvasUi.tutorialConnect"), icon: "link" },
  { key: "shortcuts", label: t("canvasUi.tutorialShortcuts"), icon: "more" },
];

function hintOf(c: Chip): string {
  return NODE_TYPE_META[c.type]?.hint ?? "";
}
</script>

<template>
  <!--
    @pointerdown.stop 不是可选项：本组件挂在 .canvas-stage 内，而 stage 的
    pointerdown 会对 stage 自己 setPointerCapture。指针被 stage 捕获后，
    pointerup 的目标变成 stage，浏览器据此把 click 也派发给 stage
    （click 目标是 down/up 目标的最近公共祖先）——chip 就永远收不到 click。
    实测证据：真实鼠标点 chip 不建节点，而 el.click() 能建。stop 掉即可。
    @dblclick.stop 同理：否则双击 chip 会冒泡到 stage 触发"双击建文本节点"。
  -->
  <div class="canvas-empty-guide" aria-live="polite" @pointerdown.stop @dblclick.stop>
    <div class="canvas-empty-guide__copy">
      <p class="canvas-empty-guide__title">{{ t("canvasUi.guideTitle") }}</p>
      <p class="canvas-empty-guide__desc">{{ t("canvasUi.guideDesc") }}</p>
    </div>

    <div class="canvas-empty-guide__nodes" role="toolbar" :aria-label="t('canvasUi.guideToolbarAria')">
      <div class="canvas-empty-guide__nodes-row">
        <button
          v-for="(c, i) in row1"
          :key="c.label"
          type="button"
          class="canvas-empty-guide__node guide-chip"
          :class="`guide-chip--${c.type}`"
          :style="{ '--node-min-width': `${c.minWidth}px`, '--enter-index': i }"
          :data-type="c.type"
          :title="hintOf(c)"
          @click="emit('select', c.type)"
        >
          <span class="canvas-empty-guide__node-icon" aria-hidden="true">
            <CanvasIcon :name="c.icon" :size="20" />
          </span>
          <span class="canvas-empty-guide__node-label guide-chip-text">{{ c.label }}</span>
        </button>
      </div>

      <div class="canvas-empty-guide__nodes-row">
        <button
          v-for="(c, i) in row2"
          :key="c.label"
          type="button"
          class="canvas-empty-guide__node guide-chip"
          :class="`guide-chip--${c.type}`"
          :style="{ '--node-min-width': `${c.minWidth}px`, '--enter-index': row1.length + i }"
          :data-type="c.type"
          :data-phase="c.type === 'script' && c.icon === 'node-asset' ? 'asset_match' : 'storyboard'"
          :title="hintOf(c)"
          @click="emit('select', c.type)"
        >
          <span class="canvas-empty-guide__node-icon" aria-hidden="true">
            <CanvasIcon :name="c.icon" :size="20" />
          </span>
          <span class="canvas-empty-guide__node-label guide-chip-text">{{ c.label }}</span>
        </button>

        <!-- 新手引导：高亮渐变胶囊，点击展开条目浮层 -->
        <div class="canvas-empty-guide__tutorial">
          <button
            type="button"
            class="canvas-empty-guide__node canvas-empty-guide__node--tutorial guide-chip-tutorial"
            :class="{ 'is-open': tutorialOpen }"
            aria-haspopup="menu"
            :aria-expanded="tutorialOpen ? 'true' : 'false'"
            @click="emit('toggle-tutorial')"
          >
            <span class="canvas-empty-guide__node-icon" aria-hidden="true">
              <CanvasIcon name="play" :size="20" />
            </span>
            <span class="canvas-empty-guide__node-label guide-chip-text">{{ t("canvasUi.onboarding") }}</span>
            <span
              class="canvas-empty-guide__tutorial-caret"
              :class="{ 'is-open': tutorialOpen }"
              aria-hidden="true"
            >
              <CanvasIcon name="chevron-down" :size="16" />
            </span>
          </button>

          <div v-if="tutorialOpen" class="canvas-empty-guide__tutorial-menu" role="menu">
            <button
              v-for="t in tutorials"
              :key="t.key"
              type="button"
              class="canvas-empty-guide__tutorial-item"
              role="menuitem"
              :data-key="t.key"
              @click="emit('select-tutorial', t.key)"
            >
              <span class="canvas-empty-guide__tutorial-item-icon" aria-hidden="true">
                <CanvasIcon :name="t.icon" :size="18" />
              </span>
              <span class="canvas-empty-guide__tutorial-item-label">{{ t.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-empty-guide {
  position: absolute;
  top: calc(50% - 17px);
  left: 50%;
  z-index: 20;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  width: max-content;
  max-width: calc(100vw - 160px);
  user-select: none;
}

/* 主文案：参照站 title 20/700/28，desc 16/22；任务书要求上下两行 */
.canvas-empty-guide__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  text-align: center;
}
.canvas-empty-guide__title {
  margin: 0;
  color: var(--text-1);
  font-size: 20px;
  font-weight: 700;
  line-height: 28px;
  white-space: nowrap;
}
.canvas-empty-guide__desc {
  margin: 0;
  color: var(--text-3);
  font-size: 16px;
  line-height: 22px;
  white-space: nowrap;
}

.canvas-empty-guide__nodes {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: 100%;
}
.canvas-empty-guide__nodes-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: max-content;
  max-width: 100%;
}

/* chip：任务书 36 高 / 8 圆角 / 底 #191A21 / 1px 边框 / 间距 8 */
.canvas-empty-guide__node {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: none;
  width: max-content;
  min-width: var(--node-min-width, auto);
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--cv-node-border);
  /* 8px 是参照站 chip 的实测圆角。注意不能写 var(--radius-lg)：本站
     html 根字号是 14px，rem 基准的 --radius-lg(0.5rem) 实际算出 7px。 */
  border-radius: 8px;
  background: var(--bg-surface); /* #191A21 */
  color: var(--text-3);
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
  /* 入场：参照站按 --enter-index 每档 50ms 递延，营造"依次浮起"的观感 */
  animation: cv-guide-rise 0.36s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: calc(0.2s + var(--enter-index, 0) * 50ms);
}
.canvas-empty-guide__node:hover {
  border-color: var(--cv-node-border-hover);
  background: var(--bg-raised);
  color: var(--text-1);
}

.canvas-empty-guide__node-icon {
  display: inline-flex;
  flex: 0 0 20px;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}
.canvas-empty-guide__node-label {
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
}

/* 新手引导：品牌渐变胶囊 + 白色外发光（参照站 --empty-guide-brand-fill 的做法，
   渐变用层二品牌令牌拼，不写死十六进制） */
.canvas-empty-guide__node--tutorial {
  border: 0;
  color: var(--bg-app);
  font-weight: 700;
  background: linear-gradient(
    90deg,
    var(--brand-50) 0%,
    var(--brand-200) 33%,
    var(--brand-300) 66%,
    var(--brand-50) 100%
  );
  box-shadow:
    0 0 12px #ffffff4d,
    0 0 8px #ffffff80,
    0 0 4px #ffffffb3;
}
.canvas-empty-guide__node--tutorial:hover,
.canvas-empty-guide__node--tutorial.is-open {
  color: var(--bg-app);
  background: linear-gradient(
    90deg,
    var(--brand-50) 0%,
    var(--brand-200) 33%,
    var(--brand-300) 66%,
    var(--brand-50) 100%
  );
  box-shadow:
    0 0 12px #ffffff5c,
    0 0 8px #ffffff8c,
    0 0 4px #ffffffbf;
}
.canvas-empty-guide__node--tutorial .canvas-empty-guide__node-label {
  font-weight: 700;
}
.canvas-empty-guide__tutorial-caret {
  display: inline-flex;
  align-items: center;
  color: inherit;
  transition: transform var(--duration-fast) var(--ease-out);
}
.canvas-empty-guide__tutorial-caret.is-open {
  transform: rotate(180deg);
}

.canvas-empty-guide__tutorial {
  position: relative;
}
.canvas-empty-guide__tutorial-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 152px;
  width: max-content;
  padding: 8px;
  border: 1px solid var(--cv-chrome-border);
  border-radius: 16px;
  background: var(--bg-surface);
  box-shadow: var(--cv-chrome-shadow);
}
.canvas-empty-guide__tutorial-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.canvas-empty-guide__tutorial-item:hover {
  background: var(--bg-hover);
}
.canvas-empty-guide__tutorial-item-icon {
  display: inline-flex;
  flex: 0 0 20px;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}
.canvas-empty-guide__tutorial-item-label {
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
}

@keyframes cv-guide-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-empty-guide__node {
    animation: none;
  }
}
@media (max-width: 1280px) {
  .canvas-empty-guide {
    max-width: calc(100vw - 120px);
  }
  .canvas-empty-guide__desc {
    white-space: normal;
  }
}
</style>
