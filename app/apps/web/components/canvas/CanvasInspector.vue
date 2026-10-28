<script setup lang="ts">

const { t } = useI18n();
import type { CanvasEdgeDto, CanvasNodeDto, CanvasNodeType } from "~/types/canvas";
import { NODE_STATUS, NODE_TYPE_META } from "~/types/canvas";
import type { CanvasEditor } from "~/composables/useCanvasEditor";
import type { TableImportResult } from "~/composables/useCanvasApi";

/**
 * 右侧检查器（画布域**唯一**负责参数编辑的组件）
 *
 * 设计取舍，每条都对应一个具体约束：
 *
 * 1. props 直接收 editor 实例，不逐个透传 30 多个 ref/方法。
 *    画布只有一个编辑器实例；拆成 props 会让父级变成一根"接线柱"，
 *    以后 composable 每加一个能力都要同步改三处（composable / 页面 / 这里），
 *    而检查器本来就是"贴着编辑器状态走"的强耦合视图。
 *
 * 2. 参数写入一律走 setNodeParam / setNodeParamPath。
 *    composable 只在这两个方法里置 dirty，直接改 node.params 会让"未保存"标记失效，
 *    用户关页面时 beforeunload 不触发、数据静默丢失。这是最容易犯又最难查的错。
 *
 * 3. 枚举字段用 .cv-seg 分段控件而不是 select。
 *    画布里改 mode/画幅是高频动作，分段控件一次点击到位；
 *    select 要点两次，且展开的原生浮层会盖住画布，打断"边看画面边调参"的节奏。
 *
 * 4. 结构化 JSON 字段能拆就拆成子字段（settings / voice / exportSettings / table 的
 *    前三级），只有确实没有字段级定义的（table.sheets、clip.timeline、script.columns、
 *    spawnConfig、upstreamRefs）才保留 JSON 文本域。
 *    理由：node.md 只给了这些字段"是个 JSON 对象/数组"，没给内部字段名；
 *    自己编字段名会造出"前端存了、后端不认"的静默脏数据，比让用户填 JSON 更糟。
 *    保留文本域时必须做解析校验并阻止写入，避免半截 JSON 进 params。
 *
 * 5. 把 editor 提到本地常量 ed。
 *    除了少写 props.editor，更重要的原因：eslint 的 vue/no-mutating-props 会把
 *    `props.x.y = z` 判成 prop 深改并报 error，而这里确实要写 editor 暴露的 ref
 *    （composable 没有提供 name/width/status 这些字段的 setter）。
 *    用本地引用表达真实语义——"这是共享状态存储，不是在改父组件传进来的 prop"。
 */
const props = defineProps<{
  /** 编辑器实例（composable 返回值） */
  editor: CanvasEditor;
  /** 面板宽度，父级可拖拽调整；用于窄面板时切紧凑排版 */
  width: number;
}>();

const emit = defineEmits<{
  close: [];
  "download-created": [listId: string];
  /** 把选中节点的图片产物设为画布封面（第 62 批）；父组件负责调 API */
  "set-cover": [nodeId: string];
}>();

const ed = props.editor;

// ── 只读视图层：模板里不直接解引用可空 ref，避免 vue-tsc 在嵌套作用域丢窄化 ──
const loading = computed(() => ed.loading.value);
const loadError = computed(() => ed.loadError.value);
const nodes = computed(() => ed.nodes.value);
const edges = computed(() => ed.edges.value);
const groups = computed(() => ed.groups.value);
const selectedIds = computed(() => ed.selectedIds.value);
const selectedNode = computed(() => ed.selectedNode.value);
const selectedNodes = computed(() => ed.selectedNodes.value);
const mode = computed(() => ed.mode.value);
const pinnedNodeId = computed(() => ed.pinnedNodeId.value);
const canvasTitle = computed(() => ed.title.value);

/** 多选态：>1 才走批量面板；单选由 selectedNode 负责 */
const multi = computed(() => selectedIds.value.length > 1);
const nodeType = computed(() => selectedNode.value?.node_type ?? "");
const typeMeta = computed(() => NODE_TYPE_META[nodeType.value as CanvasNodeType] ?? NODE_TYPE_META.text);
const nodeEdges = computed<CanvasEdgeDto[]>(() => {
  const n = selectedNode.value;
  return n ? ed.edgesOf(n.id) : [];
});
/** 面板可拖到 240px，窄的时候 X/Y 这类两列要改单列，否则输入框只有 90px 宽 */
const compact = computed(() => props.width < 300);

// ── 头部文案 ────────────────────────────────────────────
const headTitle = computed(() => {
  if (loading.value) return t("canvasUi.inspTitle");
  if (loadError.value) return t("canvasUi.inspLoadFailed");
  if (multi.value) return t("canvasUi.inspMultiTitle", { count: selectedIds.value.length });
  if (selectedNode.value) return selectedNode.value.name || t("canvasUi.inspUnnamedNode");
  return t("canvasUi.inspOverviewTitle");
});
const headSub = computed(() => {
  if (multi.value) return t("canvasUi.inspBatchTitle");
  if (selectedNode.value) return typeMeta.value.label;
  return canvasTitle.value || t("canvasUi.inspUntitledCanvas");
});
const headIcon = computed(() => {
  if (!nodeType.value) return "organize";
  if (nodeType.value === "threeDWorld") return "node-3d";
  return `node-${nodeType.value}`;
});

// ── 参数读取（params 是 Record<string, unknown>，统一走路径读取，模板里不用到处 as）──
function rawAt(path: string[]): unknown {
  const n = selectedNode.value;
  if (!n) return undefined;
  let cur: unknown = n.params ?? {};
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function sAt(path: string[], fallback = ""): string {
  const v = rawAt(path);
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
function nAt(path: string[], fallback = 0): number {
  const v = rawAt(path);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function bAt(path: string[], fallback = false): boolean {
  const v = rawAt(path);
  return typeof v === "boolean" ? v : fallback;
}
function aAt(path: string[]): unknown[] {
  const v = rawAt(path);
  return Array.isArray(v) ? v : [];
}

// ── 参数写入（唯一合法入口）────────────────────────────
function setP(key: string, value: unknown): void {
  setPP([key], value);
}
/**
 * 单级 key 走 setNodeParam、多级走 setNodeParamPath。
 * 两者语义等价，但分开调是有意的：单级用 setNodeParam 让代码读起来就是
 * "改顶层参数"，多级才需要路径，混用会让后来人误以为顶层也要拼路径。
 */
function setPP(path: string[], value: unknown): void {
  const n = selectedNode.value;
  if (!n) return;
  if (path.length === 1) ed.setNodeParam(n.id, path[0]!, value);
  else ed.setNodeParamPath(n.id, path, value);
}

// ── 事件取值助手（模板里只写 onText($event)，避免每处都 as HTMLInputElement）──
function onText(ev: Event): string {
  return (ev.target as HTMLInputElement).value;
}
function onNum(ev: Event): number {
  const v = Number((ev.target as HTMLInputElement).value);
  return Number.isFinite(v) ? v : 0;
}
function onBool(ev: Event): boolean {
  return (ev.target as HTMLInputElement).checked;
}
function clampInt(v: number, min: number): number {
  const r = Math.round(v);
  return Number.isFinite(r) ? Math.max(min, r) : min;
}

// ── 节点自身字段（非 params）────────────────────────────
/**
 * name / width / z_index / status / group_ids 走 editor.setNodeField。
 * 不直接改 node.xxx：composable 只在自己的方法里置 dirty，绕过它会让"未保存"
 * 标记漏掉，用户关页面时 beforeunload 不触发、改动静默丢失。
 */
function setField<K extends "name" | "width" | "height" | "z_index" | "status" | "group_ids">(
  field: K,
  value: CanvasNodeDto[K],
): void {
  const n = selectedNode.value;
  if (!n) return;
  ed.setNodeField(n.id, field, value);
}
function curName(): string {
  return selectedNode.value?.name ?? "";
}
function curId(): string {
  return selectedNode.value?.id ?? "";
}
function curX(): number {
  return Math.round(selectedNode.value?.x ?? 0);
}
function curY(): number {
  return Math.round(selectedNode.value?.y ?? 0);
}
function curWidth(): number | null {
  return selectedNode.value?.width ?? null;
}
function curZ(): number {
  return selectedNode.value?.z_index ?? 0;
}
function curStatus(): number {
  return selectedNode.value?.status ?? NODE_STATUS.IDLE;
}
function curGroupIds(): string[] {
  return selectedNode.value?.group_ids ?? [];
}
function isPinned(): boolean {
  const n = selectedNode.value;
  return !!n && pinnedNodeId.value === n.id;
}

function setName(v: string): void {
  setField("name", v);
}
/** x/y 走 moveNodes：这是 composable 提供的位移 API，内部会做取整，别绕过它直接改坐标 */
function setX(v: number): void {
  const n = selectedNode.value;
  if (!n) return;
  ed.moveNodes([n.id], Math.round(v) - n.x, 0);
}
function setY(v: number): void {
  const n = selectedNode.value;
  if (!n) return;
  ed.moveNodes([n.id], 0, Math.round(v) - n.y);
}
function setWidthField(v: number): void {
  setField("width", v > 0 ? Math.round(v) : null);
}
function setZField(v: number): void {
  setField("z_index", Math.round(v));
}
function setStatusField(v: number): void {
  setField("status", v);
}
function toggleGroupMembership(groupId: string, checked: boolean): void {
  const n = selectedNode.value;
  if (!n) return;
  const cur = n.group_ids ?? [];
  setField("group_ids", checked ? Array.from(new Set([...cur, groupId])) : cur.filter((g) => g !== groupId));
}

// ── 状态 / 枚举选项 ─────────────────────────────────────
interface Opt {
  value: string;
  label: string;
}

const STATUS_OPTS = [
  { value: NODE_STATUS.IDLE, label: t("canvasUi.statusIdle") },
  { value: NODE_STATUS.RUNNING, label: t("canvasUi.statusRunning") },
  { value: NODE_STATUS.DONE, label: t("canvasUi.statusDone") },
];

/** image 的 16 种 mode（顺序与 node.md 一致，label 只是中文简称，写入 params 的永远是 value） */
const IMAGE_MODE_OPTS: Opt[] = [
  { value: "text2image", label: t("canvasUi.imgModeText2image") },
  { value: "image2image", label: t("canvasUi.imgModeImage2image") },
  { value: "multi_reference", label: t("canvasUi.imgModeMultiReference") },
  { value: "upscale", label: t("canvasUi.imgModeUpscale") },
  { value: "crop", label: t("canvasUi.imgModeCrop") },
  { value: "outpaint", label: t("canvasUi.imgModeOutpaint") },
  { value: "inpaint", label: t("canvasUi.imgModeInpaint") },
  { value: "erase", label: t("canvasUi.imgModeErase") },
  { value: "panorama", label: t("canvasUi.imgModePanorama") },
  { value: "multi_angle_360", label: t("canvasUi.imgModeMultiAngle360") },
  { value: "panorama_360", label: t("canvasUi.imgModePanorama360") },
  { value: "lighting", label: t("canvasUi.imgModeLighting") },
  { value: "multi_camera_grid_9", label: t("canvasUi.imgModeCameraGrid9") },
  { value: "story_grid_4", label: t("canvasUi.imgModeStoryGrid4") },
  { value: "story_grid_9", label: t("canvasUi.imgModeStoryGrid9") },
  { value: "story_grid_25", label: t("canvasUi.imgModeStoryGrid25") },
];

/** video 的 13 种 mode */
const VIDEO_MODE_OPTS: Opt[] = [
  { value: "text2video", label: t("canvasUi.videoModeText2video") },
  { value: "image2video", label: t("canvasUi.videoModeImage2video") },
  { value: "first_frame", label: t("canvasUi.videoModeFirstFrame") },
  { value: "first_last_frame", label: t("canvasUi.videoModeFirstLast") },
  { value: "video_reference", label: t("canvasUi.videoModeVideoReference") },
  { value: "universal_reference", label: t("canvasUi.videoModeUniversalReference") },
  { value: "video_extend", label: t("canvasUi.videoModeExtend") },
  { value: "video_clip", label: t("canvasUi.videoModeClip") },
  { value: "video_upscale", label: t("canvasUi.videoModeUpscale") },
  { value: "de_subtitle_auto", label: t("canvasUi.videoModeDeSubAuto") },
  { value: "de_subtitle_region", label: t("canvasUi.videoModeDeSubRegion") },
  { value: "frame_capture", label: t("canvasUi.videoModeFrameCapture") },
  { value: "video_edit", label: t("canvasUi.videoModeVideoEdit") },
];

const AUDIO_KIND_OPTS: Opt[] = [
  { value: "voiceover", label: t("canvasUi.audioModeVoiceover") },
  { value: "music", label: t("canvasUi.audioModeMusic") },
  { value: "sfx", label: t("canvasUi.audioModeSfx") },
  { value: "ambient", label: t("canvasUi.audioModeAmbient") },
];

const RUN_PHASE_OPTS: Opt[] = [
  { value: "storyboard", label: t("canvasUi.scriptModeStoryboard") },
  { value: "asset_match", label: t("canvasUi.scriptModeAssetMatch") },
];

const ACTIVE_TAB_OPTS: Opt[] = [
  { value: "character", label: t("canvasUi.assetKindCharacter") },
  { value: "scene", label: t("canvasUi.assetKindScene") },
  { value: "prop", label: t("canvasUi.assetKindProp") },
];

const TABLE_SOURCE_OPTS: Opt[] = [
  { value: "manual", label: t("canvasUi.tableSourceManual") },
  { value: "excel_import", label: t("canvasUi.tableSourceExcel") },
  { value: "project_episode_import", label: t("canvasUi.tableSourceEpisode") },
];

// ── 表格节点 Excel 导入（两步式：先列 Sheet，再显式确认）────────────
// 为什么不在选到文件时就一口气导入：多 Sheet 的排期表自动选第一个 = 无声导错
// （用户以为导了「镜头表」，实际存的是「角色表」）。所以必须让用户看见清单再点。
const api = useCanvasApi();
const toast = useToast();
const tableFileInput = ref<HTMLInputElement | null>(null);
const tableImporting = ref(false);
const tableImportError = ref("");
const tableImport = ref<TableImportResult | null>(null);
const tableConfirming = ref("");

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("canvasUi.readFileFailed")));
    // 去掉 "data:...;base64," 前缀：后端接受裸 base64，也接受带前缀，这里给最干净的一种
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^;]*;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

