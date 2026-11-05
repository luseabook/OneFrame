<script setup lang="ts">
// 图片生成工作台（文生图 / 图生图）
//
// 与视频工具页同构：左侧参数 + 立即生成，右侧结果与历史。
// 协议完全复用既有脊柱——`/credits/quote` 报价 → `/generations` 建任务 → `/tasks/:id` 轮询，
// 不新增任何端点（工具只是"参数面板"，ADR-003）。
import type { AssetDto, ImageEffectDto, ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

const props = withDefaults(defineProps<{ initialMode?: "text2image" | "image2image" }>(), {
  initialMode: "text2image",
});

const api = useApi();
const auth = useAuth();
const toast = useToast();

type ImgMode = "text2image" | "image2image";
const mode = ref<ImgMode>(props.initialMode);
/**
 * 只放"已经能跑"的两种模式。
 *
 * 涂抹重绘 / 文字重绘需要蒙版（brush）参数与独立交互，本轮不放进这个工作台——
 * 放进来却没有蒙版，用户点了只会得到一张"和原图差不多"的图，比没有入口更糟。
 */
const MODE_TABS: Array<{ key: ImgMode; label: string }> = [
  { key: "text2image", label: "文生图" },
  { key: "image2image", label: "图生图" },
];

const allModels = ref<ModelDto[]>([]);
const selectedName = ref("");
const prompt = ref("");
const ratio = ref("1:1");
const resolution = ref("1K");
const count = ref(1);

const images = ref<Array<{ id: string; url: string; name: string }>>([]);
const imageInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const IMAGE_LIMIT = 3;

/**
 * 风格目录（图生图专用）。
 *
 * 图生图走剪影生图网关做风格迁移时 `options.effect` 是必填的：不给就被网关内置默认值
 * （3D 童话）兜走，用户上传什么照片都变成同一种风格。所以这个目录只服务图生图，
 * 且绝不在前端替用户默认选中——空就是空，让「请先选择风格」的守卫去说话。
 */
const effects = ref<ImageEffectDto[]>([]);
const effect = ref("");
const effectsLoading = ref(false);
const effectsError = ref("");
/** 只在首次进图生图时拉一次；失败后归零，下次切回来还能重试 */
let effectsRequested = false;

const estimatedCredits = ref<number | null>(null);
const quoting = ref(false);
const submitting = ref(false);
const error = ref("");
const task = ref<TaskDto | null>(null);
const history = ref<TaskDto[]>([]);
let pollTimer: ReturnType<typeof setInterval> | undefined;
let quoteTimer: ReturnType<typeof setTimeout> | undefined;

const models = computed(() =>
  allModels.value.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, mode.value)),
);
const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => (selected.value ? selected.value.modes[mode.value] ?? null : null));
const ratios = computed(() => modeCfg.value?.ratios ?? ["1:1", "16:9", "9:16"]);
const resolutions = computed(
  () => modeCfg.value?.resolution_options ?? [{ value: "1K", label: "1K" }],
);
const counts = computed(() => modeCfg.value?.counts ?? [1, 2, 3, 4]);
/**
 * 实际可上传张数：**目录优先**。
 *
 * 为什么不能只用常量：不同模型对参考图的数量上限不同（剪影生图网关只接受 1 张，
 * 第 2 张在我方约定里是蒙版位且尚未接线——多传一张会被适配器判成"要重绘"而报错）。
 * `models.modes[mode].media_limits.image` 就是目录里声明的这个上限。
 */
const imageLimit = computed(() => {
  const configured = modeCfg.value?.media_limits?.image;
  return typeof configured === "number" && configured > 0 ? configured : IMAGE_LIMIT;
});
/** 换模型/换档位把上限压小时，已选的多余图片必须裁掉，否则会带着超限 reference_uris 提交 */
watch(imageLimit, (limit) => {
  if (images.value.length > limit) images.value = images.value.slice(0, limit);
});
const modeLabel = computed(() => MODE_TABS.find((t) => t.key === mode.value)?.label ?? "图片生成");
const statusText = computed(() => (task.value ? statusLabel(task.value.status) : ""));
const taskImages = computed(() =>
  (task.value?.results ?? [])
    // 优先用后端现签 `url`；`uri` 是 storage key（`u/<space>/tasks/<id>/r0.png`），
    // 直接当 `<img src>` 会 404（浏览器会在当前域下找这个相对路径）。
    .map((r) => r.url ?? r.uri ?? r.preview_uri ?? "")
    .filter(Boolean),
);
/** 历史结果：只列真的出过图的（排队/失败的卡片点开是空白，反而让人以为坏了） */
const historyImages = computed(() =>
  history.value.filter((t) => (t.results ?? []).some((r) => r.url || r.uri || r.preview_uri)),
);
/** 历史缩略图状态：优先签好的 url */
const historyThumb = (t: { results?: Array<{ url?: string; uri?: string; preview_uri?: string }> | null }): string => {
  const first = (t.results ?? []).find((r) => r.url || r.uri || r.preview_uri);
  return first?.url ?? first?.uri ?? first?.preview_uri ?? "";
};

