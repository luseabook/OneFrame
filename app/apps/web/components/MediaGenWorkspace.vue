<script setup lang="ts">
// 视频后期工具工作台（视频续写 / 视频编辑 / 视频参考）
//
// 与视频生成工作台同构：左侧参数 + 立即生成，右侧结果与历史。
// 协议完全复用既有脊柱——`/credits/quote` 报价 → `/generations` 建任务 → `/tasks/:id` 轮询。
//
// 与 `/create/text-to-video` 的差别只有一处：**必须先有一段源视频**。
// 没有源视频时模型只能凭空编（"续写"没有前文、"编辑"没有对象），所以前端在提交前
// 直接挡住，而不是把空 reference_uris 发过去换一个看似成功的任务。
import type { AssetDto, ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

const props = withDefaults(defineProps<{ initialMode?: "extend" | "edit" | "reference" }>(), {
  initialMode: "extend",
});

const api = useApi();
const auth = useAuth();
const toast = useToast();

type ToolMode = "extend" | "edit" | "reference";
const MODE_TABS: Array<{ key: ToolMode; label: string; mode: string }> = [
  { key: "extend", label: "视频续写", mode: "video_extend" },
  { key: "edit", label: "视频编辑", mode: "video_edit" },
  { key: "reference", label: "视频参考", mode: "universal_reference" },
];
const mode = ref<ToolMode>(props.initialMode);
const apiMode = computed(() => MODE_TABS.find((t) => t.key === mode.value)?.mode ?? "video_extend");
const modeLabel = computed(() => MODE_TABS.find((t) => t.key === mode.value)?.label ?? "视频工具");

const allModels = ref<ModelDto[]>([]);
const selectedName = ref("");
const prompt = ref("");
const ratio = ref("9:16");
const resolution = ref("720p");
const duration = ref(5);

const video = ref<{ url: string; name: string } | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const VIDEO_MAX = 32 * 1024 * 1024;

const estimatedCredits = ref<number | null>(null);
const quoting = ref(false);
const submitting = ref(false);
const error = ref("");
const task = ref<TaskDto | null>(null);
const history = ref<TaskDto[]>([]);
let pollTimer: ReturnType<typeof setInterval> | undefined;
let quoteTimer: ReturnType<typeof setTimeout> | undefined;

const models = computed(() =>
  allModels.value.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, apiMode.value)),
);
const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => (selected.value ? selected.value.modes[apiMode.value] ?? null : null));
const ratios = computed(() => modeCfg.value?.ratios ?? ["9:16", "16:9"]);
const resolutions = computed(
  () => modeCfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }],
);
const durations = computed(() => modeCfg.value?.durations ?? []);
const statusText = computed(() => (task.value ? statusLabel(task.value.status) : ""));
const taskVideos = computed(() =>
  (task.value?.results ?? []).map((r) => r.uri ?? r.preview_uri ?? "").filter(Boolean),
);
const VIDEO_TOOL_MODES = new Set(MODE_TABS.map((t) => t.mode));
const historyVideos = computed(() =>
  history.value.filter(
    (t) =>
      VIDEO_TOOL_MODES.has(t.mode) && (t.results ?? []).some((r) => r.uri || r.preview_uri),
  ),
);

function applyDefaults(): void {
  const cfg = modeCfg.value;
  ratio.value = cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "9:16";
  resolution.value = cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "720p";
  duration.value = cfg?.default_duration ?? cfg?.durations?.[0] ?? 5;
}

async function loadModels(): Promise<void> {
  const all = await api.get<ModelDto[]>("/models?capability=video&visible=true");
  allModels.value = all;
  const list = all.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, apiMode.value));
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
}

