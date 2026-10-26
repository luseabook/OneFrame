<script setup lang="ts">
import type { CanvasNodeDto } from "~/types/canvas";
import { NODE_TYPE_META } from "~/types/canvas";

/**
 * 无限画布编辑器主壳
 *
 * 交互模型（每条都对应一个具体的技术决策）：
 *
 * 1. **视口 = transform: translate + scale**，不是"改每个节点的坐标"。
 *    节点存的是世界坐标；缩放/平移只改容器 transform。这样拖动节点时
 *    要把屏幕位移 / zoom 转回世界位移，否则放大后节点"跑得比鼠标快"。
 *
 * 2. **拖拽用 pointer events + setPointerCapture**，不用 mousedown/mousemove：
 *    pointer 事件统一鼠标/触屏/笔，且 capture 后鼠标移出画布也不会丢事件。
 *
 * 3. **框选用画布层自己画矩形**，命中判定在世界坐标做（见 editor.selectInRect），
 *    避免"缩小时框选区域和视觉不一致"。
 *
 * 4. **连线 = 进入连线模式后点两个节点**，不是拖端口。理由见 CanvasNode.vue 注释。
 *
 * 5. **滚轮缩放 + 空格/中键平移**：滚轮用非 passive 监听 preventDefault，
 *    否则浏览器会同时滚页面。
 *
 * 6. **快捷键遵循主流画布工具**：Delete 删除、Ctrl+Z/Y 撤销重做、Ctrl+D 复制、
 *    Ctrl+A 全选、Ctrl+S 保存、Esc 取消选择/退出连线、Tab 加文本节点（参照站文案提到）。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });
useHead({ title: "无限画布 · 一帧" });

const route = useRoute();
const canvasId = computed(() => String(route.params.id ?? ""));

const editor = useCanvasEditor(canvasId);
// 只解构模板里真正用到的；其余（pinnedNodeId/lockedNodes/selectedId/selectedNode）
// 通过 editor.* 访问，避免 lint 未使用告警
const {
  title, version, nodes, edges, groups,
  loading, saving, dirty, loadError,
  mode, connectFrom, connectCursor, viewport,
  selectedIds, selectedNodes,
  canUndo, canRedo,
} = editor;

// ── DOM 引用 ─────────────────────────────────────────────
const stageEl = ref<HTMLElement | null>(null);
const inspectorOpen = ref(true);
const inspectorWidth = ref(320);
const minimapOpen = ref(true);
const historyOpen = ref(false);
const templateOpen = ref(false);
const historyList = ref<Array<{ id: string; version: number; kind: number; created_at: string }>>([]);
const historyLoading = ref(false);
const guideOpen = ref(false);

const api = useCanvasApi();
const toast = useToast();

// ── 画布尺寸（用于 fitView / 小地图）────────────────────
const stageSize = ref({ w: 0, h: 0 });
let resizeObserver: ResizeObserver | undefined;

function measureStage(): void {
  const el = stageEl.value;
  if (!el) return;
  stageSize.value = { w: el.clientWidth, h: el.clientHeight };
}

// ── 视口变换字符串 ───────────────────────────────────────
const worldTransform = computed(
  () => `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
);
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));

// ── 拖拽（节点）─────────────────────────────────────────
interface DragState {
  /** 起始世界坐标 */
  startWorld: { x: number; y: number };
  /** 被拖节点及其初始位置 */
  origins: Array<{ id: string; x: number; y: number }>;
  /** 是否已越过阈值（避免"点一下就变脏"） */
  moved: boolean;
}
const drag = ref<DragState | null>(null);

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.left - viewport.value.x) / viewport.value.zoom,
    y: (clientY - rect.top - viewport.value.y) / viewport.value.zoom,
  };
}

function onNodePointerDown(ev: PointerEvent, node: CanvasNodeDto): void {
  if (ev.button !== 0) return;
  // 连线模式下点节点 = 选连线端点，不进入拖拽
  if (mode.value === "connect") {
    handleConnectClick(node.id);
    return;
  }
  if (mode.value === "pan") return;

  // 多选状态下点已选中的节点 → 保持多选一起拖；否则先单选
  if (!selectedIds.value.includes(node.id)) {
    editor.select(node.id, ev.shiftKey || ev.metaKey || ev.ctrlKey);
  } else if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
    editor.select(node.id, true);
    return;
  }

  const world = screenToWorld(ev.clientX, ev.clientY);
  drag.value = {
    startWorld: world,
    origins: selectedNodes.value.map((n) => ({ id: n.id, x: n.x, y: n.y })),
    moved: false,
  };
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
}

