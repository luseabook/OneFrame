import type {
  CanvasCommentDto,
  CanvasCommentNodeDto,
  CanvasDetail,
  CanvasEdgeDto,
  CanvasGroupDto,
  CanvasMaterialDto,
  CanvasNodeDto,
  CanvasNodeType,
  PinGroupDto,
} from "~/types/canvas";
import { CANVAS_ERR, NODE_TYPE_META } from "~/types/canvas";

/**
 * 画布编辑器状态机
 *
 * 设计取舍（每条都对应一个真实踩坑点）：
 *
 * 1. **本地编辑 + 整图提交**：拖拽/增删/改参数都只改本地，点「保存」才 POST /commit。
 *    理由：画布编辑天然是整图操作（拖拽、批量、撤销），逐条 diff 的边界情况远多于收益；
 *    单画布百级节点下整图提交代价可接受（后端 commit 就是按整体替换设计的）。
 *
 * 2. **视口是纯前端概念**：x/y 存的是"画布世界坐标"，视口用 pan/zoom 变换。
 *    拖动节点时必须把屏幕位移除以 zoom 转回世界坐标，否则放大后拖拽会"跑得比鼠标快"。
 *
 * 3. **撤销栈只存快照，不存命令**：节点数在百级，快照法实现简单且不会出现
 *    "命令重放顺序错乱"这类难查的 bug；上限 50 步，超了丢最早的。
 *
 * 4. **锁是提示性的，不是闸门**：拿到 746003 只提示"他人正在编辑"，仍允许本地改；
 *    真正的冲突保护是 commit 的 version 乐观锁——绝不用前端锁去替代后端校验。
 */

export interface EditorSnapshot {
  nodes: CanvasNodeDto[];
  edges: CanvasEdgeDto[];
  groups: CanvasGroupDto[];
}

