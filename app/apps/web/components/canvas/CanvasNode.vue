<script setup lang="ts">

const { t } = useI18n();
import type { CanvasNodeDto } from "~/types/canvas";
import { NODE_STATUS, NODE_TYPE_META } from "~/types/canvas";

/**
 * 画布节点卡片
 *
 * 职责边界：**纯展示 + 冒泡**。拖拽/多选/连线判定全部由编辑器画布层处理，
 * 因为拖拽要同时考虑多选位移、视口缩放换算、框选冲突，放在节点里会互相打架。
 *
 * 为什么不给节点加"输出端口"圆点：参照站的连线是「拖到节点上」而非「拖端口」，
 * 端口模型在触屏和小节点上命中率差；保持整卡可拖 + 连线模式点选更稳。
 */
const props = defineProps<{
  node: CanvasNodeDto;
  selected: boolean;
  connecting: boolean;
  connectSource: boolean;
  lockHolder: string | null;
}>();

const emit = defineEmits<{
  pointerdown: [ev: PointerEvent];
  /** additive = 按住 Shift/Ctrl 追加选择 */
  select: [additive: boolean];
}>();

const meta = computed(() => NODE_TYPE_META[props.node.node_type as keyof typeof NODE_TYPE_META] ?? NODE_TYPE_META.text);
const width = computed(() => props.node.width ?? meta.value.width);
const iconName = computed(() => {
  const t = props.node.node_type;
  if (t === "threeDWorld") return "node-3d";
  return `node-${t}`;
});

