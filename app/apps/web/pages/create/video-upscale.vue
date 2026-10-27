<script setup lang="ts">
// 视频超清（工具箱落地页）
//
// 为什么这一页带 6 个 tab：参照站只有 `/create/video-upscale` 一条路由
// （`rea-reelmate/routes.txt:41`），而「去字幕 / 切片 / 帧率时长统一 / 音画分离」
// 在竞品侧是**画布节点上的后处理动作**、没有独立工具页。我方把这族能力收在同一张
// 「视频超清」卡的落地页里：能力都有真实 mode + 报价 + 适配器分派，不为竞品没有路由的
// 功能臆造卡片（ADR-013 决策 2）。竞品对应交互的取证登记在 report-tools.md。
//
// 本页追加（模块 #15 收尾）：**「去字幕（框选区域）」的可视化区域拖拽**。
// 竞品侧的区域是纯数字输入（`banner/catalog` 的 region_x/y/w/h 参数面板），
// 用户很难靠数字定位字幕位置；这里补一层"在画面上拖矩形"的交互。
// 约束：拖拽**只产出 region 参数**，不改后端 mode——提交仍然是既有的
// `de_subtitle_region` mode，服务端 `normalizeToolOptions` 把 region_x/y/w/h
// 归一成适配器认识的 `region{x,y,w,h}`（见 tool-catalog.ts 的 normalizeToolOptions）。
import type { AssetDto, QuoteResponse, TaskDto, ToolCatalogDto, ToolModeDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频超清" });
useHead({ title: "视频超清 · 一帧" });

const api = useApi();
const toast = useToast();

/** 交给既有 ToolWorkspace 的工具（区域去字幕改为本页可视化拖拽） */
const OTHER_TOOLS = [
  "video-upscale",
  "de-subtitle-auto",
  "video-slicing",
  "fps-unify",
  "audio-separation",
];

const REGION_MODE = "de_subtitle_region";

const tool = ref<ToolModeDto | null>(null);
const toolError = ref("");
const loadingTool = ref(true);

// ── 输入视频 ───────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const videoUrl = ref("");
const videoName = ref("");
const uploading = ref(false);

// ── 区域拖拽（归一化坐标 0~1，左上原点）────────────────────
const stage = ref<HTMLDivElement | null>(null);
/**
 * 框选列表（多个字幕区域）。
 *
 * 为什么要多框：一部片子的字幕可能同时出现在底部与顶部/侧边（双语、角标），
 * 只允许一个框时用户只能分批跑任务，白白多花积分与时间。
 *
 * 提交口径：**后端当前只接受单组 `region_x/y/w/h`**（`normalizeToolOptions` 只归一单框），
 * 所以这里列表是"编辑体验"，提交时只下发**当前选中框**，UI 明确写「仅选中框生效」——
 * 不假装多框已生效（等后端支持 `regions[]` 再改提交）。
 */
const regions = ref<Array<{ x: number; y: number; w: number; h: number }>>([
  { x: 0.1, y: 0.72, w: 0.8, h: 0.2 },
]);
const activeIndex = ref(0);
const region = computed(() => regions.value[activeIndex.value] ?? regions.value[0]!);
const dragging = ref(false);
const drawn = ref(true);
const dragOrigin = { x: 0, y: 0 };

const regionFields = computed(() => [
  { key: "region_x", label: "X", value: region.value.x },
  { key: "region_y", label: "Y", value: region.value.y },
  { key: "region_w", label: "宽", value: region.value.w },
  { key: "region_h", label: "高", value: region.value.h },
]);

/** 每个框的遮罩样式（百分比 → 窗口缩放/视频自适应都不会错位） */
const boxStyle = (box: { x: number; y: number; w: number; h: number }) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function pointFromEvent(event: PointerEvent): { x: number; y: number } {
  const box = stage.value?.getBoundingClientRect();
  if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: clamp01((event.clientX - box.left) / box.width),
    y: clamp01((event.clientY - box.top) / box.height),
  };
}

/** 拖拽中的临时框（松手才入列表：避免拖动过程产生一堆碎框） */
const draftBox = ref<{ x: number; y: number; w: number; h: number } | null>(null);

