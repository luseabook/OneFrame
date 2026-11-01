<script setup lang="ts">
import type {
  CanvasEdgeDto,
  CanvasShareFileUrls,
  CanvasShareNode,
  CanvasShareThumbs,
  CanvasShareView,
} from "~/types/canvas";
import { NODE_TYPE_META } from "~/types/canvas";

/**
 * 画布公开页（第 126 批）—— `/canvas/share/[token]`。
 *
 * 公开页只读一份**冻结快照**（`GET /canvas-share/:token`），不碰画布本体：
 * 主人后续继续编辑、撤销链接、画布软删，都在服务端由这一行快照判定，
 * 前端不做任何授权判断，也没有任何写操作。
 *
 * 不设 `requiresAuth`，也不进 `PUBLIC_PATHS`：分享链接本身带 token，
 * 不应被搜索引擎收录（`i18n/index.ts` 的 `PUBLIC_PATHS` 只放营销页）。
 */
definePageMeta({ ssr: false });

const { t, locale } = useI18n();
const route = useRoute();
const api = useApi();
const token = computed(() => String(route.params.token));

const view = ref<CanvasShareView | null>(null);
const error = ref("");
const loading = ref(true);

/** 缩略图（node_id → 签名 URL）；失败不降级整页，只是卡片显示类型占位 */
const thumbs = ref<Record<string, string>>({});

/** 产物地址按需加载：签名 200 条 URL 不该阻塞首屏 */
const files = ref<CanvasShareFileUrls | null>(null);
const fileList = computed(() => files.value?.files ?? []);
const filesLoading = ref(false);
const filesError = ref("");

useHead({
  title: () => (view.value?.canvas.title ? `${view.value.canvas.title} · ${t("canvasShare.title")}` : t("canvasShare.title")),
});

// ── 节点展示 ──────────────────────────────────────────────
// 公开页的卡片高度是**恒定**的：快照不带渲染尺寸，而连线要落在确定的底边上，
// 否则同一张图在不同内容高度下会画出错位的边。宽度沿用编辑器里各类型的默认宽。
const CARD_H = 176;
const BOARD_PAD = 56;
const MIN_SCALE = 0.25;

const NODE_LABEL_KEYS: Record<string, string> = {
  text: "canvasUi.nodeText",
  table: "canvasUi.nodeTable",
  image: "canvasUi.nodeImage",
  video: "canvasUi.nodeVideo",
  audio: "canvasUi.nodeAudio",
  clip: "canvasUi.nodeClip",
  script: "canvasShare.nodeScript",
  asset: "canvasShare.nodeAsset",
  director: "canvasShare.nodeDirector",
  threeDWorld: "canvasShare.nodeThreeDWorld",
  group: "canvasUi.nodeGroupDefault",
};

function nodeTypeLabel(type: string): string {
  const key = NODE_LABEL_KEYS[type];
  if (key) return t(key);
  return (NODE_TYPE_META as Record<string, { label?: string } | undefined>)[type]?.label ?? type;
}

function nodeColor(type: string): string {
  return (NODE_TYPE_META as Record<string, { color?: string } | undefined>)[type]?.color ?? "#8b93a7";
}

function nodeW(node: CanvasShareNode): number {
  return node.width ?? (NODE_TYPE_META as Record<string, { width?: number } | undefined>)[node.node_type]?.width ?? 260;
}