function onStagePointerMove(ev: PointerEvent): void {
  // 连线模式下跟踪光标，画预览曲线
  if (mode.value === "connect" && connectFrom.value) {
    connectCursor.value = screenToWorld(ev.clientX, ev.clientY);
    return;
  }
  if (marquee.value) {
    updateMarquee(ev);
    return;
  }
  if (panState.value) {
    const dx = ev.clientX - panState.value.lastX;
    const dy = ev.clientY - panState.value.lastY;
    panState.value.lastX = ev.clientX;
    panState.value.lastY = ev.clientY;
    editor.panBy(dx, dy);
    return;
  }
  if (!drag.value) return;

  const world = screenToWorld(ev.clientX, ev.clientY);
  const dx = world.x - drag.value.startWorld.x;
  const dy = world.y - drag.value.startWorld.y;
  if (!drag.value.moved && Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
  if (!drag.value.moved) {
    drag.value.moved = true;
    // 拖拽前记一次历史，撤销才能回到"拖之前"的位置
    editor.pushHistory();
  }
  for (const origin of drag.value.origins) {
    const n = nodes.value.find((x) => x.id === origin.id);
    if (!n) continue;
    n.x = Math.round(origin.x + dx);
    n.y = Math.round(origin.y + dy);
  }
  dirty.value = true;
}

function onStagePointerUp(): void {
  drag.value = null;
  panState.value = null;
  if (marquee.value) {
    finishMarquee();
  }
}

// ── 平移（空格 / 中键 / 抓手模式）──────────────────────
const panState = ref<{ lastX: number; lastY: number } | null>(null);
const spaceDown = ref(false);

function onStagePointerDown(ev: PointerEvent): void {
  // 兜底守卫：如果事件来自浮层 chrome（按钮/输入框/面板），一律交给它们自己处理。
  // 正常情况下 chrome 已移出 .canvas-stage，但绝对定位的浮层仍可能因结构调整
  // 落回舞台内——这里做一层防御，避免 setPointerCapture 再次吞掉按钮 click。
  const target = ev.target as HTMLElement | null;
  if (target?.closest("button, input, textarea, select, a, [role='button'], [data-no-pan]")) {
    return;
  }

  // 中键、抓手模式、或按住空格 → 平移
  const wantPan = ev.button === 1 || mode.value === "pan" || spaceDown.value;
  if (wantPan) {
    ev.preventDefault();
    panState.value = { lastX: ev.clientX, lastY: ev.clientY };
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    return;
  }
  if (ev.button !== 0) return;

  // 连线模式下点空白 → 取消连线起点
  if (mode.value === "connect") {
    connectFrom.value = null;
    connectCursor.value = null;
    return;
  }

  // 点空白：清空选择，并开始框选
  if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) editor.select(null);
  const world = screenToWorld(ev.clientX, ev.clientY);
  marquee.value = { x0: world.x, y0: world.y, x1: world.x, y1: world.y };
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
}

// ── 框选 ────────────────────────────────────────────────
const marquee = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

function updateMarquee(ev: PointerEvent): void {
  if (!marquee.value) return;
  const world = screenToWorld(ev.clientX, ev.clientY);
  marquee.value.x1 = world.x;
  marquee.value.y1 = world.y;
}

function finishMarquee(): void {
  const m = marquee.value;
  marquee.value = null;
  if (!m) return;
  const rect = {
    x: Math.min(m.x0, m.x1),
    y: Math.min(m.y0, m.y1),
    w: Math.abs(m.x1 - m.x0),
    h: Math.abs(m.y1 - m.y0),
  };
  // 小于 4px 视为误触（点击空白），不做框选
  if (rect.w < 4 && rect.h < 4) return;
  editor.selectInRect(rect);
}

