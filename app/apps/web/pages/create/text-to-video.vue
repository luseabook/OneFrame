<script setup lang="ts">
import type { ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "tool", toolTitle: "视频生成" });

const api = useApi();
const auth = useAuth();

const models = ref<ModelDto[]>([]);
const selectedName = ref("");
const prompt = ref("");
const ratio = ref("9:16");
const resolution = ref("720p");
const duration = ref(5);
const quote = ref<QuoteResponse | null>(null);
const quoting = ref(false);
const submitting = ref(false);
const error = ref("");
const info = ref("");
const task = ref<TaskDto | null>(null);
const history = ref<TaskDto[]>([]);
const resultFilter = ref<"all" | "video" | "running">("all");
let taskTimer: ReturnType<typeof setInterval> | undefined;
let historyTimer: ReturnType<typeof setInterval> | undefined;

const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => selected.value?.modes.text2video ?? null);
const ratios = computed(() => modeCfg.value?.ratios ?? ["16:9", "9:16"]);
const resolutions = computed(
  () => modeCfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }],
);
const durations = computed(() => modeCfg.value?.durations ?? [5]);

const shownHistory = computed(() => {
  if (resultFilter.value === "running") return history.value.filter((t) => t.status === TaskStatus.RUNNING);
  if (resultFilter.value === "video") return history.value;
  return history.value;
});

const SAMPLE_PROMPTS = ["雨夜霓虹街道，少女撑伞回眸", "赛博朋克城市航拍，霓虹闪烁", "国风水墨山水，仙鹤掠过"];

function applyDefaults(): void {
  const cfg = modeCfg.value;
  ratio.value = cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "9:16";
  resolution.value = cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "720p";
  duration.value = cfg?.default_duration ?? cfg?.durations?.[0] ?? 5;
  quote.value = null;
}

async function loadModels(): Promise<void> {
  const all = await api.get<ModelDto[]>("/models?capability=video&visible=true");
  models.value = all.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, "text2video"));
  selectedName.value = models.value[0]?.name ?? "";
  applyDefaults();
}

async function loadHistory(): Promise<void> {
  const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=10&capability=video");
  history.value = data.list;
}

function requestBody(): Record<string, unknown> {
  return {
    mode: "text2video",
    model: selectedName.value,
    input: { prompt: prompt.value },
    options: { ratio: ratio.value, resolution: resolution.value, duration: duration.value, count: 1 },
  };
}

