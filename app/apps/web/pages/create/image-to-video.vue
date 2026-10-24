<script setup lang="ts">
import type { AssetDto, ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true });

const api = useApi();
const auth = useAuth();

const models = ref<ModelDto[]>([]);
const selectedModel = ref("");
const assets = ref<AssetDto[]>([]);
const selectedAssetId = ref("");
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
let timer: ReturnType<typeof setInterval> | undefined;
let historyTimer: ReturnType<typeof setInterval> | undefined;

const selectedModelDto = computed(() => models.value.find((m) => m.name === selectedModel.value) ?? null);
const cfg = computed(() => selectedModelDto.value?.modes.image2video ?? null);
const ratios = computed(() => cfg.value?.ratios ?? ["9:16", "16:9", "1:1"]);
const resolutions = computed(
  () => cfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }, { value: "1080p", label: "1080P" }],
);
const durations = computed(() => cfg.value?.durations ?? [5]);
const selectedAsset = computed(() => assets.value.find((a) => a.id === selectedAssetId.value) ?? null);

function applyDefaults(): void {
  const c = cfg.value;
  ratio.value = c?.default_ratio ?? c?.ratios?.[0] ?? "9:16";
  resolution.value = c?.default_resolution ?? c?.resolution_options?.[0]?.value ?? "720p";
  duration.value = c?.default_duration ?? c?.durations?.[0] ?? 5;
  quote.value = null;
}

async function load(): Promise<void> {
  const [modelList, assetList, historyData] = await Promise.all([
    api.get<ModelDto[]>("/models?capability=video&visible=true"),
    api.get<{ list: AssetDto[] }>("/assets?page=1&page_size=50"),
    api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=6&capability=video"),
  ]);
  models.value = modelList.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, "image2video"));
  selectedModel.value = models.value[0]?.name ?? "";
  assets.value = assetList.list;
  selectedAssetId.value = assets.value[0]?.id ?? "";
  history.value = historyData.list;
  applyDefaults();
}

function body(): Record<string, unknown> {
  return {
    mode: "image2video",
    model: selectedModel.value,
    input: {
      prompt: prompt.value,
      first_frame_uri: selectedAsset.value?.url ?? "",
    },
    options: { ratio: ratio.value, resolution: resolution.value, duration: duration.value, count: 1 },
  };
}

async function requestQuote(): Promise<QuoteResponse | null> {
  if (!selectedAsset.value) {
    error.value = "请先选择参考图（可到资产库上传）";
    return null;
  }
  quoting.value = true;
  error.value = "";
  try {
    const data = await api.post<QuoteResponse>("/credits/quote", body());
    quote.value = data;
    if (!data.sufficient) error.value = "余额不足";
    return data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "报价失败";
    return null;
  } finally {
    quoting.value = false;
  }
}

async function submit(): Promise<void> {
  error.value = "";
  info.value = "";
  if (!selectedAsset.value) {
    error.value = "请先选择参考图";
    return;
  }
  submitting.value = true;
  try {
    const q = quote.value ?? (await requestQuote());
    if (!q || !q.sufficient) return;
    const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
    const created = await api.post<{ task_id: string }>("/generations", { ...body(), quote_id: q.quote_id }, {
      headers: { "Idempotency-Key": key },
    });
    quote.value = null;
    await auth.me();
    task.value = await api.get<TaskDto>(`/tasks/${created.task_id}`);
    startPolling(created.task_id);
    void loadHistory();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

function startPolling(taskId: string): void {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const latest = await api.get<TaskDto>(`/tasks/${taskId}`);
      task.value = latest;
      if ([3, 4, 5, 7].includes(latest.status)) {
        if (timer) clearInterval(timer);
        await auth.me();
        void loadHistory();
      }
    } catch {
      if (timer) clearInterval(timer);
    }
  }, 2000);
}

async function loadHistory(): Promise<void> {
  const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=6&capability=video");
  history.value = data.list;
}