const marqueeStyle = computed(() => {
  const m = marquee.value;
  if (!m) return null;
  return {
    left: `${Math.min(m.x0, m.x1)}px`,
    top: `${Math.min(m.y0, m.y1)}px`,
    width: `${Math.abs(m.x1 - m.x0)}px`,
    height: `${Math.abs(m.y1 - m.y0)}px`,
  };
});

// ── 连线 ────────────────────────────────────────────────
function handleConnectClick(nodeId: string): void {
  const src = connectFrom.value;
  if (!src) {
    connectFrom.value = nodeId;
    toast.info("已选起点，再点目标节点完成连线");
    return;
  }
  if (src === nodeId) {
    connectFrom.value = null;
    connectCursor.value = null;
    return;
  }
  const created = editor.addEdge(src, nodeId);
  connectFrom.value = null;
  connectCursor.value = null;
  toast[created ? "success" : "info"](created ? "已连线" : "这条连线已存在");
}

// ── 连线路径（贝塞尔）──────────────────────────────────
function nodeById(id: string): CanvasNodeDto | undefined {
  return nodes.value.find((n) => n.id === id);
}
function nodeW(n: CanvasNodeDto): number {
  return n.width ?? NODE_TYPE_META[n.node_type as keyof typeof NODE_TYPE_META]?.width ?? 260;
}
function nodeH(n: CanvasNodeDto): number {
  return n.height ?? 76;
}

/** 从源节点右中 → 目标节点左中，三次贝塞尔 */
function edgePath(srcId: string, dstId: string): string {
  const a = nodeById(srcId);
  const b = nodeById(dstId);
  if (!a || !b) return "";
  const ax = a.x + nodeW(a);
  const ay = a.y + nodeH(a) / 2;
  const bx = b.x;
  const by = b.y + nodeH(b) / 2;
  // 水平距离足够时用标准 S 曲线；目标在左侧时加大控制点偏移避免线穿过节点
  const dx = Math.max(40, Math.abs(bx - ax) * 0.5);
  return `M ${ax} ${ay} C ${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}`;
}

/** 连线预览（起点 → 光标） */
const previewPath = computed(() => {
  const src = connectFrom.value ? nodeById(connectFrom.value) : null;
  const cur = connectCursor.value;
  if (!src || !cur) return "";
  const ax = src.x + nodeW(src);
  const ay = src.y + nodeH(src) / 2;
  const dx = Math.max(40, Math.abs(cur.x - ax) * 0.5);
  return `M ${ax} ${ay} C ${ax + dx} ${ay} ${cur.x - dx} ${cur.y} ${cur.x} ${cur.y}`;
});

// ── 缩放/滚轮 ───────────────────────────────────────────
function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect) return;
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  // 触控板双指滚动 deltaY 很小，用指数缩放更顺滑
  const factor = Math.exp(-ev.deltaY * 0.0015);
  editor.zoomAt(factor, sx, sy);
}

function zoomIn(): void {
  editor.zoomAt(1.2, stageSize.value.w / 2, stageSize.value.h / 2);
}
function zoomOut(): void {
  editor.zoomAt(1 / 1.2, stageSize.value.w / 2, stageSize.value.h / 2);
}
function setZoomPercent(p: number): void {
  editor.setZoom(p / 100, stageSize.value.w / 2, stageSize.value.h / 2);
}
function doFitView(): void {
  editor.fitView(stageSize.value);
}

/** 整理画布：按连线拓扑做简单的分层排布（无 dagre 依赖，用最长路径分层） */
function organize(): void {
  if (nodes.value.length === 0) return;
  editor.pushHistory();
  const incoming = new Map<string, string[]>();
  for (const n of nodes.value) incoming.set(n.id, []);
  for (const e of edges.value) {
    if (incoming.has(e.dst_node_id)) incoming.get(e.dst_node_id)!.push(e.src_node_id);
  }
  // 分层：入度为 0 的是第 0 层，其余取"所有前驱层号 +1"的最大值
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  function levelOf(id: string): number {
    if (level.has(id)) return level.get(id)!;
    if (visiting.has(id)) return 0; // 有环：断开，避免死循环
    visiting.add(id);
    const preds = incoming.get(id) ?? [];
    const lv = preds.length === 0 ? 0 : Math.max(...preds.map((p) => levelOf(p) + 1));
    visiting.delete(id);
    level.set(id, lv);
    return lv;
  }
  for (const n of nodes.value) levelOf(n.id);

  const byLevel = new Map<number, CanvasNodeDto[]>();
  for (const n of nodes.value) {
    const lv = level.get(n.id) ?? 0;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(n);
  }
  const GAP_X = 120;
  const GAP_Y = 60;
  let x = 120;
  for (const lv of Array.from(byLevel.keys()).sort((a, b) => a - b)) {
    const col = byLevel.get(lv)!;
    let y = 120;
    let colWidth = 0;
    for (const n of col) {
      n.x = Math.round(x);
      n.y = Math.round(y);
      y += nodeH(n) + GAP_Y;
      colWidth = Math.max(colWidth, nodeW(n));
    }
    x += colWidth + GAP_X;
  }
  dirty.value = true;
  nextTick(() => doFitView());
  toast.success("已按连线整理画布");
}

