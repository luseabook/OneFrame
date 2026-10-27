<script setup lang="ts">
// 工具箱通用工作台（第 3 批）
//
// 设计取向：**一切来自服务端目录**（`GET /generations/tools`）。参数面板、输入槽、
// 档位选项、结果媒体类型都由 `tool-catalog.ts` 声明，这个组件不认任何具体工具名——
// 新增一个工具只改服务端一处，页面复用同一套「参数 → 报价 → 投递 → 轮询 → 结果」骨架。
//
// 协议沿用既有任务脊柱（ADR-003：不新增生成端点）：
//   POST /credits/quote（报价）→ POST /generations（建任务）→ GET /tasks/:id（轮询）
//   → GET /tasks/:id/results/:n/download-url（取预签名 URL 下载/播放）
import type { AssetDto, QuoteResponse, TaskDto, ToolCatalogDto, ToolModeDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

const props = defineProps<{ tools: string[] }>();

const api = useApi();
const auth = useAuth();
const toast = useToast();

const catalog = ref<ToolCatalogDto | null>(null);
const loading = ref(true);
const loadError = ref("");
const activeKey = ref(props.tools[0] ?? "");

const pageTools = computed<ToolModeDto[]>(() => {
  const all = catalog.value?.tools ?? [];
  return props.tools.map((key) => all.find((t) => t.key === key)).filter((t): t is ToolModeDto => Boolean(t));
});
const tool = computed<ToolModeDto | null>(
  () => pageTools.value.find((t) => t.key === activeKey.value) ?? pageTools.value[0] ?? null,
);

// ── 参数面板 ──
const values = ref<Record<string, string | number | boolean>>({});
/** 输出档位（upscale 的 1080p/2K/4K 等）；单档工具隐藏该控件但仍随请求发送 */
const resolution = ref("");

function applyDefaults(): void {
  const next: Record<string, string | number | boolean> = {};
  for (const p of tool.value?.params ?? []) next[p.key] = p.default;
  values.value = next;
  resolution.value = tool.value?.default_resolution ?? "";
  error.value = "";
  estimatedCredits.value = null;
}

// ── 输入槽（提示词 / 视频 / 音频 / 图片 / 蒙版）──
const prompt = ref("");
const picked = ref<Record<string, { url: string; name: string } | null>>({});
const uploading = ref<Record<string, boolean>>({});
const fileInputs = ref<Record<string, HTMLInputElement | null>>({});
const resultUrls = ref<string[]>([]);

const promptSlot = computed(() => tool.value?.inputs.find((i) => i.key === "prompt") ?? null);
const uploadSlots = computed(() => (tool.value?.inputs ?? []).filter((i) => i.key !== "prompt"));

function setFileInput(key: string, el: unknown): void {
  fileInputs.value[key] = (el as HTMLInputElement | null) ?? null;
}

function triggerUpload(key: string): void {
  fileInputs.value[key]?.click();
}

async function onFileChange(key: string, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const slot = tool.value?.inputs.find((i) => i.key === key);
  const maxMb = slot?.maxSizeMb ?? 32;
  const accept = slot?.accept ?? "";
  const okType = accept ? accept.split(",").some((rule) => {
    const prefix = rule.replace("/*", "/");
    return file.type.startsWith(prefix);
  }) : true;
  if (!okType) {
    error.value = `请上传 ${slot?.label ?? "素材"}（${accept}）`;
    return;
  }
  if (file.size > maxMb * 1024 * 1024) {
    error.value = `文件需小于 ${maxMb}MB`;
    return;
  }
  uploading.value = { ...uploading.value, [key]: true };
  error.value = "";
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<AssetDto>("/assets/upload", {
      filename: file.name.slice(0, 200),
      content_type: file.type || "application/octet-stream",
      data_base64: dataUrl,
    });
    picked.value = { ...picked.value, [key]: { url: asset.url, name: asset.name } };
    scheduleQuote();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "上传失败";
  } finally {
    uploading.value = { ...uploading.value, [key]: false };
  }
}

