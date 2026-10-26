<script setup lang="ts">
import type { CanvasEdgeDto, CanvasListItem, CanvasNodeDto, CanvasNodeType } from "~/types/canvas";
import { CANVAS_ERR, NODE_TYPE_META } from "~/types/canvas";
import { ApiError } from "~/composables/useApi";

/**
 * 画布列表页
 *
 * 为什么用 blank 裸壳：画布族（列表 + 编辑器）是全屏应用界面，参照站 /canvas
 * 同样无侧栏（reference-alignment-spec §1.1 注）。套 app 壳会让编辑器少掉
 * 240px 侧栏 + 64px 顶栏的可用区，列表页还会出现两层顶栏。
 * 代价是 blank 不带任何 chrome，所以这里自建一条轻量顶部条（返回 + 品牌 + 新建）。
 *
 * 缩略图取舍：列表接口不返回节点数，唯一真实来源是 detail 接口。
 * 全量拉会变成 N+1（一页 24 张 = 24 个请求），所以只给**前 12 张**并发拉，
 * 分 2 批各 6 个避免瞬时打满连接；失败的单张静默降级成"空画布"示意，
 * 绝不让装饰性数据拖垮列表可用性。宁可少画，也不放占位假图。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });
useHead({ title: "无限画布 · 一帧" });

const api = useCanvasApi();
const toast = useToast();

const PAGE_SIZE = 24;
/** 缩略图最多拉多少张 detail（超过这个数就只显示版本/时间，不显示节点示意） */
const THUMB_MAX = 12;
/** 每批并发数：一次 12 个并发在弱网下会互相拖慢，分批还能让先到的先渲染 */
const THUMB_WAVE = 6;
/** 缩略图里最多画多少个节点：SVG 塞满上百个方块既慢又糊，取前 24 个足够表达布局 */
const MAX_THUMB_NODES = 24;

/** detail 的裁剪视图：缩略图只需要节点坐标/尺寸/类型与连线两端 */
interface ThumbData {
  nodes: CanvasNodeDto[];
  edges: CanvasEdgeDto[];
}

const items = ref<CanvasListItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const creating = ref(false);
const error = ref("");
/** 缩略图数据：id → detail 裁剪；null 表示拉取失败（渲染空画布示意） */
const thumbs = ref<Record<string, ThumbData | null>>({});

// ── 载入 ────────────────────────────────────────────────
async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.list(page.value, PAGE_SIZE);
    items.value = data.list ?? [];
    total.value = data.total ?? 0;
    // 列表换了，旧缩略图必须整批丢弃，否则翻页后会把上一页的图错配到新卡片上
    void loadThumbs(items.value);
  } catch (e) {
    error.value = errText(e);
    items.value = [];
    total.value = 0;
    thumbs.value = {};
  } finally {
    loading.value = false;
  }
}

/**
 * 并发拉前 12 张的 detail。
 * 用递增 token 做失效保护：翻页/刷新后旧批次的响应回来必须丢弃，
 * 否则慢请求会把上一页的节点图画到当前页的卡片上。
 */
let thumbToken = 0;
async function loadThumbs(rows: CanvasListItem[]): Promise<void> {
  const token = ++thumbToken;
  thumbs.value = {};
  const targets = rows.slice(0, THUMB_MAX);
  for (let i = 0; i < targets.length; i += THUMB_WAVE) {
    if (token !== thumbToken) return;
    const wave = targets.slice(i, i + THUMB_WAVE);
    await Promise.all(
      wave.map(async (row) => {
        try {
          const detail = await api.detail(row.id);
          if (token !== thumbToken) return;
          thumbs.value[row.id] = { nodes: detail.nodes ?? [], edges: detail.edges ?? [] };
        } catch {
          // 静默降级：单张失败只影响这一张的示意图，列表照常可用
          if (token === thumbToken) thumbs.value[row.id] = null;
        }
      }),
    );
  }
}

