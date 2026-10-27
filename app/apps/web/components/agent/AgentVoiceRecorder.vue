<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useApi } from "~/composables/useApi";
import type { AgentSttRelayResult, AgentSttToken } from "~/types/api";

/**
 * 语音输入按钮（竞品 `GET /agent/stt-token`，`routes.txt:126`）。
 *
 * 降级顺序（每一档都必须可用，不允许"点了没反应"）：
 * 1. **服务端转写可用**（`available:true`）：MediaRecorder 录音 → base64 → `POST /agent/stt/transcribe`；
 * 2. **服务端不可用 + 浏览器有 Web Speech**：直接用浏览器内置识别（`SpeechRecognition`）；
 * 3. **两者都不可用**：按钮禁用并给出可读原因（"语音转写未配置，请用文字输入"）。
 *
 * 为什么先问服务端：厂商 Key 只在服务端（Key 下发浏览器 = 把账单交给用户），
 * 所以"能不能转写"必须由后端能力位决定，前端不写死。
 */

const emit = defineEmits<{ (e: "text", text: string): void }>();
const props = defineProps<{ disabled?: boolean }>();

const api = useApi();

const capability = ref<AgentSttToken | null>(null);
const capabilityError = ref("");
const recording = ref(false);
const transcribing = ref(false);
const notice = ref("");
const elapsed = ref(0);

/** 浏览器内置识别（非标准，必须用 any 探针；不支持就当作没有） */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const speechCtor = computed<SpeechRecognitionCtor | null>(() => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
});

const serverAvailable = computed(() => capability.value?.available === true);
const browserAvailable = computed(() => speechCtor.value !== null);
const usable = computed(() => serverAvailable.value || browserAvailable.value);
const hint = computed(() => {
  if (!usable.value) return "语音转写未配置，请用文字输入";
  if (serverAvailable.value) return "语音输入（录音后转文字）";
  return "语音输入（浏览器内置识别）";
});

let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let speech: SpeechRecognitionLike | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let pressedCount = 0;

onMounted(async () => {
  try {
    capability.value = await api.get<AgentSttToken>("/agent/stt-token");
  } catch (e) {
    capabilityError.value = (e as Error).message || "语音能力查询失败";
    capability.value = { available: false, provider: null, token: null, expires_at: null, ttl_s: 0, transcribe_path: null, reason: "query_failed", fallback: "browser" };
  }
});

function startTimer(): void {
  elapsed.value = 0;
  timer = setInterval(() => {
    elapsed.value += 1;
    // 上限 60s：再长就不是一句话了，转写质量与等待成本都不划算
    if (elapsed.value >= 60) stop();
  }, 1000);
}

function clearTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  elapsed.value = 0;
}

function releaseStream(): void {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
}

async function startRecording(): Promise<void> {
  if (recording.value || transcribing.value || props.disabled) return;
  notice.value = "";
  if (serverAvailable.value) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // 无麦克风 / 用户拒绝：降级提示，不弹错误对话框
      notice.value = "无法访问麦克风（未授权或设备不可用）";
      return;
    }
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.start();
    recording.value = true;
    startTimer();
    return;
  }
  // 服务端不可用但浏览器能识别：走本地识别
  const Ctor = speechCtor.value;
  if (!Ctor) {
    notice.value = "语音转写未配置，请用文字输入";
    return;
  }
  speech = new Ctor();
  speech.lang = "zh-CN";
  speech.interimResults = false;
  speech.continuous = false;
  speech.onresult = (event) => {
    const parts: string[] = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const chunk = event.results[i];
      const first = chunk?.[0];
      if (first?.transcript) parts.push(first.transcript);
    }
    const text = parts.join("").trim();
    if (text) emit("text", text);
    else notice.value = "没有识别到内容，请重试";
  };
  speech.onerror = (event) => {
    notice.value = event.error === "not-allowed" ? "麦克风未授权" : "浏览器识别失败，请用文字输入";
  };
  speech.onend = () => {
    recording.value = false;
    clearTimer();
    speech = null;
  };
  try {
    speech.start();
    recording.value = true;
    startTimer();
  } catch {
    notice.value = "浏览器识别启动失败，请用文字输入";
    recording.value = false;
    speech = null;
  }
}