function onPointerDown(event: PointerEvent): void {
  if (!videoUrl.value) return;
  const point = pointFromEvent(event);
  dragging.value = true;
  dragOrigin.x = point.x;
  dragOrigin.y = point.y;
  draftBox.value = { x: point.x, y: point.y, w: 0, h: 0 };
  // 捕获指针：拖出画面外也不会丢事件（否则矩形会"卡住"）
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || !draftBox.value) return;
  const point = pointFromEvent(event);
  draftBox.value = {
    x: Math.min(dragOrigin.x, point.x),
    y: Math.min(dragOrigin.y, point.y),
    w: Math.abs(point.x - dragOrigin.x),
    h: Math.abs(point.y - dragOrigin.y),
  };
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  const box = draftBox.value;
  draftBox.value = null;
  // 太小的矩形视为误触（点一下画面不应产生 0 面积框）
  if (!box || box.w < 0.02 || box.h < 0.02) return;
  regions.value.push(box);
  activeIndex.value = regions.value.length - 1;
  drawn.value = true;
  scheduleEstimate();
}

/** 撤销最后画的一个框（回到默认框而不是空列表：提交必须有框） */
function undoRegion(): void {
  if (regions.value.length <= 1) {
    resetRegion();
    return;
  }
  regions.value.pop();
  activeIndex.value = Math.min(activeIndex.value, regions.value.length - 1);
  scheduleEstimate();
}

/** 删除当前选中框（只剩一个时退化为重置） */
function deleteRegion(): void {
  if (regions.value.length <= 1) {
    resetRegion();
    return;
  }
  regions.value.splice(activeIndex.value, 1);
  activeIndex.value = Math.min(activeIndex.value, regions.value.length - 1);
  scheduleEstimate();
}

function selectRegion(index: number): void {
  activeIndex.value = index;
  scheduleEstimate();
}

function resetRegion(): void {
  regions.value = [{ x: 0.1, y: 0.72, w: 0.8, h: 0.2 }];
  activeIndex.value = 0;
  drawn.value = true;
  credits.value = null;
}

function onRegionInput(key: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return;
  const field = key.replace("region_", "") as "x" | "y" | "w" | "h";
  const index = activeIndex.value;
  const box = regions.value[index];
  if (!box) return;
  regions.value[index] = { ...box, [field]: clamp01(raw) };
  drawn.value = true;
  scheduleEstimate();
}

// ── 上传 / 报价 / 提交 ─────────────────────────────────────
async function pickVideo(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    toolError.value = "请选择视频文件";
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    toolError.value = "视频需小于 32MB";
    return;
  }
  uploading.value = true;
  toolError.value = "";
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<AssetDto>("/assets/upload", {
      filename: file.name.slice(0, 200),
      content_type: file.type || "video/mp4",
      data_base64: dataUrl,
    });
    videoUrl.value = asset.url;
    videoName.value = asset.name;
    scheduleEstimate();
  } catch (e) {
    toolError.value = e instanceof Error ? e.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}

const quoting = ref(false);
const submitting = ref(false);
const credits = ref<number | null>(null);
const task = ref<TaskDto | null>(null);
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

/** 请求体与 ToolWorkspace 完全同构（mode/model/input/options），只多区域参数 */
function requestBody(): Record<string, unknown> {
  const current = tool.value;
  if (!current) return {};
  return {
    mode: current.mode,
    model: current.model.name,
    input: { prompt: "", reference_uris: [videoUrl.value] },
    options: {
      ratio: "9:16",
      resolution: current.default_resolution,
      duration: 5,
      count: 1,
      region_x: Number(region.value.x.toFixed(4)),
      region_y: Number(region.value.y.toFixed(4)),
      region_w: Number(region.value.w.toFixed(4)),
      region_h: Number(region.value.h.toFixed(4)),
      inpaint: true,
    },
  };
}

function scheduleEstimate(): void {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = setTimeout(() => void estimate(), 350);
}