function switchMode(next: ToolMode): void {
  if (mode.value === next) return;
  mode.value = next;
  const list = models.value;
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
  error.value = "";
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    error.value = "请上传视频文件（mp4 / mov / webm）";
    return;
  }
  if (file.size > VIDEO_MAX) {
    error.value = "视频需小于 32MB（本地栈走 base64 上传，生产应换直传）";
    return;
  }
  uploading.value = true;
  error.value = "";
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("读取视频失败"));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<AssetDto>("/assets/upload", {
      filename: file.name.slice(0, 200),
      content_type: file.type && file.type.startsWith("video/") ? file.type : "video/mp4",
      data_base64: dataUrl,
    });
    video.value = { url: asset.url, name: asset.name };
  } catch (e) {
    error.value = e instanceof Error ? e.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}

function removeVideo(): void {
  video.value = null;
}

function requestBody(): Record<string, unknown> {
  const options: Record<string, unknown> = {
    ratio: ratio.value,
    resolution: resolution.value,
    count: 1,
  };
  if (durations.value.length > 0) options.duration = duration.value;
  return {
    mode: apiMode.value,
    model: selectedName.value,
    input: { prompt: prompt.value.trim(), reference_uris: video.value?.url ? [video.value.url] : [] },
    options,
  };
}

async function estimateCredits(): Promise<void> {
  if (!prompt.value.trim() || !selectedName.value || !video.value) {
    estimatedCredits.value = null;
    return;
  }
  try {
    const data = await api.post<QuoteResponse>("/credits/quote", requestBody());
    estimatedCredits.value = data.credits;
  } catch {
    estimatedCredits.value = null;
  }
}

function scheduleQuote(): void {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = setTimeout(() => void estimateCredits(), 600);
}

watch([prompt, selectedName, ratio, resolution, duration, mode, video], scheduleQuote, { deep: true });

async function quote(force = false): Promise<QuoteResponse | null> {
  if (!force && !prompt.value.trim()) {
    error.value = "请先输入画面描述";
    return null;
  }
  quoting.value = true;
  error.value = "";
  try {
    const data = await api.post<QuoteResponse>("/credits/quote", requestBody());
    if (!data.sufficient) error.value = "余额不足，请先充值";
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
  if (!selectedName.value) {
    error.value = "请选择模型";
    return;
  }
  if (!video.value) {
    error.value = "请先上传源视频";
    return;
  }
  if (!prompt.value.trim()) {
    error.value = "请先输入画面描述";
    return;
  }
  submitting.value = true;
  try {
    const q = await quote(true);
    if (!q || !q.sufficient) return;
    const created = await api.post<{ task_id: string }>(
      "/generations",
      { ...requestBody(), quote_id: q.quote_id },
      { headers: { "Idempotency-Key": newIdempotencyKey() } },
    );
    await auth.me();
    task.value = await api.get<TaskDto>(`/tasks/${created.task_id}`);
    await loadHistory();
    startPolling(created.task_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

function startPolling(taskId: string): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const latest = await api.get<TaskDto>(`/tasks/${taskId}`);
      task.value = latest;
      if (
        [
          TaskStatus.SUCCEEDED,
          TaskStatus.FAILED,
          TaskStatus.CANCELED,
          TaskStatus.REVIEW_REJECTED,
        ].includes(latest.status as never)
      ) {
        if (pollTimer) clearInterval(pollTimer);
        await auth.me();
        await loadHistory();
      }
    } catch {
      if (pollTimer) clearInterval(pollTimer);
    }
  }, 2000);
}

async function loadHistory(): Promise<void> {
  try {
    const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=20&capability=video");
    history.value = data.list;
  } catch {
    /* 单次失败不打断主流程 */
  }
}

async function download(item: TaskDto, index = 1): Promise<void> {
  try {
    const data = await api.get<{ url: string }>(`/tasks/${item.task_id}/results/${index}/download-url`);
    window.open(data.url, "_blank");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "下载失败");
  }
}

onMounted(async () => {
  await Promise.all([loadModels(), loadHistory()]);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (quoteTimer) clearTimeout(quoteTimer);
});
</script>