/** 小地图点击跳转：把目标世界坐标移到视口中心 */
function jumpToWorld(wx: number, wy: number): void {
  editor.panBy(
    stageSize.value.w / 2 - wx * viewport.value.zoom,
    stageSize.value.h / 2 - wy * viewport.value.zoom,
  );
}

// ── 节点增删 ────────────────────────────────────────────
/**
 * 新建节点的落点 = **可视区中心**，不是舞台几何中心。
 *
 * 踩过的坑：`.canvas-stage` 是满宽（检查器是绝对定位浮在上面），
 * 用 stage 宽度的一半当中心，会算出「被检查器盖住」的位置——
 * 用户点完「+」看不到新节点，以为没建成功（实测 E2E 就卡在这里）。
 * 所以要把右侧检查器占的宽度扣掉，只在真正可见的区域里取中心。
 */
function visibleCenter(): { x: number; y: number } {
  const rect = stageEl.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  const coveredRight = inspectorOpen.value ? inspectorWidth.value : 0;
  const visibleW = Math.max(240, stageSize.value.w - coveredRight);
  return screenToWorld(rect.left + visibleW / 2, rect.top + stageSize.value.h / 2);
}

function addNodeAtCenter(type: Parameters<typeof editor.addNode>[0]): void {
  const world = visibleCenter();
  const node = editor.addNode(type, world);
  // 只在"新节点不在可视区"时才平移。绝不无条件居中：
  // 无条件居中会把**之前**的节点挤出屏幕，用户连点两次就看不到第一个节点了
  // （实测：第二个节点建完后第一个节点被推到 x=-68，直接落在视口外）。
  nextTick(() => ensureVisible(node.id));
}

/** 若节点不完全在可视区内，最小幅度平移把它带进来（不动缩放） */
function ensureVisible(nodeId: string): void {
  const n = nodes.value.find((x) => x.id === nodeId);
  const rect = stageEl.value?.getBoundingClientRect();
  if (!n || !rect) return;
  const coveredRight = inspectorOpen.value ? inspectorWidth.value : 0;
  const visibleW = Math.max(240, stageSize.value.w - coveredRight);
  const visibleH = stageSize.value.h;
  const pad = 24;
  const nw = n.width ?? 260;
  const nh = n.height ?? 76;
  // 节点当前在屏幕上的矩形
  const sx = n.x * viewport.value.zoom + viewport.value.x;
  const sy = n.y * viewport.value.zoom + viewport.value.y;
  const sw = nw * viewport.value.zoom;
  const sh = nh * viewport.value.zoom;
  let dx = 0;
  let dy = 0;
  if (sx < pad) dx = pad - sx;
  else if (sx + sw > visibleW - pad) dx = visibleW - pad - (sx + sw);
  if (sy < pad) dy = pad - sy;
  else if (sy + sh > visibleH - pad) dy = visibleH - pad - (sy + sh);
  if (dx !== 0 || dy !== 0) editor.panBy(dx, dy);
}
function addNodeAtPointer(type: Parameters<typeof editor.addNode>[0], ev: MouseEvent): void {
  editor.addNode(type, screenToWorld(ev.clientX, ev.clientY));
}

function onStageDoubleClick(ev: MouseEvent): void {
  // 双击空白 = 建文本节点（参照站文案「双击画布自由生成节点」）
  const target = ev.target as HTMLElement;
  if (target.closest(".canvas-node")) return;
  addNodeAtPointer("text", ev);
}