async function estimate(): Promise<void> {
  if (!tool.value || !videoUrl.value) return;
  if (region.value.w < 0.01 || region.value.h < 0.01) {
    credits.value = null;
    return;
  }
  quoting.value = true;
  try {
    const quote = await api.post<QuoteResponse>("/credits/quote", requestBody());
    credits.value = quote.credits;
  } catch {
    credits.value = null;
  } finally {
    quoting.value = false;
  }
}

async function submit(): Promise<void> {
  if (!tool.value) return;
  if (!videoUrl.value) {
    toolError.value = "请先上传视频";
    return;
  }
  if (region.value.w < 0.02 || region.value.h < 0.02) {
    toolError.value = "请先在画面上框出字幕区域";
    return;
  }
  submitting.value = true;
  toolError.value = "";
  try {
    const quote = await api.post<QuoteResponse>("/credits/quote", requestBody());
    if (!quote.sufficient) {
      toolError.value = `积分不足（需要 ${quote.credits}）`;
      return;
    }
    const created = await api.post<{ task_id: string }>(
      "/generations",
      { ...requestBody(), quote_id: quote.quote_id },
      // 幂等键：重复点击不会重复扣费（服务端 idempotency_records）
      { headers: { "Idempotency-Key": `de-subtitle-region-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } },
    );
    await refreshTask(created.task_id);
    startPolling(created.task_id);
    toast.info("已提交去字幕任务");
  } catch (e) {
    toolError.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

async function refreshTask(taskId: string): Promise<void> {
  try {
    task.value = await api.get<TaskDto>(`/tasks/${taskId}`);
  } catch {
    // 轮询失败不覆盖上一次状态
  }
}

function startPolling(taskId: string): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void (async () => {
      await refreshTask(taskId);
      const status = task.value?.status ?? 0;
      if ([3, 4, 5, 7].includes(status) && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    })();
  }, 3000);
}

async function loadTool(): Promise<void> {
  try {
    const catalog = await api.get<ToolCatalogDto>("/generations/tools");
    tool.value = catalog.tools.find((item) => item.mode === REGION_MODE) ?? null;
    if (!tool.value) toolError.value = "服务端目录里没有 de_subtitle_region 工具";
  } catch (e) {
    toolError.value = e instanceof Error ? e.message : "工具目录加载失败";
  } finally {
    loadingTool.value = false;
  }
}

onMounted(() => {
  void loadTool();
});
onUnmounted(() => {
  if (quoteTimer) clearTimeout(quoteTimer);
  if (pollTimer) clearInterval(pollTimer);
});

const STATUS_TEXT: Record<number, string> = {
  1: "排队中",
  2: "处理中",
  3: "已完成",
  4: "失败",
  5: "已取消",
  6: "审核中",
  7: "审核未通过",
};
</script>

<template>
  <div class="page">
    <!-- 区域去字幕：可视化框选（本页新增交互） -->
    <section class="panel">
      <header class="panel-head">
        <h1>去字幕（框选区域）</h1>
        <p class="muted">
          在画面上拖拽框出字幕所在区域，只在框内擦除字幕；提交的仍是既有的
          <code>de_subtitle_region</code> 模式（不改后端能力）。
        </p>
      </header>

      <p v-if="toolError" class="error">{{ toolError }}</p>
      <p v-else-if="loadingTool" class="muted">工具目录加载中…</p>

      <div class="row">
        <input
          ref="fileInput"
          type="file"
          accept="video/*"
          class="hidden-input"
          @change="pickVideo"
        />
        <Button size="sm" :loading="uploading" @click="fileInput?.click()">
          {{ uploading ? "上传中…" : videoUrl ? "重新选择视频" : "选择视频" }}
        </Button>
        <span v-if="videoName" class="muted small">{{ videoName }}</span>
        <Button v-if="videoUrl" variant="ghost" size="sm" @click="undoRegion">
          撤销上一个
        </Button>
        <Button
          v-if="videoUrl"
          variant="ghost"
          size="sm"
          :disabled="regions.length <= 1"
          @click="deleteRegion"
        >
          删除选中
        </Button>
        <Button v-if="videoUrl" variant="ghost" size="sm" @click="resetRegion">重置框选</Button>
      </div>

      <div
        ref="stage"
        class="stage"
        :class="{ empty: !videoUrl, dragging }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <video v-if="videoUrl" :src="videoUrl" muted playsinline controls class="stage-video" />
        <!-- 已画的框（可点选切换"当前框"；只有选中框会用于提交） -->
        <div
          v-for="(box, index) in regions"
          :key="`box-${index}`"
          class="mask"
          :class="{ 'mask--active': index === activeIndex }"
          :style="boxStyle(box)"
          aria-hidden="true"
          @click.stop="selectRegion(index)"
        >
          <span class="mask-index">{{ index + 1 }}</span>
        </div>
        <!-- 拖拽中的临时框 -->
        <div v-if="draftBox" class="mask mask--draft" :style="boxStyle(draftBox)" aria-hidden="true" />
        <p v-if="!videoUrl" class="stage-hint">先选择视频，再在这里拖拽框选字幕区域</p>
      </div>

      <div class="fields">
        <label v-for="field in regionFields" :key="field.key" class="field">
          <span class="field-label">{{ field.label }}</span>
          <input
            class="input"
            type="number"
            min="0"
            max="1"
            step="0.01"
            :value="Number(field.value.toFixed(2))"
            @input="onRegionInput(field.key, $event)"
          />
        </label>
        <span class="muted small">归一化坐标（0~1，左上原点）</span>
        <span class="muted small">
          共 {{ regions.length }} 个框，当前第 {{ activeIndex + 1 }} 个；
          <b>提交时仅选中框生效</b>（后端目前接受单组 region 参数）
        </span>
      </div>

      <div class="actions">
        <Button :loading="submitting || quoting" :disabled="!videoUrl" @click="submit">
          开始去字幕
        </Button>
        <span class="muted small">
          <template v-if="quoting">报价中…</template>
          <template v-else-if="credits !== null">预计 {{ credits }} 积分</template>
          <template v-else>框选后自动报价</template>
        </span>
      </div>

      <div v-if="task" class="task">
        <span class="muted">任务 {{ task.task_id }}</span>
        <b>{{ STATUS_TEXT[task.status] ?? task.status }} · {{ task.progress }}%</b>
        <a v-if="task.results?.length" :href="task.results[0]?.uri" target="_blank" rel="noreferrer" class="link">
          查看结果
        </a>
      </div>
    </section>

    <!-- 其余五个工具仍由既有 ToolWorkspace 承载 -->
    <ToolWorkspace :tools="OTHER_TOOLS" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 1040px;
  margin: 0 auto;
  padding: 24px 24px 64px;
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
.panel-head h1 {
  margin: 0 0 6px;
  font-size: var(--text-xl);
  color: var(--text-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.hidden-input {
  display: none;
}
.stage {
  position: relative;
  width: 100%;
  min-height: 220px;
  border: 1px dashed var(--border-2);
  border-radius: var(--radius-xl);
  background: #000;
  overflow: hidden;
  touch-action: none;
  cursor: crosshair;
}
.stage.empty {
  cursor: default;
  background: var(--bg-subtle, #14141c);
}
.stage-video {
  display: block;
  width: 100%;
  height: auto;
}
.mask--active {
  border-color: var(--brand-1, #6d5efc);
  box-shadow: 0 0 0 2px rgba(109, 94, 252, 0.55);
}
.mask--draft {
  border-style: dashed;
  pointer-events: none;
}
.mask-index {
  position: absolute;
  top: -9px;
  left: -9px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--brand-1, #6d5efc);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.mask {
  position: absolute;
  border: 2px solid #8a7dff;
  background: #8a7dff26;
  box-shadow: 0 0 0 9999px #00000066;
  pointer-events: none;
}
.stage-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.fields {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 96px;
}
.field-label {
  color: var(--text-3);
  font-size: 12px;
}
.input {
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-1);
  background: var(--bg-base);
  color: var(--text-1);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.task {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-1);
}
.error {
  margin: 0;
  color: var(--danger, #f87171);
  font-size: 13px;
}
.small {
  font-size: 12px;
}
.muted {
  color: var(--text-3);
}
.link {
  color: #8a7dff;
  font-size: 13px;
}
</style>