async function requestQuote(): Promise<QuoteResponse | null> {
  if (!prompt.value.trim()) {
    error.value = "请先输入画面描述";
    return null;
  }
  quoting.value = true;
  error.value = "";
  try {
    const data = await api.post<QuoteResponse>("/credits/quote", requestBody());
    quote.value = data;
    if (!data.sufficient) error.value = "余额不足，请先充值（Beta）或等待名单（Alpha）";
    return data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "报价失败";
    return null;
  } finally {
    quoting.value = false;
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submit(): Promise<void> {
  error.value = "";
  info.value = "";
  if (!selectedName.value) {
    error.value = "请选择模型";
    return;
  }
  if (!prompt.value.trim()) {
    error.value = "请先输入画面描述";
    return;
  }
  submitting.value = true;
  try {
    const q = quote.value ?? (await requestQuote());
    if (!q || !q.sufficient) return;
    const created = await api.post<{ task_id: string }>(
      "/generations",
      { ...requestBody(), quote_id: q.quote_id },
      { headers: { "Idempotency-Key": newIdempotencyKey() } },
    );
    quote.value = null;
    await auth.me();
    await loadHistory();
    task.value = await api.get<TaskDto>(`/tasks/${created.task_id}`);
    startTaskPolling(created.task_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

function startTaskPolling(taskId: string): void {
  if (taskTimer) clearInterval(taskTimer);
  taskTimer = setInterval(async () => {
    try {
      const latest = await api.get<TaskDto>(`/tasks/${taskId}`);
      task.value = latest;
      if ([TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED, TaskStatus.REVIEW_REJECTED].includes(latest.status as never)) {
        if (taskTimer) clearInterval(taskTimer);
        await auth.me();
        await loadHistory();
      }
    } catch {
      if (taskTimer) clearInterval(taskTimer);
    }
  }, 2000);
}

async function openTask(item: TaskDto): Promise<void> {
  task.value = await api.get<TaskDto>(`/tasks/${item.task_id}`);
}

async function download(item: TaskDto): Promise<void> {
  try {
    const data = await api.get<{ url: string }>(`/tasks/${item.task_id}/results/1/download-url`);
    if (data.url.startsWith("mock://")) {
      info.value = "当前为 mock 结果（真实供应商接入后可下载）";
      return;
    }
    window.open(data.url, "_blank");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "下载失败";
  }
}

onMounted(async () => {
  try {
    await loadModels();
    await loadHistory();
    historyTimer = setInterval(() => {
      void loadHistory().catch(() => undefined);
    }, 5000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "初始化失败";
  }
});

onUnmounted(() => {
  if (taskTimer) clearInterval(taskTimer);
  if (historyTimer) clearInterval(historyTimer);
});
</script>

<template>
  <div class="split">
    <!-- ── 左：生成表单 ── -->
    <section class="form-panel">
      <nav class="mode-tabs">
        <NuxtLink to="/create/image-to-video" class="mode-tab">图生视频</NuxtLink>
        <span class="mode-tab on">文生视频</span>
        <span class="mode-tab disabled">参考生视频</span>
      </nav>

      <div class="sec-head">
        <p class="sec-label">提示词</p>
        <button class="mini-pill" :disabled="!prompt" @click="prompt = ''">清空</button>
      </div>
      <textarea
        v-model="prompt"
        class="prompt-box"
        maxlength="2000"
        placeholder="描述你想生成的视频内容：主体、动作、镜头与氛围"
      />
      <div class="chips">
        <button v-for="s in SAMPLE_PROMPTS" :key="s" class="chip" @click="prompt = s">{{ s }}</button>
      </div>

      <p class="sec-label">模型</p>
      <div class="model-bar">
        <select v-model="selectedName" class="bare-select" @change="applyDefaults">
          <option v-for="m in models" :key="m.name" :value="m.name">
            {{ m.display_name }}{{ m.need_vip ? "（会员）" : "" }}
          </option>
        </select>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
      </div>

      <p class="sec-label">生成参数</p>
      <div class="param-grid">
        <label class="param">
          <span>画幅</span>
          <select v-model="ratio" class="bare-select" @change="quote = null">
            <option v-for="r in ratios" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="param">
          <span>分辨率</span>
          <select v-model="resolution" class="bare-select" @change="quote = null">
            <option v-for="r in resolutions" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </label>
        <label class="param">
          <span>时长</span>
          <select v-model.number="duration" class="bare-select" @change="quote = null">
            <option v-for="d in durations" :key="d" :value="d">{{ d }}s</option>
          </select>
        </label>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="quote" class="quote">
        预计消耗 <b>{{ quote.credits }}</b> 积分（原价 {{ quote.strike_credits }}）· 余额
        {{ auth.state.value.credits?.balance ?? "-" }} → {{ quote.balance_after_estimate }}
      </p>
      <p v-if="info" class="info">{{ info }}</p>

      <div class="submit-zone">
        <button class="submit-btn" :disabled="quoting || submitting" @click="submit">
          {{ submitting ? "提交中…" : quoting ? "报价中…" : "立即生成" }}
        </button>
        <p class="disclaim">内容由AI生成，请仔细甄别</p>
      </div>
    </section>

    <!-- ── 右：结果区 ── -->
    <section class="result-panel">
      <div class="result-head">
        <div class="seg">
          <button class="seg-btn" :class="{ on: resultFilter === 'all' }" @click="resultFilter = 'all'">全部</button>
          <button class="seg-btn" :class="{ on: resultFilter === 'video' }" @click="resultFilter = 'video'">视频</button>
          <button class="seg-btn" :class="{ on: resultFilter === 'running' }" @click="resultFilter = 'running'">进行中</button>
        </div>
        <NuxtLink to="/tasks" class="all-link">任务中心</NuxtLink>
      </div>

      <div v-if="task" class="preview">
        <div class="preview-media">
          <video
            v-if="task.status === TaskStatus.SUCCEEDED && task.results?.[0]?.uri && !task.results[0].uri.startsWith('mock://')"
            :src="task.results[0].uri"
            controls
            playsinline
          />
          <div v-else class="media-holder">
            <EmptyState
              :title="statusLabel(task.status)"
              :description="task.status === TaskStatus.SUCCEEDED ? task.results?.[0]?.uri ?? '' : `进度 ${task.progress}% · 完成后可在此预览与下载`"
            />
          </div>
        </div>
        <div class="preview-meta">
          <span class="badge" :data-status="task.status">{{ statusLabel(task.status) }}</span>
          <p class="preview-prompt">{{ task.input?.prompt || "（无提示词）" }}</p>
          <p class="muted">{{ task.options?.ratio }} · {{ task.options?.resolution }} · {{ task.options?.duration }}s · {{ task.credits_frozen }} 积分</p>
          <p v-if="task.error" class="error">{{ task.error.message }}</p>
          <div v-if="task.status === TaskStatus.SUCCEEDED" class="preview-actions">
            <button class="ghost" @click="download(task)">下载</button>
          </div>
        </div>
      </div>

      <div v-if="shownHistory.length" class="history-grid">
        <button v-for="item in shownHistory" :key="item.task_id" class="history-card" @click="openTask(item)">
          <span class="badge" :data-status="item.status">{{ statusLabel(item.status) }}</span>
          <p class="h-prompt">{{ item.input?.prompt || item.mode }}</p>
          <p class="muted">{{ item.options?.ratio }} · {{ item.options?.duration }}s · {{ item.credits_frozen }} 积分</p>
        </button>
      </div>

      <div v-else-if="!task" class="empty-zone">
        <EmptyState title="快去生成你的创意吧" description="左侧输入提示词，选择模型后点击「立即生成」" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(360px, 620px) minmax(0, 1fr);
  gap: 20px;
  padding: 4px 24px 24px;
  align-items: start;
}

/* ── 左表单 ── */
.form-panel {
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 20px;
}
.mode-tabs {
  display: flex;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: 4px;
  margin-bottom: 20px;
}
.mode-tab {
  flex: 1;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--text-2);
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
}
.mode-tab.on {
  background: var(--bg-raised);
  color: var(--text-1);
  font-weight: 600;
}
.mode-tab.disabled {
  color: var(--text-4);
  cursor: not-allowed;
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sec-label {
  margin: 18px 0 10px;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
}
.mini-pill {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.mini-pill:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--border-3);
}
.mini-pill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.prompt-box {
  width: 100%;
  min-height: 128px;
  padding: 12px 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.prompt-box:focus {
  border-color: #7e70ff66;
}
.prompt-box::placeholder {
  color: var(--text-4);
}
.chips {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  overflow-x: auto;
}
.chip {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.chip:hover {
  color: var(--text-1);
  border-color: var(--border-3);
}
.model-bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 46px;
  padding: 0 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
}
.param-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.param {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 68px;
  justify-content: center;
  padding: 0 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
}
.param span {
  font-size: 11px;
  color: var(--text-4);
}
.bare-select {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}
.bare-select option {
  background: var(--bg-raised);
  color: var(--text-1);
}
.model-bar .chev {
  position: absolute;
  right: 12px;
  width: 14px;
  height: 14px;
  color: var(--text-4);
  pointer-events: none;
  transform: rotate(90deg);
}
.model-bar .bare-select {
  appearance: none;
  padding-right: 24px;
}
.error {
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 12px;
}
.info,
.quote {
  margin: 12px 0 0;
  color: var(--text-3);
  font-size: 12px;
}
.quote b {
  color: var(--brand-400);
}
.submit-zone {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-1);
}
.submit-btn {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: var(--radius-lg);
  background: linear-gradient(90deg, var(--brand-500), var(--brand-400));
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: filter var(--duration-fast) var(--ease-out);
}
.submit-btn:hover:not(:disabled) {
  filter: brightness(1.12);
}
.submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.disclaim {
  margin: 10px 0 0;
  text-align: center;
  color: var(--text-4);
  font-size: 11px;
}

/* ── 右结果 ── */
.result-panel {
  min-height: 480px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 20px;
}
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.seg {
  display: flex;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: 4px;
}
.seg-btn {
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.seg-btn.on {
  background: var(--bg-raised);
  color: var(--text-1);
  font-weight: 600;
}
.all-link {
  color: var(--text-3);
  font-size: 13px;
}
.all-link:hover {
  color: var(--text-1);
}
.preview {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 18px;
  padding: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
}
.preview-media video {
  width: 100%;
  border-radius: var(--radius-md);
  background: #000;
  aspect-ratio: 16 / 9;
  object-fit: contain;
}
.media-holder {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}
.preview-prompt {
  margin: 0 0 6px;
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.muted {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
}
.badge {
  display: inline-block;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  padding: 2px 10px;
  font-size: 11px;
  color: var(--text-2);
}
.badge[data-status="3"] {
  color: var(--success);
  border-color: #5fd08a66;
  background: var(--success-bg);
}
.badge[data-status="4"],
.badge[data-status="7"] {
  color: var(--danger);
  border-color: #f5676766;
  background: var(--danger-bg);
}
.badge[data-status="2"],
.badge[data-status="6"] {
  color: var(--warning);
  border-color: #f5b54466;
  background: var(--warning-bg);
}
.preview-actions {
  margin-top: 10px;
}
.ghost {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.ghost:hover {
  color: var(--text-1);
  border-color: var(--border-3);
}
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 18px;
}
.history-card {
  text-align: left;
  padding: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.history-card:hover {
  border-color: #7e70ff59;
}
.h-prompt {
  margin: 8px 0 6px;
  font-size: 12px;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.empty-zone {
  display: grid;
  place-items: center;
  padding-top: 90px;
}

@media (max-width: 1080px) {
  .split {
    grid-template-columns: 1fr;
  }
  .preview {
    grid-template-columns: 1fr;
  }
}
</style>
