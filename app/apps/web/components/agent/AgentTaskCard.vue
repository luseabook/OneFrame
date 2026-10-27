<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useApi } from "~/composables/useApi";
import { statusLabel, type AgentTaskDetail, type TaskShareLink } from "~/types/api";

/**
 * 任务卡：把 Agent 对话里"真的投递出去的那一次生成"渲染成可追踪的卡。
 *
 * 三态是硬要求（任务书 4.1）：生成中 / 完成 / 失败。
 * - **为什么自己轮询而不是只吃 SSE**：`task_progress` 事件可能在路上丢（重连窗口），
 *   而任务状态是权威数据、必须能被幂等读回（ADR-012）。SSE 只用来"提前一两秒"更新。
 * - **为什么进度取最大值**：轮询响应可能乱序到达（并发请求），进度回退会让进度条抖动。
 */

const props = defineProps<{
  taskId: string;
  /** SSE 推来的进度（可选）：有就先用，轮询确认后以服务端为准 */
  progressHint?: { status: number | string; progress: number } | null;
}>();

const api = useApi();

const task = ref<AgentTaskDetail | null>(null);
const error = ref("");
const loading = ref(false);
const shareUrl = ref("");
const shareError = ref("");
const sharing = ref(false);
const copied = ref(false);

/** 终态：3 成功 / 4 失败 / 5 取消 / 7 审核未过 —— 到终态就停止轮询 */
const TERMINAL = [3, 4, 5, 7];
const POLL_MS = 2500;

let timer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

const status = computed(() => {
  if (task.value) return task.value.status;
  const hint = props.progressHint?.status;
  return typeof hint === "number" ? hint : 1;
});
const progress = computed(() => {
  const fromTask = task.value?.progress;
  const fromHint = typeof props.progressHint?.progress === "number" ? props.progressHint.progress : 0;
  // 取最大值：轮询与 SSE 两个来源乱序时进度不回退
  return Math.max(0, Math.min(100, Math.max(fromTask ?? 0, fromHint)));
});
const state = computed<"pending" | "running" | "done" | "failed">(() => {
  if (status.value === 3) return "done";
  if (status.value === 4 || status.value === 5 || status.value === 7) return "failed";
  if (status.value === 2) return "running";
  return "pending";
});
const stateLabel = computed(() => statusLabel(status.value));

interface TaskResultItem {
  url?: string;
  preview_url?: string;
  text?: string;
  ai_label?: unknown;
}

const results = computed<TaskResultItem[]>(() => {
  const raw = task.value?.results;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is TaskResultItem => typeof item === "object" && item !== null);
});
const errorMessage = computed(() => {
  const raw = task.value?.error;
  if (!raw || typeof raw !== "object") return "";
  const message = (raw as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
});
const kind = computed<"image" | "video" | "text">(() => {
  const cap = task.value?.capability ?? "";
  if (cap === "video") return "video";
  if (cap === "image") return "image";
  return "text";
});

async function load(): Promise<void> {
  if (disposed) return;
  loading.value = true;
  try {
    const detail = await api.get<AgentTaskDetail>(`/agent/task/${encodeURIComponent(props.taskId)}`);
    task.value = detail;
    error.value = "";
    if (!TERMINAL.includes(detail.status)) schedule();
  } catch (e) {
    error.value = (e as Error).message || "读取任务失败";
    // 网络抖动不放弃：任务还在跑，用户需要它最终出现结果
    schedule();
  } finally {
    loading.value = false;
  }
}

function schedule(): void {
  if (disposed || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, POLL_MS);
}

async function share(): Promise<void> {
  if (sharing.value) return;
  sharing.value = true;
  shareError.value = "";
  try {
    // 复用既有任务分享通道（`POST /tasks/:id/share` → `/share/:token`），不另造分享体系
    const res = await api.post<TaskShareLink>(`/tasks/${encodeURIComponent(props.taskId)}/share`, {});
    shareUrl.value = `${window.location.origin}${res.share_path}`;
  } catch (e) {
    shareError.value = (e as Error).message || "创建分享链接失败";
  } finally {
    sharing.value = false;
  }
}

async function copyShare(): Promise<void> {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    shareError.value = "复制失败，请手动选中链接复制";
  }
}