// ── 缩略图几何 ──────────────────────────────────────────
interface ThumbNode {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface ThumbEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface ThumbGeo {
  nodes: ThumbNode[];
  edges: ThumbEdge[];
}

const VB_W = 260;
const VB_H = 120;
const PAD = 12;

function nodeColor(type: string): string {
  const meta = NODE_TYPE_META[type as CanvasNodeType];
  // 未知类型（后端新增节点）不应让缩略图报错，退到次要文本色
  return meta ? meta.color : "var(--text-4)";
}

/**
 * 把真实节点坐标投影到缩略图 viewBox。
 * 画布世界坐标可以是负数（无限画布能向四周延伸），所以必须先求包围盒再平移，
 * 不能假设 (0,0) 是左上角。
 */
function buildGeometry(item: CanvasListItem): ThumbGeo | null {
  const data = thumbs.value[item.id];
  if (!data || data.nodes.length === 0) return null;

  const drawn = data.nodes.slice(0, MAX_THUMB_NODES);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of drawn) {
    const w = n.width ?? 200;
    const h = n.height ?? 76;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  // 单节点时包围盒退化成一点，按它缩放会放大到铺满整张缩略图；
  // 给一个最小视野，视觉上才像"画布的一角"而不是一个巨型方块
  const spanW = Math.max(300, maxX - minX);
  const spanH = Math.max(160, maxY - minY);
  const scale = Math.min((VB_W - PAD * 2) / spanW, (VB_H - PAD * 2) / spanH);
  const offsetX = (VB_W - spanW * scale) / 2;
  const offsetY = (VB_H - spanH * scale) / 2;
  const projectX = (wx: number) => offsetX + (wx - minX) * scale;
  const projectY = (wy: number) => offsetY + (wy - minY) * scale;

  const nodes: ThumbNode[] = [];
  const center = new Map<string, { x: number; y: number }>();
  for (const n of drawn) {
    const w = (n.width ?? 200) * scale;
    const h = (n.height ?? 76) * scale;
    const px = projectX(n.x);
    const py = projectY(n.y);
    // 最小 8×6：1/8 缩放下真实宽高比会细成一条线，看不出"这是个节点"
    const rw = Math.max(8, w);
    const rh = Math.max(6, h);
    nodes.push({
      x: px + (w - rw) / 2,
      y: py + (h - rh) / 2,
      w: rw,
      h: rh,
      color: nodeColor(n.node_type),
    });
    center.set(n.id, { x: px + w / 2, y: py + h / 2 });
  }

  const edges: ThumbEdge[] = [];
  for (const e of data.edges) {
    const a = center.get(e.src_node_id);
    const b = center.get(e.dst_node_id);
    // 只画两端都落在已绘制的 24 个节点内的连线，否则线会飞到图外
    if (a && b) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  return { nodes, edges };
}

/** 卡片视图模型：一次算好几何与节点数，避免模板里重复调用函数 */
const cards = computed(() =>
  items.value.map((item) => {
    const data = thumbs.value[item.id];
    return {
      item,
      geo: buildGeometry(item),
      // undefined = 超出 12 张没拉 / null = 拉失败，两者都显示 "—"（不编造数字）
      nodeCount: data ? data.nodes.length : null,
    };
  }),
);

// ── 新建 ────────────────────────────────────────────────
async function createCanvas(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const created = await api.create({ title: "未命名画布" });
    await navigateTo(`/canvas/${created.id}`);
  } catch (e) {
    toast.error(errText(e));
  } finally {
    creating.value = false;
  }
}

function openCanvas(item: CanvasListItem): void {
  void navigateTo(`/canvas/${item.id}`);
}

// ── 重命名（inline）──────────────────────────────────────
const editingId = ref<string | null>(null);
const renameDraft = ref("");
const renameSaving = ref(false);
const renameInput = ref<HTMLInputElement | null>(null);

/**
 * 用函数 ref 而不是字符串 ref：字符串 ref 放在 v-for 内部时 Vue 会收集成数组，
 * 拿到的就不是单个 input，`.select()` 会直接报错。函数 ref 逐次赋值最稳。
 */
function bindRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}