function deleteSelection(): void {
  if (selectedIds.value.length === 0) return;
  editor.deleteNodes(selectedIds.value);
}

// ── 重命名 ──────────────────────────────────────────────
async function onRename(next: string): Promise<void> {
  const t = next.trim();
  if (!t || t === title.value) return;
  try {
    const res = await api.rename(canvasId.value, { title: t, version: version.value });
    title.value = t;
    version.value = res.version;
    toast.success("已重命名");
  } catch (e) {
    const err = e as { code?: number; message: string };
    if (err.code === 746002) toast.error("画布已被他人修改（版本冲突），请重新加载");
    else toast.error(err.message || "重命名失败");
  }
}

// ── 历史版本 ────────────────────────────────────────────
async function openHistory(): Promise<void> {
  historyOpen.value = true;
  historyLoading.value = true;
  try {
    const r = await api.snapshots(canvasId.value, 30);
    historyList.value = r.list;
  } catch (e) {
    toast.error((e as Error).message || "读取历史版本失败");
  } finally {
    historyLoading.value = false;
  }
}

/** 恢复到某个历史版本：把快照里的节点/边/组载入本地，仍需点保存才落库 */
async function restoreSnapshot(v: number): Promise<void> {
  if (dirty.value && !confirm("当前有未保存修改，恢复历史版本会丢弃它们。继续？")) return;
  try {
    const snap = await api.snapshot(canvasId.value, v);
    const payload = snap.payload as {
      nodes?: CanvasNodeDto[];
      edges?: Array<{ src_node_id: string; dst_node_id: string; semantic?: string }>;
      groups?: Array<{ id?: string; name?: string; parent_id?: string | null; sort?: number; status?: number }>;
    };
    editor.pushHistory();
    nodes.value = (payload.nodes ?? []).map((n) => ({
      id: String(n.id),
      node_type: n.node_type,
      name: n.name ?? "",
      x: n.x,
      y: n.y,
      width: n.width ?? null,
      height: n.height ?? null,
      z_index: n.z_index ?? 0,
      params: (n.params ?? {}) as Record<string, unknown>,
      task_id: n.task_id ?? null,
      status: n.status ?? 1,
      group_ids: n.group_ids ?? [],
      version: 1,
    }));
    edges.value = (payload.edges ?? []).map((e, i) => ({
      id: `snap_e_${i}`,
      src_node_id: String(e.src_node_id),
      dst_node_id: String(e.dst_node_id),
      semantic: e.semantic ?? "pipeline",
    }));
    groups.value = (payload.groups ?? []).map((g, i) => ({
      id: String(g.id ?? `snap_g_${i}`),
      parent_id: g.parent_id ? String(g.parent_id) : null,
      name: g.name ?? null,
      sort: g.sort ?? 0,
      status: g.status ?? 1,
    }));    dirty.value = true;
    historyOpen.value = false;
    nextTick(() => doFitView());
    toast.success(`已载入 v${v}，点保存后生效`);
  } catch (e) {
    toast.error((e as Error).message || "恢复失败");
  }
}

// ── 保存 ────────────────────────────────────────────────
/**
 * 保存后**不重新拉整图**：commit 返回 id_map，composable 已在本地把临时 id 换成真实 id。
 * 重新 load() 会清空撤销历史与选择态，用户刚整理好的画布会"跳一下"，体验更差。
 */
async function save(): Promise<void> {
  await editor.save();
}

// ── 生成投递（C6）───────────────────────────────────────
/** 批量投递选中的节点（Ctrl+Enter）；实际逻辑在 composable，这里只管入口 */
async function generateSelection(): Promise<void> {
  if (selectedIds.value.length === 0) {
    toast.info("先选中要生成的节点（可 Shift 多选）");
    return;
  }
  await editor.generateSelected();
}

