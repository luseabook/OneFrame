<script setup lang="ts">
// 灵感成片（Agent 工具工作台）
//
// 为什么这条卡不走通用 `ToolWorkspace`：它没有独立的 generation mode ——
// 参照站把它放在 Agent 侧（`/creation-agent`，`rea-reelmate/routes.txt:42`），
// 由 Agent 规划后**复用同一条投递链路**（`POST /agent/task/create`，内部仍走 generations）。
// 因此这一页走 agent 域的两个端点：
//   - `POST /agent/task/create-check`：只校验不落库，把"会不会失败/多少钱"先告诉用户；
//   - `POST /agent/task/create`：真投递（冻结/幂等/去重都在 generations 里）。
// 轮询复用 `GET /agent/task/:task_id`，产物 URL 用任务下载端点取。
import type { ModelDto, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

const api = useApi();
const auth = useAuth();

interface CreateCheck {
  ok: boolean;
  credits_estimate: number;
  blockers: Array<{ code: number; field?: string; msg: string }>;
}

const models = ref<ModelDto[]>([]);
const selectedName = ref("");
const idea = ref("");
const ratio = ref("9:16");
const resolution = ref("720p");
const duration = ref(5);

const loading = ref(true);
const loadError = ref("");
const checking = ref(false);
const submitting = ref(false);
const error = ref("");
const check = ref<CreateCheck | null>(null);
const task = ref<TaskDto | null>(null);
const resultUrls = ref<string[]>([]);
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => (selected.value ? selected.value.modes.text2video ?? null : null));
const resolutions = computed(() => modeCfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }]);
const ratios = computed(() => modeCfg.value?.ratios ?? ["9:16", "16:9"]);
const durations = computed(() => modeCfg.value?.durations ?? [5]);

const IDEA_TEMPLATES = [
  "一个外卖员在暴雨夜送最后一单，发现收件人是十年前失踪的哥哥",
  "末日后的图书馆管理员，用最后一批书换取幸存者的故事",
  "古装女主在成亲当日被退婚，三年后以商队首领身份回来",
];

function applyDefaults(): void {
  const cfg = modeCfg.value;
  ratio.value = cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "9:16";
  resolution.value = cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "720p";
  duration.value = cfg?.default_duration ?? cfg?.durations?.[0] ?? 5;
}

function requestBody(): Record<string, unknown> {
  return {
    mode: "text2video",
    model: selectedName.value,
    input: { prompt: idea.value.trim() },
    options: { ratio: ratio.value, resolution: resolution.value, duration: duration.value, count: 1 },
  };
}

async function loadModels(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const all = await api.get<ModelDto[]>("/models?capability=video&visible=true&mode=text2video");
    models.value = all;
    selectedName.value = all[0]?.name ?? "";
    applyDefaults();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "模型目录加载失败";
  } finally {
    loading.value = false;
  }
}

/** 静默预检：只显示"预计消耗 / 是否会被拦"，用户改文案时不打扰 */
async function runCheck(): Promise<void> {
  if (!idea.value.trim() || !selectedName.value) {
    check.value = null;
    return;
  }
  checking.value = true;
  try {
    check.value = await api.post<CreateCheck>("/agent/task/create-check", requestBody());
  } catch {
    check.value = null;
  } finally {
    checking.value = false;
  }
}

function scheduleCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => void runCheck(), 500);
}