<template>
  <div class="media-gen">
    <!-- 左：创作面板 -->
    <section class="panel left-panel">
      <div class="mode-tabs">
        <button
          v-for="tab in MODE_TABS"
          :key="tab.key"
          type="button"
          class="mode-tab mg-mode-tab"
          :class="{ on: mode === tab.key }"
          @click="switchMode(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="scroll">
        <div class="field">
          <div class="field-head">
            <span class="field-label">源视频</span>
            <span class="field-hint">{{ video ? "1/1" : "0/1" }}</span>
          </div>
          <div class="uploads">
            <div v-if="video" class="thumb mg-thumb">
              <video :src="video.url" muted playsinline preload="metadata" />
              <button type="button" class="thumb-remove" @click="removeVideo">✕</button>
            </div>
            <button
              v-else
              type="button"
              class="upload-slot"
              :disabled="uploading"
              @click="videoInput?.click()"
            >
              <span v-if="uploading">上传中…</span>
              <template v-else>
                <span class="upload-plus">＋</span>
                <span class="upload-text">上传视频</span>
              </template>
            </button>
            <input
              ref="videoInput"
              type="file"
              accept="video/*"
              class="hidden-input mg-upload"
              @change="onFileChange"
            />
          </div>
          <p class="cv-hint">
            支持 mp4 / mov / webm，≤32MB。{{ modeLabel }}需要以这段视频为源，空源视频不会提交。
          </p>
        </div>

        <div class="field">
          <span class="field-label">提示词</span>
          <div class="prompt-box">
            <textarea
              v-model="prompt"
              class="mg-prompt"
              maxlength="2000"
              :placeholder="
                mode === 'extend'
                  ? '描述接下来发生什么：动作、镜头运动与节奏'
                  : mode === 'edit'
                    ? '描述要改成什么样：替换主体、风格或局部内容'
                    : '描述想参考这个视频的哪些方面：运镜、节奏或画面风格'
              "
            />
          </div>
        </div>

        <div class="field">
          <span class="field-label">模型</span>
          <select v-model="selectedName" class="mg-model" @change="applyDefaults">
            <option v-for="m in models" :key="m.name" :value="m.name">
              {{ m.display_name }}{{ m.description ? ` · ${m.description}` : "" }}
            </option>
          </select>
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
                class="pill mg-ratio"
                :class="{ on: ratio === r }"
                @click="ratio = r"
              >
                {{ r }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-name">清晰度</span>
            <div class="pills">
              <button
                v-for="r in resolutions"
                :key="r.value"
                type="button"
                class="pill mg-res"
                :class="{ on: resolution === r.value }"
                @click="resolution = r.value"
              >
                {{ r.label }}
              </button>
            </div>
          </div>
          <div v-if="durations.length" class="setting-row">
            <span class="setting-name">时长</span>
            <div class="pills">
              <button
                v-for="d in durations"
                :key="d"
                type="button"
                class="pill mg-duration"
                :class="{ on: duration === d }"
                @click="duration = d"
              >
                {{ d }}s
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="quote-row">
          <span>预计消耗</span>
          <b class="mg-quote">{{ estimatedCredits != null ? `${estimatedCredits} 积分` : "—" }}</b>
        </div>
        <p v-if="error" class="error mg-error">{{ error }}</p>
        <button class="submit mg-submit" type="button" :disabled="submitting || quoting" @click="submit">
          {{ submitting ? "提交中…" : "立即生成" }}
        </button>
        <p class="hint">生成内容须遵守平台规范；单价由后台价目表控制，不在此写死。</p>
      </div>
    </section>

    <!-- 右：结果 -->
    <section class="panel right-panel">
      <header class="right-head">
        <h2>{{ modeLabel }}结果</h2>
        <span v-if="task" class="status mg-status" :class="`s-${task.status}`">{{ statusText }}</span>
      </header>

      <div v-if="task && taskVideos.length" class="results mg-results">
        <figure v-for="(uri, i) in taskVideos" :key="uri" class="result-card mg-result">
          <video :src="uri" controls playsinline preload="metadata" />
          <figcaption>
            <button type="button" class="ghost" @click="download(task, i + 1)">下载</button>
          </figcaption>
        </figure>
      </div>
      <div v-else-if="task" class="placeholder">
        <p>{{ statusText }}…</p>
        <p class="sub">完成后自动出现在这里（{{ task.progress }}%）</p>
      </div>
      <div v-else class="placeholder">
        <p>还没有生成结果</p>
        <p class="sub">上传源视频、写好描述，点「立即生成」</p>
      </div>

      <div v-if="historyVideos.length" class="history mg-history">
        <div class="history-head">最近的后期结果</div>
        <div class="history-grid">
          <button
            v-for="item in historyVideos"
            :key="item.task_id"
            type="button"
            class="history-item"
            :title="item.input?.prompt ?? item.task_id"
            @click="download(item)"
          >
            <img
              :src="(item.results ?? []).find((r) => r.preview_uri || r.uri)?.preview_uri ?? ''"
              alt=""
              loading="lazy"
            />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.media-gen {
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
  overflow: auto;
}

.mode-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: #0f0f12;
}