onMounted(async () => {
  try {
    await load();
    historyTimer = setInterval(() => void loadHistory().catch(() => undefined), 5000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "初始化失败";
  }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (historyTimer) clearInterval(historyTimer);
});
</script>

<template>
  <main class="workspace">
    <section class="panel">
      <h2>图生视频</h2>
      <label class="field">
        <span class="label">模型</span>
        <select v-model="selectedModel" class="input" @change="applyDefaults">
          <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
        </select>
      </label>

      <div class="field">
        <span class="label">参考图（资产库）</span>
        <div v-if="assets.length" class="assets">
          <button
            v-for="asset in assets"
            :key="asset.id"
            class="asset"
            :class="{ active: asset.id === selectedAssetId }"
            @click="selectedAssetId = asset.id; quote = null"
          >
            <img :src="asset.url" :alt="asset.name" />
          </button>
        </div>
        <p v-else class="muted">
          还没有资产，<NuxtLink to="/assets" class="link">去上传图片</NuxtLink>
        </p>
      </div>

      <label class="field">
        <span class="label">动作 / 镜头描述（可选）</span>
        <textarea v-model="prompt" class="input textarea" maxlength="1000" placeholder="例如：镜头缓慢推近，人物转头看向窗外" />
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
        预计 <b>{{ quote.credits }}</b> 积分（划线 {{ quote.strike_credits }}）· 余额
        {{ auth.state.value.credits?.balance ?? "-" }} → {{ quote.balance_after_estimate }}
      </p>
      <p v-if="info" class="info">{{ info }}</p>
      <div class="actions">
        <Button variant="ghost" :disabled="quoting || submitting" @click="requestQuote">
          {{ quoting ? "报价中…" : "获取报价" }}
        </Button>
        <Button :disabled="submitting || !selectedAsset" @click="submit">
          {{ submitting ? "提交中…" : "生成视频" }}
        </Button>
      </div>
    </section>

    <section class="panel preview">
      <h2>预览</h2>
      <template v-if="task">
        <div class="status"><span class="badge" :data-status="task.status">{{ statusLabel(task.status) }}</span><span class="muted">{{ task.progress }}%</span></div>
        <img v-if="selectedAsset" :src="selectedAsset.url" class="ref" :alt="selectedAsset.name" />
        <p class="muted">{{ task.input?.prompt || "（无额外描述）" }}</p>
        <p v-if="task.status === TaskStatus.SUCCEEDED" class="muted">结果：{{ task.results?.[0]?.uri }}</p>
        <p v-if="task.error" class="error">{{ task.error.message }}</p>
      </template>
      <p v-else class="muted">选择参考图、报价并生成后，此处显示任务进度。</p>
    </section>

    <aside class="panel">
      <h2>最近任务</h2>
      <ul class="list">
        <li v-for="item in history" :key="item.task_id" class="item">
          <span class="badge" :data-status="item.status">{{ statusLabel(item.status) }}</span>
          <span class="muted">{{ item.mode }} · {{ item.credits_frozen }} 积分</span>
        </li>
      </ul>
      <NuxtLink to="/tasks" class="muted">查看全部 →</NuxtLink>
    </aside>
  </main>
</template>

<style scoped>
.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 300px;
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
  min-height: 90px;
  resize: vertical;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.assets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}
.asset {
  border: 2px solid transparent;
  border-radius: var(--radius-s);
  padding: 0;
  background: none;
  cursor: pointer;
  aspect-ratio: 1;
  overflow: hidden;
}
.asset.active {
  border-color: var(--color-primary);
}
.asset img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 1px 8px;
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
.ref {
  width: 120px;
  border-radius: var(--radius-s);
  margin: 10px 0;
}
.list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.muted {
  color: var(--text-3);
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
.error {
  color: #ff6b6b;
  font-size: 12px;
}
.link {
  color: var(--color-primary);
}
@media (max-width: 1080px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