export interface Viewport {
  /** 平移（屏幕像素） */
  x: number;
  y: number;
  /** 缩放倍数 */
  zoom: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const HISTORY_LIMIT = 50;
const NODE_DEFAULT_H = 72;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const useCanvasEditor = (canvasId: Ref<string>) => {
  const api = useCanvasApi();
  const toast = useToast();

  // ── 数据 ────────────────────────────────────────────────
  const title = ref("");
  const version = ref(1);
  const nodes = ref<CanvasNodeDto[]>([]);
  const edges = ref<CanvasEdgeDto[]>([]);
  const groups = ref<CanvasGroupDto[]>([]);
  const pinnedNodeId = ref<string | null>(null);

  // ── 加载/保存态 ─────────────────────────────────────────
  const loading = ref(true);
  const saving = ref(false);
  const dirty = ref(false);
  const loadError = ref("");

  // ── 选择与交互 ──────────────────────────────────────────
  const selectedIds = ref<string[]>([]);
  const selectedId = computed(() => (selectedIds.value.length === 1 ? selectedIds.value[0] : null));
  const selectedNodes = computed(() => nodes.value.filter((n) => selectedIds.value.includes(n.id)));
  const selectedNode = computed(() => (selectedId.value ? (nodes.value.find((n) => n.id === selectedId.value) ?? null) : null));

  /** 交互模式：选择 / 连线 / 平移 */
  const mode = ref<"select" | "connect" | "pan">("select");
  const connectFrom = ref<string | null>(null);
  /** 悬停中的连线预览终点（世界坐标） */
  const connectCursor = ref<{ x: number; y: number } | null>(null);

  // ── 视口 ────────────────────────────────────────────────
  const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 });

  // ── 锁 ──────────────────────────────────────────────────
  const lockedNodes = ref<Array<{ node_id: string; user_id: string }>>([]);
  const myUserId = ref("");

  // ── 历史 ────────────────────────────────────────────────
  const history = ref<EditorSnapshot[]>([]);
  const future = ref<EditorSnapshot[]>([]);

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let lockTimer: ReturnType<typeof setInterval> | undefined;

  function snapshot(): EditorSnapshot {
    return { nodes: clone(nodes.value), edges: clone(edges.value), groups: clone(groups.value) };
  }

  /** 记录一次可撤销的变更（在**修改前**调用） */
  function pushHistory(): void {
    history.value.push(snapshot());
    if (history.value.length > HISTORY_LIMIT) history.value.shift();
    future.value = [];
  }

  function restore(s: EditorSnapshot): void {
    nodes.value = clone(s.nodes);
    edges.value = clone(s.edges);
    groups.value = clone(s.groups);
    dirty.value = true;
    // 选中的节点可能已被撤销掉
    selectedIds.value = selectedIds.value.filter((id) => nodes.value.some((n) => n.id === id));
  }

  function undo(): void {
    const prev = history.value.pop();
    if (!prev) return;
    future.value.push(snapshot());
    restore(prev);
  }

  function redo(): void {
    const next = future.value.pop();
    if (!next) return;
    history.value.push(snapshot());
    restore(next);
  }

  const canUndo = computed(() => history.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  // ── 加载 ────────────────────────────────────────────────
  async function load(): Promise<void> {
    loading.value = true;
    loadError.value = "";
    try {
      const d: CanvasDetail = await api.detail(canvasId.value);
      title.value = d.canvas.title;
      version.value = d.canvas.version;
      pinnedNodeId.value = d.canvas.pinned_node_id;
      nodes.value = d.nodes.map((n) => ({ ...n, params: { ...n.params } }));
      edges.value = d.edges.map((e) => ({ ...e }));
      groups.value = d.groups.map((g) => ({ ...g }));
      dirty.value = false;
      history.value = [];
      future.value = [];
      selectedIds.value = [];
      connectFrom.value = null;
      // 首次加载后把内容适配到视口
      await nextTick();
      fitView();
    } catch (e) {
      loadError.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function loadMe(): Promise<void> {
    try {
      const p = await useApi().get<{ user_id: string }>("/cam/permission/user");
      myUserId.value = p.user_id;
    } catch {
      /* 仅用于锁提示，失败不影响编辑 */
    }
  }

  // ── 保存 ────────────────────────────────────────────────
  async function save(): Promise<boolean> {
    if (saving.value) return false;
    saving.value = true;
    try {
      const res = await api.commit(canvasId.value, {
        version: version.value,
        nodes: nodes.value.map((n) => ({
          id: n.id,
          node_type: n.node_type,
          name: n.name,
          x: Math.round(n.x),
          y: Math.round(n.y),
          width: n.width,
          height: n.height,
          z_index: n.z_index,
          params: n.params,
          task_id: n.task_id,
          status: n.status,
          group_ids: n.group_ids,
        })),
        edges: edges.value.map((e) => ({
          src_node_id: e.src_node_id,
          dst_node_id: e.dst_node_id,
          semantic: e.semantic,
        })),
        groups: groups.value.map((g) => ({
          id: g.id,
          parent_id: g.parent_id,
          name: g.name ?? undefined,
          sort: g.sort,
          status: g.status,
        })),
      });
      version.value = res.version;
      dirty.value = false;

      // 用后端返回的 id_map 把本地临时 id 换成真实 id。
      // 不做这一步的话，下次保存会把同一批节点当"新节点"再建一遍 → 节点翻倍。
      const idMap = res.id_map ?? {};
      if (Object.keys(idMap).length > 0) {
        for (const n of nodes.value) {
          const real = idMap[n.id];
          if (real) n.id = real;
        }
        for (const e of edges.value) {
          if (idMap[e.src_node_id]) e.src_node_id = idMap[e.src_node_id]!;
          if (idMap[e.dst_node_id]) e.dst_node_id = idMap[e.dst_node_id]!;
        }
        for (const g of groups.value) {
          if (idMap[g.id]) g.id = idMap[g.id]!;
          if (g.parent_id && idMap[g.parent_id]) g.parent_id = idMap[g.parent_id]!;
        }
        // 选择态与连线起点也要跟着换，否则选中会丢
        selectedIds.value = selectedIds.value.map((id) => idMap[id] ?? id);
        if (connectFrom.value) connectFrom.value = idMap[connectFrom.value] ?? connectFrom.value;
      }

      toast.success(`已保存 v${res.version}（${res.nodes} 节点 / ${res.edges} 连线）`);
      return true;
    } catch (e) {
      const err = e as { code?: number; message: string };
      if (err.code === CANVAS_ERR.VERSION_CONFLICT) {
        toast.error("画布已被他人修改（版本冲突）。请点「重新加载」拿最新版本再改，避免覆盖别人。");
      } else {
        toast.error(err.message || "保存失败");
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  // ── 节点操作（本地）────────────────────────────────────
  /** 新节点的落点：避开已有节点，向右错开排布 */
  function nextNodePosition(): { x: number; y: number } {
    if (nodes.value.length === 0) return { x: 120, y: 120 };
    const maxRight = Math.max(...nodes.value.map((n) => n.x + (n.width ?? NODE_TYPE_META.text.width)));
    const sameCol = nodes.value.filter((n) => Math.abs(n.x + (n.width ?? 200) - maxRight) < 40);
    const baseY = sameCol.length ? Math.max(...sameCol.map((n) => n.y)) + 110 : 120;
    return { x: Math.round(maxRight + 80), y: Math.round(baseY) };
  }

  /**
   * 在给定位置附近找一个"不压住已有节点"的空位。
   *
   * 为什么要做这个：从工具栏/空态 chip/视口中心建节点时，调用方只给一个
   * 中心点，若直接用它，连点两次就得到两个完全重合的节点——用户看到"只多了一个"，
   * 拖开才发现叠着，且连线/选择都会变得莫名其妙。这里按固定步长做螺旋式让位。
   */
  function freeSpotNear(pos: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
    const GAP = 24;
    const STEP_X = w + 48;
    const STEP_Y = h + 48;
    const overlaps = (p: { x: number; y: number }): boolean =>
      nodes.value.some((n) => {
        const nw = n.width ?? NODE_TYPE_META[n.node_type as keyof typeof NODE_TYPE_META]?.width ?? 260;
        const nh = n.height ?? 76;
        return (
          p.x < n.x + nw + GAP &&
          p.x + w + GAP > n.x &&
          p.y < n.y + nh + GAP &&
          p.y + h + GAP > n.y
        );
      });
    if (!overlaps(pos)) return pos;
    // 先向右排（符合"左→右数据流"的直觉），右边 4 个都占满就换下一行
    for (let row = 0; row < 12; row++) {
      for (let col = 1; col <= 4; col++) {
        const candidate = { x: Math.round(pos.x + STEP_X * col), y: Math.round(pos.y + STEP_Y * row) };
        if (!overlaps(candidate)) return candidate;
      }
    }
    // 极端情况（画布已经很满）：直接右下角往外放，保证不重合
    return { x: Math.round(pos.x + STEP_X), y: Math.round(pos.y + STEP_Y * 12) };
  }

  function addNode(type: CanvasNodeType, at?: { x: number; y: number }): CanvasNodeDto {
    pushHistory();
    const meta = NODE_TYPE_META[type];
    const base = at ?? nextNodePosition();
    // 给了显式落点就做让位；没给就信任 nextNodePosition 的排布
    const pos = at ? freeSpotNear(base, meta.width, 76) : base;
    const node: CanvasNodeDto = {
      // 本地临时 id：commit 时后端会为不存在的 id 新建（后端接受可选 id）
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      node_type: type,
      name: meta.label,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      width: meta.width,
      height: null,
      z_index: nodes.value.length,
      params: defaultParams(type),
      task_id: null,
      status: 1,
      group_ids: [],
      version: 1,
    };
    nodes.value.push(node);
    selectedIds.value = [node.id];
    dirty.value = true;
    return node;
  }

  /** 每种类型的默认参数（字段名严格对齐 cli-skill/commands/node.md） */
  function defaultParams(type: CanvasNodeType): Record<string, unknown> {
    switch (type) {
      case "text":
        return { prompt: "", model: "", count: 1 };
      case "image":
        return { mode: "text2image", prompt: "", model: "", count: 1, settings: { ratio: "16:9" } };
      case "video":
        return {
          mode: "text2video",
          prompt: "",
          model: "",
          count: 1,
          settings: { ratio: "16:9", resolution: "720p", duration: 5 },
        };
      case "audio":
        return { audioKind: "voiceover", prompt: "", model: "", duration: 10, count: 1 };
      case "table":
        return {
          table: {
            active_sheet_id: "sheet-1",
            sheet_selection_required: false,
            source: { type: "manual" },
            sheets: [],
          },
        };
      case "script":
        return { runPhase: "storyboard", sourceText: "", model: "", shotCount: 3 };
      case "asset":
        return { sourceText: "", model: "", activeTab: "character" };
      case "clip":
        return { shotOrder: [], exportSettings: { exportTarget: "canvas", resolution: "720p", format: "mp4" } };
      case "director":
        return {};
      case "threeDWorld":
        return { mode: "text2image", prompt: "", model: "", worldInputIsPano: false };
      case "group":
        return { title: "分组", color: "#6C5CE7", childNodeIds: [], collapsed: false, locked: false };
      default:
        return {};
    }
  }

  function deleteNodes(ids: string[]): void {
    if (ids.length === 0) return;
    pushHistory();
    const set = new Set(ids);
    nodes.value = nodes.value.filter((n) => !set.has(n.id));
    // 同时清相关连线，避免留下悬挂边（后端 commit 也会因悬挂边整单回滚）
    edges.value = edges.value.filter((e) => !set.has(e.src_node_id) && !set.has(e.dst_node_id));
    selectedIds.value = selectedIds.value.filter((id) => !set.has(id));
    dirty.value = true;
  }

  function duplicateNodes(ids: string[]): void {
    if (ids.length === 0) return;
    pushHistory();
    const created: string[] = [];
    for (const id of ids) {
      const src = nodes.value.find((n) => n.id === id);
      if (!src) continue;
      const copy: CanvasNodeDto = {
        ...clone(src),
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        x: src.x + 40,
        y: src.y + 40,
        name: `${src.name} 副本`,
      };
      nodes.value.push(copy);
      created.push(copy.id);
    }
    selectedIds.value = created;
    dirty.value = true;
  }

  function moveNodes(ids: string[], dx: number, dy: number): void {
    for (const n of nodes.value) {
      if (ids.includes(n.id)) {
        n.x = Math.round(n.x + dx);
        n.y = Math.round(n.y + dy);
      }
    }
    dirty.value = true;
  }

  function setNodeParam(nodeId: string, key: string, value: unknown): void {
    const n = nodes.value.find((x) => x.id === nodeId);
    if (!n) return;
    n.params = { ...n.params, [key]: value };
    dirty.value = true;
  }

  /**
   * 改节点的**非 params 字段**（name / width / height / z_index / status / group_ids）。
   *
   * 为什么需要独立方法：`setNodeParam` 只写 params。检查器的"公共区"（名称、宽度、
   * Z 序、状态、分组）改的是节点自身字段，直接改 node 对象会让脏标记漏掉，
   * 用户改了却没提示"未保存"——这类静默丢改动是最难查的 bug。
   *
   * x/y 不走这里，走 `moveNodes`（要支持多选位移与吸附，语义不同）。
   */
  type NodeField = "name" | "width" | "height" | "z_index" | "status" | "group_ids";

  function setNodeField<K extends NodeField>(nodeId: string, field: K, value: CanvasNodeDto[K]): void {
    const n = nodes.value.find((x) => x.id === nodeId);
    if (!n) return;
    n[field] = value;
    dirty.value = true;
  }

  /** 批量改同一字段（多选时"批量改状态"用） */
  function setNodesField<K extends NodeField>(ids: string[], field: K, value: CanvasNodeDto[K]): void {
    for (const n of nodes.value) {
      if (ids.includes(n.id)) n[field] = value;
    }
    dirty.value = true;
  }

  /** 批量对齐：按选择集的包围盒对齐（left/center/right/top/middle/bottom） */
  function alignNodes(ids: string[], align: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"): void {
    const picked = nodes.value.filter((n) => ids.includes(n.id));
    if (picked.length < 2) return;
    pushHistory();
    const minX = Math.min(...picked.map((n) => n.x));
    const maxX = Math.max(...picked.map((n) => n.x + nodeW(n)));
    const minY = Math.min(...picked.map((n) => n.y));
    const maxY = Math.max(...picked.map((n) => n.y + nodeH(n)));
    for (const n of picked) {
      if (align === "left") n.x = Math.round(minX);
      else if (align === "right") n.x = Math.round(maxX - nodeW(n));
      else if (align === "hcenter") n.x = Math.round((minX + maxX) / 2 - nodeW(n) / 2);
      else if (align === "top") n.y = Math.round(minY);
      else if (align === "bottom") n.y = Math.round(maxY - nodeH(n));
      else if (align === "vcenter") n.y = Math.round((minY + maxY) / 2 - nodeH(n) / 2);
    }
    dirty.value = true;
  }

  function nodeW(n: CanvasNodeDto): number {
    return n.width ?? NODE_TYPE_META[n.node_type as keyof typeof NODE_TYPE_META]?.width ?? 260;
  }
  function nodeH(n: CanvasNodeDto): number {
    return n.height ?? 76;
  }

  /** 钉住/取消钉住（后端 PUT pinned-node，单选） */
  async function setPinned(nodeId: string | null): Promise<void> {
    const prev = pinnedNodeId.value;
    pinnedNodeId.value = nodeId;
    try {
      await api.pinNode(canvasId.value, nodeId);
    } catch (e) {
      pinnedNodeId.value = prev; // 失败回滚，避免 UI 与后端不一致
      toast.error((e as Error).message || "钉住失败");
    }
  }

  // ── 节点派生任务（C6）────────────────────────────────────
  const taskSubmitting = ref<string[]>([]);

  function isSubmitting(nodeId: string): boolean {
    return taskSubmitting.value.includes(nodeId);
  }

  /**
   * 投递单个节点的生成任务。
   *
   * 为什么必须先保存再投递：后端 `generate` 读的是**库里的节点**（params/task_id），
   * 如果本地刚改完参数没保存就投递，投出去的是旧参数——
   * 用户会觉得"我明明改了提示词，生成的还是老图"。
   * 所以这里强制先 commit（有脏改动时），再投递。
   */
  async function generateNode(nodeId: string, override?: { mode?: string; model?: string }): Promise<boolean> {
    const node = nodes.value.find((n) => n.id === nodeId);
    if (!node) return false;
    if (nodeId.startsWith("local_")) {
      toast.error("请先保存画布，再投递生成（新节点还没有服务端 id）");
      return false;
    }
    if (dirty.value) {
      const ok = await save();
      if (!ok) return false;
    }

    const params = node.params ?? {};
    const mode = override?.mode ?? String(params.mode ?? "");
    const model = override?.model ?? String(params.model ?? "");
    if (!mode) {
      toast.error("这个节点还没选生成模式（mode）");
      return false;
    }
    if (!model) {
      toast.error("请先在右侧选择模型（model）");
      return false;
    }

    taskSubmitting.value = [...taskSubmitting.value, nodeId];
    try {
      const res = await api.generateNode(canvasId.value, nodeId, {
        mode,
        model,
        input: {
          prompt: typeof params.prompt === "string" ? params.prompt : "",
        },
      });
      // 回写本地状态：让节点立刻显示"生成中"，并记下 task_id（轮询用）
      node.status = res.node.status;
      node.task_id = res.node.task_id;
      toast.success(`已投递，冻结 ${res.credits_estimate} 积分`);
      startTaskPolling(nodeId, res.task_id);
      return true;
    } catch (e) {
      const err = e as { code?: number; message: string };
      // 余额不足/预算触顶给出可操作提示，而不是只显示错误码
      if (err.code === 745701) toast.error("积分不足，请先充值或调整参数");
      else if (err.code === 745703) toast.error("超出预算上限，请调整批量或预算");
      else if (err.code === 745801) toast.error("提示词未通过内容审核");
      else toast.error(err.message || "投递失败");
      return false;
    } finally {
      taskSubmitting.value = taskSubmitting.value.filter((x) => x !== nodeId);
    }
  }

  /** 批量投递当前选中的、可生成的节点 */
  async function generateSelected(): Promise<void> {
    const targets = selectedNodes.value.filter(
      (n) => !n.id.startsWith("local_") && n.params?.mode && n.params?.model,
    );
    if (targets.length === 0) {
      toast.error("选中的节点里没有可投递的（需要 mode + model）");
      return;
    }
    if (dirty.value) {
      const ok = await save();
      if (!ok) return;
    }
    try {
      const res = await api.batchNodeTasks(
        canvasId.value,
        targets.map((n) => ({
          node_id: n.id,
          mode: String(n.params.mode),
          model: String(n.params.model),
          input: { prompt: typeof n.params.prompt === "string" ? n.params.prompt : "" },
        })),
      );
      // 逐项回写：成功的置"生成中"，失败的带出错误码（不吞掉，否则用户不知道哪条没投出去）
      for (const r of res.results) {
        const n = nodes.value.find((x) => x.id === r.node_id);
        if (!n) continue;
        if (r.submitted && r.task_id) {
          n.status = 2;
          n.task_id = r.task_id;
          startTaskPolling(n.id, r.task_id);
        } else if (r.code) {
          n.params = { ...n.params, last_error: { code: r.code, message: r.msg ?? "" } };
        }
      }
      const failed = res.results.filter((r) => !r.submitted).length;
      if (failed === 0) toast.success(`已投递 ${res.submitted} 个节点，共冻结 ${res.total_credits} 积分`);
      else toast.info(`成功 ${res.submitted} 个 / 失败 ${failed} 个，共冻结 ${res.total_credits} 积分`);
    } catch (e) {
      toast.error((e as Error).message || "批量投递失败");
    }
  }

  /**
   * 文本类派生：剧本优化 / 拆解分镜。
   *
   * 与媒体生成共用同一条链路（落 `tasks` → 节点挂 `task_id` → 轮询 → 回填），
   * 区别只在参数来源：文本能力不要求用户手选 mode/model，由**模型目录**决定用哪个
   * LLM、由**价目表**决定扣多少——前端不参与定价，也不写死金额。
   */
  async function deriveText(
    nodeId: string,
    kind: "script_optimization" | "storyboard_parse",
    extraPrompt?: string,
  ): Promise<boolean> {
    const node = nodes.value.find((n) => n.id === nodeId);
    if (!node) return false;
    if (nodeId.startsWith("local_")) {
      toast.error("请先保存画布，再发起派生（新节点还没有服务端 id）");
      return false;
    }
    if (dirty.value) {
      const ok = await save();
      if (!ok) return false;
    }

    taskSubmitting.value = [...taskSubmitting.value, nodeId];
    try {
      const payload = { prompt: extraPrompt };
      const res =
        kind === "script_optimization"
          ? await api.scriptOptimization(canvasId.value, nodeId, payload)
          : await api.storyboardParse(canvasId.value, nodeId, payload);
      node.status = res.node.status;
      node.task_id = res.node.task_id;
      toast.success(
        `已发起${kind === "script_optimization" ? "剧本优化" : "拆解分镜"}，冻结 ${res.credits_estimate} 积分`,
      );
      startTaskPolling(nodeId, res.task_id);
      return true;
    } catch (e) {
      const err = e as { code?: number; message: string };
      if (err.code === 745701) toast.error("积分不足，请先充值");
      else if (err.code === 745801) toast.error("原文未通过内容审核");
      else if (err.code === 400104) toast.error("原文超过 5 万字，请分段处理");
      else toast.error(err.message || "发起失败");
      return false;
    } finally {
      taskSubmitting.value = taskSubmitting.value.filter((id) => id !== nodeId);
    }
  }

  // ── 任务轮询（节点状态 → 结果回填）──────────────────────
  const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * 轮询节点任务状态。
   *
   * 为什么画布必须自己轮询：worker 在任务终态会回写 canvas_nodes（见 executor.ts），
   * 但浏览器不知道什么时候回写完；不轮询就只能靠用户手动刷新。
   * 5s 一次、最多 10 分钟（对齐 useTaskPolling 的节奏），到点自动停，避免泄漏定时器。
   */
  function startTaskPolling(nodeId: string, taskId: string): void {
    if (pollTimers.has(nodeId)) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks++;
      if (ticks > 120) {
        stopTaskPolling(nodeId);
        return;
      }
      try {
        const res = await api.nodeTaskStatus(canvasId.value, nodeId, taskId);
        const node = nodes.value.find((n) => n.id === nodeId);
        if (!node) {
          stopTaskPolling(nodeId);
          return;
        }
        node.status = res.node.status;
        const st = res.task.status;
        // 3=成功 → 回填结果 URI；4/7=失败/审核拒绝 → 记错误（积分已由后端退回）
        if (st === 3) {
          const first = res.task.results?.[0];
          const uris = (res.task.results ?? []).map((r) => r.uri).filter((u): u is string => !!u);
          const texts = (res.task.results ?? [])
            .map((r) => (r as { text?: string }).text)
            .filter((t): t is string => !!t);
          node.params = {
            ...node.params,
            ...(first?.uri ? { result_uri: first.uri, result_preview_uri: first.preview_uri ?? first.uri } : {}),
            ...(uris.length ? { result_uris: uris } : {}),
            // 文本类派生（剧本优化 / 拆解分镜）没有 uri 只有 text：不写这一段的话，
            // 任务成功了节点上也看不到内容，用户会以为没跑成功
            ...(texts.length ? { result_text: texts[0], result_texts: texts } : {}),
          };
          delete (node.params as Record<string, unknown>).last_error;
          stopTaskPolling(nodeId);
          toast.success("生成完成");
        } else if (st === 4 || st === 7) {
          node.params = {
            ...node.params,
            last_error: res.task.error ?? { message: st === 7 ? "内容审核未通过" : "生成失败" },
          };
          stopTaskPolling(nodeId);
          toast.error(st === 7 ? "输出未通过内容审核（积分已退回）" : "生成失败（积分已退回）");
        }
      } catch {
        // 单次失败不打断轮询（网络抖动很常见），到上限自然停
      }
    }, 5000);
    pollTimers.set(nodeId, timer);
  }

  function stopTaskPolling(nodeId: string): void {
    const t = pollTimers.get(nodeId);
    if (t) {
      clearInterval(t);
      pollTimers.delete(nodeId);
    }
  }

  function stopAllPolling(): void {
    for (const t of pollTimers.values()) clearInterval(t);
    pollTimers.clear();
  }

  // ── 素材 + 批注（C8/C9）──────────────────────────────────
  const materials = ref<CanvasMaterialDto[]>([]);
  const materialsLoading = ref(false);
  const commentNodes = ref<CanvasCommentNodeDto[]>([]);
  const commentsLoading = ref(false);
  /** 批注模式：开启后点画布空白处 = 在该位置落一个批注点 */
  const commentMode = ref(false);
  const activeCommentId = ref<string | null>(null);
  const activeComments = ref<CanvasCommentDto[]>([]);

  async function loadMaterials(): Promise<void> {
    materialsLoading.value = true;
    try {
      const res = await api.listMaterials(canvasId.value, { page_size: 60 });
      materials.value = res.list;
    } catch {
      /* 素材读取失败不该阻塞画布编辑 */
    } finally {
      materialsLoading.value = false;
    }
  }

  /**
   * 挂一张素材到画布（含"从节点结果保存为素材"的常用路径）。
   * 只登记 object_key；URL 由存储层签，避免直链过期。
   */
  async function addMaterial(input: {
    object_key: string;
    material_type: string;
    name?: string;
    node_id?: string;
    source?: number;
  }): Promise<boolean> {
    try {
      await api.createMaterial(canvasId.value, input);
      await loadMaterials();
      toast.success("已加入素材库");
      return true;
    } catch (e) {
      toast.error((e as Error).message || "加入素材库失败");
      return false;
    }
  }

  /** 把某个节点的生成结果存进素材库（画布里最高频的"素材沉淀"动作） */
  async function saveNodeResultAsMaterial(nodeId: string): Promise<boolean> {
    const node = nodes.value.find((n) => n.id === nodeId);
    if (!node) return false;
    if (nodeId.startsWith("local_")) {
      toast.error("请先保存画布");
      return false;
    }
    const uri = typeof node.params?.result_uri === "string" ? node.params.result_uri : "";
    if (!uri) {
      toast.error("这个节点还没有生成结果");
      return false;
    }
    // 结果是完整 URL，素材库存的是 object_key；取 URL 的 pathname 作为 key 兜底
    let key = uri;
    try {
      const u = new URL(uri);
      key = u.pathname.replace(/^\//, "");
    } catch {
      /* 相对路径直接用 */
    }
    const type =
      node.node_type === "video" ? "video" : node.node_type === "audio" ? "audio" : "image";
    return addMaterial({
      object_key: key,
      material_type: type,
      name: node.name || "节点产出",
      node_id: nodeId,
      source: 2,
    });
  }

  async function removeMaterials(ids: string[]): Promise<void> {
    try {
      await api.batchDeleteMaterials(canvasId.value, ids);
      await loadMaterials();
      toast.success("已移除素材");
    } catch (e) {
      toast.error((e as Error).message || "移除失败");
    }
  }

  async function loadCommentNodes(): Promise<void> {
    commentsLoading.value = true;
    try {
      const res = await api.listCommentNodes(canvasId.value, { page_size: 100 });
      commentNodes.value = res.list;
    } catch {
      /* 忽略 */
    } finally {
      commentsLoading.value = false;
    }
  }

  /** 在画布坐标处新建批注点（带首条内容，避免留空点） */
  async function createComment(anchor: { x: number; y: number }, content: string, nodeId?: string): Promise<boolean> {
    if (!content.trim()) {
      toast.error("先写点什么再发");
      return false;
    }
    try {
      const res = await api.createCommentNode(canvasId.value, {
        anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
        content,
        ...(nodeId && !nodeId.startsWith("local_") ? { node_id: nodeId } : {}),
      });
      await loadCommentNodes();
      activeCommentId.value = res.comment_node_id;
      await loadComments(res.comment_node_id);
      return true;
    } catch (e) {
      toast.error((e as Error).message || "新建批注失败");
      return false;
    }
  }

  async function loadComments(cnId: string): Promise<void> {
    activeCommentId.value = cnId;
    try {
      const res = await api.listComments(canvasId.value, cnId);
      activeComments.value = res.list;
    } catch {
      activeComments.value = [];
    }
  }

  async function replyComment(cnId: string, content: string): Promise<boolean> {
    if (!content.trim()) return false;
    try {
      await api.addComment(canvasId.value, cnId, content);
      await loadComments(cnId);
      await loadCommentNodes(); // 刷新计数
      return true;
    } catch (e) {
      toast.error((e as Error).message || "回复失败");
      return false;
    }
  }

  async function toggleCommentResolved(cnId: string, resolved: boolean): Promise<void> {
    try {
      await api.resolveCommentNode(canvasId.value, cnId, resolved);
      await loadCommentNodes();
      const target = commentNodes.value.find((c) => c.id === cnId);
      if (target) target.resolved = resolved;
    } catch (e) {
      toast.error((e as Error).message || "操作失败");
    }
  }

  async function deleteComment(cnId: string): Promise<void> {
    try {
      await api.deleteCommentNode(canvasId.value, cnId);
      if (activeCommentId.value === cnId) {
        activeCommentId.value = null;
        activeComments.value = [];
      }
      await loadCommentNodes();
      toast.success("批注已删除");
    } catch (e) {
      toast.error((e as Error).message || "删除失败");
    }
  }

  // ── 固定组（C10）────────────────────────────────────────
  const pinGroups = ref<PinGroupDto[]>([]);
  const pinGroupsMaxSlots = ref(7);

  async function loadPinGroups(): Promise<void> {
    try {
      const res = await api.listPinGroups(canvasId.value);
      pinGroups.value = res.list;
      pinGroupsMaxSlots.value = res.max_slots;
    } catch {
      /* 固定组读取失败不阻塞编辑 */
    }
  }

  /**
   * 把当前选中节点存进某个槽位的固定组（整体替换该槽位）。
   *
   * 为什么是"整体替换"而不是"追加"：后端契约如此（`PUT /pin-groups/:slot`），
   * 前端交互也一致——用户选中一批节点，点一个槽位，语义就是"这一组换成这些"。
   * 追加语义会让"如何移除"变成一个没有出口的动作。
   */
  async function assignSelectionToPinSlot(slot: number, name?: string): Promise<boolean> {
    if (selectedIds.value.length === 0) {
      toast.error("先选中要归组的节点");
      return false;
    }
    // 有未保存改动（含 local_ 临时 id 的新节点）→ 先自动保存拿真实 id 再归组。
    // 早期实现是"检测到未保存就报错让用户先手动保存"，但实测这条路径很容易踩到
    // （套用模板后立刻归组）——用户会觉得"点了没反应"。归组本来就是一次服务端写入，
    // 顺手把本地改动落库更符合预期，也不会丢东西。
    if (dirty.value || selectedIds.value.some((id) => id.startsWith("local_"))) {
      const ok = await save();
      if (!ok) return false;
    }
    const ids = selectedIds.value.filter((id) => !id.startsWith("local_"));
    if (ids.length === 0) {
      toast.error("这些节点还没保存成功，无法归组");
      return false;
    }
    try {
      const res = await api.upsertPinGroup(canvasId.value, slot, {
        node_ids: ids,
        ...(name ? { name } : {}),
      });
      await loadPinGroups();
      // 同步本地节点的 group_ids，避免要刷新才看到归属变化
      for (const n of nodes.value) {
        if (ids.includes(n.id)) {
          n.group_ids = res.pin_group.node_ids;
        } else if (n.group_ids.includes(res.pin_group.group_id)) {
          // 被替换掉的旧成员要清掉，否则出现"幽灵归属"
          n.group_ids = n.group_ids.filter((g) => g !== res.pin_group.group_id);
        }
      }
      toast[res.replaced ? "info" : "success"](res.replaced ? `已替换槽位 ${slot}` : `已加入槽位 ${slot}`);
      return true;
    } catch (e) {
      toast.error((e as Error).message || "归组失败");
      return false;
    }
  }

  async function clearPinSlot(slot: number): Promise<void> {
    try {
      await api.clearPinGroupMembers(canvasId.value, slot);
      await loadPinGroups();
      toast.success("已清空该分组");
    } catch (e) {
      toast.error((e as Error).message || "清空失败");
    }
  }

  async function removePinSlot(slot: number): Promise<void> {
    try {
      await api.deletePinGroup(canvasId.value, slot);
      await loadPinGroups();
      toast.success("已删除该分组");
    } catch (e) {
      toast.error((e as Error).message || "删除失败");
    }
  }

  /** 点固定组 = 把视口带到该组成员（"一键跳转"是它的核心价值） */
  function focusPinGroup(group: PinGroupDto): void {
    if (group.node_ids.length === 0) return;
    const members = nodes.value.filter((n) => group.node_ids.includes(n.id));
    if (members.length === 0) return;
    selectedIds.value = members.map((n) => n.id);
    focusNode(members[0]!.id);
  }

  /**
   * 打开画布时校正一次节点任务状态。
   * 存在的意义：用户可能关掉页面错过了任务完成，重新打开时画布不该永远显示"生成中"。
   */  async function syncNodeTasks(): Promise<void> {
    const inFlight = nodes.value.filter((n) => n.task_id && (n.status === 2 || n.status === 1));
    if (inFlight.length === 0) return;
    try {
      const res = await api.syncNodeTasks(canvasId.value, inFlight.map((n) => n.id));
      for (const row of res.nodes) {
        const n = nodes.value.find((x) => x.id === row.id);
        if (n) n.status = row.status;
      }
    } catch {
      /* 校正失败不影响编辑 */
    }
  }

  // ── 模板（C2）────────────────────────────────────────────
  /**
   * 把当前画布存成模板。
   *
   * 为什么先强制保存：模板是"从库里的画布快照"，本地未保存的改动不在库里。
   * 不先保存就存模板，用户会得到"少了刚加的几个节点"的模板，且完全无从理解。
   */
  async function saveAsTemplate(name: string, scope: 2 | 3 = 3): Promise<boolean> {
    if (dirty.value) {
      const ok = await save();
      if (!ok) return false;
    }
    try {
      await api.saveAsTemplate(canvasId.value, { name, tpl_scope: scope });
      toast.success(`已存为模板「${name}」`);
      return true;
    } catch (e) {
      toast.error((e as Error).message || "存模板失败");
      return false;
    }
  }

  /**
   * 套用模板到当前画布：把模板里的节点描述**追加**到本地画布。
   *
   * 只改本地、不直接落库——必须由用户点保存（走 commit 乐观锁）才写库，
   * 否则会绕开版本校验，出现"别人正在编辑时被模板悄悄覆盖"。
   */
  async function applyTemplate(templateId: string, offset?: { dx?: number; dy?: number }): Promise<number> {
    try {
      const res = await api.instantiateTemplate(templateId, offset);
      if (res.total === 0) {
        toast.info("这个模板里没有节点");
        return 0;
      }
      pushHistory();
      const created: string[] = [];
      for (const draft of res.nodes) {
        const node: CanvasNodeDto = {
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          node_type: draft.node_type,
          name: draft.name ?? "",
          x: Math.round(draft.x),
          y: Math.round(draft.y),
          width: draft.width,
          height: draft.height,
          z_index: nodes.value.length,
          params: { ...(draft.params ?? {}) },
          task_id: null,
          // 套用过来的节点不该继承"生成中"状态，一律重置为就绪
          status: 1,
          group_ids: [],
          version: 1,
        };
        nodes.value.push(node);
        created.push(node.id);
      }
      selectedIds.value = created;
      dirty.value = true;
      nextTick(() => fitView());
      toast.success(`已套用模板（新增 ${created.length} 个节点），点保存后生效`);
      return created.length;
    } catch (e) {
      toast.error((e as Error).message || "套用模板失败");
      return 0;
    }
  }

  /** 嵌套参数（settings/table/exportSettings 等 JSON 字段） */
  function setNodeParamPath(nodeId: string, path: string[], value: unknown): void {
    const n = nodes.value.find((x) => x.id === nodeId);
    if (!n) return;
    const next = clone(n.params);
    let cur: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i]!;
      if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[path[path.length - 1]!] = value;
    n.params = next;
    dirty.value = true;
  }

  // ── 连线 ────────────────────────────────────────────────
  function addEdge(srcId: string, dstId: string, semantic = "pipeline"): boolean {
    if (srcId === dstId) return false;
    const exists = edges.value.some((e) => e.src_node_id === srcId && e.dst_node_id === dstId && e.semantic === semantic);
    if (exists) return false;
    pushHistory();
    edges.value.push({
      id: `local_e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      src_node_id: srcId,
      dst_node_id: dstId,
      semantic,
    });
    dirty.value = true;
    return true;
  }

  function deleteEdge(edgeId: string): void {
    pushHistory();
    edges.value = edges.value.filter((e) => e.id !== edgeId);
    dirty.value = true;
  }

  function edgesOf(nodeId: string): CanvasEdgeDto[] {
    return edges.value.filter((e) => e.src_node_id === nodeId || e.dst_node_id === nodeId);
  }

  // ── 选择 ────────────────────────────────────────────────
  function select(id: string | null, additive = false): void {
    if (id === null) {
      selectedIds.value = [];
      return;
    }
    if (additive) {
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter((x) => x !== id)
        : [...selectedIds.value, id];
    } else {
      selectedIds.value = [id];
    }
    if (selectedIds.value.includes(id)) void tryLock(id);
  }

  function selectInRect(rect: { x: number; y: number; w: number; h: number }, additive = false): void {
    const hits = nodes.value
      .filter((n) => {
        const nw = n.width ?? NODE_TYPE_META.text.width;
        const nh = n.height ?? NODE_DEFAULT_H;
        return n.x < rect.x + rect.w && n.x + nw > rect.x && n.y < rect.y + rect.h && n.y + nh > rect.y;
      })
      .map((n) => n.id);
    selectedIds.value = additive ? Array.from(new Set([...selectedIds.value, ...hits])) : hits;
  }

  function selectAll(): void {
    selectedIds.value = nodes.value.map((n) => n.id);
  }

  // ── 视口 ────────────────────────────────────────────────
  function zoomAt(factor: number, screenX: number, screenY: number): void {
    const vp = viewport.value;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
    if (next === vp.zoom) return;
    // 保持鼠标下的世界坐标不动：先算世界点，再反解平移
    const wx = (screenX - vp.x) / vp.zoom;
    const wy = (screenY - vp.y) / vp.zoom;
    viewport.value = { zoom: next, x: screenX - wx * next, y: screenY - wy * next };
  }

  function setZoom(next: number, screenX: number, screenY: number): void {
    zoomAt(next / viewport.value.zoom, screenX, screenY);
  }

  function panBy(dx: number, dy: number): void {
    viewport.value = { ...viewport.value, x: viewport.value.x + dx, y: viewport.value.y + dy };
  }

  /** 适配视图：把所有节点装进视口（留边距） */
  function fitView(size?: { w: number; h: number }): void {
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    if (nodes.value.length === 0) {
      viewport.value = { x: w / 2 - 200, y: h / 2 - 120, zoom: 1 };
      return;
    }
    const pad = 80;
    const minX = Math.min(...nodes.value.map((n) => n.x));
    const minY = Math.min(...nodes.value.map((n) => n.y));
    const maxX = Math.max(...nodes.value.map((n) => n.x + (n.width ?? NODE_TYPE_META.text.width)));
    const maxY = Math.max(...nodes.value.map((n) => n.y + (n.height ?? NODE_DEFAULT_H)));
    const cw = Math.max(1, maxX - minX);
    const ch = Math.max(1, maxY - minY);
    const vw = Math.max(1, w - pad * 2);
    const vh = Math.max(1, h - pad * 2);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(vw / cw, vh / ch, 1)));
    viewport.value = {
      zoom,
      x: pad + (vw - cw * zoom) / 2 - minX * zoom,
      y: pad + (vh - ch * zoom) / 2 - minY * zoom,
    };
  }

  /** 把某个节点居中（小地图/定位用） */
  function focusNode(nodeId: string, size?: { w: number; h: number }): void {
    const n = nodes.value.find((x) => x.id === nodeId);
    if (!n) return;
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    const nw = n.width ?? NODE_TYPE_META.text.width;
    const nh = n.height ?? NODE_DEFAULT_H;
    viewport.value = {
      ...viewport.value,
      x: w / 2 - (n.x + nw / 2) * viewport.value.zoom,
      y: h / 2 - (n.y + nh / 2) * viewport.value.zoom,
    };
  }

  // ── 锁 ──────────────────────────────────────────────────
  async function tryLock(nodeId: string): Promise<void> {
    // 本地临时 id 还没落库，抢锁必然 404，跳过
    if (nodeId.startsWith("local_")) return;
    try {
      await api.lock(canvasId.value, nodeId);
    } catch (e) {
      const err = e as { code?: number };
      if (err.code === CANVAS_ERR.NODE_LOCKED) toast.info("该节点正被其他成员编辑，你的修改保存时会校验版本");
    }
  }

  async function releaseLock(nodeId: string): Promise<void> {
    if (nodeId.startsWith("local_")) return;
    try {
      await api.unlock(canvasId.value, nodeId);
    } catch {
      /* 可能已过期 */
    }
  }

  function lockHolder(nodeId: string): string | null {
    const l = lockedNodes.value.find((x) => x.node_id === nodeId);
    if (!l || l.user_id === myUserId.value) return null;
    return l.user_id;
  }

  async function heartbeat(): Promise<void> {
    try {
      const r = await api.heartbeat(canvasId.value);
      lockedNodes.value = r.locked_nodes ?? [];
    } catch {
      /* 心跳失败不阻塞编辑 */
    }
  }

  // ── 生命周期 ────────────────────────────────────────────
  function startTimers(): void {
    heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
    lockTimer = setInterval(() => {
      if (selectedId.value) void tryLock(selectedId.value);
    }, 20_000);
  }

  function stopTimers(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (lockTimer) clearInterval(lockTimer);
    heartbeatTimer = undefined;
    lockTimer = undefined;
  }

  async function dispose(): Promise<void> {
    stopAllPolling();
    stopTimers();
    if (selectedId.value) await releaseLock(selectedId.value);
  }

  return {
    // 数据
    canvasId,
    title,
    version,
    nodes,
    edges,
    groups,
    pinnedNodeId,
    // 态
    loading,
    saving,
    dirty,
    loadError,
    mode,
    connectFrom,
    connectCursor,
    viewport,
    lockedNodes,
    myUserId,
    // 选择
    selectedIds,
    selectedId,
    selectedNodes,
    selectedNode,
    select,
    selectInRect,
    selectAll,
    // 历史
    canUndo,
    canRedo,
    undo,
    redo,
    pushHistory,
    // 载入/保存
    load,
    loadMe,
    save,
    // 节点
    addNode,
    deleteNodes,
    duplicateNodes,
    moveNodes,
    setNodeParam,
    setNodeParamPath,
    setNodeField,
    setNodesField,
    alignNodes,
    // 连线
    addEdge,
    deleteEdge,
    edgesOf,
    // 视口
    zoomAt,
    setZoom,
    panBy,
    fitView,
    focusNode,
    // 锁 / 钉住
    tryLock,
    releaseLock,
    lockHolder,
    heartbeat,
    setPinned,
    // 节点派生任务（C6）
    taskSubmitting,
    isSubmitting,
    generateNode,
    deriveText,
    generateSelected,
    startTaskPolling,
    stopTaskPolling,
    stopAllPolling,
    syncNodeTasks,
    // 模板（C2）
    saveAsTemplate,
    applyTemplate,
    // 素材 / 批注（C8/C9）
    materials,
    materialsLoading,
    loadMaterials,
    addMaterial,
    saveNodeResultAsMaterial,
    removeMaterials,
    commentNodes,
    commentsLoading,
    commentMode,
    activeCommentId,
    activeComments,
    loadCommentNodes,
    createComment,
    loadComments,
    replyComment,
    toggleCommentResolved,
    deleteComment,
    // 固定组（C10）
    pinGroups,
    pinGroupsMaxSlots,
    loadPinGroups,
    assignSelectionToPinSlot,
    clearPinSlot,
    removePinSlot,
    focusPinGroup,
    // 生命周期
    startTimers,
    stopTimers,
    dispose,
  };
};

export type CanvasEditor = ReturnType<typeof useCanvasEditor>;