.mode-tab {
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
}

.mode-tab.on {
  background: var(--bg-raised);
  color: var(--text-1);
  font-weight: 600;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 4px;
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
  color: var(--text-2);
}

.field-hint {
  font-size: 12px;
  color: var(--text-3);
}

.prompt-box {
  border-radius: 8px;
  background: var(--bg-raised);
  padding: 10px 12px;
}

.prompt-box textarea {
  width: 100%;
  min-height: 110px;
  border: 0;
  outline: 0;
  resize: vertical;
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.7;
  font-family: inherit;
}

.uploads {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.thumb {
  position: relative;
  width: 140px;
  height: 88px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-sunken);
}

.thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: #000c;
  color: #fff;
  font-size: 11px;
  cursor: pointer;
}

.upload-slot {
  width: 140px;
  height: 88px;
  border: 1px dashed var(--panel-line);
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}

.upload-plus {
  font-size: 20px;
}

.upload-text {
  font-size: 12px;
}

.hidden-input {
  display: none;
}

.mg-model {
  height: 38px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: var(--bg-raised);
  color: var(--text-1);
  padding: 0 10px;
  font-size: 13px;
  outline: none;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.setting-name {
  width: 48px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-3);
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.pill.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--panel-line);
  padding-top: 12px;
}

.quote-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}

.quote-row b {
  color: var(--brand-on-soft);
  font-size: 15px;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.submit {
  height: 42px;
  border: 0;
  border-radius: 8px;
  background: var(--brand-500);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.right-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 12px;
}

.right-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-tint);
  color: var(--text-2);
}

.status.s-3 {
  color: var(--success);
  background: var(--success-bg);
}

.status.s-4,
.status.s-7 {
  color: var(--danger);
  background: var(--danger-bg);
}

.results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.result-card {
  margin: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-sunken);
}

.result-card video {
  width: 100%;
  display: block;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: #000;
}

.result-card figcaption {
  display: flex;
  justify-content: flex-end;
  padding: 6px 8px;
}

.ghost {
  border: 0;
  background: transparent;
  color: var(--brand-on-soft);
  font-size: 12px;
  cursor: pointer;
}

.placeholder {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 13px;
}

.placeholder .sub {
  font-size: 12px;
  opacity: 0.8;
}

.history {
  margin-top: 18px;
  border-top: 1px solid var(--panel-line);
  padding-top: 12px;
}

.history-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 10px;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.history-item {
  border: 0;
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-sunken);
  cursor: pointer;
  aspect-ratio: 16 / 9;
}

.history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
