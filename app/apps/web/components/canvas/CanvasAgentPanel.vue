<script setup lang="ts">
import type { AgentMessage, AgentMessageView, AgentNodeDraft } from "~/composables/useCanvasAgent";

/**
 * 画布内 Agent 对话面板（右侧 dock 的第二个页签）
 *
 * 为什么组件只做渲染、不做网络：
 * SSE / 降级轮询 / 乐观去重是一套相互纠缠的状态机，放组件里会随着模板改动走形；
 * 这里只把 composable 的响应式状态铺成 DOM，并严格按契约 §2.2 保留 E2E 断言锚点。
 *
 * 组件对外 API 与契约 §2.3 完全一致（只有 close / create-nodes 两个事件）：
 * "真的建节点"必须由父组件做 —— 节点要进 useCanvasEditor 的本地图、参与 commit 乐观锁，
 * 面板自己造节点会绕开版本校验。
 */
const props = defineProps<{
  canvasId: string;
  /** 当前选中节点，发消息时作为 reference_node_ids 带给 Agent */
  selectionIds?: string[];
  /** 可选：模型切换器数据源 */
  models?: Array<{ model_id: string; name: string; capability: string; modes: string[] }>;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "create-nodes", nodes: Array<{ node_type: string; name: string; params?: Record<string, unknown> }>): void;
}>();

const toast = useToast();
const agent = useCanvasAgent(computed(() => props.canvasId));

// 只解构模板用到的字段：其余（bindNodes/markRead/dispose）留给父组件与生命周期
const {
  sessions, activeSessionId, activeSession, sessionsLoading, creating, ending, listError, ended,
  messages, messagesLoading, sending, awaitingReply, streamError, lastSendError,
  modelStep, modelStepLabel, taskProgress,
  streamState, degraded,
  outputs, outputsLoading, outputsError,
  activeModelId, setActiveModel,
  loadSessions, createSession, selectSession, endSession, send, decide, react, loadOutputs, retryRealtime,
} = agent;

const draft = ref("");
const listEl = ref<HTMLElement | null>(null);
const outputsOpen = ref(false);
/** 已提交决策的 interrupt：提交成功后按钮立刻禁用，不等后端回推 */
const decidedIds = ref<string[]>([]);
const decidingId = ref<string | null>(null);
/** 最近一次 emit("create-nodes") 的来源消息，供 bindLastAppliedNodes 溯源 */
const lastAppliedMessageId = ref<string | null>(null);

const canSend = computed(() => !ended.value && !sending.value && draft.value.trim().length > 0);
const canEnd = computed(() => activeSessionId.value !== null && !ended.value);

// ── 生命周期 ─────────────────────────────────────────────
onMounted(() => {
  void loadSessions();
  // 有默认模型时选中第一个：下拉框不该显示空白却其实有可用项
  if (!activeModelId.value && props.models && props.models.length > 0) {
    setActiveModel(props.models[0]!.model_id);
  }
});

/** 新消息/阶段变化后贴底：对话面板不贴底就等于让用户手动找回复 */
watch(
  () => [messages.value.length, modelStep.value, awaitingReply.value] as const,
  () => void scrollToBottom(),
);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

// ── 会话 ────────────────────────────────────────────────
function onSessionChange(ev: Event): void {
  const id = (ev.target as HTMLSelectElement).value;
  if (id) void selectSession(id);
}

async function onNewSession(): Promise<void> {
  const id = await createSession();
  if (!id && listError.value) toast.error(listError.value);
}

async function onEndSession(): Promise<void> {
  if (!canEnd.value) return;
  const ok = await endSession();
  if (!ok && listError.value) toast.error(listError.value);
}

function sessionLabel(title: string): string {
  return title.trim() || "新会话";
}

// ── 发送 ────────────────────────────────────────────────
/**
 * Enter 发送 / Shift+Enter 换行。
 * 必须自己判 `isComposing`：中文输入法用 Enter 确认候选词时会一并触发 keydown，
 * 直接绑 `@keydown.enter` 会在用户还没选完词时就把半截拼音发出去。
 */