function startRename(item: CanvasListItem): void {
  editingId.value = item.id;
  renameDraft.value = item.title;
  // 输入框是 v-if 渲染的，必须等 DOM 出现后再 focus，否则拿到 null
  void nextTick(() => renameInput.value?.select());
}

function cancelRename(): void {
  editingId.value = null;
  renameDraft.value = "";
}

async function commitRename(item: CanvasListItem): Promise<void> {
  if (editingId.value !== item.id || renameSaving.value) return;
  const title = renameDraft.value.trim();
  if (!title || title === item.title) {
    cancelRename();
    return;
  }
  renameSaving.value = true;
  try {
    // 带当前 version 做乐观锁：服务端版本已推进说明别人先改了
    const res = await api.rename(item.id, { title, version: item.version });
    item.title = title;
    item.version = res.version;
    cancelRename();
    toast.success("已重命名");
  } catch (e) {
    if (e instanceof ApiError && e.code === CANVAS_ERR.VERSION_CONFLICT) {
      toast.error("画布已被他人修改，请刷新");
      // 必须重拉：本地 version 已过期，不刷新会让用户反复提交同一个旧 version
      await load();
    } else {
      toast.error(errText(e));
    }
    cancelRename();
  } finally {
    renameSaving.value = false;
  }
}

// ── 删除（二次确认）──────────────────────────────────────
const pendingDelete = ref<CanvasListItem | null>(null);
const deleting = ref(false);

function askDelete(item: CanvasListItem): void {
  pendingDelete.value = item;
}

async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value;
  if (!target || deleting.value) return;
  deleting.value = true;
  try {
    await api.remove(target.id);
    pendingDelete.value = null;
    items.value = items.value.filter((x) => x.id !== target.id);
    total.value = Math.max(0, total.value - 1);
    // 删掉本页最后一张时回退一页，避免停在空白页
    if (items.value.length === 0 && page.value > 1) {
      page.value -= 1;
      await load();
    } else {
      void loadThumbs(items.value);
    }
    toast.success("画布已删除，可在历史版本中恢复");
  } catch (e) {
    toast.error(errText(e));
  } finally {
    deleting.value = false;
  }
}

// ── 分页 ────────────────────────────────────────────────
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

async function goPage(next: number): Promise<void> {
  if (loading.value || next < 1 || next > pageCount.value || next === page.value) return;
  page.value = next;
  await load();
  // 翻页后回到顶部，否则用户看到的是新一页的中间
  if (import.meta.client) window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── 展示辅助 ────────────────────────────────────────────
function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "加载失败";
}

function modeLabel(mode: number): string {
  // creation_mode：1 = 制片工坊内建画布，2 = 独立无限画布（后端默认 2）
  return mode === 1 ? "制片工坊" : "无限画布";
}

/** 相对时间：列表只需要"多久没动过"的粗粒度判断，精确到分钟即可 */
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

function editedAt(item: CanvasListItem): string | null {
  // last_edited_at 只在该画布真正被编辑过时才有值，新建的空画布要回落到 updated_at
  return item.last_edited_at ?? item.updated_at;
}

onMounted(load);
</script>