function pget(params: Record<string, unknown>, key: string): unknown {
  return params?.[key];
}
function ps(params: Record<string, unknown>, key: string, fallback = ""): string {
  const value = pget(params, key);
  return value === undefined || value === null || value === "" ? fallback : String(value);
}
function pn(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = pget(params, key);
  return typeof value === "number" ? value : fallback;
}
function pobj(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = pget(params, key);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function parr(params: Record<string, unknown>, key: string): unknown[] {
  const value = pget(params, key);
  return Array.isArray(value) ? value : [];
}

/** 摘要行与编辑器同口径（`CanvasNode.vue`）：只显示"一眼看出这是什么"的信息 */
function summary(node: CanvasShareNode): string {
  const params = node.params ?? {};
  switch (node.node_type) {
    case "text":
      return ps(params, "prompt");
    case "image":
    case "threeDWorld":
      return [ps(params, "mode", "text2image"), ps(params, "prompt")].filter(Boolean).join(" · ");
    case "video": {
      const settings = pobj(params, "settings");
      const bits = [ps(params, "mode", "text2video")];
      if (settings.resolution) bits.push(String(settings.resolution));
      if (settings.duration) bits.push(`${String(settings.duration)}s`);
      return bits.join(" · ") + (ps(params, "prompt") ? ` · ${ps(params, "prompt")}` : "");
    }
    case "audio":
      return [ps(params, "audioKind", "voiceover"), ps(params, "prompt"), `${pn(params, "duration", 10)}s`]
        .filter(Boolean)
        .join(" · ");
    case "table": {
      const table = pobj(params, "table");
      const sheets = Array.isArray(table.sheets) ? table.sheets.length : 0;
      const source = (table.source as Record<string, unknown> | undefined)?.type;
      return t("canvasUi.nodeTableSummary", { sheets: String(sheets), src: String(source ?? "manual") });
    }
    case "script":
      return [
        ps(params, "runPhase", "storyboard") === "asset_match"
          ? t("canvasUi.nodeScriptAssetMatch")
          : t("canvasUi.nodeScriptStoryboard"),
        t("canvasUi.nodeShotsCount", { n: pn(params, "shotCount", 3) }),
        ps(params, "sourceText"),
      ]
        .filter(Boolean)
        .join(" · ");
    case "asset":
      return [ps(params, "activeTab", "character"), ps(params, "sourceText")].filter(Boolean).join(" · ");
    case "clip": {
      const settings = pobj(params, "exportSettings");
      return t("canvasUi.nodeVideoSummary", {
        segments: String(parr(params, "shotOrder").length),
        resolution: String(settings.resolution ?? "720p"),
        format: String(settings.format ?? "mp4"),
      });
    }
    case "director":
      return ps(params, "referenceLabel", t("canvasUi.nodeShotOrderDefault"));
    case "group":
      return t("canvasUi.nodeGroupSummary", {
        title: ps(params, "title", t("canvasUi.nodeGroupDefault")),
        count: parr(params, "childNodeIds").length,
      });
    default:
      return "";
  }
}

const nodes = computed(() => view.value?.nodes ?? []);
const edges = computed(() => view.value?.edges ?? []);
const nodeMap = computed(() => new Map(nodes.value.map((node) => [node.id, node])));

/** 画布包围盒 → 固定尺寸的舞台；缩放只做适配，不改坐标 */
const board = computed(() => {
  let minX = 0;
  let minY = 0;
  let width = 0;
  let height = 0;
  if (nodes.value.length) {
    let maxX = -Infinity;
    let maxY = -Infinity;
    minX = Infinity;
    minY = Infinity;
    for (const node of nodes.value) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + nodeW(node));
      maxY = Math.max(maxY, node.y + CARD_H);
    }
    width = Math.max(320, Math.ceil(maxX - minX + BOARD_PAD * 2));
    height = Math.max(240, Math.ceil(maxY - minY + BOARD_PAD * 2));
  }
  return { minX, minY, width, height };
});

function cardPos(node: CanvasShareNode): { left: number; top: number } {
  return { left: node.x - board.value.minX + BOARD_PAD, top: node.y - board.value.minY + BOARD_PAD };
}

/** 连线几何与编辑器一致：右中点 → 左中点的三次贝塞尔 */
function edgePath(edge: CanvasEdgeDto): string {
  const from = nodeMap.value.get(edge.src_node_id);
  const to = nodeMap.value.get(edge.dst_node_id);
  if (!from || !to) return "";
  const a = cardPos(from);
  const b = cardPos(to);
  const ax = a.left + nodeW(from);
  const ay = a.top + CARD_H / 2;
  const bx = b.left;
  const by = b.top + CARD_H / 2;
  const dx = Math.max(40, Math.abs(bx - ax) * 0.5);
  return `M ${ax} ${ay} C ${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}`;
}

// 无 @vueuse，直接用 ResizeObserver 做"适配宽度"
const wrapEl = ref<HTMLElement | null>(null);
const wrapWidth = ref(0);
let observer: ResizeObserver | null = null;