/** 模型目录决定默认档位：图像是 1K/2K/4K，写死 720p 会 100% 报"resolution not supported" */
function applyDefaults(): void {
  const cfg = modeCfg.value;
  ratio.value = cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "1:1";
  resolution.value = cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "1K";
  count.value = cfg?.default_count ?? cfg?.counts?.[0] ?? 1;
}

async function loadModels(): Promise<void> {
  const all = await api.get<ModelDto[]>("/models?capability=image&visible=true");
  allModels.value = all;
  const list = all.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, mode.value));
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
}

/** 惰性拉风格目录：拉失败只让「风格」这一行显示一行中文提示，不阻塞文生图 */
async function loadEffects(): Promise<void> {
  if (effectsRequested || effectsLoading.value) return;
  effectsRequested = true;
  effectsLoading.value = true;
  effectsError.value = "";
  try {
    effects.value = await api.get<ImageEffectDto[]>("/effects");
  } catch (e) {
    effects.value = [];
    effectsError.value = e instanceof Error && e.message ? e.message : "风格加载失败，请稍后重试";
    effectsRequested = false;
  } finally {
    effectsLoading.value = false;
  }
}

function switchMode(next: ImgMode): void {
  if (mode.value === next) return;
  mode.value = next;
  images.value = [];
  // 风格只影响图生图的 options.effect；切回文生图必须清掉，免得残留参数污染请求
  if (next === "text2image") effect.value = "";
  else void loadEffects();
  const list = models.value;
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
  error.value = "";
}

function requestBody(): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: prompt.value.trim() };
  if (mode.value === "image2image") input.reference_uris = images.value.map((img) => img.url);
  const options: Record<string, unknown> = { ratio: ratio.value, resolution: resolution.value, count: count.value };
  // 只在图生图带 effect：文生图不带，免得给别的供应商的参数校验塞一个不认识的字段
  if (mode.value === "image2image" && effect.value) options.effect = effect.value;
  return {
    mode: mode.value,
    model: selectedName.value,
    input,
    options,
  };
}

/** 静默估算积分（输入过程中不弹错误，避免每敲一个字都报一次） */
async function estimateCredits(): Promise<void> {
  if (!prompt.value.trim() || !selectedName.value) {
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

watch([prompt, selectedName, ratio, resolution, count, mode, effect], scheduleQuote);

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).slice(0, imageLimit.value - images.value.length);
  input.value = "";
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      error.value = "请上传图片文件";
      continue;
    }
    if (file.size > 8 * 1024 * 1024) {
      error.value = "图片需小于 8MB";
      continue;
    }
    uploading.value = true;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      const asset = await api.post<AssetDto>("/assets/upload", {
        filename: file.name.slice(0, 200),
        content_type: file.type || "image/png",
        data_base64: dataUrl,
      });
      images.value.push({ id: asset.id, url: asset.url, name: asset.name });
    } catch (e) {
      error.value = e instanceof Error ? e.message : "上传失败";
    } finally {
      uploading.value = false;
    }
  }
}

function removeImage(index: number): void {
  images.value.splice(index, 1);
}

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
  if (!prompt.value.trim()) {
    error.value = "请先输入画面描述";
    return;
  }
  if (mode.value === "image2image" && images.value.length === 0) {
    error.value = "图生图请先上传一张参考图";
    return;
  }
  // 守卫放在这里而不是靠后端报错：网关缺 effect 会用内置默认值，用户根本看不见自己没选
  if (mode.value === "image2image" && !effect.value) {
    error.value = "请先选择风格";
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
    const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=12&capability=image");
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
  // 直接以图生图进来（initialMode）时也要有风格可选
  if (mode.value === "image2image") void loadEffects();
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (quoteTimer) clearTimeout(quoteTimer);
});
</script>