// ── 快捷键 ──────────────────────────────────────────────
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function onKeyDown(ev: KeyboardEvent): void {
  // 输入框里不抢键（否则在提示词里按 Delete 会删节点）
  if (isTypingTarget(ev.target)) return;
  const mod = ev.ctrlKey || ev.metaKey;

  if (ev.code === "Space" && !ev.repeat) {
    spaceDown.value = true;
    return;
  }
  if (mod && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    void save();
    return;
  }
  if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
    ev.preventDefault();
    editor.undo();
    return;
  }
  if (mod && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) {
    ev.preventDefault();
    editor.redo();
    return;
  }
  if (mod && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    editor.duplicateNodes(selectedIds.value);
    return;
  }
  if (mod && ev.key.toLowerCase() === "a") {
    ev.preventDefault();
    editor.selectAll();
    return;
  }
  // Ctrl+Enter：批量投递选中的节点（与「生成」单节点投递区分开）
  if (mod && ev.key === "Enter") {
    ev.preventDefault();
    void generateSelection();
    return;
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (selectedIds.value.length > 0) {
      ev.preventDefault();
      deleteSelection();
    }
    return;
  }
  if (ev.key === "Escape") {
    if (connectFrom.value) {
      connectFrom.value = null;
      connectCursor.value = null;
    } else if (mode.value === "connect") {
      mode.value = "select";
    } else if (historyOpen.value) {
      historyOpen.value = false;
    } else {
      editor.select(null);
    }
    return;
  }
  if (ev.key === "Tab") {
    ev.preventDefault();
    addNodeAtCenter("text");
    return;
  }
  // 方向键微调（Shift 加速 10px）
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key) && selectedIds.value.length > 0) {
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1;
    const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
    const dy = ev.key === "ArrowUp" ? -step : ev.key === "ArrowDown" ? step : 0;
    editor.moveNodes(selectedIds.value, dx, dy);
  }
}

function onKeyUp(ev: KeyboardEvent): void {
  if (ev.code === "Space") spaceDown.value = false;
}

// ── 离开保护 ────────────────────────────────────────────
function beforeUnload(e: BeforeUnloadEvent): void {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}

/** 从编辑器返回列表：有未保存改动先问一句 */
async function goBack(): Promise<void> {
  if (dirty.value && !confirm("有未保存的修改，确定离开？")) return;
  await navigateTo("/canvas");
}