async function stop(): Promise<void> {
  if (!recording.value) return;
  clearTimer();

  if (speech) {
    speech.stop();
    return;
  }
  const recorder = mediaRecorder;
  mediaRecorder = null;
  if (!recorder) {
    recording.value = false;
    releaseStream();
    return;
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.stop();
  recording.value = false;
  await stopped;
  releaseStream();

  const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
  chunks = [];
  if (blob.size === 0) {
    notice.value = "没有录到声音，请重试";
    return;
  }
  transcribing.value = true;
  try {
    const audioBase64 = await toBase64(blob);
    // 令牌每次重新取：录音可能持续到令牌过期，用旧票会被 401
    const fresh = await api.get<AgentSttToken>("/agent/stt-token");
    capability.value = fresh;
    if (!fresh.available || !fresh.token) {
      notice.value = "语音转写未配置，请用文字输入";
      return;
    }
    const res = await api.post<AgentSttRelayResult>(fresh.transcribe_path?.replace(/^\/v1/, "") ?? "/agent/stt/transcribe", {
      audio_base64: audioBase64,
      format: "webm",
      language: "zh",
      stt_token: fresh.token,
    });
    emit("text", res.text);
  } catch (e) {
    // 400100 = 服务端当时不可用：按"降级"处理而不是"发送失败"
    notice.value = (e as Error).message || "语音转写失败，请用文字输入";
  } finally {
    transcribing.value = false;
  }
}

/** Blob → base64。后端 decodeBase64Upload 会剥掉 data-url 前缀，所以直接给整串。 */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取录音失败"));
    reader.readAsDataURL(blob);
  });
}

/** 按下说话、松开发送；键盘（Space/Enter）同样可触发，避免只能用鼠标 */
async function onPressStart(): Promise<void> {
  pressedCount += 1;
  await startRecording();
}

async function onPressEnd(): Promise<void> {
  pressedCount = Math.max(0, pressedCount - 1);
  await stop();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  void onPressStart();
}

function onKeyup(event: KeyboardEvent): void {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  void onPressEnd();
}

onBeforeUnmount(() => {
  clearTimer();
  releaseStream();
  mediaRecorder = null;
  try {
    speech?.stop();
  } catch {
    /* 已在停止中 */
  }
  speech = null;
});
</script>

<template>
  <div class="voice">
    <button
      class="voice__btn"
      :class="{ 'voice__btn--recording': recording }"
      type="button"
      :disabled="props.disabled || transcribing || !usable"
      :title="hint"
      :aria-label="hint"
      @mousedown.prevent="onPressStart"
      @mouseup.prevent="onPressEnd"
      @mouseleave="recording && onPressEnd()"
      @keydown="onKeydown"
      @keyup="onKeyup"
    >
      <span v-if="transcribing">转写中…</span>
      <span v-else-if="recording">■ {{ elapsed }}s</span>
      <span v-else>🎙</span>
    </button>
    <span v-if="recording" class="voice__hint">松开发送</span>
    <span v-else-if="!usable" class="voice__hint voice__hint--off">{{ hint }}</span>
    <span v-else-if="notice" class="voice__hint voice__hint--warn">{{ notice }}</span>
    <span v-else-if="capabilityError" class="voice__hint voice__hint--warn">{{ capabilityError }}</span>
  </div>
</template>

<style scoped>
.voice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.voice__btn {
  height: var(--control-h);
  min-width: 44px;
  padding: 0 var(--space-3);
  border-radius: 10px;
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
}
.voice__btn--recording {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-bg);
}
.voice__btn:disabled {
  color: var(--text-5);
  cursor: not-allowed;
}
.voice__hint {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.voice__hint--off,
.voice__hint--warn {
  color: var(--warning);
}
</style>