<template>
  <div class="canvas-list">
    <!-- blank 裸壳没有顶栏，这里自建一条：返回工作台 + 品牌 + 新建 -->
    <header class="cl-topbar">
      <div class="cl-topbar-left">
        <NuxtLink to="/home" class="cl-back" title="返回工作台">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
          </svg>
          <span>工作台</span>
        </NuxtLink>
        <span class="cl-divider" aria-hidden="true" />
        <span class="cl-brand">
          <span class="cl-brand-mark" aria-hidden="true">一</span>
          <span class="cl-brand-text">一帧 · 无限画布</span>
        </span>
      </div>
      <div class="cl-topbar-right">
        <Button class="canvas-create" :loading="creating" @click="createCanvas">新建画布</Button>
      </div>
    </header>

    <main class="cl-main">
      <!-- 错误态：保留重试入口，不要只给一句红字让用户自己刷新页面 -->
      <div v-if="error" class="cl-error" role="alert">
        <span class="cl-error-text">{{ error }}</span>
        <Button variant="ghost" size="sm" :disabled="loading" @click="load">重试</Button>
      </div>

      <!-- 加载态：卡片骨架，尺寸与真实卡片一致，避免加载完成时页面跳动 -->
      <!-- 骨架故意不用 .canvas-card：那是 E2E 数卡片数量的稳定选择器，
           混进骨架会让"等待加载完成再数卡片"的断言永远对不上。 -->
      <div v-if="loading" class="cl-grid">
        <div v-for="i in 8" :key="i" class="cl-skel-card">
          <div class="cl-skel-thumb" />
          <div class="cl-skel-body">
            <Skeleton :rows="2" />
          </div>
        </div>
      </div>

      <!-- 空态 -->
      <div v-else-if="items.length === 0 && !error" class="cl-empty">
        <EmptyState
          title="还没有画布"
          description="新建一张画布，从拖入一个文本节点开始，把文本 → 图像 → 视频串成一条生成链路。"
        >
          <!-- 空态里的 CTA 不复用 .canvas-create：顶栏那颗才是全页唯一的
               .canvas-create，E2E 用单选择器点击时不会撞上二义性 -->
          <Button class="canvas-create-cta" :loading="creating" @click="createCanvas">新建画布</Button>
        </EmptyState>
      </div>

      <!-- 列表：用 items.length > 0 而不是裸 v-else ——
           出错时 items 已被清空，裸 v-else 会渲染一个空网格占位。 -->
      <div v-else-if="items.length > 0" class="cl-grid">
        <article
          v-for="card in cards"
          :key="card.item.id"
          class="canvas-card"
          :class="{ 'is-editing': editingId === card.item.id }"
        >
          <!-- 缩略图：用真实节点坐标画，没有数据时退化成"空画布"示意（不是假图） -->
          <div class="cl-thumb">
            <!-- 打开热区是独立的按钮层，铺在 SVG 之上：
                 如果把 role="button" 直接套在缩略图容器上、再把操作条塞进去，
                 就变成"按钮里嵌按钮"，键盘 Enter 会先命中外层、误开画布。 -->
            <button
              type="button"
              class="cl-thumb-hit"
              :aria-label="`打开画布 ${card.item.title}`"
              @click="openCanvas(card.item)"
            />
            <svg class="cl-thumb-svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" aria-hidden="true">
              <template v-if="card.geo">
                <line
                  v-for="(e, ei) in card.geo.edges"
                  :key="`e${ei}`"
                  class="cl-thumb-edge"
                  :x1="e.x1"
                  :y1="e.y1"
                  :x2="e.x2"
                  :y2="e.y2"
                />
                <rect
                  v-for="(n, ni) in card.geo.nodes"
                  :key="`n${ni}`"
                  class="cl-thumb-node"
                  :x="n.x"
                  :y="n.y"
                  :width="n.w"
                  :height="n.h"
                  rx="2"
                  :style="{ fill: n.color }"
                />
              </template>
              <template v-else>
                <rect class="cl-thumb-blank" x="18" y="18" :width="VB_W - 36" :height="VB_H - 36" rx="6" />
                <path class="cl-thumb-plus" :d="`M${VB_W / 2 - 6} ${VB_H / 2}h12M${VB_W / 2} ${VB_H / 2 - 6}v12`" />
              </template>
            </svg>

            <span class="cl-thumb-ver">v{{ card.item.version }}</span>
            <span class="cl-thumb-mode">{{ modeLabel(card.item.creation_mode) }}</span>

            <!-- hover 才出现的操作条：常驻会把缩略图盖掉，也更容易误触 -->
            <div class="cl-actions">
              <button type="button" class="cl-act" title="打开" @click.stop="openCanvas(card.item)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 4h6v6" />
                  <path d="M20 4 10 14" />
                  <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
                </svg>
              </button>
              <button type="button" class="cl-act" title="重命名" @click.stop="startRename(card.item)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
                </svg>
              </button>
              <button type="button" class="cl-act is-danger" title="删除" @click.stop="askDelete(card.item)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4.5 6.5h15M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
                  <path d="M6.5 6.5 7.5 19a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12.5" />
                </svg>
              </button>
            </div>
          </div>

          <div class="cl-body">
            <input
              v-if="editingId === card.item.id"
              :ref="bindRenameInput"
              v-model="renameDraft"
              class="canvas-rename-input"
              type="text"
              maxlength="80"
              :disabled="renameSaving"
              @click.stop
              @keydown.enter.prevent="commitRename(card.item)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(card.item)"
            />
            <h3
              v-else
              class="canvas-card-title"
              :title="card.item.title"
              @click="openCanvas(card.item)"
            >
              {{ card.item.title }}
            </h3>
            <p class="cl-meta">
              <span class="cl-meta-item">v{{ card.item.version }}</span>
              <span class="cl-dot" aria-hidden="true">·</span>
              <span class="cl-meta-item">{{ card.nodeCount === null ? "—" : `${card.nodeCount} 个节点` }}</span>
              <span class="cl-dot" aria-hidden="true">·</span>
              <span class="cl-meta-item" :title="editedAt(card.item) ?? ''">编辑于 {{ relativeTime(editedAt(card.item)) }}</span>
            </p>
          </div>
        </article>
      </div>

      <!-- 分页：只有一页时隐藏，避免给用户"还有更多"的错觉 -->
      <nav v-if="!loading && !error && total > PAGE_SIZE" class="cl-pager">
        <Button variant="ghost" size="sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</Button>
        <span class="cl-pager-text">{{ page }} / {{ pageCount }}</span>
        <Button variant="ghost" size="sm" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</Button>
      </nav>
    </main>

    <!-- 删除二次确认：用项目里的 Modal，文案必须说清"可恢复"再让用户点删除 -->
    <Modal
      :open="pendingDelete !== null"
      title="删除画布"
      width="420px"
      @close="pendingDelete = null"
    >
      <p class="cl-confirm-text">
        确定删除画布「{{ pendingDelete?.title }}」吗？删除后它会从列表中移除，节点一并释放。
      </p>
      <p class="cl-confirm-hint">删除是软删除：服务端保留记录与历史快照，之后仍可从历史版本恢复。</p>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="deleting" @click="pendingDelete = null">取消</Button>
        <Button variant="danger" size="sm" :loading="deleting" @click="confirmDelete">删除</Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.canvas-list {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text-1);
}