function onInputKeydown(ev: KeyboardEvent): void {
  if (ev.isComposing || ev.key !== "Enter" || ev.shiftKey) return;
  ev.preventDefault();
  void onSend();
}

async function onSend(): Promise<void> {
  if (!canSend.value) return;
  const text = draft.value;
  // 先清空输入框：乐观气泡会立刻出现在消息区（契约 §2.2 #3 断言的就是这两件事）
  draft.value = "";
  const ok = await send(text, props.selectionIds ?? []);
  if (!ok) {
    // 发送失败：还原草稿，别让用户重敲；这类错误走 toast，
    // 只有 SSE 的 error 事件按契约落在消息区内联红字
    draft.value = text;
    toast.error(lastSendError.value || "发送失败");
  }
}

async function onDecide(message: AgentMessageView, decision: "approve" | "reject"): Promise<void> {
  if (decidingId.value || decidedIds.value.includes(message.message_id)) return;
  decidingId.value = message.message_id;
  const ok = await decide(message, decision);
  decidingId.value = null;
  if (ok) decidedIds.value = [...decidedIds.value, message.message_id];
  else toast.error(lastSendError.value || "决策提交失败");
}

function onReact(message: AgentMessageView): void {
  // 赞/踩是互斥三态（0 无 1 赞 2 踩 3 已取消）：再点同向 = 取消
  void react(message, message.reaction === 1 ? "none" : "like");
}

function onDislike(message: AgentMessageView): void {
  void react(message, message.reaction === 2 ? "none" : "dislike");
}

// ── payload 收口（后端形状不可全信，缺字段就当没有，绝不拼假数据）──
function messageNodes(message: AgentMessage): AgentNodeDraft[] {
  const nodes = message.payload?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n) => !!n && typeof n.node_type === "string" && typeof n.name === "string");
}

function messageSteps(message: AgentMessage): string[] {
  const steps = message.payload?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter((s): s is string => typeof s === "string" && s.length > 0);
}

function allowedDecisions(message: AgentMessage): Array<"approve" | "reject"> {
  const allowed = message.payload?.allowed_decisions;
  if (!Array.isArray(allowed) || allowed.length === 0) return ["approve", "reject"];
  return allowed.filter((d): d is "approve" | "reject" => d === "approve" || d === "reject");
}

function hitlQuestion(message: AgentMessage): string {
  const q = message.payload?.question;
  return typeof q === "string" && q ? q : message.content;
}

function itemNodesPreview(message: AgentMessage): string {
  return messageNodes(message)
    .map((n) => n.name)
    .slice(0, 3)
    .join("、");
}

/**
 * 一次性把消息折算成渲染模型。
 * 为什么不在模板里反复调函数：既有 v-if/v-else 收口，也避免每次重渲染重复扫描 payload；
 * 顺带把"可能为 null 的进度"拍平成非空字段，模板里不需要类型断言。
 */
interface AgentMessageVM {
  msg: AgentMessageView;
  nodes: AgentNodeDraft[];
  steps: string[];
  decisions: Array<"approve" | "reject">;
  question: string;
  hasProgress: boolean;
  progressPercent: number;
  progressLabel: string;
  isDecided: boolean;
}

const viewMessages = computed<AgentMessageVM[]>(() =>
  messages.value.map((m) => {
    const progress = m.task_id ? taskProgress.value[m.task_id] : undefined;
    return {
      msg: m,
      nodes: messageNodes(m),
      steps: messageSteps(m),
      decisions: allowedDecisions(m),
      question: hitlQuestion(m),
      hasProgress: progress !== undefined,
      progressPercent: progress ? progress.progress : 0,
      progressLabel: progress ? `${progress.status || "进行中"} ${progress.progress}%` : "",
      isDecided: decidedIds.value.includes(m.message_id),
    };
  }),
);

