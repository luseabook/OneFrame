<script setup lang="ts">
import type { ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true });

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
let taskTimer: ReturnType<typeof setInterval> | undefined;
let historyTimer: ReturnType<typeof setInterval> | undefined;

const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => selected.value?.modes.text2video ?? null);
const ratios = computed(() => modeCfg.value?.ratios ?? ["16:9", "9:16"]);
const resolutions = computed(
  () => modeCfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }],
);
const durations = computed(() => modeCfg.value?.durations ?? [5]);

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
  <main class="workspace">
    <section class="panel">
      <h2>文生视频</h2>
      <label class="field">
        <span class="label">模型</span>
        <select v-model="selectedName" class="input" @change="applyDefaults">
          <option v-for="m in models" :key="m.name" :value="m.name">
            {{ m.display_name }}{{ m.need_vip ? "（会员）" : "" }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="label">画面描述</span>
        <textarea v-model="prompt" class="input textarea" maxlength="2000" placeholder="描述主体、动作、镜头与氛围" />
      </label>
      <div class="grid">
        <label class="field">
          <span class="label">画幅</span>
          <select v-model="ratio" class="input" @change="quote = null">
            <option v-for="r in ratios" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="field">
          <span class="label">分辨率</span>
          <select v-model="resolution" class="input" @change="quote = null">
            <option v-for="r in resolutions" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </label>
        <label class="field">
          <span class="label">时长</span>
          <select v-model.number="duration" class="input" @change="quote = null">
            <option v-for="d in durations" :key="d" :value="d">{{ d }}s</option>
          </select>
        </label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="quote" class="quote">
        预计消耗 <b>{{ quote.credits }}</b> 积分（划线 {{ quote.strike_credits }}）· 余额
        {{ auth.state.value.credits?.balance ?? "-" }} → {{ quote.balance_after_estimate }}
      </p>
      <p v-if="info" class="info">{{ info }}</p>
      <div class="actions">
        <Button variant="ghost" :disabled="quoting || submitting" @click="requestQuote">
          {{ quoting ? "报价中…" : "获取报价" }}
        </Button>
        <Button :disabled="submitting" @click="submit">{{ submitting ? "提交中…" : "生成视频" }}</Button>
      </div>
    </section>

    <section class="panel preview">
      <h2>预览</h2>
      <template v-if="task">
        <div class="status-row">
          <span class="badge" :data-status="task.status">{{ statusLabel(task.status) }}</span>
          <span class="muted">{{ task.progress }}%</span>
        </div>
        <p class="prompt">{{ task.input?.prompt || "（无提示词）" }}</p>
        <p class="muted">
          {{ task.options?.ratio }} · {{ task.options?.resolution }} · {{ task.options?.duration }}s
        </p>
        <div class="result">
          <template v-if="task.status === TaskStatus.SUCCEEDED">
            <p class="muted">结果：{{ task.results?.[0]?.uri }}</p>
            <Button variant="ghost" @click="download(task)">下载</Button>
          </template>
          <p v-else class="muted">生成完成后可下载；失败/取消自动退还冻结积分。</p>
        </div>
        <p v-if="task.error" class="error">{{ task.error.message }}</p>
      </template>
      <p v-else class="muted">提交后在右侧历史或此处查看任务状态。</p>
    </section>

    <aside class="panel history">
      <h2>生成历史</h2>
      <ul class="list">
        <li v-for="item in history" :key="item.task_id" class="item" @click="openTask(item)">
          <div class="item-head">
            <span class="badge" :data-status="item.status">{{ statusLabel(item.status) }}</span>
            <span class="muted">{{ item.credits_frozen }} 积分</span>
          </div>
          <p class="prompt">{{ item.input?.prompt || item.mode }}</p>
          <div class="item-actions">
            <button class="mini" @click.stop="download(item)">下载</button>
            <NuxtLink class="mini" :to="`/tasks`">详情</NuxtLink>
          </div>
        </li>
      </ul>
      <p v-if="history.length === 0" class="muted">还没有生成记录。</p>
    </aside>
  </main>
</template>

<style scoped>
.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 320px;
  gap: 16px;
  padding: 24px 32px;
  align-items: start;
}
.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 20px;
}
h2 {
  margin: 0 0 16px;
  font-size: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.label {
  color: var(--text-2);
  font-size: 12px;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}
.textarea {
  min-height: 120px;
  resize: vertical;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
.info,
.quote {
  color: var(--text-2);
  font-size: 12px;
}
.quote b {
  color: var(--color-primary);
}
.preview {
  min-height: 320px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  border-radius: 999px;
  border: 1px solid var(--color-border);
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-2);
}
.badge[data-status="3"] {
  color: #4ade80;
  border-color: #4ade80;
}
.badge[data-status="4"],
.badge[data-status="7"] {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.badge[data-status="2"],
.badge[data-status="6"] {
  color: #fbbf24;
  border-color: #fbbf24;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.prompt {
  margin: 8px 0;
  font-size: 13px;
}
.result {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history .list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 10px;
  cursor: pointer;
}
.item-head,
.item-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.item-actions {
  margin-top: 6px;
}
.mini {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
@media (max-width: 1080px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