<template>
  <div class="img-gen">
    <!-- 左：创作面板 -->
    <section class="panel left-panel">
      <div class="mode-tabs">
        <button
          v-for="tab in MODE_TABS"
          :key="tab.key"
          type="button"
          class="mode-tab img-mode-tab"
          :class="{ on: mode === tab.key }"
          @click="switchMode(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="scroll">
        <div class="field">
          <span class="field-label">提示词</span>
          <div class="prompt-box">
            <textarea
              v-model="prompt"
              class="imgt-prompt"
              placeholder="描述你想生成的画面：主体、风格、光线、构图与画质"
              maxlength="2000"
            />
          </div>
        </div>

        <div v-if="mode === 'image2image'" class="field">
          <div class="field-head">
            <span class="field-label">参考图</span>
            <span class="field-hint">{{ images.length }}/{{ imageLimit }}</span>
          </div>
          <div class="uploads">
            <div v-for="(img, i) in images" :key="img.id" class="thumb imgt-thumb">
              <img :src="img.url" :alt="img.name" />
              <button type="button" class="thumb-remove" @click="removeImage(i)">✕</button>
            </div>
            <button
              v-if="images.length < imageLimit"
              type="button"
              class="upload-slot"
              :disabled="uploading"
              @click="imageInput?.click()"
            >
              <span v-if="uploading">上传中…</span>
              <template v-else>
                <span class="upload-plus">＋</span>
                <span class="upload-text">上传图片</span>
              </template>
            </button>
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden-input imgt-upload"
              @change="onFileChange"
            />
          </div>
        </div>

        <div class="field">
          <span class="field-label">模型</span>
          <select v-model="selectedName" class="imgt-model" @change="applyDefaults">
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
                class="pill imgt-ratio"
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
                class="pill imgt-res"
                :class="{ on: resolution === r.value }"
                @click="resolution = r.value"
              >
                {{ r.label }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <span class="setting-name">张数</span>
            <div class="pills">
              <button
                v-for="c in counts"
                :key="c"
                type="button"
                class="pill imgt-count"
                :class="{ on: count === c }"
                @click="count = c"
              >
                {{ c }}
              </button>
            </div>
          </div>
          <!-- 风格目录只服务图生图；空选是合法状态，选择成本由用户承担 -->
          <div v-if="mode === 'image2image'" class="setting-row">
            <span class="setting-name">风格</span>
            <EffectSelect
              v-model="effect"
              :effects="effects"
              :loading="effectsLoading"
              :error="effectsError"
            />
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="quote-row">
          <span>预计消耗</span>
          <b class="imgt-quote">{{ estimatedCredits != null ? `${estimatedCredits} 积分` : "—" }}</b>
        </div>
        <p v-if="mode === 'image2image' && !effect" class="hint imgt-effect-hint">
          图生图需先选择风格后再生成。
        </p>
        <p v-if="error" class="error imgt-error">{{ error }}</p>
        <button
          class="submit imgt-submit"
          type="button"
          :disabled="submitting || quoting || (mode === 'image2image' && !effect)"
          @click="submit"
        >
          {{ submitting ? "提交中…" : "立即生成" }}
        </button>
        <p class="hint">生成内容须遵守平台规范；单价由后台价目表控制，不在此写死。</p>
      </div>
    </section>

    <!-- 右：结果 -->
    <section class="panel right-panel">
      <header class="right-head">
        <h2>{{ modeLabel }}结果</h2>
        <span v-if="task" class="status imgt-status" :class="`s-${task.status}`">{{ statusText }}</span>
      </header>

      <div v-if="task && taskImages.length" class="results imgt-results">
        <figure v-for="(uri, i) in taskImages" :key="uri" class="result-card imgt-result">
          <img :src="uri" :alt="`生成结果 ${i + 1}`" loading="lazy" />
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
        <p class="sub">在左侧写好描述，点「立即生成」</p>
      </div>

      <div v-if="historyImages.length" class="history imgt-history">
        <div class="history-head">最近生成</div>
        <div class="history-grid">
          <button
            v-for="item in historyImages"
            :key="item.task_id"
            type="button"
            class="history-item"
            :title="item.input?.prompt ?? item.task_id"
            @click="download(item)"
          >
            <img :src="historyThumb(item)" alt="" loading="lazy" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.img-gen {
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
  grid-template-columns: repeat(2, 1fr);
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
  min-height: 120px;
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
  width: 88px;
  height: 88px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-sunken);
}

.thumb img {
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
  width: 88px;
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

.imgt-model {
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
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.result-card {
  margin: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-sunken);
}

.result-card img {
  width: 100%;
  display: block;
  aspect-ratio: 1 / 1;
  object-fit: cover;
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
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.history-item {
  border: 0;
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-sunken);
  cursor: pointer;
  aspect-ratio: 1 / 1;
}

.history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