/** 参数取值（params 是 unknown 索引，统一走这里避免到处 as） */
function p(key: string): unknown {
  return props.node.params?.[key];
}
function ps(key: string, fallback = ""): string {
  const v = p(key);
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
function pn(key: string, fallback: number): number {
  const v = p(key);
  return typeof v === "number" ? v : fallback;
}
function pobj(key: string): Record<string, unknown> {
  const v = p(key);
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function parr(key: string): unknown[] {
  const v = p(key);
  return Array.isArray(v) ? v : [];
}

/** 各类型的摘要行：只显示"一眼能判断这是什么"的信息，完整参数在右侧检查器 */
const summary = computed<string>(() => {
  // 局部变量不能叫 `t`：会遮蔽 i18n 的 t()（本项目第 6 次踩同类，建议加 lint 规则）
  const nodeType = props.node.node_type;
  switch (nodeType) {
    case "text":
      return ps("prompt");
    case "image":
    case "threeDWorld":
      return [ps("mode", "text2image"), ps("prompt")].filter(Boolean).join(" · ");
    case "video": {
      const s = pobj("settings");
      const bits = [ps("mode", "text2video")];
      if (s.resolution) bits.push(String(s.resolution));
      if (s.duration) bits.push(`${s.duration}s`);
      return bits.join(" · ") + (ps("prompt") ? ` · ${ps("prompt")}` : "");
    }
    case "audio":
      return [ps("audioKind", "voiceover"), ps("prompt"), `${pn("duration", 10)}s`].filter(Boolean).join(" · ");
    case "table": {
      const tb = pobj("table");
      const sheets = Array.isArray(tb.sheets) ? tb.sheets.length : 0;
      const src = (tb.source as Record<string, unknown> | undefined)?.type;
      return t("canvasUi.nodeTableSummary", { sheets: String(sheets), src: String(src ?? "manual") });
    }
    case "script":
      return [
        ps("runPhase", "storyboard") === "asset_match" ? t("canvasUi.nodeScriptAssetMatch") : t("canvasUi.nodeScriptStoryboard"),
        t("canvasUi.nodeShotsCount", { n: pn("shotCount", 3) }),
        ps("sourceText"),
      ]
        .filter(Boolean)
        .join(" · ");
    case "asset":
      return [`${ps("activeTab", "character")}`, ps("sourceText")].filter(Boolean).join(" · ");
    case "clip": {
      const es = pobj("exportSettings");
      return t("canvasUi.nodeVideoSummary", {
        segments: String(parr("shotOrder").length),
        resolution: String(es.resolution ?? "720p"),
        format: String(es.format ?? "mp4"),
      });
    }
    case "director":
      return ps("referenceLabel", t("canvasUi.nodeShotOrderDefault"));
    case "group":
      return t("canvasUi.nodeGroupSummary", { title: ps("title", t("canvasUi.nodeGroupDefault")), count: parr("childNodeIds").length });
    default:
      return "";
  }
});

const statusTag = computed(() => {
  if (props.node.status === NODE_STATUS.RUNNING) return { text: t("canvasUi.nodeRunning"), cls: "cv-tag--brand" };
  if (props.node.status === NODE_STATUS.DONE) return { text: t("canvasUi.nodeDone"), cls: "cv-tag--success" };
  return null;
});

/** 图像/视频类节点如果有生成结果，优先展示缩略（params.result_url 由后续生成链路回写） */
const thumbUrl = computed(() => {
  const t = props.node.node_type;
  if (t !== "image" && t !== "video" && t !== "threeDWorld") return "";
  // worker 成功后回写 result_uri / result_preview_uri（见 executor.ts）
  const u = p("result_preview_uri") ?? p("result_uri") ?? p("result_url") ?? p("cover_url");
  return typeof u === "string" ? u : "";
});

/** 最近一次失败的错误（worker 失败时写 params.last_error，含错误码） */
const lastErrorText = computed(() => {
  const e = p("last_error");
  if (!e || typeof e !== "object") return "";
  const obj = e as Record<string, unknown>;
  return obj.code ? `[${String(obj.code)}] ${String(obj.message ?? obj.kind ?? "")}` : String(obj.message ?? "");
});
</script>

<template>
  <div
    class="canvas-node"
    :class="{
      'is-selected': selected,
      'is-connecting': connecting,
      'is-source': connectSource,
      'is-locked': !!lockHolder,
    }"
    :style="{
      left: `${node.x}px`,
      top: `${node.y}px`,
      width: `${width}px`,
      '--node-accent': meta.color,
    }"
    :data-node-id="node.id"
    :data-node-type="node.node_type"
    @pointerdown.stop="emit('pointerdown', $event)"
    @click.stop="emit('select', $event.shiftKey || $event.metaKey || $event.ctrlKey)"
  >
    <!-- 头部：类型图标 + 类型名 + 状态 -->
    <header class="canvas-node__head">
      <span class="canvas-node__icon">
        <CanvasIcon :name="iconName" :size="14" />
      </span>
      <span class="canvas-node__type">{{ meta.label }}</span>
      <span v-if="lockHolder" class="canvas-node__lock" :title="t('canvasUi.nodeLockedByOther')">
        <CanvasIcon name="lock" :size="12" />
      </span>
      <span v-if="statusTag" class="cv-tag" :class="statusTag.cls">{{ statusTag.text }}</span>
    </header>

    <!-- 缩略图（有生成结果时） -->
    <div v-if="thumbUrl" class="canvas-node__thumb" :class="{ 'is-running': node.status === NODE_STATUS.RUNNING }">
      <img :src="thumbUrl" :alt="node.name" loading="lazy" />
      <span v-if="node.node_type === 'video'" class="canvas-node__play">
        <CanvasIcon name="play" :size="16" />
      </span>
    </div>

    <!-- 生成中占位：没有结果时也要让"正在生成"可见，否则用户以为没反应 -->
    <div v-else-if="node.status === NODE_STATUS.RUNNING" class="canvas-node__thumb is-placeholder">
      <span class="canvas-node__spinner" aria-hidden="true" />
      <span class="canvas-node__thumb-label">{{ t("canvasUi.nodeGenerating") }}</span>
    </div>

    <!-- 标题 -->
    <p class="canvas-node__name">{{ node.name || meta.label }}</p>

    <!-- 摘要：空参数时给一句"该填什么"的提示，而不是留白 -->
    <p v-if="summary" class="canvas-node__summary">{{ summary }}</p>
    <p v-else class="canvas-node__summary is-empty">{{ meta.hint }}</p>

    <!-- 失败原因：带错误码，用户能自己对照文档排查，也方便他判断要不要重投 -->
    <p v-if="lastErrorText" class="canvas-node__error" :title="lastErrorText">{{ lastErrorText }}</p>

    <!-- 尾部：任务/分组标记 -->
    <footer v-if="node.task_id || node.group_ids.length" class="canvas-node__foot">
      <span v-if="node.task_id" class="cv-tag">{{ t("canvasUi.nodeTaskTag") }}</span>
      <span v-if="node.group_ids.length" class="cv-tag">{{ t("canvasUi.nodeGroupsTag", { count: node.group_ids.length }) }}</span>
    </footer>
  </div>