function clearSlot(key: string): void {
  picked.value = { ...picked.value, [key]: null };
  scheduleQuote();
}

// ── 报价 / 投递 / 轮询 ──
const quoting = ref(false);
const submitting = ref(false);
const error = ref("");
const estimatedCredits = ref<number | null>(null);
const task = ref<TaskDto | null>(null);
const history = ref<TaskDto[]>([]);
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const modeSet = computed(() => new Set(pageTools.value.map((t) => t.mode)));
const historyRows = computed(() => history.value.filter((row) => modeSet.value.has(row.mode)));

/** 参考素材顺序必须与目录声明的 inputs 顺序一致（如对口型 = [视频, 音频]） */
function referenceUris(): string[] {
  const out: string[] = [];
  for (const slot of uploadSlots.value) {
    const item = picked.value[slot.key];
    if (item?.url) out.push(item.url);
  }
  return out;
}

function requestBody(): Record<string, unknown> {
  const current = tool.value;
  if (!current) return {};
  const options: Record<string, unknown> = {
    ratio: "9:16",
    resolution: resolution.value || current.default_resolution,
    duration: 5,
    count: 1,
  };
  for (const p of current.params) options[p.key] = values.value[p.key];
  Object.assign(options, current.fixed_options ?? {});
  return {
    mode: current.mode,
    model: current.model.name,
    input: { prompt: prompt.value.trim(), reference_uris: referenceUris() },
    options,
  };
}

function missingSlot(): string {
  const current = tool.value;
  if (!current) return "工具未加载";
  for (const slot of current.inputs) {
    if (!slot.required) continue;
    if (slot.key === "prompt" && !prompt.value.trim()) return `请填写${slot.label}`;
    if (slot.key !== "prompt" && !picked.value[slot.key]?.url) return `请上传${slot.label}`;
  }
  // 内容型必填参数（如文字重绘的替换文字）：空串提交会被服务端拒，提前在这里挡住
  for (const key of current.required_params ?? []) {
    const value = values.value[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      return `请填写${current.params.find((p) => p.key === key)?.label ?? key}`;
    }
  }
  return "";
}

async function estimateCredits(): Promise<void> {
  if (!tool.value) return;
  const missing = missingSlot();
  if (missing) {
    estimatedCredits.value = null;
    return;
  }
  try {
    const data = await api.post<QuoteResponse>("/credits/quote", requestBody());
    estimatedCredits.value = data.credits;
  } catch {
    // 静默：参数还没填全时报价失败是常态，不打扰用户（唯一例外是显式点「立即生成」）
    estimatedCredits.value = null;
  }
}

function scheduleQuote(): void {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = setTimeout(() => void estimateCredits(), 500);
}

watch([prompt, values, tool], scheduleQuote, { deep: true });

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submit(): Promise<void> {
  error.value = "";
  if (!tool.value) return;
  const missing = missingSlot();
  if (missing) {
    error.value = missing;
    return;
  }
  submitting.value = true;
  try {
    const quote = await api.post<QuoteResponse>("/credits/quote", requestBody());
    if (!quote.sufficient) {
      error.value = "积分不足，请先充值";
      return;
    }
    const created = await api.post<{ task_id: string }>(
      "/generations",
      { ...requestBody(), quote_id: quote.quote_id },
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

async function loadResultUrls(row: TaskDto): Promise<void> {
  const items = row.results ?? [];
  const urls: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    try {
      const data = await api.get<{ url: string }>(`/tasks/${row.task_id}/results/${i + 1}/download-url`);
      urls.push(data.url);
    } catch {
      // 单条取不到不影响其它产物（切片/拆轨天然是多产物）
    }
  }
  resultUrls.value = urls;
}

function startPolling(taskId: string): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const latest = await api.get<TaskDto>(`/tasks/${taskId}`);
      task.value = latest;
      if ([TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED, TaskStatus.REVIEW_REJECTED].includes(latest.status as never)) {
        if (pollTimer) clearInterval(pollTimer);
        if (latest.status === TaskStatus.SUCCEEDED) await loadResultUrls(latest);
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
    const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=30");
    history.value = data.list;
  } catch {
    /* 历史加载失败不影响主流程 */
  }
}

function openHistory(row: TaskDto): void {
  task.value = row;
  resultUrls.value = [];
  if (row.status === TaskStatus.SUCCEEDED) void loadResultUrls(row);
  if (![TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED, TaskStatus.REVIEW_REJECTED].includes(row.status as never)) {
    startPolling(row.task_id);
  }
}

async function loadCatalog(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    catalog.value = await api.get<ToolCatalogDto>("/generations/tools");
    if (!pageTools.value.some((t) => t.key === activeKey.value)) activeKey.value = pageTools.value[0]?.key ?? "";
    applyDefaults();
    await loadHistory();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "工具箱加载失败";
  } finally {
    loading.value = false;
  }
}