onMounted(() => void load());
onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearTimeout(timer);
  timer = null;
});
watch(
  () => props.taskId,
  () => {
    task.value = null;
    shareUrl.value = "";
    void load();
  },
);
</script>

<template>
  <div class="task-card" :class="`task-card--${state}`" :data-task-id="taskId">
    <header class="task-card__head">
      <span class="task-card__title">{{ task?.title || "生成任务" }}</span>
      <span class="task-card__state">{{ stateLabel }}</span>
    </header>

    <div v-if="state === 'pending' || state === 'running'" class="task-card__body">
      <div class="task-card__bar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" role="progressbar">
        <span class="task-card__bar-fill" :style="{ width: `${progress}%` }" />
      </div>
      <p class="task-card__hint">{{ state === "pending" ? "排队中，稍候开始…" : `生成中 ${progress}%` }}</p>
    </div>

    <div v-else-if="state === 'failed'" class="task-card__body">
      <p class="task-card__error">{{ errorMessage || stateLabel }}</p>
      <p v-if="error" class="task-card__hint">{{ error }}</p>
    </div>

    <div v-else class="task-card__body">
      <div v-if="results.length === 0" class="task-card__hint">任务已完成，但还没有可预览的结果。</div>
      <div v-for="(item, index) in results" :key="index" class="task-card__result">
        <video
          v-if="kind === 'video' && (item.url || item.preview_url)"
          class="task-card__media"
          :src="item.url || item.preview_url"
          controls
          playsinline
          preload="metadata"
        />
        <img
          v-else-if="kind === 'image' && (item.preview_url || item.url)"
          class="task-card__media"
          :src="item.preview_url || item.url"
          alt="生成结果"
          loading="lazy"
        />
        <p v-else-if="item.text" class="task-card__text">{{ item.text }}</p>
        <a
          v-if="item.url"
          class="task-card__download"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
        >打开原图/原片</a>
      </div>
    </div>

    <footer class="task-card__foot">
      <button class="btn btn--ghost" type="button" :disabled="sharing" @click="share">
        {{ sharing ? "创建中…" : "分享" }}
      </button>
      <span v-if="shareError" class="task-card__warn">{{ shareError }}</span>
      <span v-if="shareUrl" class="task-card__share">
        <code>{{ shareUrl }}</code>
        <button class="btn btn--ghost" type="button" @click="copyShare">{{ copied ? "已复制" : "复制" }}</button>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.task-card {
  border: 1px solid var(--border-2);
  border-radius: var(--radius-panel);
  background: var(--bg-raised);
  padding: var(--space-4);
  max-width: 520px;
}
.task-card--running {
  border-color: var(--brand-border);
}
.task-card--failed {
  border-color: var(--danger);
  background: var(--danger-bg);
}
.task-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.task-card__title {
  color: var(--text-1);
  font-size: var(--text-sm);
  font-weight: 600;
}
.task-card__state {
  color: var(--text-3);
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  white-space: nowrap;
}
.task-card--running .task-card__state {
  color: var(--brand-on-soft);
  border-color: var(--brand-border);
}
.task-card--failed .task-card__state {
  color: var(--danger);
  border-color: var(--danger);
}
.task-card__bar {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  overflow: hidden;
}
.task-card__bar-fill {
  display: block;
  height: 100%;
  background: var(--brand-500);
  transition: width 240ms ease;
}
.task-card__hint {
  margin: var(--space-2) 0 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.task-card__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.task-card__result + .task-card__result {
  margin-top: var(--space-3);
}
.task-card__media {
  width: 100%;
  max-height: 320px;
  border-radius: 12px;
  background: var(--bg-sunken);
  object-fit: contain;
}
.task-card__text {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}
.task-card__download {
  display: inline-block;
  margin-top: var(--space-2);
  color: var(--brand-400);
  font-size: var(--text-xs);
  text-decoration: underline;
}
.task-card__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-1);
}
.task-card__share {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.task-card__share code {
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
  white-space: nowrap;
}
.task-card__warn {
  color: var(--danger);
  font-size: var(--text-xs);
}
.btn {
  height: 32px;
  padding: 0 var(--space-3);
  border-radius: 10px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn:disabled {
  color: var(--text-5);
  cursor: not-allowed;
}
</style>