watch([idea, selectedName, ratio, resolution, duration], scheduleCheck);

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submit(): Promise<void> {
  error.value = "";
  if (!selectedName.value) {
    error.value = "请等待模型目录加载";
    return;
  }
  if (!idea.value.trim()) {
    error.value = "请先描述你的创意";
    return;
  }
  submitting.value = true;
  try {
    const created = await api.post<{ task_id: string }>("/agent/task/create", requestBody(), {
      headers: { "Idempotency-Key": newIdempotencyKey() },
    });
    await auth.me();
    task.value = await api.get<TaskDto>(`/agent/task/${created.task_id}`);
    startPolling(created.task_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "投递失败";
  } finally {
    submitting.value = false;
  }
}

async function loadResultUrls(row: TaskDto): Promise<void> {
  const urls: string[] = [];
  const items = row.results ?? [];
  for (let i = 0; i < items.length; i += 1) {
    try {
      const data = await api.get<{ url: string }>(`/tasks/${row.task_id}/results/${i + 1}/download-url`);
      urls.push(data.url);
    } catch {
      /* 单条失败不影响其它产物 */
    }
  }
  resultUrls.value = urls;
}

function startPolling(taskId: string): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const latest = await api.get<TaskDto>(`/agent/task/${taskId}`);
      task.value = latest;
      if ([TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED, TaskStatus.REVIEW_REJECTED].includes(latest.status as never)) {
        if (pollTimer) clearInterval(pollTimer);
        if (latest.status === TaskStatus.SUCCEEDED) await loadResultUrls(latest);
        await auth.me();
      }
    } catch {
      if (pollTimer) clearInterval(pollTimer);
    }
  }, 2000);
}

function useTemplate(text: string): void {
  idea.value = text;
}

function openResult(url: string): void {
  window.open(url, "_blank", "noopener");
}

onMounted(() => {
  void loadModels();
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (checkTimer) clearTimeout(checkTimer);
});
</script>

<template>
  <div class="insp">
    <section class="panel left-panel">
      <div v-if="loading" class="state">正在加载模型目录…</div>
      <div v-else-if="loadError" class="state">
        <p>{{ loadError }}</p>
        <button type="button" class="mini" @click="loadModels">重试</button>
      </div>
      <template v-else>
        <div class="scroll">
          <div class="field">
            <div class="field-head">
              <span class="field-label">你的创意<i class="req">*</i></span>
              <span class="field-hint">{{ idea.length }}/2000</span>
            </div>
            <textarea
              v-model="idea"
              class="prompt"
              maxlength="2000"
              placeholder="用一两句话描述你想拍的短片，Agent 会规划镜头并直接出片"
            />
            <div class="chips">
              <button v-for="t in IDEA_TEMPLATES" :key="t" type="button" class="chip" @click="useTemplate(t)">
                {{ t.slice(0, 12) }}…
              </button>
            </div>
          </div>

          <div class="field">
            <span class="field-label">模型</span>
            <select v-model="selectedName" class="select" @change="applyDefaults">
              <option v-for="m in models" :key="m.name" :value="m.name">{{ m.display_name }}</option>
            </select>
            <p class="hint">{{ selected?.description || "选择负责出片的视频模型" }}</p>
          </div>

          <div class="field">
            <span class="field-label">画面设置</span>
            <div class="setting-row">
              <span class="setting-name">比例</span>
              <div class="pills">
                <button
                  v-for="r in ratios"
                  :key="r"
                  type="button"
                  class="pill"
                  :class="{ on: ratio === r }"
                  @click="ratio = r"
                >
                  {{ r }}
                </button>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-name">分辨率</span>
              <div class="pills">
                <button
                  v-for="r in resolutions"
                  :key="r.value"
                  type="button"
                  class="pill"
                  :class="{ on: resolution === r.value }"
                  @click="resolution = r.value"
                >
                  {{ r.label }}
                </button>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-name">时长</span>
              <div class="pills">
                <button
                  v-for="d in durations"
                  :key="d"
                  type="button"
                  class="pill"
                  :class="{ on: duration === d }"
                  @click="duration = d"
                >
                  {{ d }}s
                </button>
              </div>
            </div>
          </div>

          <p v-if="check && check.blockers.length" class="error">
            {{ check.blockers.map((b) => b.msg).join("；") }}
          </p>
          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <div class="generate-wrap">
          <div class="quote-row">
            <span>积分消耗</span>
            <b>✦ {{ check ? check.credits_estimate : "—" }}</b>
          </div>
          <button type="button" class="generate" :disabled="submitting || checking" @click="submit">
            {{ submitting ? "投递中…" : "生成短片" }}
          </button>
          <p class="disclaimer">Agent 会规划镜头并调用视频模型出片，内容由 AI 生成</p>
        </div>
      </template>
    </section>

    <section class="panel right-panel">
      <header class="result-head">
        <span class="result-title">成片结果</span>
        <button v-if="resultUrls.length" type="button" class="mini" @click="openResult(resultUrls[0]!)">打开</button>
      </header>
      <div class="result-body">
        <article v-if="task" class="result-live">
          <div class="result-media">
            <video v-if="task.status === TaskStatus.SUCCEEDED && resultUrls.length" :src="resultUrls[0]" controls playsinline />
            <div v-else class="placeholder">
              <span v-if="task.status === TaskStatus.FAILED || task.status === TaskStatus.REVIEW_REJECTED">
                {{ statusLabel(task.status) }}：{{ task.error?.message ?? "生成失败" }}
              </span>
              <span v-else>{{ statusLabel(task.status) }} {{ task.progress ?? 0 }}%</span>
            </div>
          </div>
          <div class="result-meta">
            <span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span>
            <span class="meta-time">{{ new Date(task.created_at).toLocaleString("zh-CN") }}</span>
          </div>
        </article>
        <div v-else class="empty">还没有成片，左侧写一句创意后点「生成短片」</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.insp {
  display: grid;
  grid-template-columns: 560px minmax(0, 1fr);
  gap: 12px;
  padding: 0 12px 12px;
  height: calc(100vh - 64px);
  box-sizing: border-box;
}