/* ── 顶部条 ─────────────────────────────────────────── */
.cl-topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: 56px;
  padding: 0 var(--space-6);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-1);
}
.cl-topbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.cl-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  color: var(--text-2);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.cl-back svg {
  width: 16px;
  height: 16px;
}
.cl-back:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.cl-divider {
  width: 1px;
  height: 16px;
  background: var(--border-2);
}
.cl-brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.cl-brand-mark {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
  color: var(--text-inverse-2);
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.cl-brand-text {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 主体 ───────────────────────────────────────────── */
.cl-main {
  flex: 1;
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.cl-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-sm);
}
.cl-error-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.cl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}

.cl-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-16) 0;
}

/* ── 卡片 ───────────────────────────────────────────── */
.canvas-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  overflow: hidden;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
.canvas-card:hover,
.canvas-card:focus-within {
  border-color: var(--border-3);
  transform: translateY(-2px);
}
.canvas-card.is-editing {
  border-color: var(--brand-border);
}

.cl-thumb {
  position: relative;
  aspect-ratio: 13 / 6;
  background: var(--bg-sunken);
  overflow: hidden;
}
/* 打开热区：铺满缩略图的透明按钮，位于 SVG 之上、角标与操作条之下。
   用真实 <button> 而不是 role="button"，原生就能被 Tab 聚焦、被 Enter/Space 触发。 */