const scale = computed(() => {
  const width = board.value.width;
  if (!width || !wrapWidth.value) return 1;
  return Math.max(MIN_SCALE, Math.min(1, (wrapWidth.value - 2) / width));
});

function observeWrap(): void {
  observer?.disconnect();
  const el = wrapEl.value;
  if (!el) return;
  wrapWidth.value = el.clientWidth;
  observer = new ResizeObserver((entries) => {
    wrapWidth.value = entries[0]?.contentRect.width ?? el.clientWidth;
  });
  observer.observe(el);
}

const expiresText = computed(() =>
  view.value ? new Date(view.value.share.expires_at).toLocaleString(locale.value) : "",
);

function fileName(file: CanvasShareFileUrls["files"][number]): string {
  const node = nodeMap.value.get(file.node_id);
  return node?.name || nodeTypeLabel(node?.node_type ?? "");
}

// ── 数据加载 ──────────────────────────────────────────────
async function loadThumbs(): Promise<void> {
  try {
    const data = await api.get<CanvasShareThumbs>(`/canvas-share/${token.value}/file-thumbs`);
    const map: Record<string, string> = {};
    for (const item of data.thumbs) map[item.node_id] = item.url;
    thumbs.value = map;
  } catch {
    // 缩略图只是锦上添花：签名失败或网络抖动不该把整页降级成错误页
  }
}

async function loadFiles(): Promise<void> {
  filesLoading.value = true;
  filesError.value = "";
  try {
    const data = await api.get<CanvasShareFileUrls>(`/canvas-share/${token.value}/file-urls`);
    files.value = data;
  } catch (e) {
    filesError.value = e instanceof Error ? e.message : t("canvasShare.filesError");
  } finally {
    filesLoading.value = false;
  }
}

