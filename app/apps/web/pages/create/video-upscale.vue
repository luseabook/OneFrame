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
const region = reactive({ x: 0.1, y: 0.72, w: 0.8, h: 0.2 });
const dragging = ref(false);
const drawn = ref(false);
const dragOrigin = { x: 0, y: 0 };

const regionFields = computed(() => [
  { key: "region_x", label: "X", value: region.x },
  { key: "region_y", label: "Y", value: region.y },
  { key: "region_w", label: "宽", value: region.w },
  { key: "region_h", label: "高", value: region.h },
]);

/** 遮罩样式：用百分比，窗口缩放/视频自适应都不会错位 */
const maskStyle = computed(() => ({
  left: `${region.x * 100}%`,
  top: `${region.y * 100}%`,
  width: `${region.w * 100}%`,
  height: `${region.h * 100}%`,
}));

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function pointFromEvent(event: PointerEvent): { x: number; y: number } {
  const box = stage.value?.getBoundingClientRect();
  if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: clamp01((event.clientX - box.left) / box.width),
    y: clamp01((event.clientY - box.top) / box.height),
  };
}

function onPointerDown(event: PointerEvent): void {
  if (!videoUrl.value) return;
  const point = pointFromEvent(event);
  dragging.value = true;
  dragOrigin.x = point.x;
  dragOrigin.y = point.y;
  region.x = point.x;
  region.y = point.y;
  region.w = 0;
  region.h = 0;
  drawn.value = true;
  // 捕获指针：拖出画面外也不会丢事件（否则矩形会"卡住"）
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const point = pointFromEvent(event);
  region.x = Math.min(dragOrigin.x, point.x);
  region.y = Math.min(dragOrigin.y, point.y);
  region.w = Math.abs(point.x - dragOrigin.x);
  region.h = Math.abs(point.y - dragOrigin.y);
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  // 太小的矩形视为误触：保留一个可用默认框，避免提交 0 面积区域被服务端拒
  if (region.w < 0.02 || region.h < 0.02) {
    resetRegion();
    return;
  }
  scheduleEstimate();
}

function resetRegion(): void {
  region.x = 0.1;
  region.y = 0.72;
  region.w = 0.8;
  region.h = 0.2;
  drawn.value = false;
  credits.value = null;
}

function onRegionInput(key: string, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return;
  const field = key.replace("region_", "") as "x" | "y" | "w" | "h";
  region[field] = clamp01(raw);
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
      region_x: Number(region.x.toFixed(4)),
      region_y: Number(region.y.toFixed(4)),
      region_w: Number(region.w.toFixed(4)),
      region_h: Number(region.h.toFixed(4)),
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
  if (region.w < 0.01 || region.h < 0.01) {
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
  if (region.w < 0.02 || region.h < 0.02) {
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
        <div v-if="drawn" class="mask" :style="maskStyle" aria-hidden="true"></div>
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