</template>

<style scoped>
.canvas-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px 10px;
  border: 1px solid var(--cv-node-border);
  border-radius: var(--cv-node-radius);
  background: var(--cv-node-bg);
  box-shadow: var(--cv-node-shadow);
  cursor: grab;
  user-select: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  /* 左侧色条用伪元素，避免影响盒模型宽度计算（拖拽命中依赖精确宽高） */
}
.canvas-node::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: var(--radius-full);
  background: var(--node-accent);
  opacity: 0.8;
}
.canvas-node:hover {
  border-color: var(--cv-node-border-hover);
}
.canvas-node.is-selected {
  border-color: var(--cv-node-selected);
  box-shadow: 0 0 0 2px #9b46ff40, var(--cv-node-shadow);
}
.canvas-node.is-connecting {
  cursor: crosshair;
}
.canvas-node.is-connecting:hover {
  border-color: var(--brand-400);
  box-shadow: 0 0 0 2px #b07aff4d;
}
.canvas-node.is-source {
  border-color: var(--brand-400);
  border-style: dashed;
}
.canvas-node.is-locked {
  opacity: 0.62;
  cursor: not-allowed;
}

.canvas-node__head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.canvas-node__icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--node-accent) 16%, transparent);
  color: var(--node-accent);
  flex: none;
}
.canvas-node__type {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-node__lock {
  color: var(--warning);
  display: inline-flex;
  flex: none;
}
.canvas-node__head .cv-tag {
  margin-left: auto;
  flex: none;
}

.canvas-node__thumb {
  position: relative;
  margin-top: 2px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #0e0f14;
  aspect-ratio: 16 / 9;
}
.canvas-node__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.canvas-node__play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  background: #0000004d;
}

/* 生成中占位：脉冲底 + 旋转圈，让"在跑"这件事一眼可见 */
.canvas-node__thumb.is-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: linear-gradient(100deg, #1b1c24 30%, #24263a 50%, #1b1c24 70%);
  background-size: 240% 100%;
  animation: cv-node-shimmer 1.5s ease-in-out infinite;
}
@keyframes cv-node-shimmer {
  0% {
    background-position: 140% 0;
  }
  100% {
    background-position: -40% 0;
  }
}
.canvas-node__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #ffffff2e;
  border-top-color: var(--node-accent);
  border-radius: var(--radius-full);
  animation: cv-node-spin 0.8s linear infinite;
}
@keyframes cv-node-spin {
  to {
    transform: rotate(360deg);
  }
}
.canvas-node__thumb-label {
  font-size: 10px;
  color: var(--text-3);
}
/* 缩略图生成中也保持半透明叠加，指示"这还不是最终结果" */
.canvas-node__thumb.is-running img {
  opacity: 0.55;
}

.canvas-node__error {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-node__name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-node__summary {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.canvas-node__summary.is-empty {
  color: var(--text-5);
  font-style: italic;
}
.canvas-node__foot {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 1px;
}
</style>
