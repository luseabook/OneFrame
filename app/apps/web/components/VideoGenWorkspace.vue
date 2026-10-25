<script setup lang="ts">
// 视频生成工作台（对齐参照产品「视频生成」页 t2v.png）
// 左侧：模式 tabs / 提示词 / 参考图 / 模型 / 运镜 / 画面设置 / 立即生成
// 右侧：生成结果库（全部·视频·图片·音频 + 进行中 / 我的收藏）
import type { AssetDto, ModelDto, QuoteResponse, TaskDto } from "~/types/api";
import { statusLabel, TaskStatus } from "~/types/api";

const props = withDefaults(defineProps<{ initialMode?: "text2video" | "image2video" | "reference" }>(), {
  initialMode: "text2video",
});

const api = useApi();
const auth = useAuth();
const toast = useToast();

type GenMode = "text2video" | "image2video" | "reference";
const modeTabs: Array<{ key: GenMode; label: string; isNew?: boolean }> = [
  { key: "image2video", label: "图生视频" },
  { key: "text2video", label: "文生视频" },
  { key: "reference", label: "参考生视频", isNew: true },
];
const mode = ref<GenMode>(props.initialMode);

// ── 模型与参数 ──
const allModels = ref<ModelDto[]>([]);
const selectedName = ref("");
const ratio = ref("9:16");
const resolution = ref("720p");
const duration = ref(5);
const camera = ref("");
const enableAudio = ref(false);

const MODE_KEY: Record<GenMode, string> = {
  text2video: "text2video",
  image2video: "image2video",
  reference: "universal_reference",
};
const models = computed(() =>
  allModels.value.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, MODE_KEY[mode.value])),
);
const selected = computed(() => models.value.find((m) => m.name === selectedName.value) ?? null);
const modeCfg = computed(() => (selected.value ? selected.value.modes[MODE_KEY[mode.value]] ?? null : null));
const ratios = computed(() => modeCfg.value?.ratios ?? ["9:16", "16:9"]);
const resolutions = computed(
  () => modeCfg.value?.resolution_options ?? [{ value: "720p", label: "720P" }],
);
const durations = computed(() => modeCfg.value?.durations ?? [5]);

// ── 提示词 ──
const prompt = ref("");
const promptChips = ["小鸭", "自行车手", "航海"];
const PROMPT_TEMPLATES = [
  { title: "雨夜霓虹", text: "雨夜霓虹街道，少女撑伞回眸，电影感浅景深，镜头缓慢推近" },
  { title: "赛博航拍", text: "赛博朋克城市航拍，霓虹灯反射在雨面，扫光镜头，8K 质感" },
  { title: "国风水墨", text: "国风水墨山水，仙鹤掠过云海，留白构图，镜头平缓横移" },
];
const showWizard = ref(false);
const showMyPrompts = ref(false);
const savedPrompts = ref<string[]>([]);

// ── 参考图 / 首帧 ──
const images = ref<Array<{ id: string; url: string; name: string }>>([]);
const imageInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const imageLimit = computed(() => (mode.value === "reference" ? 3 : 1));

// ── 模型 / 运镜 选择弹层 ──
const showModelPicker = ref(false);
const showCameraPicker = ref(false);
const CAMERAS = [
  { key: "", label: "不指定运镜", phrase: "" },
  { key: "push", label: "缓慢推近", phrase: "镜头缓慢推近" },
  { key: "pull", label: "缓慢拉远", phrase: "镜头缓慢拉远" },
  { key: "pan-left", label: "向左摇镜", phrase: "镜头向左摇移" },
  { key: "pan-right", label: "向右摇镜", phrase: "镜头向右摇移" },
  { key: "follow", label: "跟随主体", phrase: "镜头跟随主体移动" },
  { key: "orbit", label: "环绕主体", phrase: "镜头环绕主体旋转" },
] as const;
const cameraLabel = computed(() => CAMERAS.find((c) => c.key === camera.value)?.label ?? "请点击选择运镜方式");