async function onTableFilePick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  // 立刻清空 value：否则"同一个文件再选一次"不会触发 change，用户会以为按钮坏了
  input.value = "";
  const n = selectedNode.value;
  if (!file || !n) return;
  if (!/\.xlsx$/i.test(file.name)) {
    tableImportError.value = t("canvasUi.excelOnly");
    return;
  }
  tableImporting.value = true;
  tableImportError.value = "";
  tableImport.value = null;
  try {
    tableImport.value = await api.importTable(ed.canvasId.value, n.id, {
      file_name: file.name,
      file_base64: await readFileAsBase64(file),
    });
  } catch (err) {
    tableImportError.value = (err as { message?: string }).message || t("canvasUi.importFailed");
  } finally {
    tableImporting.value = false;
  }
}

/** 确认某个 Sheet：后端写库并返回落库后的 table 参数，用它覆盖本地参数 */
async function onConfirmSheet(sheetId: string): Promise<void> {
  const n = selectedNode.value;
  const token = tableImport.value?.import_token;
  if (!n || !token) return;
  tableConfirming.value = sheetId;
  tableImportError.value = "";
  try {
    const res = await api.confirmTableSheet(ed.canvasId.value, n.id, {
      import_token: token,
      sheet_id: sheetId,
    });
    // 必须用后端返回值覆盖本地：只改本地的话，下一次 commit 会用旧参数把导入结果冲掉
    setPP(["table"], res.table);
    toast.success(t("canvasUi.tableImported", { name: res.sheet.name, rows: res.sheet.row_count, cols: res.sheet.col_count }));
  } catch (err) {
    tableImportError.value = (err as { message?: string }).message || t("canvasUi.confirmFailed");
  } finally {
    tableConfirming.value = "";
  }
}

const VIDEO_RATIO_OPTS: Opt[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

const VIDEO_RES_OPTS: Opt[] = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const CLIP_RES_OPTS: Opt[] = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

const EXPORT_TARGET_OPTS: Opt[] = [
  { value: "canvas", label: t("canvasUi.downloadTargetCanvas") },
  { value: "local", label: t("canvasUi.downloadTargetLocal") },
];

const EXPORT_FORMAT_OPTS: Opt[] = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
];

const RICH_FORMAT_OPTS: Opt[] = [
  { value: "plain", label: t("canvasUi.richFormatPlain") },
  { value: "markdown", label: "Markdown" },
];

const TONE_OPTS: Opt[] = [
  { value: "Neutral", label: t("canvasUi.toneNeutral") },
  { value: "Happy", label: t("canvasUi.toneHappy") },
  { value: "Sad", label: t("canvasUi.toneSad") },
  { value: "Surprise", label: t("canvasUi.toneSurprise") },
  { value: "Angry", label: t("canvasUi.toneAngry") },
];

/** 音频时长不是任意值：按 audioKind 有固定档位，所以把档位写在提示里而不是硬限制输入 */
const audioDurationHint = computed(() => {
  const kind = sAt(["audioKind"], "voiceover");
  if (kind === "music" || kind === "ambient") return t("canvasUi.audioDurationMusic");
  if (kind === "sfx") return t("canvasUi.audioDurationSfx");
  return t("canvasUi.audioDurationVoiceover");
});

// ── JSON 文本域：本地缓冲 + 解析校验 ─────────────────────
/**
 * 为什么要本地缓冲而不是直接 value=JSON.stringify(params)：
 * 用户打到一半时 JSON 必然不合法，如果每次都回写 params 再回显，光标会被重置、
 * 半截内容也会进 params。所以"合法才写入、非法只报错"，缓冲按 节点ID+路径 隔离，
 * 避免在 A 节点输入的半截内容串到 B 节点。
 */
type JsonKind = "array" | "object";
const jsonBuffers = reactive<Record<string, string>>({});
const jsonErrors = reactive<Record<string, string>>({});
/**
 * 缓冲的"基线"：上一次与 params 对齐时 params 的序列化结果。
 * 作用是把"用户正在编辑"与"值被外部改了"区分开——
 * 只有 params 偏离基线，才说明撤销/重做/重新载入动过这个字段，缓冲才作废。
 */
const jsonBaseline = reactive<Record<string, string>>({});