onMounted(async () => {
  try {
    view.value = await api.get<CanvasShareView>(`/canvas-share/${token.value}`);
    void loadThumbs();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("canvasShare.expired");
  } finally {
    loading.value = false;
    await nextTick();
    observeWrap();
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <main class="page">
    <p v-if="loading" class="loading">{{ t("common.loading") }}</p>

    <section v-else-if="error" class="panel">
      <h1>{{ t("canvasShare.unavailable") }}</h1>
      <p class="muted">{{ error }}</p>
      <NuxtLink class="link" to="/">{{ t("canvasShare.backHome") }}</NuxtLink>
    </section>

    <section v-else-if="view" class="panel">
      <header class="head">
        <h1>{{ view.canvas.title }}</h1>
        <p class="meta">
          <span>{{ t("canvasShare.nodeCount", { n: view.canvas.node_count }) }}</span>
          <span v-if="view.canvas.file_count">{{ t("canvasShare.fileCount", { n: view.canvas.file_count }) }}</span>
          <span>{{ t("canvasShare.expires", { at: expiresText }) }}</span>
        </p>
      </header>

      <p v-if="view.canvas.truncated" class="muted">
        {{ t("canvasShare.truncated", { n: view.canvas.node_count }) }}
      </p>

      <p v-if="!view.nodes.length" class="muted">{{ t("canvasShare.empty") }}</p>

      <div v-else ref="wrapEl" class="board-wrap">
        <div
          class="board-scale"
          :style="{ width: `${board.width * scale}px`, height: `${board.height * scale}px` }"
        >
          <div
            class="board"
            :style="{ width: `${board.width}px`, height: `${board.height}px`, transform: `scale(${scale})` }"
          >
            <svg class="board-edges" :width="board.width" :height="board.height" aria-hidden="true">
              <path v-for="edge in edges" :key="edge.id" :d="edgePath(edge)" />
            </svg>

            <article
              v-for="node in nodes"
              :key="node.id"
              class="cv-card"
              :style="{
                left: `${cardPos(node).left}px`,
                top: `${cardPos(node).top}px`,
                width: `${nodeW(node)}px`,
                height: `${CARD_H}px`,
                '--node-accent': nodeColor(node.node_type),
              }"
            >
              <span class="cv-card__type">{{ nodeTypeLabel(node.node_type) }}</span>
              <div class="cv-card__thumb">
                <img v-if="thumbs[node.id]" :src="thumbs[node.id]" alt="" loading="lazy" />
                <span v-else class="cv-card__ph">{{ nodeTypeLabel(node.node_type) }}</span>
              </div>
              <p class="cv-card__name">{{ node.name || nodeTypeLabel(node.node_type) }}</p>
              <p v-if="summary(node)" class="cv-card__sum">{{ summary(node) }}</p>
              <span v-if="node.file_count" class="cv-card__files">
                {{ t("canvasShare.fileCount", { n: node.file_count }) }}
              </span>
            </article>
          </div>
        </div>
      </div>

      <p class="muted small">{{ t("canvasShare.snapshotNote") }}</p>

      <section v-if="view.canvas.file_count" class="files">
        <div class="files-head">
          <h2>{{ t("canvasShare.filesTitle") }}</h2>
          <Button v-if="!files" size="sm" variant="ghost" :loading="filesLoading" @click="loadFiles">
            {{ t("canvasShare.loadFiles") }}
          </Button>
        </div>

        <p v-if="filesError" class="error">{{ filesError }}</p>
        <p v-else-if="!files" class="muted small">{{ t("canvasShare.filesHint") }}</p>
        <template v-else>
          <p v-if="!fileList.length" class="muted small">{{ t("canvasShare.emptyFiles") }}</p>
          <template v-else>
            <ul class="file-list">
              <li v-for="file in fileList" :key="file.url">
                <a :href="file.url" target="_blank" rel="noopener noreferrer">{{ fileName(file) }}</a>
                <span class="kind">
                  {{ file.kind === "preview" ? t("canvasShare.kindPreview") : t("canvasShare.kindResult") }}
                </span>
              </li>
            </ul>
            <p class="muted small">
              {{ t("canvasShare.filesTtl", { min: Math.round(files.expires_in / 60) }) }}
            </p>
          </template>
        </template>
      </section>
    </section>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
.loading {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-6);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.muted {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.7;
}
.small {
  font-size: var(--text-xs);
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.link {
  display: inline-block;
  color: var(--brand-300);
  font-size: var(--text-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.link:hover {
  color: var(--text-1);
}

/* 画布舞台：`--cv-*` 令牌只在 `.canvas-view` 下定义，这里按同一口径局部落地 */
.board-wrap {
  --cv-canvas-bg: #08080b;
  --cv-dot-color: #ffffff14;
  --cv-dot-size: 24px;
  --cv-node-bg: #1b1c24;
  --cv-node-border: #ffffff1f;
  --cv-edge: #8b93a7;
  position: relative;
  overflow: auto;
  max-height: 70vh;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background-color: var(--cv-canvas-bg);
  background-image: radial-gradient(var(--cv-dot-color) 1px, transparent 1px);
  background-size: var(--cv-dot-size) var(--cv-dot-size);
}
.board-scale {
  position: relative;
}
.board {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}
.board-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.board-edges path {
  fill: none;
  stroke: var(--cv-edge);
  stroke-width: 1.5;
  opacity: 0.55;
}
.cv-card {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  overflow: hidden;
  background: var(--cv-node-bg);
  border: 1px solid var(--cv-node-border);
  border-radius: 12px;
}
.cv-card__type {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: var(--node-accent, var(--text-3));
}
.cv-card__thumb {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72px;
  overflow: hidden;
  background: #ffffff08;
  border-radius: 8px;
}
.cv-card__thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv-card__ph {
  color: var(--text-4);
  font-size: 12px;
}
.cv-card__name {
  flex: none;
  margin: 0;
  overflow: hidden;
  color: var(--text-1);
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cv-card__sum {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-3);
  font-size: 11px;
  line-height: 15px;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.cv-card__files {
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--text-4);
  font-size: 10px;
}

/* 产物文件：默认收起，点一次才签名 */
.files {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-top: 1px solid var(--border-1);
  padding-top: var(--space-4);
}
.files-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.file-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.file-list a {
  overflow: hidden;
  color: var(--brand-300);
  font-size: var(--text-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color var(--duration-fast) var(--ease-out);
}
.file-list a:hover {
  color: var(--text-1);
}
.kind {
  flex: none;
  color: var(--text-4);
  font-size: var(--text-xs);
}

@media (max-width: 768px) {
  .page {
    padding: 16px;
  }
  .panel {
    padding: var(--space-4);
  }
}
</style>