// ── 生成 / 结果 ──
const quoting = ref(false);
const submitting = ref(false);
const error = ref("");
const estimatedCredits = ref<number | null>(null);
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
const task = ref<TaskDto | null>(null);
const history = ref<TaskDto[]>([]);
const galleryTab = ref<"all" | "video" | "image" | "audio">("all");
const onlyRunning = ref(false);
const onlyFavorite = ref(false);
const favorites = ref<string[]>([]);
const previewTask = ref<TaskDto | null>(null);
let pollTimer: ReturnType<typeof setInterval> | undefined;

const shownHistory = computed(() => {
  let rows = history.value;
  if (galleryTab.value !== "all" && galleryTab.value !== "video") rows = [];
  if (onlyRunning.value) rows = rows.filter((t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.RUNNING);
  if (onlyFavorite.value) rows = rows.filter((t) => favorites.value.includes(t.task_id));
  return rows;
});

function finalPrompt(): string {
  const base = prompt.value.trim();
  const phrase = CAMERAS.find((c) => c.key === camera.value)?.phrase ?? "";
  return phrase ? `${base}，${phrase}` : base;
}

function applyDefaults(): void {
  const cfg = modeCfg.value;
  ratio.value = cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "9:16";
  resolution.value = cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "720p";
  duration.value = cfg?.default_duration ?? cfg?.durations?.[0] ?? 5;
}

async function loadModels(): Promise<void> {
  const all = await api.get<ModelDto[]>("/models?capability=video&visible=true");
  allModels.value = all;
  const list = all.filter((m) => Object.prototype.hasOwnProperty.call(m.modes, MODE_KEY[mode.value]));
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
}

function switchMode(next: GenMode): void {
  if (mode.value === next) return;
  mode.value = next;
  images.value = [];
  const list = models.value;
  selectedName.value = list[0]?.name ?? "";
  applyDefaults();
  error.value = "";
}

function pickChip(chip: string): void {
  const text =
    chip === "小鸭"
      ? "一只小黄鸭在清晨的池塘里游动，水波粼粼，镜头低角度跟随"
      : chip === "自行车手"
        ? "自行车手穿过海边公路，阳光逆光，镜头侧向跟拍"
        : "帆船在暮色海面航行，海鸟掠过，镜头缓慢拉远";
  prompt.value = prompt.value ? `${prompt.value} ${text}` : text;
}

function randomPrompt(): void {
  const template = PROMPT_TEMPLATES[Math.floor(Math.random() * PROMPT_TEMPLATES.length)]!;
  prompt.value = template.text;
  showWizard.value = false;
}

/** 静默估算积分消耗（不弹错误提示，避免输入过程中打扰） */
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

watch([prompt, selectedName, ratio, resolution, duration, camera, mode], scheduleQuote);

function useTemplate(text: string): void {
  prompt.value = text;
  showWizard.value = false;
}

function loadSavedPrompts(): void {
  try {
    const raw = localStorage.getItem("of_saved_prompts");
    savedPrompts.value = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    savedPrompts.value = [];
  }
}

function saveCurrentPrompt(): void {
  const text = prompt.value.trim();
  if (!text) return;
  if (!savedPrompts.value.includes(text)) savedPrompts.value.unshift(text);
  savedPrompts.value = savedPrompts.value.slice(0, 20);
  localStorage.setItem("of_saved_prompts", JSON.stringify(savedPrompts.value));
  toast.success("已保存到我的提示词");
}

function loadFavorites(): void {
  try {
    const raw = localStorage.getItem("of_fav_tasks");
    favorites.value = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    favorites.value = [];
  }
}

function toggleFavorite(id: string): void {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter((x) => x !== id)
    : [...favorites.value, id];
  localStorage.setItem("of_fav_tasks", JSON.stringify(favorites.value));
}

async function loadHistory(): Promise<void> {
  try {
    const data = await api.get<{ list: TaskDto[] }>("/tasks?page=1&page_size=20&capability=video");
    history.value = data.list;
  } catch {
    /* 忽略单次失败 */
  }
}

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

function requestBody(): Record<string, unknown> {
  const options = {
    ratio: ratio.value,
    resolution: resolution.value,
    duration: duration.value,
    count: 1,
    ...(selected.value?.audio_video_support ? { enable_audio: enableAudio.value } : {}),
  };
  const input: Record<string, unknown> = { prompt: finalPrompt() };
  if (mode.value === "image2video") input.first_frame_uri = images.value[0]?.url ?? "";
  if (mode.value === "reference") input.reference_uris = images.value.map((img) => img.url);
  return { mode: mode.value === "reference" ? "universal_reference" : mode.value, model: selectedName.value, input, options };
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
  if (mode.value !== "text2video" && images.value.length === 0) {
    error.value = mode.value === "image2video" ? "请先上传首帧图片" : "请至少上传一张参考图";
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
      if ([TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED, TaskStatus.REVIEW_REJECTED].includes(latest.status as never)) {
        if (pollTimer) clearInterval(pollTimer);
        await auth.me();
        await loadHistory();
      }
    } catch {
      if (pollTimer) clearInterval(pollTimer);
    }
  }, 2000);
}