.cl-thumb-hit {
  position: absolute;
  inset: 0;
  z-index: 1;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.cl-thumb-hit:focus-visible {
  outline: 2px solid var(--brand-500);
  outline-offset: -2px;
}
.cl-thumb-svg {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.cl-thumb-edge {
  stroke: var(--border-3);
  stroke-width: 1;
}
.cl-thumb-node {
  opacity: 0.9;
}
.cl-thumb-blank {
  fill: none;
  stroke: var(--border-2);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.cl-thumb-plus {
  stroke: var(--text-4);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.cl-thumb-ver,
.cl-thumb-mode {
  position: absolute;
  z-index: 2;
  top: var(--space-2);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: 11px;
  line-height: 16px;
  pointer-events: none;
}
.cl-thumb-ver {
  left: var(--space-2);
  color: var(--brand-on-soft);
  background: var(--brand-soft);
  border-color: var(--brand-border);
}
.cl-thumb-mode {
  right: var(--space-2);
}

/* 操作条：默认隐藏，hover / 键盘聚焦时出现（触屏没有 hover，用 focus-within 兜底）。
   z-index 必须高于 .cl-thumb-hit(1)，否则透明热区会盖住按钮点不到；
   opacity:0 时还要关掉 pointer-events —— 否则按钮虽然看不见，
   但右下角那块区域会吞掉点击，用户点缩略图右下角打不开画布。 */
.cl-actions {
  position: absolute;
  z-index: 3;
  right: var(--space-2);
  bottom: var(--space-2);
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.canvas-card:hover .cl-actions,
.canvas-card:focus-within .cl-actions {
  opacity: 1;
  pointer-events: auto;
}
.cl-act {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-2);
  cursor: pointer;
}
.cl-act svg {
  width: 14px;
  height: 14px;
}
.cl-act:hover {
  background: var(--bg-active);
  color: var(--text-1);
  border-color: var(--border-3);
}
.cl-act.is-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.cl-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4) var(--space-4);
}
.canvas-card-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-card-title:hover {
  color: var(--brand-on-soft);
}
.canvas-rename-input {
  width: 100%;
  height: 24px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--brand-border);
  background: var(--bg-sunken);
  color: var(--text-1);
  font-size: var(--text-sm);
  font-weight: 600;
  outline: none;
}
.canvas-rename-input:focus {
  border-color: var(--brand-500);
}

.cl-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.cl-dot {
  color: var(--text-5);
}

/* 骨架卡：与真实卡片同尺寸，避免 loading → 有数据时网格跳动 */
.cl-skel-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  overflow: hidden;
  pointer-events: none;
}
.cl-skel-thumb {
  aspect-ratio: 13 / 6;
  background: var(--bg-sunken);
}
.cl-skel-body {
  padding: 0 var(--space-4);
}

/* ── 分页 ───────────────────────────────────────────── */
.cl-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4) 0 var(--space-6);
}
.cl-pager-text {
  color: var(--text-3);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

/* ── 删除确认 ───────────────────────────────────────── */
.cl-confirm-text {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.cl-confirm-hint {
  margin: var(--space-2) 0 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.6;
}

@media (max-width: 720px) {
  .cl-topbar {
    padding: 0 var(--space-4);
  }
  .cl-brand-text {
    display: none;
  }
  .cl-main {
    padding: var(--space-4);
  }
}

/* 触屏设备没有 hover，操作条永远不出现 → 重命名/删除就变成不可达功能。
   这里常驻显示，用半透明底压住缩略图右下角保证可读。 */
@media (hover: none) {
  .cl-actions {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