function switchTool(key: string): void {
  if (activeKey.value === key) return;
  activeKey.value = key;
  prompt.value = "";
  picked.value = {};
  task.value = null;
  resultUrls.value = [];
  if (pollTimer) clearInterval(pollTimer);
  applyDefaults();
  scheduleQuote();
}

function paramOptions(p: { options?: Array<{ value: string; label: string }> }): Array<{ value: string; label: string }> {
  return p.options ?? [];
}

function downloadAll(): void {
  if (resultUrls.value.length === 0) {
    toast.error("暂无可下载的产物");
    return;
  }
  for (const url of resultUrls.value) window.open(url, "_blank");
}

function openUrl(url: string): void {
  window.open(url, "_blank");
}

onMounted(() => {
  void loadCatalog();
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (quoteTimer) clearTimeout(quoteTimer);
});
</script>

<template>
  <div class="tool-ws">
    <section class="panel left-panel">
      <div v-if="pageTools.length > 1" class="mode-tabs">
        <button
          v-for="item in pageTools"
          :key="item.key"
          type="button"
          class="mode-tab"
          :class="{ on: item.key === activeKey }"
          @click="switchTool(item.key)"
        >
          {{ item.title }}
        </button>
      </div>

      <div v-if="loading" class="state">正在加载工具箱…</div>
      <div v-else-if="loadError" class="state error-state">
        <p>{{ loadError }}</p>
        <button type="button" class="mini" @click="loadCatalog">重试</button>
      </div>

      <template v-else-if="tool">
        <div class="scroll">
          <p class="tool-desc">{{ tool.title }} · {{ tool.model.description }}</p>

          <div v-for="slot in uploadSlots" :key="slot.key" class="field">
            <div class="field-head">
              <span class="field-label">{{ slot.label }}<i v-if="slot.required" class="req">*</i></span>
              <span v-if="slot.hint" class="field-hint">{{ slot.hint }}</span>
            </div>
            <div v-if="picked[slot.key]" class="picked">
              <video v-if="slot.key === 'video'" :src="picked[slot.key]!.url" class="picked-media" muted playsinline />
              <img
                v-else-if="slot.key === 'image' || slot.key === 'mask'"
                :src="picked[slot.key]!.url"
                :alt="slot.label"
                class="picked-media"
              />
              <div v-else class="picked-audio">♪ {{ picked[slot.key]!.name }}</div>
              <button type="button" class="picked-clear" aria-label="移除" @click="clearSlot(slot.key)">✕</button>
            </div>
            <button
              v-else
              type="button"
              class="upload-slot"
              :disabled="uploading[slot.key]"
              @click="triggerUpload(slot.key)"
            >
              <span v-if="uploading[slot.key]">上传中…</span>
              <template v-else>
                <span class="upload-plus">＋</span>
                <span>{{ slot.label }}</span>
              </template>
            </button>
            <input
              :ref="(el) => setFileInput(slot.key, el)"
              type="file"
              :accept="slot.accept"
              class="hidden-input"
              @change="onFileChange(slot.key, $event)"
            />
          </div>

          <div v-if="promptSlot" class="field">
            <div class="field-head">
              <span class="field-label">{{ promptSlot.label }}<i v-if="promptSlot.required" class="req">*</i></span>
              <span class="field-hint">{{ prompt.length }}/2000</span>
            </div>
            <textarea
              v-model="prompt"
              class="prompt"
              maxlength="2000"
              :placeholder="promptSlot.placeholder || '请输入内容'"
            />
          </div>

          <div v-if="tool.params.length" class="field">
            <span class="field-label">参数</span>
            <div v-for="p in tool.params" :key="p.key" class="setting-row">
              <span class="setting-name">{{ p.label }}</span>
              <div class="pills">
                <template v-if="p.type === 'select'">
                  <button
                    v-for="opt in paramOptions(p)"
                    :key="opt.value"
                    type="button"
                    class="pill"
                    :class="{ on: values[p.key] === opt.value }"
                    @click="values[p.key] = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </template>
                <input
                  v-else-if="p.type === 'number'"
                  v-model.number="values[p.key]"
                  type="number"
                  class="num-input"
                  :min="p.min"
                  :max="p.max"
                  :step="p.step ?? 1"
                />
                <input
                  v-else-if="p.type === 'text'"
                  v-model="values[p.key]"
                  type="text"
                  class="text-input"
                  :placeholder="p.label"
                />
                <label v-else class="switch-row">
                  <input v-model="values[p.key]" type="checkbox" />
                  <span>{{ values[p.key] ? "开启" : "关闭" }}</span>
                </label>
                <span v-if="p.unit" class="unit">{{ p.unit }}</span>
              </div>
            </div>
          </div>

          <div v-if="tool.resolution_options.length > 1" class="field">
            <span class="field-label">输出档位</span>
            <div class="pills">
              <button
                v-for="opt in tool.resolution_options"
                :key="opt.value"
                type="button"
                class="pill"
                :class="{ on: resolution === opt.value }"
                @click="resolution = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <div class="generate-wrap">
          <div class="quote-row">
            <span>积分消耗</span>
            <b>✦ {{ estimatedCredits ?? "—" }}</b>
          </div>
          <button type="button" class="generate" :disabled="submitting || quoting" @click="submit">
            {{ submitting ? "提交中…" : "立即生成" }}
          </button>
          <p class="disclaimer">内容由 AI 生成，请仔细甄别</p>
        </div>
      </template>

      <div v-else class="state">该工具暂未开放</div>
    </section>

    <section class="panel right-panel">
      <header class="result-head">
        <span class="result-title">生成结果</span>
        <button v-if="resultUrls.length" type="button" class="mini" @click="downloadAll">全部下载</button>
      </header>

      <div class="result-body">
        <article v-if="task" class="result-live">
          <div class="result-media" :data-media="tool?.result_media ?? 'video'">
            <template v-if="task.status === TaskStatus.SUCCEEDED && resultUrls.length">
              <video v-if="tool?.result_media === 'video'" :src="resultUrls[0]" controls playsinline />
              <img v-else-if="tool?.result_media === 'image'" :src="resultUrls[0]" :alt="tool?.title ?? '结果'" />
              <audio v-else :src="resultUrls[0]" controls />
            </template>
            <div v-else class="placeholder">
              <span v-if="task.status === TaskStatus.SUCCEEDED">已完成，正在取产物…</span>
              <span v-else-if="task.status === TaskStatus.FAILED || task.status === TaskStatus.REVIEW_REJECTED">
                {{ statusLabel(task.status) }}：{{ task.error?.message ?? "生成失败" }}
              </span>
              <span v-else>{{ statusLabel(task.status) }} {{ task.progress ?? 0 }}%</span>
            </div>
          </div>
          <div class="result-meta">
            <span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span>
            <span class="meta-mode">{{ task.mode }}</span>
            <span class="meta-time">{{ new Date(task.created_at).toLocaleString("zh-CN") }}</span>
          </div>
          <div v-if="resultUrls.length > 1" class="multi-list">
            <button
              v-for="(url, i) in resultUrls"
              :key="url"
              type="button"
              class="mini"
              @click="openUrl(url)"
            >
              产物 {{ i + 1 }}
            </button>
          </div>
        </article>

        <div v-if="historyRows.length" class="history">
          <p class="history-title">最近任务</p>
          <button
            v-for="row in historyRows"
            :key="row.task_id"
            type="button"
            class="history-row"
            @click="openHistory(row)"
          >
            <span class="status" :data-status="row.status">{{ statusLabel(row.status) }}</span>
            <span class="history-mode">{{ row.mode }}</span>
            <span class="history-time">{{ new Date(row.created_at).toLocaleString("zh-CN") }}</span>
          </button>
        </div>

        <div v-else-if="!task" class="empty">
          <p>还没有任务，左侧填好参数后点「立即生成」</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tool-ws {
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

.mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: #0f0f12;
}