function applyNodes(message: AgentMessage): void {
  const nodes = messageNodes(message);
  if (nodes.length === 0) return;
  // 记住来源消息：父组件建完节点后可以调 expose 出来的 bindLastAppliedNodes(nodeIds) 记溯源，
  // 因为契约冻结的 create-nodes 事件里只有节点、没有 message_id，这里替父组件先把上下文留住
  lastAppliedMessageId.value = message.message_id;
  emit("create-nodes", nodes);
}

/**
 * 给父组件的溯源钩子（不属于契约 §2.3 的 props/emits，属于可选增强）：
 * 建完节点后把新节点 id 交回来，面板替它调 `POST …/messages/:id/node-binding`。
 * 绑定失败只记 console，不会让"节点已创建"看起来失败。
 */
async function bindLastAppliedNodes(nodeIds: string[]): Promise<number> {
  const messageId = lastAppliedMessageId.value;
  if (!messageId || nodeIds.length === 0) return 0;
  return agent.bindNodes(messageId, nodeIds);
}

defineExpose({ bindLastAppliedNodes });

function previewText(text: string, limit = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

// ── 历史产出 ────────────────────────────────────────────
async function toggleOutputs(): Promise<void> {
  outputsOpen.value = !outputsOpen.value;
  // 只在第一次打开时拉取：反复拉会让列表在一次交互中途变化
  if (outputsOpen.value && outputs.value.length === 0 && !outputsLoading.value) await loadOutputs();
}

// ── 模型 ────────────────────────────────────────────────
function onModelChange(ev: Event): void {
  setActiveModel((ev.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="cv-agent" role="region" aria-label="Agent 对话">
    <!-- 头部：标题 + 新建/结束 + 会话下拉 + 关闭 -->
    <header class="cv-agent__head">
      <div class="cv-agent__head-row">
        <span class="cv-agent__title">Agent</span>
        <span v-if="degraded" class="cv-agent__tag">轮询</span>
        <div class="cv-agent__head-acts">
          <button
            type="button"
            class="cv-agent__new"
            :disabled="creating"
            aria-label="新开会话"
            @click="onNewSession"
          >
            ＋ 新会话
          </button>
          <button
            v-if="canEnd"
            type="button"
            class="cv-agent__end"
            :disabled="ending"
            aria-label="结束会话"
            @click="onEndSession"
          >
            结束会话
          </button>
          <button type="button" class="cv-glass-btn" aria-label="关闭" @click="emit('close')">
            <CanvasIcon name="close" :size="16" />
          </button>
        </div>
      </div>

      <select
        class="cv-select cv-agent__sessions"
        :value="activeSessionId ?? ''"
        aria-label="选择会话"
        :disabled="sessions.length === 0"
        @change="onSessionChange"
      >
        <option value="" disabled>{{ sessions.length === 0 ? "暂无会话" : "选择会话" }}</option>
        <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
          {{ sessionLabel(s.title) }}（{{ s.message_count }}）
        </option>
      </select>

      <p v-if="sessionsLoading" class="cv-hint">读取会话…</p>
      <p v-else-if="activeSession?.last_message_preview" class="cv-hint cv-agent__preview">
        {{ previewText(activeSession?.last_message_preview ?? "", 40) }}
      </p>
      <p v-if="listError" class="cv-hint cv-agent__list-error">{{ listError }}</p>
    </header>

    <!-- 降级提示条（ADR-012 硬要求：SSE 不可用必须显式告知，并说明补偿方式） -->
    <div v-if="degraded" class="cv-agent__degraded" role="status">
      <span class="cv-agent__degraded-text">实时连接不可用，已切换为 3 秒轮询补齐消息</span>
      <button type="button" class="cv-agent__degraded-retry" @click="retryRealtime">重试实时连接</button>
    </div>

    <!-- 历史产出：切换按钮常驻，展开后才请求接口 -->
    <section v-if="outputsOpen" class="cv-agent__outputs-panel">
      <p v-if="outputsLoading" class="cv-hint">读取历史产出…</p>
      <p v-else-if="outputsError" class="cv-hint cv-agent__outputs-error">{{ outputsError }}</p>
      <p v-else-if="outputs.length === 0" class="cv-hint">还没有可复用的历史产出。</p>
      <ul v-else class="cv-agent__outputs-list">
        <li v-for="o in outputs" :key="o.message_id" class="cv-agent__output-item">
          <p class="cv-agent__output-text">{{ previewText(o.content, 70) }}</p>
          <p v-if="messageNodes(o).length" class="cv-agent__output-meta">
            {{ messageNodes(o).length }} 个节点：{{ itemNodesPreview(o) }}
            <button type="button" class="cv-agent__output-apply" @click="applyNodes(o)">创建</button>
          </p>
        </li>
      </ul>
    </section>

    <!-- 消息区 -->
    <div ref="listEl" class="cv-agent__messages">
      <p v-if="messagesLoading" class="cv-hint">读取消息…</p>

      <div v-else-if="!activeSessionId" class="cv-agent__empty">
        <p class="cv-agent__empty-title">还没有选择会话</p>
        <p class="cv-agent__empty-hint">点右上角「＋ 新会话」，把想做的事说给 Agent。</p>
      </div>

      <div v-else-if="messages.length === 0" class="cv-agent__empty">
        <p class="cv-agent__empty-title">会话已就绪</p>
        <p class="cv-agent__empty-hint">描述你的需求，Agent 会把它拆成能落到画布上的节点。</p>
      </div>

      <template v-else>
        <article
          v-for="vm in viewMessages"
          :key="vm.msg.message_id"
          class="cv-agent__msg"
          :class="[
            vm.msg.role === 1 ? 'cv-agent__msg--user' : vm.msg.role === 2 ? 'cv-agent__msg--assistant' : 'cv-agent__msg--system',
            { 'is-optimistic': vm.msg._optimistic, 'is-failed': !!vm.msg._error },
          ]"
        >
          <!-- HITL（需要用户决策）：卡片优先于正文，决策是这一屏的主操作 -->
          <div v-if="vm.msg.content_type === 4" class="cv-agent__hitl">
            <p class="cv-agent__hitl-q">{{ vm.question }}</p>
            <div class="cv-agent__hitl-acts">
              <button
                v-for="d in vm.decisions"
                :key="d"
                type="button"
                class="cv-agent__hitl-btn"
                :class="{ 'is-primary': d === 'approve' }"
                :disabled="ended || decidingId === vm.msg.message_id || vm.isDecided"
                @click="onDecide(vm.msg, d)"
              >
                {{ d === "approve" ? "同意" : "拒绝" }}
              </button>
            </div>
            <p v-if="vm.isDecided" class="cv-hint">已提交决策，等待 Agent 继续。</p>
          </div>

          <p v-if="vm.msg.content" class="cv-agent__bubble">{{ vm.msg.content }}</p>

          <!-- 计划（content_type=3） -->
          <ol v-if="vm.steps.length" class="cv-agent__steps">
            <li v-for="(s, i) in vm.steps" :key="i">{{ s }}</li>
          </ol>

          <!-- 卡片（content_type=2 或 payload 带 nodes）：真正落画布的动作在这里 -->
          <div v-if="vm.nodes.length" class="cv-agent__card">
            <p class="cv-agent__card-title">将要创建的节点</p>
            <ul class="cv-agent__nodes">
              <li v-for="(n, i) in vm.nodes" :key="i" class="cv-agent__node">
                <span class="cv-agent__node-type">{{ n.node_type }}</span>
                <span class="cv-agent__node-name">{{ n.name }}</span>
              </li>
            </ul>
            <Button size="sm" variant="secondary" class="cv-agent__apply" @click="applyNodes(vm.msg)">
              在画布中创建 {{ vm.nodes.length }} 个节点
            </Button>
          </div>

          <!-- 任务进度（task_progress 事件喂 taskProgress） -->
          <div v-if="vm.hasProgress" class="cv-agent__progress">
            <span class="cv-agent__progress-track">
              <span class="cv-agent__progress-bar" :style="{ width: `${vm.progressPercent}%` }" />
            </span>
            <span class="cv-agent__progress-label">{{ vm.progressLabel }}</span>
          </div>

          <p v-if="vm.msg._error" class="cv-agent__msg-error">{{ vm.msg._error }}</p>

          <!-- 元信息 + 赞/踩（只对助手发言开放） -->
          <div class="cv-agent__meta">
            <span class="cv-agent__time">{{ timeOf(vm.msg.created_at) }}</span>
            <button
              v-if="vm.msg.role === 2"
              type="button"
              class="cv-agent__react"
              :class="{ 'is-on': vm.msg.reaction === 1 }"
              :disabled="vm.msg._optimistic"
              aria-label="赞"
              @click="onReact(vm.msg)"
            >
              赞
            </button>
            <button
              v-if="vm.msg.role === 2"
              type="button"
              class="cv-agent__react--dislike"
              :class="{ 'is-on': vm.msg.reaction === 2 }"
              :disabled="vm.msg._optimistic"
              aria-label="踩"
              @click="onDislike(vm.msg)"
            >
              踩
            </button>
          </div>
        </article>
      </template>

      <!-- 在途指示：服务端已受理、等回复 / model_step 阶段。不是假消息，不占消息位 -->
      <p v-if="modelStep || awaitingReply" class="cv-agent__typing">
        <span class="cv-agent__typing-dot" aria-hidden="true" />
        {{ modelStep === "writing" ? "正在写…" : modelStep === "thinking" ? "正在思考…" : "等待 Agent 回复…" }}
        <span v-if="modelStepLabel" class="cv-agent__typing-label">{{ modelStepLabel }}</span>
      </p>

      <!-- SSE error 事件：按契约落在消息区内联红字，不弹全局 toast -->
      <p v-if="streamError" class="cv-agent__stream-error">{{ streamError }}</p>
    </div>

    <!-- 输入区 -->
    <footer class="cv-agent__composer">
      <div v-if="ended" class="cv-agent__ended">
        {{ activeSession?.status === 3 ? "会话已归档，只能查看。" : "会话已结束，不能再发送。点「＋ 新会话」重新开始。" }}
      </div>

      <textarea
        v-model="draft"
        class="cv-textarea cv-agent__input"
        :disabled="ended"
        :placeholder="ended ? '会话已结束' : '描述创意或需求（Enter 发送，Shift+Enter 换行）'"
        aria-label="对话输入"
        rows="3"
        @keydown="onInputKeydown"
      />

      <div class="cv-agent__composer-bar">
        <div class="cv-agent__composer-left">
          <button type="button" class="cv-agent__outputs" :class="{ 'is-open': outputsOpen }" @click="toggleOutputs">
            历史产出
          </button>
          <select
            v-if="models && models.length > 0"
            class="cv-select cv-agent__model"
            :value="activeModelId"
            aria-label="切换模型"
            @change="onModelChange"
          >
            <option
              v-for="m in models"
              :key="m.model_id"
              :value="m.model_id"
              :title="`${m.capability}｜${m.modes.join('/')}`"
            >
              {{ m.name }}
            </option>
          </select>
        </div>
        <Button size="sm" class="cv-agent__send" :disabled="!canSend" :loading="sending" @click="onSend">
          发送
        </Button>
      </div>

      <p v-if="props.selectionIds && props.selectionIds.length > 0" class="cv-hint cv-agent__ref">
        已引用 {{ props.selectionIds.length }} 个选中节点
      </p>
      <!-- 模型切换暂未接入：契约冻结的发送 body 里没有模型字段，硬加会 400；这里如实标注而不是装作生效 -->
      <p v-if="models && models.length > 0" class="cv-hint">模型当前由服务端路由，切换项暂未下发到请求。</p>

      <p class="cv-agent__status">
        <template v-if="streamState === 'connecting'">正在连接实时通道…</template>
        <template v-else-if="streamState === 'polling'">实时通道不可用，正在轮询</template>
        <template v-else-if="sending">发送中…</template>
        <template v-else-if="ended">只读</template>
        <template v-else>Enter 发送 · Shift+Enter 换行</template>
      </p>
    </footer>
  </div>
</template>