function jsonKey(path: string[]): string {
  return `${curId()}::${path.join(".")}`;
}
function serialize(v: unknown): string {
  return v === undefined || v === null ? "" : JSON.stringify(v);
}
function pretty(v: unknown): string {
  if (v === undefined || v === null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}
function jsonText(path: string[]): string {
  const key = jsonKey(path);
  const external = serialize(rawAt(path));
  const buf = jsonBuffers[key];
  // 有缓冲且 params 没被外部改过 → 显示缓冲（含用户正在敲的半截 JSON）
  if (buf !== undefined && jsonBaseline[key] === external) return buf;
  return pretty(rawAt(path));
}
function jsonErr(path: string[]): string {
  const key = jsonKey(path);
  // params 被外部改过时，之前的语法错误提示不再成立
  if (jsonBaseline[key] !== undefined && jsonBaseline[key] !== serialize(rawAt(path))) return "";
  return jsonErrors[key] ?? "";
}
function onJsonInput(path: string[], kind: JsonKind, ev: Event): void {
  const n = selectedNode.value;
  if (!n) return;
  const key = jsonKey(path);
  const text = (ev.target as HTMLTextAreaElement).value;
  jsonBuffers[key] = text;
  // 首次编辑时用"当前 params 的实际值"当基线：空字段基线就是 ""，
  // 这样用户往空字段里敲第一个字符时缓冲不会被立刻丢掉（否则根本打不进字）。
  if (jsonBaseline[key] === undefined) jsonBaseline[key] = serialize(rawAt(path));

  const trimmed = text.trim();
  if (trimmed === "") {
    // 清空 = 显式清掉该字段，按类型写回空容器，而不是留一个语法错误的空串
    delete jsonErrors[key];
    setPP(path, kind === "array" ? [] : {});
    jsonBaseline[key] = serialize(kind === "array" ? [] : {});
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    jsonErrors[key] = t("canvasUi.jsonSyntaxError", { msg: (e as Error).message });
    return;
  }
  if (kind === "array" && !Array.isArray(parsed)) {
    jsonErrors[key] = t("canvasUi.jsonNeedArray");
    return;
  }
  if (kind === "object" && (Array.isArray(parsed) || parsed === null || typeof parsed !== "object")) {
    jsonErrors[key] = t("canvasUi.jsonNeedObject");
    return;
  }
  delete jsonErrors[key];
  setPP(path, parsed);
  jsonBaseline[key] = serialize(parsed);
}

/** 换节点/换选中集合时清空缓冲：否则旧节点的半截 JSON 会污染新节点 */
watch(
  () => ed.selectedId.value,
  () => {
    for (const k of Object.keys(jsonBuffers)) delete jsonBuffers[k];
    for (const k of Object.keys(jsonErrors)) delete jsonErrors[k];
    for (const k of Object.keys(jsonBaseline)) delete jsonBaseline[k];
  },
);

// ── 数组型参数（节点 ID 列表）：用画布真实节点做勾选，不让用户手抄 ID ──
function toggleIdInParam(key: string, id: string, checked: boolean): void {
  const n = selectedNode.value;
  if (!n) return;
  const cur = Array.isArray(n.params?.[key]) ? (n.params[key] as unknown[]).map((x) => String(x)) : [];
  // 追加而不是按 id 排序：shotOrder 的顺序就是镜头顺序，必须保留用户勾选先后
  setP(key, checked ? [...cur, id] : cur.filter((x) => x !== id));
}
function idListOf(key: string): string[] {
  return aAt([key]).map((x) => String(x));
}
/** 候选节点：排除自己（自引用在 clip/group 里没有意义） */
const otherNodes = computed(() => {
  const selfId = curId();
  return nodes.value.filter((x) => x.id !== selfId);
});

// ── 连线 ────────────────────────────────────────────────
function edgeIsOut(e: CanvasEdgeDto): boolean {
  return e.src_node_id === curId();
}
function edgePeerName(e: CanvasEdgeDto): string {
  const selfId = curId();
  const peerId = e.src_node_id === selfId ? e.dst_node_id : e.src_node_id;
  const peer = nodes.value.find((x) => x.id === peerId);
  return peer?.name || peerId;
}
function removeEdge(edgeId: string): void {
  ed.deleteEdge(edgeId);
}

// ── 底部操作 ────────────────────────────────────────────
function toggleConnect(): void {
  const next = mode.value === "connect" ? "select" : "connect";
  ed.mode.value = next;
  // 退出连线模式必须清掉起点，否则下次进来会接着上一条半截连线
  ed.connectFrom.value = null;
}
function duplicateOne(): void {
  const n = selectedNode.value;
  if (!n) return;
  ed.duplicateNodes([n.id]);
}
function deleteOne(): void {
  const n = selectedNode.value;
  if (!n) return;
  if (!window.confirm(t("canvasUi.deleteNodeConfirm", { name: n.name || t("canvasUi.inspUnnamedNode") }))) return;
  ed.deleteNodes([n.id]);
}
/**
 * 钉住：走 editor.setPinned，内部真的调 PUT pinned-node，失败会自动回滚 UI。
 * 不能只改本地 ref——那会让用户以为已钉住，刷新后却没了。
 */
function togglePin(): void {
  const n = selectedNode.value;
  if (!n) return;
  void ed.setPinned(pinnedNodeId.value === n.id ? null : n.id);
}
function reload(): void {
  void ed.load();
}

// ── 生成投递（C6）──────────────────────────────────────────
/**
 * 哪些节点类型可以投递生成。
 * `group`/`director`/`clip` 是"组织/编排"类节点，本身不出图，
 * 给它们放生成按钮会让用户以为能直接生成——所以不显示。
 * （clip 的合成走独立链路，不在本期）
 */
const GENERATABLE_TYPES = ["image", "video", "audio", "threeDWorld"];
const canGenerate = computed(() => GENERATABLE_TYPES.includes(nodeType.value));

function genMode(): string {
  const v = rawAt(["mode"]);
  return typeof v === "string" ? v : "";
}
function genModel(): string {
  const v = rawAt(["model"]);
  return typeof v === "string" ? v : "";
}
function nodeStatus(): number {
  return selectedNode.value?.status ?? NODE_STATUS.IDLE;
}
/** 本地临时 id 还没落库，后端 generate 会 404 —— 按钮直接禁用并说明原因 */
function isLocalNode(): boolean {
  return (selectedNode.value?.id ?? "").startsWith("local_");
}
function resultUri(): string | null {
  const v = rawAt(["result_uri"]) ?? rawAt(["result_preview_uri"]);
  return typeof v === "string" && v ? v : null;
}
function isImageResult(): boolean {
  const t = nodeType.value;
  return t === "image" || t === "threeDWorld";
}
function lastError(): unknown {
  return rawAt(["last_error"]);
}
function lastErrorText(): string {
  const e = lastError();
  if (!e) return "";
  if (typeof e === "string") return e;
  const obj = e as Record<string, unknown>;
  const code = obj.code;
  const msg = obj.message ?? obj.kind ?? "";
  return code ? `[${String(code)}] ${String(msg)}` : String(msg);
}

async function doGenerate(): Promise<void> {
  const n = selectedNode.value;
  if (!n) return;
  await ed.generateNode(n.id);
}

/**
 * 多选里"真正可投递"的节点：类型可生成 + 已填 mode/model + 已落库（非 local_ id）。
 * 用 computed 而不是点击时过滤，是为了让按钮上的数字与禁用态实时反映可投递数量——
 * 用户点之前就知道会投几个，不会出现"点了说没东西可投"。
 */
const generatableSelected = computed(() =>
  selectedNodes.value.filter(
    (n) =>
      !n.id.startsWith("local_") &&
      GENERATABLE_TYPES.includes(n.node_type) &&
      typeof n.params?.mode === "string" &&
      !!n.params.mode &&
      typeof n.params?.model === "string" &&
      !!n.params.model,
  ),
);

async function doBatchGenerate(): Promise<void> {
  await ed.generateSelected();
}

// ── 文本类派生（剧本优化 / 拆解分镜）────────────────────
const deriveSubmitting = ref(false);

/**
 * 发起派生。
 *
 * `prompt` 只作为"对产出的额外要求"传过去，原文由后端从节点 `sourceText` 取——
 * 前端不要把两者混在一起（混了就等于"用户写一句要求，我们把这句话当剧本送去优化"）。
 */
async function doDerive(kind: "script_optimization" | "storyboard_parse" | "asset_extraction"): Promise<void> {
  const n = selectedNode.value;
  if (!n || deriveSubmitting.value) return;
  deriveSubmitting.value = true;
  try {
    const extra = typeof n.params?.prompt === "string" ? n.params.prompt : undefined;
    await ed.deriveText(n.id, kind, extra);
  } finally {
    deriveSubmitting.value = false;
  }
}

/** 「拆分资产」的产出是 JSON：解析成候选列表，让用户一键建 asset 节点 */
interface AssetCandidate {
  kind: "character" | "scene" | "prop";
  name: string;
  description?: string;
  prompt?: string;
}

const assetCandidates = computed<AssetCandidate[]>(() => {
  const text = sAt(["result_text"]);
  if (!text || !text.trim().startsWith("{")) return [];
  try {
    const parsed = JSON.parse(text) as {
      characters?: Array<Record<string, unknown>>;
      scenes?: Array<Record<string, unknown>>;
      props?: Array<Record<string, unknown>>;
    };
    const groups: Array<[AssetCandidate["kind"], Array<Record<string, unknown>> | undefined]> = [
      ["character", parsed.characters],
      ["scene", parsed.scenes],
      ["prop", parsed.props],
    ];
    const out: AssetCandidate[] = [];
    for (const [kind, list] of groups) {
      for (const item of list ?? []) {
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name) continue;
        out.push({
          kind,
          name,
          description: typeof item.description === "string" ? item.description : undefined,
          prompt: typeof item.prompt === "string" ? item.prompt : undefined,
        });
      }
    }
    return out;
  } catch {
    // 结果不是 JSON（比如用户点的是"拆解分镜"）→ 不显示候选区，不报错
    return [];
  }
});

function assetKindLabel(kind: AssetCandidate["kind"]): string {
  return kind === "character"
    ? t("canvasUi.assetKindCharacter")
    : kind === "scene"
      ? t("canvasUi.assetKindScene")
      : t("canvasUi.assetKindProp");
}

/** 资产匹配结果：`[{shot_no, character, scene, props[]}]`，逐镜渲染成一行的对照表 */
interface MatchRow {
  shot_no: number;
  character: string;
  scene: string;
  props: string[];
}

const matchRows = computed<MatchRow[]>(() => {
  const text = sAt(["result_text"]);
  if (!text || !text.trim().startsWith("[")) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .filter((row) => typeof row.shot_no === "number")
      .map((row) => ({
        shot_no: row.shot_no as number,
        character: typeof row.character === "string" ? row.character : "",
        scene: typeof row.scene === "string" ? row.scene : "",
        props: Array.isArray(row.props) ? row.props.filter((p): p is string => typeof p === "string") : [],
      }));
  } catch {
    return [];
  }
});

/** 发起分镜×资产匹配（候选资产取本画布的 asset 节点，分镜取本节点结果） */
async function doMatchAssets(): Promise<void> {
  const n = selectedNode.value;
  if (!n || deriveSubmitting.value) return;
  deriveSubmitting.value = true;
  try {
    await ed.matchAssets(n.id);
  } finally {
    deriveSubmitting.value = false;
  }
}

/** 一键把候选建成 asset 节点：排在剧本节点右侧，避免互相压住 */
function createAssetNodes(): void {
  const source = selectedNode.value;
  const items = assetCandidates.value;
  if (!source || items.length === 0) return;
  items.forEach((item, index) => {
    const node = ed.addNode("asset", { x: source.x + 360, y: source.y + index * 150 });
    ed.setNodeField(node.id, "name", `${assetKindLabel(item.kind)}·${item.name}`);
    ed.setNodeParam(node.id, "assetKind", item.kind);
    if (item.prompt) ed.setNodeParam(node.id, "prompt", item.prompt);
    if (item.description) ed.setNodeParam(node.id, "description", item.description);
  });
  toast.success(t("canvasUi.assetsCreated", { count: items.length }));
}

// ── 视频拆解（拉片）──────────────────────────────────────
/**
 * 视频拆解：输入是视频节点**自己的产物**（后端取 `result_uri`），前端不搬 URI——
 * 搬一遍就会出现"节点里换了视频、请求里还是旧 URI"的不一致。
 *
 * 产出 JSON 与「拆分资产」同形，因此复用同一套候选列表与"建资产节点"按钮
 * （参照站也是把解析结果落成资产表 + 文本节点）。
 */
async function doParseVideo(): Promise<void> {
  const n = selectedNode.value;
  if (!n || deriveSubmitting.value) return;
  deriveSubmitting.value = true;
  try {
    await ed.parseVideo(n.id);
  } finally {
    deriveSubmitting.value = false;
  }
}

// ── 批量下载（产物打包）──────────────────────────────────
const downloadPacking = ref(false);
/** 只有真的"出过产物"的节点才值得打包：全选一堆空节点只会得到"无可下载内容" */
const canBatchDownload = computed(() =>
  selectedNodes.value.some((n) => {
    const p = (n.params ?? {}) as Record<string, unknown>;
    return Array.isArray(p.result_uris) || !!p.result_uri || !!n.task_id;
  }),
);

async function doBatchDownload(): Promise<void> {
  const ids = [...selectedIds.value];
  if (ids.length === 0 || downloadPacking.value) return;
  downloadPacking.value = true;
  try {
    const res = await api.batchDownloadNodes(ed.canvasId.value, ids);
    toast.success(t("canvasUi.packedFiles", { files: res.file_count, nodes: res.node_count }));
    // 交给页面打开"下载记录"抽屉：下载单是可复用凭证，用户应该能回头再取链接
    emit("download-created", res.download_list_id);
  } catch (err) {
    toast.error((err as { message?: string }).message || t("canvasUi.packFailed"));
  } finally {
    downloadPacking.value = false;
  }
}

// ── 多选批量操作 ────────────────────────────────────────
/** 批量改状态走 setNodesField：批量改字段的脏标记/遍历逻辑都在 composable 里，别在这里重写一遍 */
function batchStatus(status: number): void {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  ed.setNodesField(ids, "status", status);
}
/**
 * 全部选中节点都是这个状态时高亮。
 * 不做"部分选中"的中间态：分段控件只有选中/未选中两态，
 * 造第三种视觉反而让人猜不到点下去会发生什么。
 */
function allSelectedStatus(status: number): boolean {
  const list = selectedNodes.value;
  return list.length > 0 && list.every((n) => n.status === status);
}

type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
/**
 * 对齐基准 = 选区外接框（alignNodes 内部实现）。
 * 不用"以第一个选中节点为基准"：多选时用户记不住哪个是第一个，结果不可预期。
 */
function alignSelection(kind: AlignKind): void {
  const ids = [...selectedIds.value];
  if (ids.length < 2) return;
  ed.alignNodes(ids, kind);
}

function batchDelete(): void {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  if (!window.confirm(t("canvasUi.deleteNodesConfirm", { count: ids.length }))) return;
  ed.deleteNodes(ids);
}

// ── 概览 ────────────────────────────────────────────────
const typeCounts = computed(() => {
  const map = new Map<string, number>();
  for (const n of nodes.value) map.set(n.node_type, (map.get(n.node_type) ?? 0) + 1);
  return Array.from(map.entries()).map(([t, count]) => ({ type: t, label: typeLabelOf(t), count }));
});
const pinnedName = computed(() => {
  if (!pinnedNodeId.value) return "";
  const n = nodes.value.find((x) => x.id === pinnedNodeId.value);
  return n?.name || pinnedNodeId.value;
});

function typeLabelOf(t: string): string {
  return (NODE_TYPE_META as Record<string, { label: string } | undefined>)[t]?.label ?? t;
}
function statusLabel(v: number): string {
  return STATUS_OPTS.find((o) => o.value === v)?.label ?? t("canvasUi.statusFallback", { v: v });
}

// ── 折叠区 ──────────────────────────────────────────────
const secOpen = reactive<Record<string, boolean>>({ adv: false, edges: true, extra: false });
function toggleSec(key: string): void {
  secOpen[key] = !secOpen[key];
}
</script>