.mode-tab {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}

.mode-tab.on {
  background: #26262c;
  color: var(--text-1);
  font-weight: 600;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 2px;
}

.tool-desc {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
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
  margin-left: 2px;
  color: var(--danger);
  font-style: normal;
}

.field-hint {
  font-size: 11px;
  color: var(--text-4);
}

.prompt {
  width: 100%;
  min-height: 96px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #0d0d10;
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.7;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}

.prompt::placeholder {
  color: var(--text-4);
}

.upload-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 76px;
  border-radius: 8px;
  border: 1px dashed #ffffff1f;
  background: #0d0d10;
  color: var(--text-4);
  font-size: 12px;
  cursor: pointer;
}

.upload-slot:hover {
  border-color: var(--brand-500);
  color: var(--brand-300);
}

.upload-plus {
  font-size: 16px;
}

.hidden-input {
  display: none;
}

.picked {
  position: relative;
  width: 120px;
  height: 76px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #ffffff1a;
  background: #0d0d10;
  display: grid;
  place-items: center;
}

.picked-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.picked-audio {
  color: var(--text-2);
  font-size: 11px;
  padding: 6px;
  text-align: center;
  word-break: break-all;
}

.picked-clear {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 0;
  background: #000000a8;
  color: #fff;
  font-size: 10px;
  cursor: pointer;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-name {
  flex: 0 0 96px;
  font-size: 12px;
  color: var(--text-3);
}

.pills {
  display: flex;
  align-items: center;
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

.num-input,
.text-input {
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #ffffff14;
  background: #141418;
  color: var(--text-1);
  font-size: 12px;
  width: 96px;
  outline: none;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}

.switch-row input {
  accent-color: var(--brand-500);
}

.unit {
  color: var(--text-4);
  font-size: 11px;
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

.error-state {
  gap: 10px;
  grid-auto-flow: row;
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
  font-weight: 600;
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

.mini:hover {
  color: var(--text-1);
  border-color: #ffffff3d;
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
  margin-bottom: 14px;
}

.result-media {
  display: grid;
  place-items: center;
  background: #000;
  min-height: 220px;
  padding: 8px;
  box-sizing: border-box;
}

.result-media[data-media="video"] {
  aspect-ratio: 16 / 9;
}

.result-media video,
.result-media img {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.result-media audio {
  width: 100%;
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

.status[data-status="7"] {
  background: #3a2a12;
  color: #f5b544;
}

.meta-mode,
.meta-time {
  color: var(--text-4);
  font-size: 11px;
}

.multi-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 12px 12px;
}

.history {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-title {
  margin: 0 0 4px;
  color: var(--text-3);
  font-size: 12px;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #ffffff12;
  background: #101014;
  color: var(--text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.history-row:hover {
  border-color: #ffffff2e;
}

.history-mode {
  color: var(--text-3);
}

.history-time {
  margin-left: auto;
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
  .tool-ws {
    grid-template-columns: 1fr;
    height: auto;
  }

  .right-panel {
    min-height: 420px;
  }
}
</style>