.panel {
  min-height: 0;
  border-radius: 10px;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
}

.left-panel {
  padding: 20px;
  gap: 12px;
}

.right-panel {
  padding: 12px 14px;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.req {
  color: var(--danger);
  font-style: normal;
}

.field-hint {
  font-size: 11px;
  color: var(--text-4);
}

.prompt {
  width: 100%;
  min-height: 110px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #0d0d10;
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.7;
  font-family: inherit;
  box-sizing: border-box;
  resize: vertical;
  outline: none;
}

.prompt::placeholder {
  color: var(--text-4);
}

.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #ffffff14;
  background: #151519;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
}

.chip:hover {
  border-color: #ffffff33;
  color: var(--text-1);
}

.select {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #141418;
  color: var(--text-1);
  font-size: 12px;
  outline: none;
}

.hint {
  margin: 0;
  color: var(--text-4);
  font-size: 11px;
  line-height: 1.6;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-name {
  flex: 0 0 56px;
  font-size: 12px;
  color: var(--text-3);
}

.pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pill {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #ffffff14;
  background: #141418;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}

.pill.on {
  border-color: var(--brand-500);
  color: var(--text-1);
  background: #221d43;
}

.error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
}

.state {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-3);
  font-size: 13px;
}

.generate-wrap {
  padding-top: 10px;
  border-top: 1px solid #ffffff0f;
}

.quote-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 8px;
  color: var(--text-3);
  font-size: 12px;
}

.quote-row b {
  color: var(--text-1);
}

.generate {
  width: 100%;
  height: 42px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(90deg, #7e70ff, #a45fff);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.generate:disabled {
  opacity: 0.6;
  cursor: default;
}

.disclaimer {
  margin: 8px 0 0;
  text-align: center;
  color: var(--text-4);
  font-size: 10px;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid #ffffff0f;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.mini {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #ffffff24;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.result-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
}

.result-live {
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #101014;
  overflow: hidden;
}

.result-media {
  aspect-ratio: 16 / 9;
  background: #000;
  display: grid;
  place-items: center;
}

.result-media video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.placeholder {
  color: var(--text-3);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.status {
  padding: 0 6px;
  border-radius: 4px;
  background: #ffffff14;
  color: var(--text-3);
  font-size: 10px;
  line-height: 16px;
}

.status[data-status="3"] {
  background: #123a26;
  color: #5fd08a;
}

.status[data-status="4"] {
  background: #3a1414;
  color: #f56767;
}

.meta-time {
  color: var(--text-4);
  font-size: 11px;
}

.empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-4);
  font-size: 13px;
}

@media (max-width: 1000px) {
  .insp {
    grid-template-columns: 1fr;
    height: auto;
  }

  .right-panel {
    min-height: 420px;
  }
}
</style>