async function download(item: TaskDto): Promise<void> {
  try {
    const data = await api.get<{ url: string }>(`/tasks/${item.task_id}/results/1/download-url`);
    window.open(data.url, "_blank");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "下载失败");
  }
}

onMounted(async () => {
  loadSavedPrompts();
  loadFavorites();
  try {
    await loadModels();
    await loadHistory();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  }
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="video-gen">
    <!-- 左：创作面板 -->
    <section class="panel left-panel">
      <div class="mode-tabs">
        <button
          v-for="tab in modeTabs"
          :key="tab.key"
          type="button"
          class="mode-tab"
          :class="{ on: mode === tab.key }"
          @click="switchMode(tab.key)"
        >
          {{ tab.label }}
          <span v-if="tab.isNew" class="new-badge">NEW</span>
        </button>
      </div>

      <div class="scroll">
        <div class="field">
          <div class="field-head">
            <span class="field-label">提示词</span>
            <div class="field-actions">
              <button class="ghost" type="button" @click="showWizard = true">✦ 创意向导</button>
              <button class="ghost" type="button" @click="showMyPrompts = true">✎ 我的提示词</button>
            </div>
          </div>
          <div class="prompt-box">
            <textarea
              v-model="prompt"
              placeholder="请描述你想生成的视频内容，使用创意向导 帮助您润色灵感"
              maxlength="2000"
            />
            <button class="copy" type="button" aria-label="保存提示词" @click="saveCurrentPrompt">⧉</button>
          </div>
          <div class="chips">
            <button v-for="chip in promptChips" :key="chip" type="button" class="chip" @click="pickChip(chip)">
              {{ chip }}
            </button>
            <button type="button" class="chip dice" aria-label="随机灵感" title="随机灵感" @click="randomPrompt">🎲</button>
          </div>
        </div>

        <div v-if="mode !== 'text2video'" class="field">
          <div class="field-head">
            <span class="field-label">{{ mode === "image2video" ? "首帧图片" : "参考图" }}</span>
            <span class="field-hint">{{ images.length }}/{{ imageLimit }}</span>
          </div>
          <div class="uploads">
            <div v-for="(img, i) in images" :key="img.id" class="thumb">
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
            <input ref="imageInput" type="file" accept="image/*" multiple class="hidden-input" @change="onFileChange" />
          </div>
        </div>

        <div class="field">
          <span class="field-label">模型</span>
          <button type="button" class="select-card" @click="showModelPicker = true">
            <span class="model-logo">{{ (selected?.display_name || "M").slice(0, 1) }}</span>
            <span class="select-main">
              <span class="select-title">
                {{ selected?.display_name || "请选择模型" }}
                <span v-if="selected" class="tag-best">最优选</span>
              </span>
              <span class="select-sub">{{ selected?.description || "选择适合本次生成的视频模型" }}</span>
            </span>
            <span class="chevron">›</span>
          </button>
        </div>

        <div class="field">
          <span class="field-label">运镜控制</span>
          <button type="button" class="select-card compact" @click="showCameraPicker = true">
            <span class="camera-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h7A2.5 2.5 0 0 1 16 8.5v7A2.5 2.5 0 0 1 13.5 18h-7A2.5 2.5 0 0 1 4 15.5Z" />
                <path d="m16 13 4 2.5v-7L16 11" />
              </svg>
            </span>
            <span class="select-main">
              <span class="select-title">{{ cameraLabel }}</span>
            </span>
            <span class="chevron">›</span>
          </button>
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

        <div v-if="selected?.audio_video_support" class="field">
          <span class="field-label">音频</span>
          <label class="switch-row">
            <input v-model="enableAudio" type="checkbox" />
            <span>生成带音频的视频（支持模型）</span>
          </label>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div class="generate-wrap">
        <div class="quote-row">
          <span>积分消耗</span>
          <b>✦ {{ estimatedCredits ?? "—" }}</b>
        </div>
        <button type="button" class="generate" :disabled="submitting || quoting" @click="submit">
          {{ submitting ? "提交中…" : quoting ? "计算中…" : "立即生成" }}
        </button>
        <p class="disclaimer">内容由AI生成，请仔细甄别</p>
      </div>
    </section>

    <!-- 右：生成结果 -->
    <section class="panel right-panel">
      <div class="gallery-head">
        <div class="gallery-tabs">
          <button
            v-for="tab in [
              { key: 'all', label: '全部' },
              { key: 'video', label: '视频' },
              { key: 'image', label: '图片' },
              { key: 'audio', label: '音频' },
            ]"
            :key="tab.key"
            type="button"
            class="gallery-tab"
            :class="{ on: galleryTab === tab.key }"
            @click="galleryTab = tab.key as typeof galleryTab"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="gallery-filters">
          <label class="check"><input v-model="onlyFavorite" type="checkbox" />我的收藏</label>
          <label class="check"><input v-model="onlyRunning" type="checkbox" />进行中</label>
        </div>
      </div>

      <div class="gallery-body">
        <template v-if="task">
          <article class="result-live">
            <div class="result-media">
              <video
                v-if="task.status === TaskStatus.SUCCEEDED && task.results?.[0]?.uri && !task.results[0].uri.startsWith('mock://')"
                :src="task.results[0].uri"
                controls
                playsinline
              />
              <div v-else class="result-placeholder">
                <span>{{ task.status === TaskStatus.SUCCEEDED ? "已完成" : `生成中 ${task.progress ?? 0}%` }}</span>
              </div>
            </div>
            <div class="result-meta">
              <span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span>
              <p class="result-prompt">{{ prompt || "（无提示词）" }}</p>
              <div class="result-actions">
                <button v-if="task.status === TaskStatus.SUCCEEDED" type="button" class="mini" @click="download(task)">下载</button>
                <button type="button" class="mini" @click="task = null">收起</button>
              </div>
            </div>
          </article>
        </template>

        <div v-if="shownHistory.length" class="gallery-grid">
          <article v-for="item in shownHistory" :key="item.task_id" class="gallery-card">
            <button type="button" class="gallery-thumb" @click="previewTask = item">
              <video v-if="item.results?.[0]?.uri && !item.results[0].uri.startsWith('mock://')" :src="item.results[0].uri" muted playsinline preload="metadata" />
              <span v-else class="thumb-empty">{{ item.progress ?? 0 }}%</span>
            </button>
            <div class="gallery-meta">
              <span class="status" :data-status="item.status">{{ statusLabel(item.status) }}</span>
              <button type="button" class="fav" :class="{ on: favorites.includes(item.task_id) }" @click="toggleFavorite(item.task_id)">
                {{ favorites.includes(item.task_id) ? "★" : "☆" }}
              </button>
              <span class="time">{{ new Date(item.created_at).toLocaleString("zh-CN") }}</span>
            </div>
          </article>
        </div>

        <div v-else-if="!task" class="empty">
          <span class="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
            </svg>
          </span>
          <p>快去生成你的创意吧</p>
        </div>
      </div>
    </section>

    <!-- 模型选择弹层 -->
    <Teleport to="body">
      <div v-if="showModelPicker" class="mask" @click.self="showModelPicker = false">
        <div class="sheet">
          <header><h3>选择模型</h3><button type="button" @click="showModelPicker = false">✕</button></header>
          <div class="sheet-list">
            <button
              v-for="(m, i) in models"
              :key="m.name"
              type="button"
              class="model-option"
              :class="{ on: m.name === selectedName }"
              @click="selectedName = m.name; applyDefaults(); showModelPicker = false"
            >
              <span class="model-logo">{{ m.display_name.slice(0, 1) }}</span>
              <span class="select-main">
                <span class="select-title">
                  {{ m.display_name }}
                  <span v-if="i === 0" class="tag-best">最优选</span>
                </span>
                <span class="select-sub">{{ m.description }}</span>
              </span>
              <span v-if="m.name === selectedName" class="tick">✓</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 运镜选择弹层 -->
      <div v-if="showCameraPicker" class="mask" @click.self="showCameraPicker = false">
        <div class="sheet small">
          <header><h3>运镜方式</h3><button type="button" @click="showCameraPicker = false">✕</button></header>
          <div class="sheet-list">
            <button
              v-for="c in CAMERAS"
              :key="c.key"
              type="button"
              class="model-option"
              :class="{ on: c.key === camera }"
              @click="camera = c.key; showCameraPicker = false"
            >
              <span class="select-title">{{ c.label }}</span>
              <span v-if="c.key === camera" class="tick">✓</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 创意向导 -->
      <div v-if="showWizard" class="mask" @click.self="showWizard = false">
        <div class="sheet small">
          <header><h3>创意向导</h3><button type="button" @click="showWizard = false">✕</button></header>
          <div class="sheet-list">
            <button v-for="t in PROMPT_TEMPLATES" :key="t.title" type="button" class="template" @click="useTemplate(t.text)">
              <b>{{ t.title }}</b>
              <span>{{ t.text }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 我的提示词 -->
      <div v-if="showMyPrompts" class="mask" @click.self="showMyPrompts = false">
        <div class="sheet small">
          <header><h3>我的提示词</h3><button type="button" @click="showMyPrompts = false">✕</button></header>
          <div class="sheet-list">
            <button type="button" class="template save" @click="saveCurrentPrompt">＋ 保存当前提示词</button>
            <button v-for="(t, i) in savedPrompts" :key="i" type="button" class="template" @click="prompt = t; showMyPrompts = false">
              <span>{{ t }}</span>
            </button>
            <p v-if="savedPrompts.length === 0" class="sheet-empty">还没有保存的提示词</p>
          </div>
        </div>
      </div>

      <!-- 结果预览 -->
      <div v-if="previewTask" class="mask" @click.self="previewTask = null">
        <div class="preview-dialog">
          <button type="button" class="preview-close" @click="previewTask = null">✕</button>
          <video v-if="previewTask.results?.[0]?.uri && !previewTask.results[0].uri.startsWith('mock://')" :src="previewTask.results[0].uri" controls autoplay playsinline />
          <p v-else class="preview-empty">{{ statusLabel(previewTask.status) }} · 暂无视频可预览</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.video-gen {
  display: grid;
  grid-template-columns: 624px minmax(0, 1fr);
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
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: #0f0f12;
}

.mode-tab {
  position: relative;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
}
.new-badge {
  position: absolute;
  top: 2px;
  right: 12px;
  padding: 0 4px;
  border-radius: 4px;
  background: linear-gradient(90deg, #7e70ff, #b06bff);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  font-weight: 600;
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

.field-hint {
  font-size: 11px;
  color: var(--text-4);
}

.field-actions {
  display: flex;
  gap: 6px;
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #ffffff17;
  background: #17171b;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.ghost:hover {
  border-color: #ffffff33;
  color: var(--text-1);
}

.prompt-box {
  position: relative;
  border-radius: 8px;
  background: #0d0d10;
  border: 1px solid #ffffff14;
  padding: 10px 12px 26px;
}

.prompt-box textarea {
  width: 100%;
  min-height: 96px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.7;
  font-family: inherit;
}

.prompt-box textarea::placeholder {
  color: var(--text-4);
}

.copy {
  position: absolute;
  right: 8px;
  bottom: 6px;
  border: 0;
  background: transparent;
  color: var(--text-4);
  font-size: 14px;
  cursor: pointer;
}

.chips {
  display: flex;
  gap: 8px;
}

.chip {
  flex: 1;
  height: 30px;
  border-radius: 6px;
  border: 1px solid #ffffff14;
  background: #151519;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.chip:hover {
  border-color: #ffffff33;
  color: var(--text-1);
}

.chip.plus {
  flex: 0 0 34px;
  font-size: 16px;
}
.chip.dice {
  flex: 0 0 34px;
  font-size: 14px;
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

.uploads {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.thumb,
.upload-slot {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #ffffff1a;
  background: #0d0d10;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-remove {
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

.upload-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--text-4);
  font-size: 11px;
  cursor: pointer;
}

.upload-slot:hover {
  border-color: var(--brand-500);
  color: var(--brand-300);
}

.upload-plus {
  font-size: 18px;
  line-height: 1;
}

.upload-text {
  font-size: 10px;
}

.hidden-input {
  display: none;
}

.select-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #141418;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
}

.select-card:hover {
  border-color: #ffffff2e;
}

.select-card.compact {
  padding: 12px;
}

.model-logo {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: linear-gradient(135deg, #7e70ff, #b06bff);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.select-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.select-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-best {
  padding: 0 5px;
  border-radius: 4px;
  background: #2a2450;
  color: #a99cff;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}

.select-sub {
  font-size: 11px;
  color: var(--text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: var(--text-4);
  font-size: 18px;
}

.camera-icon {
  width: 26px;
  height: 26px;
  color: var(--text-2);
}

.camera-icon svg {
  width: 100%;
  height: 100%;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.switch-row input {
  accent-color: var(--brand-500);
}

.setting-name {
  flex: 0 0 48px;
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

.generate-wrap {
  padding-top: 10px;
  border-top: 1px solid #ffffff0f;
}

.generate {
  width: 100%;
  height: 44px;
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

/* ── 右侧结果库 ── */
.gallery-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ffffff0f;
}

.gallery-tabs {
  display: flex;
  gap: 24px;
}

.gallery-tab {
  position: relative;
  padding: 4px 0 10px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
}

.gallery-tab.on {
  color: var(--text-1);
  font-weight: 600;
}

.gallery-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--text-1);
}

.gallery-filters {
  display: flex;
  gap: 16px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}

.check input {
  accent-color: var(--brand-500);
}

.gallery-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 14px;
}

.result-live {
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #101014;
  overflow: hidden;
  margin-bottom: 14px;
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

.result-placeholder {
  color: var(--text-3);
  font-size: 13px;
}

.result-meta {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-prompt {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-actions {
  display: flex;
  gap: 8px;
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

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.gallery-card {
  border-radius: 8px;
  border: 1px solid #ffffff12;
  overflow: hidden;
  background: #101014;
}

.gallery-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  background: #000;
  padding: 0;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text-4);
  font-size: 12px;
}

.gallery-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
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

.fav {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--text-4);
  font-size: 13px;
  cursor: pointer;
}

.fav.on {
  color: #f5b544;
}

.time {
  color: var(--text-4);
  font-size: 10px;
}

.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-4);
  font-size: 13px;
}

.empty-icon {
  width: 90px;
  height: 90px;
  color: #ffffff70;
  filter: drop-shadow(0 12px 30px #7e70ff33);
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

/* ── 弹层通用 ── */
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: #000000b8;
  display: grid;
  place-items: center;
  padding: 24px;
}

.sheet {
  width: min(520px, 94vw);
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #ffffff1a;
  background: var(--bg-surface);
  overflow: hidden;
}

.sheet.small {
  width: min(440px, 94vw);
}

.sheet header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #ffffff0f;
}

.sheet h3 {
  margin: 0;
  font-size: 15px;
}

.sheet header button {
  border: 0;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 13px;
}

.sheet-list {
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #141418;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
}

.model-option:hover,
.model-option.on {
  border-color: var(--brand-500);
}

.tick {
  color: var(--brand-300);
}

.template {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #ffffff14;
  background: #141418;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.template b {
  color: var(--text-1);
  font-size: 13px;
}

.template:hover {
  border-color: #ffffff33;
}

.template.save {
  color: var(--brand-300);
  border-style: dashed;
}

.sheet-empty {
  margin: 6px 2px;
  color: var(--text-4);
  font-size: 12px;
}

.preview-dialog {
  position: relative;
  width: min(880px, 94vw);
  max-height: 84vh;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}

.preview-dialog video {
  width: 100%;
  max-height: 84vh;
  display: block;
}

.preview-empty {
  margin: 0;
  padding: 80px 20px;
  text-align: center;
  color: var(--text-3);
}

.preview-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 0;
  background: #000000a8;
  color: #fff;
  cursor: pointer;
}

@media (max-width: 1000px) {
  .video-gen {
    grid-template-columns: 1fr;
    height: auto;
  }
  .right-panel {
    min-height: 420px;
  }
}
</style>