// ── 检查器宽度拖拽 ──────────────────────────────────────
const resizing = ref(false);
function startResize(ev: PointerEvent): void {
  resizing.value = true;
  const startX = ev.clientX;
  const startW = inspectorWidth.value;
  const onMove = (e: PointerEvent): void => {
    // 面板从右往左拖，所以是 startW - delta
    inspectorWidth.value = Math.min(520, Math.max(240, startW - (e.clientX - startX)));
  };
  const onUp = (): void => {
    resizing.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// ── 生命周期 ────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([editor.load(), editor.loadMe()]);
  editor.startTimers();
  // 打开画布先校正一次节点任务状态：用户可能上次关页面时任务还没跑完，
  // 不校正的话画布会永远显示"生成中"（worker 已回写，但前端不知道）。
  void editor.syncNodeTasks();
  measureStage();
  doFitView();
  if (typeof ResizeObserver !== "undefined" && stageEl.value) {
    resizeObserver = new ResizeObserver(() => {
      measureStage();
    });
    resizeObserver.observe(stageEl.value);
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("beforeunload", beforeUnload);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  void editor.dispose();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<template>
  <div class="canvas-view canvas-editor">
    <!-- 点阵背景（不随视口变换，参照站也是这样：网格在视口层之上固定） -->
    <div class="canvas-view__grid" aria-hidden="true" />

    <!-- ── 加载态 ─────────────────────────────────────── -->
    <div v-if="loading" class="canvas-editor__state">
      <Skeleton :rows="4" />
      <p class="cv-hint">正在载入画布…</p>
    </div>

    <!-- ── 错误态 ─────────────────────────────────────── -->
    <div v-else-if="loadError" class="canvas-editor__state">
      <p class="canvas-editor__err">{{ loadError }}</p>
      <div class="canvas-editor__state-actions">
        <Button variant="secondary" @click="editor.load()">重试</Button>
        <Button variant="text" @click="navigateTo('/canvas')">返回画布列表</Button>
      </div>
    </div>

    <!-- ── 编辑器 ─────────────────────────────────────── -->
    <template v-else>
      <!-- 画布舞台 -->
      <div
        ref="stageEl"
        class="canvas-stage"
        :class="{
          'is-pan-mode': mode === 'pan' || spaceDown,
          'is-connect-mode': mode === 'connect',
          'is-resizing': resizing,
        }"
        @pointerdown="onStagePointerDown"
        @pointermove="onStagePointerMove"
        @pointerup="onStagePointerUp"
        @pointerleave="onStagePointerUp"
        @wheel.prevent="onWheel"
        @dblclick="onStageDoubleClick"
        @contextmenu.prevent
      >
        <!-- 世界层：所有节点与连线都在这一层，统一受 transform 影响 -->
        <div class="canvas-world" :style="{ transform: worldTransform }">
          <!-- 连线 -->
          <svg class="canvas-edges" aria-hidden="true">
            <g v-for="e in edges" :key="e.id">
              <path :d="edgePath(e.src_node_id, e.dst_node_id)" class="canvas-edge__hit" @click.stop="editor.deleteEdge(e.id)" />
              <path :d="edgePath(e.src_node_id, e.dst_node_id)" class="canvas-edge" />
            </g>
            <path v-if="previewPath" :d="previewPath" class="canvas-edge is-preview" />
          </svg>

          <!-- 节点 -->
          <CanvasNode
            v-for="n in nodes"
            :key="n.id"
            :node="n"
            :selected="selectedIds.includes(n.id)"
            :connecting="mode === 'connect'"
            :connect-source="connectFrom === n.id"
            :lock-holder="editor.lockHolder(n.id)"
            @pointerdown="onNodePointerDown($event, n)"
            @select="(additive) => editor.select(n.id, additive)"
          />

          <!-- 框选矩形（画在世界层，跟随缩放） -->
          <div v-if="marqueeStyle" class="canvas-marquee" :style="marqueeStyle" />
        </div>
      </div>

      <!--
        浮层 chrome 必须放在 .canvas-stage **外面**。
        踩过的坑：放在里面时，点 chip 会先冒泡到 stage 的 pointerdown，
        stage 调 setPointerCapture 把后续指针事件全抢走，按钮的 click 不再触发——
        表现就是"点空态 chip 毫无反应，但按 Tab 能建节点"，极难定位。
      -->
      <!-- 空态引导 -->
      <CanvasEmptyGuide
        v-if="nodes.length === 0"
        :tutorial-open="guideOpen"
        @select="addNodeAtCenter"
        @toggle-tutorial="guideOpen = !guideOpen"
        @select-tutorial="toast.info('新手引导内容待接入（依赖 agent 域）')"
      />

      <!-- 浮动顶栏 -->
      <CanvasTopBar
        :title="title"
        :version="version"
        :dirty="dirty"
        :saving="saving"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @back="goBack"
        @rename="onRename"
        @save="save"
        @reload="editor.load()"
        @undo="editor.undo()"
        @redo="editor.redo()"
        @history="openHistory"
      />

      <!-- 左侧工具栏 -->
      <CanvasToolbar
        :mode="mode"
        :active-count="selectedIds.length"
        @update:mode="mode = $event"
        @add="addNodeAtCenter"
        @layers="toast.info('图层树待接入（当前可在右侧检查器查看节点）')"
        @templates="templateOpen = true"
      />

      <!-- 底部 dock -->
      <CanvasDock
        :zoom="zoomPercent"
        :minimap-open="minimapOpen"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @set-zoom="setZoomPercent"
        @fit-view="doFitView"
        @organize="organize"
        @toggle:minimap="minimapOpen = !minimapOpen"
      />

      <!-- 小地图 -->
      <CanvasMinimap
        v-if="minimapOpen && nodes.length > 0"
        :nodes="nodes"
        :viewport="viewport"
        :stage="stageSize"
        @jump="jumpToWorld"
      />

      <!-- 模板库抽屉 -->
      <CanvasTemplatePanel v-if="templateOpen" :editor="editor" @close="templateOpen = false" />

      <!-- 右侧检查器 -->
      <aside
        v-if="inspectorOpen"
        class="canvas-editor__inspector"
        :style="{ width: `${inspectorWidth}px` }"
      >
        <button class="canvas-editor__resize" aria-label="拖拽调整面板宽度" @pointerdown="startResize" />
        <CanvasInspector :editor="editor" :width="inspectorWidth" @close="inspectorOpen = false" />
      </aside>
      <!-- 折叠态：只留一个展开钮（参照站右侧折叠态约 58px） -->
      <button
        v-else
        class="canvas-editor__inspector-toggle cv-chrome"
        aria-label="展开检查器"
        @click="inspectorOpen = true"
      >
        <CanvasIcon name="chevron-left" :size="16" />
      </button>

      <!-- 历史版本抽屉 -->
      <div v-if="historyOpen" class="canvas-history" role="dialog" aria-label="历史版本">
        <div class="canvas-history__panel cv-chrome">
          <header class="canvas-history__head">
            <span>历史版本</span>
            <button class="cv-glass-btn" aria-label="关闭" @click="historyOpen = false">
              <CanvasIcon name="close" :size="16" />
            </button>
          </header>
          <p v-if="historyLoading" class="cv-hint">读取中…</p>
          <p v-else-if="historyList.length === 0" class="cv-hint">还没有历史版本（每次保存会生成一个快照）</p>
          <ul v-else class="canvas-history__list">
            <li v-for="s in historyList" :key="s.id" class="canvas-history__item">
              <span class="canvas-history__ver">v{{ s.version }}</span>
              <span class="canvas-history__time">{{ new Date(s.created_at).toLocaleString() }}</span>
              <Button size="sm" variant="secondary" @click="restoreSnapshot(s.version)">载入</Button>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.canvas-editor {
  position: relative;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
}

/* ── 舞台 ───────────────────────────────────────────── */
.canvas-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  cursor: default;
}
.canvas-stage.is-pan-mode {
  cursor: grab;
}
.canvas-stage.is-pan-mode:active {
  cursor: grabbing;
}
.canvas-stage.is-connect-mode {
  cursor: crosshair;
}

.canvas-world {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
  /* 世界层不裁剪，节点可以拖到任意位置 */
  will-change: transform;
}

.canvas-edges {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}
.canvas-edge {
  fill: none;
  stroke: var(--cv-edge);
  stroke-width: 1.6;
  opacity: 0.75;
}
.canvas-edge.is-preview {
  stroke: var(--brand-400);
  stroke-dasharray: 5 4;
  opacity: 1;
}
/* 加粗透明描边做命中区，细线本身太难点中 */
.canvas-edge__hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: stroke;
  cursor: pointer;
}
.canvas-edge__hit:hover + .canvas-edge {
  stroke: var(--cv-edge-active);
  opacity: 1;
}