<template>
  <div class="canvas-inspector" :class="{ 'is-compact': compact }">
    <!-- 头部：固定不滚动，保证换节点时标题始终可见 -->
    <header class="insp-head">
      <span class="insp-head__icon" :style="{ color: typeMeta.color }">
        <CanvasIcon :name="headIcon" :size="16" />
      </span>
      <span class="insp-head__text">
        <span class="insp-head__title" :title="headTitle">{{ headTitle }}</span>
        <span class="insp-head__sub">{{ headSub }}</span>
      </span>
      <button class="cv-glass-btn insp-close" type="button" :aria-label="t('canvasUi.inspCollapse')" @click="emit('close')">
        <CanvasIcon name="close" :size="15" />
      </button>
    </header>

    <!-- ── 三态之一：加载中 ───────────────────────────── -->
    <div v-if="loading" class="insp-state insp-state--loading">
      <Skeleton :rows="5" />
      <p class="cv-hint">{{ t("canvasUi.inspLoadingCanvas") }}</p>
    </div>

    <!-- ── 三态之二：载入失败 ─────────────────────────── -->
    <div v-else-if="loadError" class="insp-state insp-state--error">
      <p class="insp-error">{{ loadError }}</p>
      <Button variant="secondary" size="sm" @click="reload">{{ t("canvasUi.retry") }}</Button>
    </div>

    <!-- ── 多选：批量操作 ─────────────────────────────── -->
    <div v-else-if="multi" class="insp-body insp-multi">
      <section class="cv-section insp-sec-batch insp-sec--first">
        <div class="cv-section__head">
          <span>{{ t("canvasUi.inspBatchTitle") }}</span>
          <span class="cv-tag cv-tag--brand">{{ t("canvasUi.inspBatchCount", { n: selectedIds.length }) }}</span>
        </div>
        <ul class="insp-name-list">
          <li v-for="nd in selectedNodes" :key="nd.id" class="insp-name-list__item">
            <span class="insp-name-list__dot" />
            <span class="insp-name-list__name">{{ nd.name || t("canvasUi.inspUnnamed") }}</span>
            <span class="cv-tag" :class="{ 'cv-tag--success': nd.status === NODE_STATUS.DONE }">
              {{ statusLabel(nd.status) }}
            </span>
            <span class="cv-tag">{{ typeLabelOf(nd.node_type) }}</span>
          </li>
        </ul>
      </section>

      <section class="cv-section insp-sec-batch-status">
        <div class="cv-section__head"><span>{{ t("canvasUi.batchStatusHead") }}</span></div>
        <div class="cv-seg insp-seg">
          <button
            v-for="o in STATUS_OPTS"
            :key="o.value"
            type="button"
            :class="{ 'is-active': allSelectedStatus(o.value) }"
            @click="batchStatus(o.value)"
          >
            {{ o.label }}
          </button>
        </div>
        <p class="cv-hint">{{ t("canvasUi.batchStatusHint") }}</p>
      </section>

      <section class="cv-section insp-sec-batch-align">
        <div class="cv-section__head"><span>{{ t("canvasUi.batchAlignHead") }}</span></div>
        <div class="insp-align-grid">
          <button class="insp-act" type="button" @click="alignSelection('left')">{{ t("canvasUi.alignLeft") }}</button>
          <button class="insp-act" type="button" @click="alignSelection('hcenter')">{{ t("canvasUi.alignHCenter") }}</button>
          <button class="insp-act" type="button" @click="alignSelection('right')">{{ t("canvasUi.alignRight") }}</button>
          <button class="insp-act" type="button" @click="alignSelection('top')">{{ t("canvasUi.alignTop") }}</button>
          <button class="insp-act" type="button" @click="alignSelection('vcenter')">{{ t("canvasUi.alignVCenter") }}</button>
          <button class="insp-act" type="button" @click="alignSelection('bottom')">{{ t("canvasUi.alignBottom") }}</button>
        </div>
        <p class="cv-hint">{{ t("canvasUi.batchAlignHint") }}</p>
      </section>

      <section class="cv-section insp-sec-batch-gen">
        <div class="cv-section__head">
          <span>{{ t("canvasUi.batchGenHead") }}</span>
          <span class="cv-tag">{{ t("canvasUi.batchGenReady", { n: generatableSelected.length }) }}</span>
        </div>
        <Button
          size="sm"
          block
          class="insp-batch-generate"
          :disabled="generatableSelected.length === 0"
          @click="doBatchGenerate"
        >
          {{ t("canvasUi.batchGenSubmit", { n: generatableSelected.length }) }}
        </Button>
        <p class="cv-hint">
          {{ t("canvasUi.batchGenHint") }}
        </p>
      </section>

      <section class="cv-section insp-sec-batch-download">
        <div class="cv-section__head">
          <span>{{ t("canvasUi.batchDownloadHead") }}</span>
          <span class="cv-tag">{{ t("canvasUi.batchDownloadCount", { n: selectedIds.length }) }}</span>
        </div>
        <Button
          size="sm"
          block
          variant="secondary"
          class="insp-batch-download"
          :disabled="!canBatchDownload"
          :loading="downloadPacking"
          @click="doBatchDownload"
        >
          {{ t("canvasUi.batchDownloadSubmit") }}
        </Button>
        <p class="cv-hint">
          {{ t("canvasUi.batchDownloadHint") }}
        </p>
      </section>

      <section class="cv-section insp-sec-batch-danger">
        <Button variant="danger" size="sm" block class="insp-delete insp-batch-delete" @click="batchDelete">
          {{ t("canvasUi.batchDeleteSubmit", { n: selectedIds.length }) }}
        </Button>
      </section>
    </div>

    <!-- ── 三态之三：未选中 → 画布概览 ────────────────── -->
    <div v-else-if="!selectedNode" class="insp-body insp-overview">
      <section class="insp-ov-hero">
        <p class="insp-ov-title">{{ t("canvasUi.inspOverviewTitle") }}</p>
        <p class="cv-hint">{{ canvasTitle || t("canvasUi.inspUntitledCanvas") }}</p>
      </section>

      <div class="insp-ov-stats">
        <div class="insp-ov-stat">
          <span class="insp-ov-stat__num">{{ nodes.length }}</span>
          <span class="insp-ov-stat__label">{{ t("canvasUi.ovNodes") }}</span>
        </div>
        <div class="insp-ov-stat">
          <span class="insp-ov-stat__num">{{ edges.length }}</span>
          <span class="insp-ov-stat__label">{{ t("canvasUi.ovEdges") }}</span>
        </div>
        <div class="insp-ov-stat">
          <span class="insp-ov-stat__num">{{ groups.length }}</span>
          <span class="insp-ov-stat__label">{{ t("canvasUi.ovGroups") }}</span>
        </div>
      </div>

      <section v-if="pinnedName" class="cv-section insp-sec-pinned">
        <div class="cv-section__head"><span>{{ t("canvasUi.ovPinnedHead") }}</span></div>
        <p class="insp-ov-pinned">
          <CanvasIcon name="pin" :size="13" />
          <span>{{ pinnedName }}</span>
        </p>
      </section>

      <section v-if="typeCounts.length > 0" class="cv-section insp-sec-typecount">
        <div class="cv-section__head"><span>{{ t("canvasUi.ovTypeDistHead") }}</span></div>
        <ul class="insp-typecount">
          <li v-for="tc in typeCounts" :key="tc.type" class="insp-typecount__row">
            <span class="insp-typecount__label">{{ tc.label }}</span>
            <span class="insp-typecount__num">{{ tc.count }}</span>
          </li>
        </ul>
      </section>

      <section class="cv-section insp-sec-tips">
        <div class="cv-section__head"><span>{{ t("canvasUi.ovTipsHead") }}</span></div>
        <ul class="insp-tips">
          <li>{{ t("canvasUi.tipNewText") }}</li>
          <li>{{ t("canvasUi.tipSelect") }}</li>
          <li>{{ t("canvasUi.tipConnect") }}</li>
          <li>{{ t("canvasUi.tipShortcuts") }}</li>
          <li>{{ t("canvasUi.tipLocalOnly") }}</li>
        </ul>
      </section>
    </div>

    <!-- ── 单选：公共区 + 类型面板 + 连线 + 底部操作 ──── -->
    <template v-else>
      <div class="insp-body">
        <!-- 公共区 -->
        <section class="cv-section insp-sec-common insp-sec--first">
          <div class="cv-section__head">
            <span>{{ t("canvasUi.basicHead") }}</span>
            <span class="cv-tag">{{ typeLabelOf(nodeType) }}</span>
          </div>

          <div class="cv-field insp-field-name insp-name">
            <label>{{ t("canvasUi.nameLabel") }}</label>
            <input class="cv-input" :value="curName()" :placeholder="t('canvasUi.nodeNamePlaceholder')" @input="setName(onText($event))" />
          </div>

          <div class="insp-row">
            <div class="cv-field insp-field-x">
              <label>X</label>
              <input class="cv-input" type="number" step="1" :value="curX()" @input="setX(onNum($event))" />
            </div>
            <div class="cv-field insp-field-y">
              <label>Y</label>
              <input class="cv-input" type="number" step="1" :value="curY()" @input="setY(onNum($event))" />
            </div>
          </div>

          <div class="insp-row">
            <div class="cv-field insp-field-width">
              <label>{{ t("canvasUi.widthLabel") }}</label>
              <input
                class="cv-input"
                type="number"
                step="10"
                :value="curWidth() ?? ''"
                :placeholder="t('canvasUi.autoPlaceholder')"
                @input="setWidthField(onNum($event))"
              />
            </div>
            <div class="cv-field insp-field-z">
              <label>{{ t("canvasUi.zLabel") }}</label>
              <input class="cv-input" type="number" step="1" :value="curZ()" @input="setZField(onNum($event))" />
            </div>
          </div>

          <div class="cv-field insp-field-status">
            <label>{{ t("canvasUi.statusLabel2") }}</label>
            <div class="cv-seg insp-seg">
              <button
                v-for="o in STATUS_OPTS"
                :key="o.value"
                type="button"
                :class="{ 'is-active': curStatus() === o.value }"
                @click="setStatusField(o.value)"
              >
                {{ o.label }}
              </button>
            </div>
          </div>

          <div class="cv-field insp-field-group">
            <label>{{ t("canvasUi.groupAssignLabel") }}</label>
            <div v-if="groups.length === 0" class="cv-hint">{{ t("canvasUi.noGroupsYet") }}</div>
            <div v-else class="insp-check-list">
              <label v-for="g in groups" :key="g.id" class="insp-check">
                <input
                  type="checkbox"
                  :checked="curGroupIds().includes(g.id)"
                  @change="toggleGroupMembership(g.id, onBool($event))"
                />
                <span>{{ g.name || g.id }}</span>
              </label>
            </div>
          </div>

          <div class="cv-field insp-field-id">
            <label>{{ t("canvasUi.nodeIdLabel") }}</label>
            <input class="cv-input insp-id" :value="curId()" readonly />
          </div>
        </section>

        <!-- 类型专属参数 -->
        <section class="cv-section insp-sec-type">
          <div class="cv-section__head">
            <span>{{ t("canvasUi.paramsSuffix", { label: typeMeta.label }) }}</span>
            <span class="cv-hint insp-type-hint">{{ typeMeta.hint }}</span>
          </div>

          <!-- text -->
          <template v-if="nodeType === 'text'">
            <div class="cv-field insp-field-prompt insp-prompt">
              <label>{{ t("canvasUi.promptLabel2") }}</label>
              <textarea
                class="cv-textarea insp-prompt"
                :value="sAt(['prompt'])"
                :placeholder="t('canvasUi.promptTextPlaceholder')"
                @input="setP('prompt', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.modelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-count">
              <label>{{ t("canvasUi.countLabel") }}</label>
              <input
                class="cv-input insp-count"
                type="number"
                min="1"
                step="1"
                :value="nAt(['count'], 1)"
                @input="setP('count', clampInt(onNum($event), 1))"
              />
            </div>
            <div class="cv-field insp-field-richformat">
              <label>{{ t("canvasUi.richFormatLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in RICH_FORMAT_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['richText', 'format'], 'plain') === o.value }"
                  @click="setPP(['richText', 'format'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.richFormatHint") }}</p>
            </div>
          </template>

          <!-- image / threeDWorld 共用图片结构 -->
          <template v-else-if="nodeType === 'image' || nodeType === 'threeDWorld'">
            <div class="cv-field insp-field-mode">
              <label>{{ t("canvasUi.modeLabel") }}</label>
              <div class="cv-seg insp-seg insp-seg--scroll">
                <button
                  v-for="o in IMAGE_MODE_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['mode'], 'text2image') === o.value }"
                  @click="setP('mode', o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.modeHint") }}</p>
            </div>
            <div class="cv-field insp-field-prompt insp-prompt">
              <label>{{ t("canvasUi.promptLabel2") }}</label>
              <textarea
                class="cv-textarea insp-prompt"
                :value="sAt(['prompt'])"
                :placeholder="t('canvasUi.promptImagePlaceholder')"
                @input="setP('prompt', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.modelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-count">
              <label>{{ t("canvasUi.countImagesLabel") }}</label>
              <input
                class="cv-input insp-count"
                type="number"
                min="1"
                step="1"
                :value="nAt(['count'], 1)"
                @input="setP('count', clampInt(onNum($event), 1))"
              />
            </div>

            <div class="insp-subhead">settings</div>
            <div class="cv-field insp-field-ratio">
              <label>{{ t("canvasUi.ratioLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['settings', 'ratio'], '16:9')"
                placeholder="16:9"
                @input="setPP(['settings', 'ratio'], onText($event))"
              />
              <p class="cv-hint">{{ t("canvasUi.ratioHint") }}</p>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-quality">
                <label>{{ t("canvasUi.qualityLabel") }}</label>
                <input
                  class="cv-input"
                  :value="sAt(['settings', 'quality'])"
                  placeholder="2K"
                  @input="setPP(['settings', 'quality'], onText($event))"
                />
              </div>
              <div class="cv-field insp-field-imagequality">
                <label>{{ t("canvasUi.imageQualityLabel") }}</label>
                <input
                  class="cv-input"
                  :value="sAt(['settings', 'imageQuality'])"
                  placeholder="high"
                  @input="setPP(['settings', 'imageQuality'], onText($event))"
                />
              </div>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-w">
                <label>{{ t("canvasUi.widthLabel2") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  step="8"
                  :value="nAt(['settings', 'width'], 0)"
                  @input="setPP(['settings', 'width'], clampInt(onNum($event), 0))"
                />
              </div>
              <div class="cv-field insp-field-h">
                <label>{{ t("canvasUi.heightLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  step="8"
                  :value="nAt(['settings', 'height'], 0)"
                  @input="setPP(['settings', 'height'], clampInt(onNum($event), 0))"
                />
              </div>
            </div>
            <p class="cv-hint">{{ t("canvasUi.sizeHint") }}</p>

            <template v-if="nodeType === 'threeDWorld'">
              <div class="insp-subhead">{{ t("canvasUi.threeDWorldHead") }}</div>
              <label class="insp-check insp-field-pano">
                <input
                  type="checkbox"
                  :checked="bAt(['worldInputIsPano'])"
                  @change="setP('worldInputIsPano', onBool($event))"
                />
                <span>{{ t("canvasUi.worldPanoLabel") }}</span>
              </label>
              <p class="cv-hint">{{ t("canvasUi.worldPanoHint") }}</p>
            </template>
          </template>

          <!-- video -->
          <template v-else-if="nodeType === 'video'">
            <div class="cv-field insp-field-mode">
              <label>{{ t("canvasUi.modeLabel") }}</label>
              <div class="cv-seg insp-seg insp-seg--scroll">
                <button
                  v-for="o in VIDEO_MODE_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['mode'], 'text2video') === o.value }"
                  @click="setP('mode', o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="cv-field insp-field-prompt insp-prompt">
              <label>{{ t("canvasUi.promptLabel2") }}</label>
              <textarea
                class="cv-textarea insp-prompt"
                :value="sAt(['prompt'])"
                :placeholder="t('canvasUi.promptVideoPlaceholder')"
                @input="setP('prompt', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.modelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-count">
              <label>{{ t("canvasUi.countLabel") }}</label>
              <input
                class="cv-input insp-count"
                type="number"
                min="1"
                step="1"
                :value="nAt(['count'], 1)"
                @input="setP('count', clampInt(onNum($event), 1))"
              />
            </div>

            <div class="insp-subhead">settings</div>
            <div class="cv-field insp-field-ratio">
              <label>{{ t("canvasUi.ratioLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in VIDEO_RATIO_OPTS"
                  :key="o.value"
                  type="button"
                  :class="{ 'is-active': sAt(['settings', 'ratio'], '16:9') === o.value }"
                  @click="setPP(['settings', 'ratio'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.videoValuesHint") }}</p>
            </div>
            <div class="cv-field insp-field-resolution">
              <label>{{ t("canvasUi.resolutionLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in VIDEO_RES_OPTS"
                  :key="o.value"
                  type="button"
                  :class="{ 'is-active': sAt(['settings', 'resolution'], '720p') === o.value }"
                  @click="setPP(['settings', 'resolution'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.resolutionHint") }}</p>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-duration">
                <label>{{ t("canvasUi.durationLabel") }}</label>
                <!-- 不写死档位：项目规范要求时长/画幅/分辨率由 /models 目录驱动，
                     这里给自由输入 + 明确 placeholder，避免用户以为只有固定几档 -->
                <input
                  class="cv-input"
                  type="number"
                  min="1"
                  step="1"
                  :value="nAt(['settings', 'duration'], 0)"
                  :placeholder="t('canvasUi.durationPlaceholder')"
                  @input="setPP(['settings', 'duration'], clampInt(onNum($event), 1))"
                />
              </div>
              <div class="cv-field insp-field-fps">
                <label>{{ t("canvasUi.fpsLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="1"
                  step="1"
                  :value="nAt(['settings', 'fps'], 24)"
                  @input="setPP(['settings', 'fps'], clampInt(onNum($event), 1))"
                />
              </div>
            </div>
            <div class="cv-field insp-field-shottype">
              <label>{{ t("canvasUi.shotTypeLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['settings', 'shotType'])"
                :placeholder="t('canvasUi.shotTypePlaceholder')"
                @input="setPP(['settings', 'shotType'], onText($event))"
              />
            </div>
            <label class="insp-check insp-field-enablesound">
              <input
                type="checkbox"
                :checked="bAt(['settings', 'enableSound'], true)"
                @change="setPP(['settings', 'enableSound'], onBool($event))"
              />
              <span>{{ t("canvasUi.enableSoundLabel") }}</span>
            </label>
            <label class="insp-check insp-field-mouthdrive">
              <input
                type="checkbox"
                :checked="bAt(['settings', 'mouthDrive'])"
                @change="setPP(['settings', 'mouthDrive'], onBool($event))"
              />
              <span>{{ t("canvasUi.mouthDriveLabel") }}</span>
            </label>
            <label class="insp-check insp-field-offpeak">
              <input
                type="checkbox"
                :checked="bAt(['settings', 'offPeak'])"
                @change="setPP(['settings', 'offPeak'], onBool($event))"
              />
              <span>{{ t("canvasUi.offPeakLabel") }}</span>
            </label>

            <!-- 视频拆解（拉片）：输入是本节点已出的视频，产出 JSON 候选 -->
            <section class="cv-section insp-sec-videoparse">
              <div class="cv-section__head">
                <span>{{ t("canvasUi.videoBreakdownHead") }}</span>
                <span class="cv-tag">{{ t("canvasUi.perRunPricing") }}</span>
              </div>
              <div class="insp-derive-row">
                <Button
                  size="sm"
                  variant="secondary"
                  class="insp-parse-video"
                  :disabled="deriveSubmitting"
                  :loading="deriveSubmitting"
                  @click="doParseVideo"
                >
                  {{ t("canvasUi.breakdownBtn") }}
                </Button>
              </div>
              <p class="cv-hint">
                {{ t("canvasUi.breakdownHint") }}
              </p>
              <div v-if="assetCandidates.length" class="cv-field insp-asset-candidates insp-videoparse-candidates">
                <label>
                  {{ t("canvasUi.breakdownCandidates") }}
                  <span class="cv-tag">{{ t("canvasUi.countItems", { n: assetCandidates.length }) }}</span>
                </label>
                <ul class="insp-assets__list">
                  <li v-for="(a, i) in assetCandidates" :key="i" class="insp-assets__item">
                    <span class="cv-tag">{{ assetKindLabel(a.kind) }}</span>
                    <span class="insp-assets__name">{{ a.name }}</span>
                  </li>
                </ul>
                <Button class="insp-assets__create" size="sm" block @click="createAssetNodes">
                  {{ t("canvasUi.createAssetsN", { n: assetCandidates.length }) }}
                </Button>
                <p class="cv-hint">{{ t("canvasUi.createAssetsHint") }}</p>
              </div>
              <p v-else-if="ed.selectedNode.value?.status === 2" class="cv-hint insp-derive-running">
                {{ t("canvasUi.breakingDown") }}
              </p>
            </section>
          </template>

          <!-- audio -->
          <template v-else-if="nodeType === 'audio'">
            <div class="cv-field insp-field-audiokind">
              <label>{{ t("canvasUi.audioKindLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in AUDIO_KIND_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['audioKind'], 'voiceover') === o.value }"
                  @click="setP('audioKind', o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="cv-field insp-field-prompt insp-prompt">
              <label>{{ t("canvasUi.audioPromptLabel") }}</label>
              <textarea
                class="cv-textarea insp-prompt"
                :value="sAt(['prompt'])"
                :placeholder="t('canvasUi.audioPromptPlaceholder')"
                @input="setP('prompt', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.audioModelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-duration">
                <label>{{ t("canvasUi.durationLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="0"
                  step="1"
                  :value="nAt(['duration'], 10)"
                  @input="setP('duration', clampInt(onNum($event), 0))"
                />
              </div>
              <div class="cv-field insp-field-count">
                <label>{{ t("canvasUi.countLabel") }}</label>
                <input
                  class="cv-input insp-count"
                  type="number"
                  min="1"
                  step="1"
                  :value="nAt(['count'], 1)"
                  @input="setP('count', clampInt(onNum($event), 1))"
                />
              </div>
            </div>
            <p class="cv-hint">{{ audioDurationHint }}</p>

            <div class="insp-subhead">{{ t("canvasUi.voiceHead") }}</div>
            <div class="cv-field insp-field-voiceid">
              <label>{{ t("canvasUi.voiceIdLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['voice', 'voiceId'])"
                :placeholder="t('canvasUi.voiceIdPlaceholder')"
                @input="setPP(['voice', 'voiceId'], onText($event))"
              />
            </div>
            <div class="cv-field insp-field-voicename">
              <label>{{ t("canvasUi.voiceNameLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['voice', 'voiceName'])"
                :placeholder="t('canvasUi.voiceNamePlaceholder')"
                @input="setPP(['voice', 'voiceName'], onText($event))"
              />
            </div>
            <div class="cv-field insp-field-tone">
              <label>{{ t("canvasUi.toneLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in TONE_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['voice', 'tone'], 'Neutral') === o.value }"
                  @click="setPP(['voice', 'tone'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-speed">
                <label>{{ t("canvasUi.speedLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.1"
                  :value="nAt(['voice', 'speed'], 1)"
                  @input="setPP(['voice', 'speed'], onNum($event))"
                />
              </div>
              <div class="cv-field insp-field-pitch">
                <label>{{ t("canvasUi.pitchLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="-12"
                  max="12"
                  step="1"
                  :value="nAt(['voice', 'pitch'], 0)"
                  @input="setPP(['voice', 'pitch'], onNum($event))"
                />
              </div>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-volume">
                <label>{{ t("canvasUi.volumeLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="0"
                  step="0.05"
                  :value="nAt(['voice', 'volume'], 1)"
                  @input="setPP(['voice', 'volume'], onNum($event))"
                />
              </div>
              <div class="cv-field insp-field-rate">
                <label>{{ t("canvasUi.previewRateLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  min="0.5"
                  step="0.25"
                  :value="nAt(['previewPlaybackRate'], 1)"
                  @input="setP('previewPlaybackRate', onNum($event))"
                />
              </div>
            </div>
            <label class="insp-check insp-field-loop">
              <input
                type="checkbox"
                :checked="bAt(['voice', 'loop'])"
                @change="setPP(['voice', 'loop'], onBool($event))"
              />
              <span>{{ t("canvasUi.loopLabel") }}</span>
            </label>
            <p class="cv-hint">{{ t("canvasUi.audioRangeHint") }}</p>
          </template>

          <!-- table -->
          <template v-else-if="nodeType === 'table'">
            <div class="cv-field insp-field-table-import">
              <label>
                {{ t("canvasUi.excelImport") }}
                <span v-if="sAt(['table', 'import', 'file_name'])" class="cv-tag">
                  {{ sAt(["table", "import", "file_name"]) }}
                </span>
              </label>
              <!-- 隐藏的 file input：样式无法可靠定制，用按钮代理点击 -->
              <input
                ref="tableFileInput"
                class="insp-hidden-file"
                type="file"
                accept=".xlsx"
                @change="onTableFilePick"
              />
              <Button
                class="insp-table-pick"
                variant="secondary"
                size="sm"
                :disabled="tableImporting"
                @click="tableFileInput?.click()"
              >
                {{ tableImporting ? t("canvasUi.parsing") : t("canvasUi.selectXlsx") }}
              </Button>
              <p v-if="tableImportError" class="insp-json-err">{{ tableImportError }}</p>

              <div v-if="tableImport" class="insp-sheets">
                <p class="cv-hint">
                  {{ t("canvasUi.sheetsCountHintA", { n: tableImport.sheets.length }) }}
                  <strong>{{ t("canvasUi.sheetsCountHintB") }}</strong>：
                </p>
                <ul class="insp-sheets__list">
                  <li v-for="s in tableImport.sheets" :key="s.sheet_id" class="insp-sheets__item">
                    <span class="insp-sheets__name">{{ s.name }}</span>
                    <span class="insp-sheets__meta">{{ t("canvasUi.sheetMeta", { rows: s.row_count, cols: s.col_count }) }}</span>
                    <Button
                      class="insp-sheets__use"
                      size="sm"
                      :disabled="tableConfirming === s.sheet_id"
                      @click="onConfirmSheet(s.sheet_id)"
                    >
                      {{ tableConfirming === s.sheet_id ? t("canvasUi.writing") : t("canvasUi.useSheet") }}
                    </Button>
                  </li>
                </ul>
                <p v-if="tableImport.warnings.length" class="cv-hint">{{ tableImport.warnings.join("；") }}</p>
              </div>
            </div>

            <div class="cv-field insp-field-sheetid">
              <label>{{ t("canvasUi.activeSheetLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['table', 'active_sheet_id'])"
                placeholder="sheet-1"
                @input="setPP(['table', 'active_sheet_id'], onText($event))"
              />
            </div>
            <div class="cv-field insp-field-sourcetype">
              <label>{{ t("canvasUi.sourceTypeLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in TABLE_SOURCE_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['table', 'source', 'type'], 'manual') === o.value }"
                  @click="setPP(['table', 'source', 'type'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.excelFlowHint") }}</p>
            </div>
            <label class="insp-check insp-field-sheetrequired">
              <input
                type="checkbox"
                :checked="bAt(['table', 'sheet_selection_required'])"
                @change="setPP(['table', 'sheet_selection_required'], onBool($event))"
              />
              <span>{{ t("canvasUi.sheetRequiredLabel") }}</span>
            </label>

            <div class="cv-field insp-field-sheets">
              <label>
                {{ t("canvasUi.sheetsJsonLabel") }}
                <span class="cv-tag">{{ t("canvasUi.countItems", { n: aAt(['table', 'sheets']).length }) }}</span>
              </label>
              <textarea
                class="cv-textarea insp-json"
                :class="{ 'is-invalid': !!jsonErr(['table', 'sheets']) }"
                spellcheck="false"
                :value="jsonText(['table', 'sheets'])"
                placeholder="[{&quot;id&quot;:&quot;sheet-1&quot;,&quot;name&quot;:&quot;Sheet1&quot;,&quot;rows&quot;:[]}]"
                @input="onJsonInput(['table', 'sheets'], 'array', $event)"
              />
              <p v-if="jsonErr(['table', 'sheets'])" class="insp-json-err">{{ jsonErr(['table', 'sheets']) }}</p>
              <p v-else class="cv-hint">{{ t("canvasUi.sheetsStructHint") }}</p>
            </div>
          </template>

          <!-- script -->
          <template v-else-if="nodeType === 'script'">
            <div class="cv-field insp-field-runphase">
              <label>{{ t("canvasUi.runPhaseLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in RUN_PHASE_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['runPhase'], 'storyboard') === o.value }"
                  @click="setP('runPhase', o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
              <p class="cv-hint">{{ t("canvasUi.runPhaseHint") }}</p>
            </div>
            <div class="cv-field insp-field-prompt insp-prompt">
              <label>{{ t("canvasUi.promptLabel2") }}</label>
              <textarea
                class="cv-textarea insp-prompt"
                :value="sAt(['prompt'])"
                :placeholder="t('canvasUi.scriptPromptPlaceholder')"
                @input="setP('prompt', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-sourcetext">
              <label>{{ t("canvasUi.sourceTextLabel") }}</label>
              <textarea
                class="cv-textarea"
                :value="sAt(['sourceText'])"
                :placeholder="t('canvasUi.sourceTextPlaceholder')"
                @input="setP('sourceText', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.modelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-shotcount">
              <label>{{ t("canvasUi.shotCountLabel") }}</label>
              <input
                class="cv-input"
                type="number"
                min="1"
                step="1"
                :value="nAt(['shotCount'], 3)"
                @input="setP('shotCount', clampInt(onNum($event), 1))"
              />
            </div>

            <!-- 文本类派生：剧本优化 / 拆解分镜（按次计价，金额由后台价目表决定） -->
            <section class="cv-section insp-sec-derive">
              <div class="cv-section__head">
                <span>{{ t("canvasUi.textDeriveHead") }}</span>
                <span class="cv-tag">{{ t("canvasUi.perRunPricing") }}</span>
              </div>
              <div class="insp-derive-row">
                <Button
                  size="sm"
                  variant="secondary"
                  class="insp-derive-optimize"
                  :disabled="deriveSubmitting"
                  :loading="deriveSubmitting"
                  @click="doDerive('script_optimization')"
                >
                  {{ t("canvasUi.deriveOptimize") }}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  class="insp-derive-storyboard"
                  :disabled="deriveSubmitting"
                  @click="doDerive('storyboard_parse')"
                >
                  {{ t("canvasUi.deriveStoryboard") }}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  class="insp-derive-assets"
                  :disabled="deriveSubmitting"
                  @click="doDerive('asset_extraction')"
                >
                  {{ t("canvasUi.deriveAssets") }}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  class="insp-derive-match"
                  :disabled="deriveSubmitting"
                  @click="doMatchAssets"
                >
                  {{ t("canvasUi.deriveMatch") }}
                </Button>
              </div>
              <p class="cv-hint">
                {{ t("canvasUi.deriveHint") }}
              </p>
              <div v-if="sAt(['result_text'])" class="cv-field insp-field-resulttext">
                <label>
                  {{ t("canvasUi.deriveResultLabel") }}
                  <span class="cv-tag">{{ t("canvasUi.lineCount", { n: sAt(["result_text"]).split("\n").length }) }}</span>
                </label>
                <textarea class="cv-textarea insp-result-text" readonly :value="sAt(['result_text'])" />
              </div>
              <div v-if="assetCandidates.length" class="cv-field insp-asset-candidates">
                <label>
                  {{ t("canvasUi.assetCandidatesLabel") }}
                  <span class="cv-tag">{{ t("canvasUi.countItems", { n: assetCandidates.length }) }}</span>
                </label>
                <ul class="insp-assets__list">
                  <li v-for="(a, i) in assetCandidates" :key="i" class="insp-assets__item">
                    <span class="cv-tag">{{ assetKindLabel(a.kind) }}</span>
                    <span class="insp-assets__name">{{ a.name }}</span>
                  </li>
                </ul>
                <Button class="insp-assets__create" size="sm" block @click="createAssetNodes">
                  {{ t("canvasUi.createAssetsN", { n: assetCandidates.length }) }}
                </Button>
                <p class="cv-hint">{{ t("canvasUi.createAssetsHint") }}</p>
              </div>
              <div v-if="matchRows.length" class="cv-field insp-match-result">
                <label>
                  {{ t("canvasUi.matchResultLabel") }}
                  <span class="cv-tag">{{ t("canvasUi.shotCountTag", { n: matchRows.length }) }}</span>
                </label>
                <ul class="insp-match__list">
                  <li v-for="(row, i) in matchRows" :key="i" class="insp-match__item">
                    <span class="insp-match__shot">{{ t("canvasUi.shotShort", { n: row.shot_no }) }}</span>
                    <span class="insp-match__cell">{{ row.character || "—" }}</span>
                    <span class="insp-match__cell">{{ row.scene || "—" }}</span>
                    <span class="insp-match__props">{{ row.props.join("、") || "—" }}</span>
                  </li>
                </ul>
              </div>
              <p v-else-if="ed.selectedNode.value?.status === 2" class="cv-hint insp-derive-running">
                {{ t("canvasUi.runningEllipsis") }}
              </p>
            </section>

            <button class="insp-sec-toggle" type="button" @click="toggleSec('adv')">
              <CanvasIcon :name="secOpen.adv ? 'chevron-down' : 'chevron-right'" :size="13" />
              <span>{{ t("canvasUi.advancedJsonHead") }}</span>
            </button>
            <div v-if="secOpen.adv" class="insp-adv">
              <div class="cv-field insp-field-columns">
                <label>{{ t("canvasUi.columnsJsonLabel") }}</label>
                <textarea
                  class="cv-textarea insp-json"
                  :class="{ 'is-invalid': !!jsonErr(['columns']) }"
                  spellcheck="false"
                  :value="jsonText(['columns'])"
                  placeholder="[]"
                  @input="onJsonInput(['columns'], 'array', $event)"
                />
                <p v-if="jsonErr(['columns'])" class="insp-json-err">{{ jsonErr(['columns']) }}</p>
                <p v-else class="cv-hint">{{ t("canvasUi.columnsStructHint") }}</p>
              </div>
              <div class="cv-field insp-field-spawnconfig">
                <label>{{ t("canvasUi.spawnConfigLabel") }}</label>
                <textarea
                  class="cv-textarea insp-json"
                  :class="{ 'is-invalid': !!jsonErr(['spawnConfig']) }"
                  spellcheck="false"
                  :value="jsonText(['spawnConfig'])"
                  placeholder="{}"
                  @input="onJsonInput(['spawnConfig'], 'object', $event)"
                />
                <p v-if="jsonErr(['spawnConfig'])" class="insp-json-err">{{ jsonErr(['spawnConfig']) }}</p>
              </div>
              <div class="cv-field insp-field-upstreamrefs">
                <label>{{ t("canvasUi.upstreamRefsLabel") }}</label>
                <textarea
                  class="cv-textarea insp-json"
                  :class="{ 'is-invalid': !!jsonErr(['upstreamRefs']) }"
                  spellcheck="false"
                  :value="jsonText(['upstreamRefs'])"
                  placeholder="[]"
                  @input="onJsonInput(['upstreamRefs'], 'array', $event)"
                />
                <p v-if="jsonErr(['upstreamRefs'])" class="insp-json-err">{{ jsonErr(['upstreamRefs']) }}</p>
              </div>
            </div>
          </template>

          <!-- asset -->
          <template v-else-if="nodeType === 'asset'">
            <div class="cv-field insp-field-activetab">
              <label>{{ t("canvasUi.assetTabLabel2") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in ACTIVE_TAB_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['activeTab'], 'character') === o.value }"
                  @click="setP('activeTab', o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="cv-field insp-field-sourcetext">
              <label>{{ t("canvasUi.sourceTextLabel") }}</label>
              <textarea
                class="cv-textarea"
                :value="sAt(['sourceText'])"
                :placeholder="t('canvasUi.assetSourceTextPlaceholder')"
                @input="setP('sourceText', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-model">
              <label>{{ t("canvasUi.modelLabel2") }}</label>
              <input
                class="cv-input insp-model"
                :value="sAt(['model'])"
                :placeholder="t('canvasUi.modelPlaceholder')"
                @input="setP('model', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-extractcredits">
              <label>{{ t("canvasUi.extractCreditsLabel") }}</label>
              <input
                class="cv-input"
                type="number"
                min="0"
                step="1"
                :value="nAt(['extractCredits'], 0)"
                @input="setP('extractCredits', clampInt(onNum($event), 0))"
              />
              <p class="cv-hint">{{ t("canvasUi.extractCreditsHint") }}</p>
            </div>

            <button class="insp-sec-toggle" type="button" @click="toggleSec('adv')">
              <CanvasIcon :name="secOpen.adv ? 'chevron-down' : 'chevron-right'" :size="13" />
              <span>{{ t("canvasUi.advancedJsonHead") }}</span>
            </button>
            <div v-if="secOpen.adv" class="insp-adv">
              <div class="cv-field insp-field-spawnconfig">
                <label>{{ t("canvasUi.spawnConfigLabel") }}</label>
                <textarea
                  class="cv-textarea insp-json"
                  :class="{ 'is-invalid': !!jsonErr(['spawnConfig']) }"
                  spellcheck="false"
                  :value="jsonText(['spawnConfig'])"
                  placeholder="{}"
                  @input="onJsonInput(['spawnConfig'], 'object', $event)"
                />
                <p v-if="jsonErr(['spawnConfig'])" class="insp-json-err">{{ jsonErr(['spawnConfig']) }}</p>
              </div>
              <div class="cv-field insp-field-upstreamrefs">
                <label>{{ t("canvasUi.upstreamRefsLabel") }}</label>
                <textarea
                  class="cv-textarea insp-json"
                  :class="{ 'is-invalid': !!jsonErr(['upstreamRefs']) }"
                  spellcheck="false"
                  :value="jsonText(['upstreamRefs'])"
                  placeholder="[]"
                  @input="onJsonInput(['upstreamRefs'], 'array', $event)"
                />
                <p v-if="jsonErr(['upstreamRefs'])" class="insp-json-err">{{ jsonErr(['upstreamRefs']) }}</p>
              </div>
            </div>
          </template>

          <!-- clip -->
          <template v-else-if="nodeType === 'clip'">
            <div class="cv-field insp-field-shotorder">
              <label>
                {{ t("canvasUi.shotOrderLabel") }}
                <span class="cv-tag">{{ t("canvasUi.countItems", { n: idListOf('shotOrder').length }) }}</span>
              </label>
              <div v-if="otherNodes.length === 0" class="cv-hint">{{ t("canvasUi.noOtherNodesForClip") }}</div>
              <div v-else class="insp-check-list insp-check-list--tall">
                <label v-for="nd in otherNodes" :key="nd.id" class="insp-check">
                  <input
                    type="checkbox"
                    :checked="idListOf('shotOrder').includes(nd.id)"
                    @change="toggleIdInParam('shotOrder', nd.id, onBool($event))"
                  />
                  <span class="insp-check__name">{{ nd.name || t("canvasUi.inspUnnamed") }}</span>
                  <span class="cv-tag">{{ typeLabelOf(nd.node_type) }}</span>
                  <span v-if="idListOf('shotOrder').includes(nd.id)" class="insp-check__order">
                    #{{ idListOf('shotOrder').indexOf(nd.id) + 1 }}
                  </span>
                </label>
              </div>
              <p class="cv-hint">{{ t("canvasUi.shotOrderHint") }}</p>
            </div>

            <div class="insp-subhead">exportSettings</div>
            <div class="cv-field insp-field-exporttarget">
              <label>{{ t("canvasUi.exportTargetLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in EXPORT_TARGET_OPTS"
                  :key="o.value"
                  type="button"
                  :title="o.value"
                  :class="{ 'is-active': sAt(['exportSettings', 'exportTarget'], 'canvas') === o.value }"
                  @click="setPP(['exportSettings', 'exportTarget'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="cv-field insp-field-exportres">
              <label>{{ t("canvasUi.resolutionShortLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in CLIP_RES_OPTS"
                  :key="o.value"
                  type="button"
                  :class="{ 'is-active': sAt(['exportSettings', 'resolution'], '720p') === o.value }"
                  @click="setPP(['exportSettings', 'resolution'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>
            <div class="cv-field insp-field-exportformat">
              <label>{{ t("canvasUi.formatLabel") }}</label>
              <div class="cv-seg insp-seg">
                <button
                  v-for="o in EXPORT_FORMAT_OPTS"
                  :key="o.value"
                  type="button"
                  :class="{ 'is-active': sAt(['exportSettings', 'format'], 'mp4') === o.value }"
                  @click="setPP(['exportSettings', 'format'], o.value)"
                >
                  {{ o.label }}
                </button>
              </div>
            </div>

            <div class="cv-field insp-field-timeline">
              <label>{{ t("canvasUi.timelineLabel") }}</label>
              <textarea
                class="cv-textarea insp-json insp-json--tall"
                :class="{ 'is-invalid': !!jsonErr(['timeline']) }"
                spellcheck="false"
                :value="jsonText(['timeline'])"
                placeholder="{}"
                @input="onJsonInput(['timeline'], 'object', $event)"
              />
              <p v-if="jsonErr(['timeline'])" class="insp-json-err">{{ jsonErr(['timeline']) }}</p>
              <p v-else class="cv-hint">{{ t("canvasUi.timelineHint") }}</p>
            </div>
            <div class="cv-field insp-field-rate">
              <label>{{ t("canvasUi.previewRateLabelB") }}</label>
              <input
                class="cv-input"
                type="number"
                min="0.5"
                step="0.25"
                :value="nAt(['previewPlaybackRate'], 1)"
                @input="setP('previewPlaybackRate', onNum($event))"
              />
            </div>
          </template>

          <!-- director -->
          <template v-else-if="nodeType === 'director'">
            <p class="cv-hint insp-field-director-hint">
              {{ t("canvasUi.directorNoParamsHint") }}
            </p>
            <label class="insp-check insp-field-isreference">
              <input
                type="checkbox"
                :checked="bAt(['isReference'])"
                @change="setP('isReference', onBool($event))"
              />
              <span>{{ t("canvasUi.isReferenceLabel") }}</span>
            </label>
            <div class="cv-field insp-field-referencerole">
              <label>{{ t("canvasUi.referenceRoleLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['referenceRole'])"
                :placeholder="t('canvasUi.referenceRolePlaceholder')"
                @input="setP('referenceRole', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-referencelabel">
              <label>{{ t("canvasUi.referenceLabelLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['referenceLabel'])"
                :placeholder="t('canvasUi.referenceLabelPlaceholder')"
                @input="setP('referenceLabel', onText($event))"
              />
            </div>
          </template>

          <!-- group -->
          <template v-else-if="nodeType === 'group'">
            <div class="cv-field insp-field-title">
              <label>{{ t("canvasUi.groupTitleLabel") }}</label>
              <input
                class="cv-input"
                :value="sAt(['title'])"
                :placeholder="t('canvasUi.groupTitlePlaceholder')"
                @input="setP('title', onText($event))"
              />
            </div>
            <div class="cv-field insp-field-color">
              <label>{{ t("canvasUi.colorLabel") }}</label>
              <div class="insp-color">
                <span class="insp-color__swatch" :style="{ background: sAt(['color'], 'transparent') }" />
                <input
                  class="cv-input"
                  :value="sAt(['color'])"
                  placeholder="#6C5CE7"
                  @input="setP('color', onText($event))"
                />
              </div>
            </div>
            <div class="cv-field insp-field-childnodes">
              <label>
                {{ t("canvasUi.childNodesLabel") }}
                <span class="cv-tag">{{ t("canvasUi.countItems", { n: idListOf('childNodeIds').length }) }}</span>
              </label>
              <div v-if="otherNodes.length === 0" class="cv-hint">{{ t("canvasUi.noOtherNodesForGroup") }}</div>
              <div v-else class="insp-check-list insp-check-list--tall">
                <label v-for="nd in otherNodes" :key="nd.id" class="insp-check">
                  <input
                    type="checkbox"
                    :checked="idListOf('childNodeIds').includes(nd.id)"
                    @change="toggleIdInParam('childNodeIds', nd.id, onBool($event))"
                  />
                  <span class="insp-check__name">{{ nd.name || t("canvasUi.inspUnnamed") }}</span>
                  <span class="cv-tag">{{ typeLabelOf(nd.node_type) }}</span>
                </label>
              </div>
            </div>
            <div class="insp-row">
              <div class="cv-field insp-field-gw">
                <label>{{ t("canvasUi.groupWidthLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  step="10"
                  :value="nAt(['width'], 0)"
                  @input="setP('width', clampInt(onNum($event), 0))"
                />
              </div>
              <div class="cv-field insp-field-gh">
                <label>{{ t("canvasUi.groupHeightLabel") }}</label>
                <input
                  class="cv-input"
                  type="number"
                  step="10"
                  :value="nAt(['height'], 0)"
                  @input="setP('height', clampInt(onNum($event), 0))"
                />
              </div>
            </div>
            <p class="cv-hint">{{ t("canvasUi.groupSizeHint") }}</p>
            <label class="insp-check insp-field-collapsed">
              <input
                type="checkbox"
                :checked="bAt(['collapsed'])"
                @change="setP('collapsed', onBool($event))"
              />
              <span>{{ t("canvasUi.collapsedLabel") }}</span>
            </label>
            <label class="insp-check insp-field-locked">
              <input type="checkbox" :checked="bAt(['locked'])" @change="setP('locked', onBool($event))" />
              <span>{{ t("canvasUi.lockedLabel") }}</span>
            </label>
            <div class="cv-field insp-field-servergroupid">
              <label>{{ t("canvasUi.serverGroupIdLabel") }}</label>
              <input class="cv-input" :value="sAt(['serverGroupId'])" readonly :placeholder="t('canvasUi.serverGroupIdPlaceholder')" />
            </div>
          </template>

          <!-- 未知类型兜底：node_type 是 string，后端加新类型时不能让面板崩 -->
          <template v-else>
            <p class="cv-hint insp-field-unknown">
              {{ t("canvasUi.unknownTypeA", { type: nodeType || t("canvasUi.unknownTypeEmpty") }) }}
              {{ t("canvasUi.unknownTypeB") }}
            </p>
          </template>
        </section>

        <!-- 连线区 -->
        <section v-if="nodeEdges.length > 0" class="cv-section insp-sec-edges">
          <button class="cv-section__head insp-sec-toggle insp-sec-toggle--head" type="button" @click="toggleSec('edges')">
            <span>{{ t("canvasUi.edgesHead", { n: nodeEdges.length }) }}</span>
            <CanvasIcon :name="secOpen.edges ? 'chevron-down' : 'chevron-right'" :size="13" />
          </button>
          <ul v-if="secOpen.edges" class="insp-edges">
            <li v-for="e in nodeEdges" :key="e.id" class="insp-edge">
              <span class="insp-edge__dir" :class="edgeIsOut(e) ? 'is-out' : 'is-in'">
                {{ edgeIsOut(e) ? t("canvasUi.edgeOut") : t("canvasUi.edgeIn") }}
              </span>
              <span class="insp-edge__name" :title="edgePeerName(e)">{{ edgePeerName(e) }}</span>
              <span class="cv-tag">{{ e.semantic }}</span>
              <button class="insp-edge__del" type="button" :aria-label="t('canvasUi.deleteEdgeAria')" @click="removeEdge(e.id)">
                 {{ t("canvasUi.deleteShort") }}
              </button>
            </li>
          </ul>
          <p v-if="secOpen.edges" class="cv-hint">{{ t("canvasUi.edgesHint") }}</p>
        </section>
      </div>

      <!-- 底部操作 -->
      <footer class="insp-foot">
        <!--
          投递区：画布的价值就在"节点能出片"。
          放在底部操作之上而不是塞进各类型的参数面板里——所有可生成类型
          （image/video/audio/3D）都需要它，塞进各自面板会重复 4 遍，
          且用户换类型后按钮位置会跳。
        -->
        <section v-if="canGenerate" class="cv-section insp-sec-generate">
          <div class="cv-section__head">
            <span>{{ t("canvasUi.genHead") }}</span>
            <span v-if="nodeStatus() === 2" class="cv-tag cv-tag--brand insp-gen-running">{{ t("canvasUi.nodeGenerating") }}</span>
            <span v-else-if="nodeStatus() === 3" class="cv-tag cv-tag--success">{{ t("canvasUi.nodeDone") }}</span>
          </div>

          <!-- 缺 mode/model 时给出明确指引，而不是让按钮"点了没反应" -->
          <p v-if="!genMode()" class="cv-hint insp-gen-need-mode">{{ t("canvasUi.needMode") }}</p>
          <p v-else-if="!genModel()" class="cv-hint insp-gen-need-model">{{ t("canvasUi.needModel") }}</p>

          <!-- 上一次失败的错误：带错误码，便于对照文档排查 -->
          <p v-if="lastError()" class="cv-hint insp-gen-error">{{ t("canvasUi.lastFailed", { msg: lastErrorText() }) }}</p>

          <!-- 结果预览：有 result_uri 就显示，让用户确认"这张就是刚生成的" -->
          <div v-if="resultUri()" class="insp-gen-result">
            <img v-if="isImageResult()" :src="resultUri()!" :alt="selectedNode?.name ?? t('canvasUi.resultAlt')" loading="lazy" />
            <video v-else :src="resultUri()!" controls preload="metadata" />
            <p class="cv-hint">{{ t("canvasUi.lastResult") }}</p>
            <!-- 第 62 批：竞品封面是用户指定的 file_id，画布产物天然就是候选图 -->
            <Button
              v-if="isImageResult()"
              size="sm"
              variant="ghost"
              block
              class="insp-set-cover"
              :disabled="isLocalNode() || !selectedNode?.id"
              @click="emit('set-cover', selectedNode?.id ?? '')"
            >
              {{ t("canvasUi.setAsCover") }}
            </Button>
          </div>

          <Button
            size="sm"
            block
            class="insp-generate"
            :loading="ed.isSubmitting(selectedNode?.id ?? '')"
            :disabled="!genMode() || !genModel() || nodeStatus() === 2 || isLocalNode()"
            @click="doGenerate"
          >
            {{ nodeStatus() === 2 ? t("canvasUi.nodeGenerating") : t("canvasUi.genHead") }}
          </Button>
          <p v-if="isLocalNode()" class="cv-hint insp-gen-local">
            {{ t("canvasUi.unsavedCannotSubmit") }}
          </p>
        </section>

        <div class="insp-foot__row">
          <Button
            variant="ghost"
            size="sm"
            class="insp-connect"
            :class="{ 'is-on': mode === 'connect' }"
            @click="toggleConnect"
          >
            {{ mode === "connect" ? t("canvasUi.exitConnect") : t("canvasUi.connectModeShort") }}
          </Button>
          <Button variant="ghost" size="sm" class="insp-pin" :class="{ 'is-on': isPinned() }" @click="togglePin">
            {{ isPinned() ? t("canvasUi.pinnedState") : t("canvasUi.pinAction") }}
          </Button>
          <Button variant="ghost" size="sm" class="insp-duplicate" @click="duplicateOne">{{ t("canvasUi.duplicate") }}</Button>
        </div>
        <Button variant="danger" size="sm" block class="insp-delete" @click="deleteOne">{{ t("canvasUi.deleteNodeBtn") }}</Button>
        <p class="cv-hint insp-foot__hint">{{ t("canvasUi.deleteLocalHint") }}</p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
/* 面板本身：竖向三段（头部固定 / 内容滚动 / 底部固定）。
   宽度交给父级（aside 已是目标宽度），这里只占满，避免拖拽时出现 1px 错位。 */
.canvas-inspector {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--cv-panel-bg, var(--bg-surface));
  color: var(--text-1);
  font-size: 12px;
}

/* ── 头部 ───────────────────────────────────────────── */
.insp-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--cv-panel-border, var(--border-1));
  flex: none;
}
.insp-head__icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-md);
  background: var(--bg-hover);
  flex: none;
}
.insp-head__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.insp-head__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-head__sub {
  font-size: 11px;
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-close {
  flex: none;
  width: 26px;
  height: 26px;
}

/* ── 内容区 ─────────────────────────────────────────── */
.insp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-3);
}
.insp-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4);
  text-align: center;
}
.insp-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

/* 两列字段：窄面板下改单列，否则输入框窄到看不清数字 */
.insp-row {
  display: flex;
  gap: var(--space-2);
}
.insp-row > .cv-field {
  flex: 1;
  min-width: 0;
}
.is-compact .insp-row {
  flex-direction: column;
  gap: 0;
}

.insp-subhead {
  margin: var(--space-2) 0 var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--cv-panel-border, var(--border-1));
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 0.04em;
  text-transform: none;
}
/* 每组第一块不要顶部边距/分隔线：.cv-section 自带 border-top，直接叠在头部下会多一条线 */
.insp-sec--first {
  border-top: 0;
  margin-top: 0;
  padding-top: 0;
}
.insp-type-hint {
  max-width: 60%;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 长枚举（image 16 种 / video 13 种 mode）分段控件给固定高度内滚动，
   否则单这一块就把整个面板推得很长，下面的 prompt 输入框要滚半天才看到 */
.insp-seg--scroll {
  max-height: 104px;
  overflow-y: auto;
  padding-right: 2px;
}

/* ── 勾选行 ─────────────────────────────────────────── */
.insp-check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 3px 0;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}
.insp-check input {
  width: 13px;
  height: 13px;
  accent-color: var(--brand-500);
  cursor: pointer;
  flex: none;
}
.insp-check__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-check__order {
  margin-left: auto;
  font-size: 10px;
  color: var(--brand-on-soft);
  flex: none;
}
.insp-check-list {
  display: flex;
  flex-direction: column;
  max-height: 132px;
  overflow-y: auto;
  padding: 2px 0;
}
.insp-check-list--tall {
  max-height: 200px;
}

/* ── JSON 文本域 ────────────────────────────────────── */
.insp-json {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  min-height: 88px;
  tab-size: 2;
}
.insp-json--tall {
  min-height: 140px;
}
/* 非法态只换边框色，不换底色：整块变红会让面板看起来很吵 */
.insp-json.is-invalid {
  border-color: var(--danger);
}
.insp-json-err {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--danger);
  word-break: break-word;
}

/* ── 折叠按钮 ───────────────────────────────────────── */
.insp-sec-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: var(--space-2) 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
}
.insp-sec-toggle:hover {
  color: var(--text-1);
}
.insp-sec-toggle--head {
  width: 100%;
  justify-content: space-between;
  margin: 0 0 var(--space-2);
  font-size: 11px;
}
.insp-adv {
  padding-left: var(--space-2);
  border-left: 1px solid var(--cv-panel-border, var(--border-1));
}

/* ── 连线列表 ───────────────────────────────────────── */
.insp-edges {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.insp-edge {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 3px 0;
  font-size: 12px;
}
.insp-edge__dir {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  font-size: 10px;
}
.insp-edge__dir.is-out {
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}
.insp-edge__dir.is-in {
  background: var(--bg-active);
  color: var(--text-2);
}
.insp-edge__name {
  flex: 1;
  min-width: 0;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-edge__del {
  flex: none;
  border: 0;
  background: transparent;
  padding: 0 2px;
  color: var(--text-4);
  font-size: 11px;
  cursor: pointer;
}
.insp-edge__del:hover {
  color: var(--danger);
}

/* ── 底部操作 ───────────────────────────────────────── */
.insp-foot {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-top: 1px solid var(--cv-panel-border, var(--border-1));
}
.insp-foot__row {
  display: flex;
  gap: var(--space-2);
}
.insp-foot__row > * {
  flex: 1;
  min-width: 0;
}
/* 连线/钉住是"开关"语义，激活态必须能一眼看出来，否则用户不知道自己在连线模式里 */
.insp-foot :deep(.btn.is-on) {
  border-color: var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}
.insp-foot__hint {
  text-align: center;
}

/* ── 概览 ───────────────────────────────────────────── */
.insp-ov-hero {
  padding-bottom: var(--space-3);
}
.insp-ov-title {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}
.insp-ov-stats {
  display: flex;
  gap: var(--space-2);
}
.insp-ov-stat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: var(--space-2) 0;
  border: 1px solid var(--cv-panel-border, var(--border-1));
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
}
.insp-ov-stat__num {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.2;
}
.insp-ov-stat__label {
  font-size: 10px;
  color: var(--text-4);
}
.insp-ov-pinned {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
}
.insp-typecount {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.insp-typecount__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-2);
}
.insp-typecount__num {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.insp-tips {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}
.insp-tips kbd {
  display: inline-block;
  padding: 0 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
}

/* ── 多选 ───────────────────────────────────────────── */
.insp-name-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 132px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.insp-name-list__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  color: var(--text-2);
}
.insp-name-list__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--brand-400);
  flex: none;
}
.insp-name-list__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-align-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}
.is-compact .insp-align-grid {
  grid-template-columns: repeat(2, 1fr);
}
/* 小号动作按钮：cv-glass-btn 是 32x32 的纯图标尺寸，文字按钮需要自己给内边距 */
.insp-act {
  padding: 5px 6px;
  border: 1px solid var(--cv-panel-border, var(--border-1));
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.insp-act:hover {
  border-color: var(--text-4);
  color: var(--text-1);
}

/* ── 杂项 ───────────────────────────────────────────── */
.insp-color {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* 色块颜色来自节点数据（用户填的 hex），不是设计令牌，所以走内联 style */
.insp-color__swatch {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-2);
  flex: none;
}
.insp-id {
  color: var(--text-4);
  font-family: var(--font-mono);
  font-size: 10px;
  cursor: text;
}
/* 表格 Excel 导入：file input 无法可靠定制样式，隐藏后用按钮代理点击 */
.insp-hidden-file {
  display: none;
}
.insp-sheets {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.insp-sheets__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.insp-sheets__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
}
.insp-sheets__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.insp-sheets__meta {
  color: var(--text-4);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 拆分资产的候选列表：一行一个，名字过长省略（资产名可能很长） */
.insp-assets__list {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}
.insp-assets__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
}
.insp-assets__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.insp-derive-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
/* 匹配结果：镜号 + 角色 + 场景 + 道具，一行一镜（等宽数字便于纵向扫读） */
.insp-match__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 180px;
  overflow-y: auto;
}
.insp-match__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: var(--radius-md);
  background: var(--bg-2);
  font-size: 11px;
}
.insp-match__shot {
  flex: none;
  width: 38px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.insp-match__cell {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-match__props {
  flex: 1;
  min-width: 0;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-result-text {
  min-height: 120px;
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