.canvas-marquee {
  position: absolute;
  border: 1px solid var(--brand-400);
  background: #9b46ff1f;
  border-radius: 2px;
  pointer-events: none;
}

/* ── 检查器 ─────────────────────────────────────────── */
.canvas-editor__inspector {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  border-left: 1px solid var(--cv-panel-border);
  background: var(--cv-panel-bg);
  display: flex;
  flex-direction: column;
  min-width: 240px;
  max-width: 520px;
}
.canvas-editor__resize {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: col-resize;
  z-index: 1;
}
.canvas-editor__resize:hover {
  background: var(--brand-400);
  opacity: 0.35;
}
.canvas-editor__inspector-toggle {
  position: absolute;
  top: 50%;
  right: 12px;
  z-index: 20;
  width: 28px;
  height: 52px;
  display: grid;
  place-items: center;
  transform: translateY(-50%);
  color: var(--text-2);
  cursor: pointer;
}

/* ── 加载/错误态 ────────────────────────────────────── */
.canvas-editor__state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
}
.canvas-editor__err {
  color: var(--danger);
  font-size: 13px;
  max-width: 480px;
  text-align: center;
}
.canvas-editor__state-actions {
  display: flex;
  gap: var(--space-2);
}

/* ── 历史版本抽屉 ───────────────────────────────────── */
.canvas-history {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: #000000a6;
}
.canvas-history__panel {
  width: min(460px, 92vw);
  max-height: 70vh;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.canvas-history__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.canvas-history__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.canvas-history__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 6px 4px;
  border-bottom: 1px solid var(--cv-panel-border);
  font-size: 12px;
}
.canvas-history__ver {
  color: var(--brand-on-soft);
  font-weight: 600;
  min-width: 44px;
}
.canvas-history__time {
  color: var(--text-3);
  flex: 1;
}
</style>
