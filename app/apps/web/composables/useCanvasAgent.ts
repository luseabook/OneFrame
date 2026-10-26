import type { Ref } from "vue";

/**
 * 画布内 Agent 对话（scope=2）状态机 · 端点形状见 `_acceptance/_gap/agent-chat-frontend-contract.md`
 *
 * 为什么把这套东西收在 composable 而不是组件里：
 * SSE / 轮询 / 乐观消息三者共享同一份"当前会话 + 游标 + 退避计数"，
 * 一旦拆到组件里，切会话与组件卸载时必然出现漏 abort（旧流继续往已关闭的列表 push），
 * 这类 bug 在 E2E 里很难稳定复现，所以生命周期必须集中在一处收口。
 *
 * 关键取舍（逐条对应契约 §1.4）：
 * 1. 不用原生 `EventSource`：它无法加 `Authorization` 头，也没有 `AbortController`，
 *    而本项目 access token 只存在于内存（ADR-008），必须手写 `fetch` + `ReadableStream` 解析。
 * 2. 未知事件类型一律忽略而不是抛错：后端加新事件类型不能把前端打断。
 * 3. SSE 只是"加速器"，所有状态都要能从 REST 幂等读回（ADR-012），
 *    因此降级成轮询后行为必须等价 —— 消息合并只认 `message_id`，不认到达顺序。
 */

// ── 契约类型（放本文件，不动 types/canvas.ts）──────────────────
export interface AgentSession {
  /** 字符串化雪花 id */
  session_id: string;
  /** 空串 = 未命名，UI 显示"新会话" */
  title: string;
  /** 1 活跃 2 已结束 3 已归档 */
  status: 1 | 2 | 3;
  /** 2 = 画布内对话 */
  scope: 1 | 2;
  last_active_at: string | null;
  created_at: string;
  message_count: number;
  /** 空串表示无消息 */
  last_message_preview: string;
}

/** 卡片类消息里可直接落到画布的节点描述（父组件负责真正建节点） */
export interface AgentNodeDraft {
  node_type: string;
  name: string;
  params?: Record<string, unknown>;
}

export interface AgentMessagePayload {
  nodes?: AgentNodeDraft[];
  steps?: string[];
  interrupt_id?: string;
  question?: string;
  allowed_decisions?: Array<"approve" | "reject">;
  task_id?: string | null;
  [k: string]: unknown;
}

export interface AgentMessage {
  message_id: string;
  /** 1 用户 2 助手 3 系统 */
  role: 1 | 2 | 3;
  content: string;
  /** 1 文本 2 卡片 3 计划 4 HITL */
  content_type: 1 | 2 | 3 | 4;
  payload: AgentMessagePayload;
  task_id: string | null;
  seq: number;
  created_at: string;
  /** 0 无 1 赞 2 踩 3 已取消 */
  reaction: 0 | 1 | 2 | 3;
}

/**
 * 列表里实际渲染的消息。
 * 只多两个前端本地字段，不去改契约里的 `AgentMessage`（避免和 Lead 的类型互撞）：
 * - `_optimistic`：还没被服务端确认的回显，用于去重与禁止点赞；
 * - `_error`：本地发送失败的红字说明。
 */
export interface AgentMessageView extends AgentMessage {
  _optimistic?: boolean;
  _error?: string;
}

export type AgentReactionAction = "like" | "dislike" | "none";
export type AgentDecisionKind = "approve" | "reject";
export type AgentStreamState = "idle" | "connecting" | "live" | "polling";

export interface AgentTaskProgress {
  /** 后端原样给的 status 文案（running/succeeded/... 不做映射，避免猜错枚举） */
  status: string;
  /** 0~100 */
  progress: number;
}

export interface AgentSendBody {
  content: string;
  content_type?: 1 | 2 | 3 | 4;
  reference_node_ids?: string[];
  decision?: { interrupt_id: string; decision: AgentDecisionKind; edits?: unknown };
  wait?: boolean;
}

interface AgentMessagePage {
  list: AgentMessage[];
  next_event_id: string | null;
  has_more: boolean;
}

interface AgentSessionPage {
  list: AgentSession[];
  total: number;
  page: number;
  page_size: number;
}

interface AgentSendResult {
  message_id: string;
  stream_id: string;
  task_id?: string;
}

interface AgentOutputPage {
  list: AgentMessage[];
  total: number;
  page: number;
  page_size: number;
}

// ── SSE 常量（契约 §1.4 明确数值，勿改）──────────────────────
const MAX_ATTEMPTS = 5;
const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;
/** ADR-012 硬要求：降级后的轮询周期固定 3s */
const POLL_INTERVAL = 3000;
/** 等回复的兜底超时：避免"正在思考…"永远挂着（消息本身仍会由轮询补回来） */
const AWAITING_REPLY_TIMEOUT = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pickString = (src: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const v = src[key];
    if (typeof v === "string") return v;
  }
  return "";
};

const pickNumber = (src: Record<string, unknown>, key: string): number | null => {
  const v = src[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * @param canvasId 画布 id；允许传 computed（页面路由 id 变了同一个组件实例还能继续用）
 */
export const useCanvasAgent = (canvasId: string | Ref<string>) => {
  const api = useApi();
  const auth = useAuth();
  const activeSpace = useActiveSpaceId();
  const config = useRuntimeConfig();
  const origin = (config.public.apiBase as string) || "";

  const currentCanvasId = (): string =>
    typeof canvasId === "string" ? canvasId : canvasId.value;

  /** `/canvas/canvases/:id/...`：会话与消息列表挂在画布下 */
  const canvasBase = (): string => `/canvas/canvases/${encodeURIComponent(currentCanvasId())}`;
  /** `/canvas/chat/sessions/:id/...`：流 / 已读 / 反馈 / 绑定是会话级，契约里不带画布 id */
  const chatBase = (): string => "/canvas/chat/sessions";

  // ── 会话 ────────────────────────────────────────────────
  const sessions = ref<AgentSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  const sessionsLoading = ref(false);
  const creating = ref(false);
  const ending = ref(false);
  const listError = ref("");

  const activeSession = computed<AgentSession | null>(
    () => sessions.value.find((s) => s.session_id === activeSessionId.value) ?? null,
  );
  /** status 非 1（活跃）即视为只能读：已结束 2 / 已归档 3 */
  const ended = computed(() => {
    const s = activeSession.value;
    return s !== null && s.status !== 1;
  });

  // ── 消息 ────────────────────────────────────────────────
  const messages = ref<AgentMessageView[]>([]);
  const messagesLoading = ref(false);
  const sending = ref(false);
  const awaitingReply = ref(false);
  const streamError = ref("");
  const lastSendError = ref("");
  /** model_step 的当前阶段；null = 没有在途步骤 */
  const modelStep = ref<"thinking" | "writing" | null>(null);
  const modelStepLabel = ref("");
  /** 按 task_id 索引的任务进度（事件 `task_progress` 喂进来） */
  const taskProgress = ref<Record<string, AgentTaskProgress>>({});

  // ── 通道 ────────────────────────────────────────────────
  const streamState = ref<AgentStreamState>("idle");
  /** 降级提示条的唯一判据：正在轮询即为降级 */
  const degraded = computed(() => streamState.value === "polling");

  // ── 历史产出 ────────────────────────────────────────────
  const outputs = ref<AgentMessage[]>([]);
  const outputsLoading = ref(false);
  const outputsError = ref("");

  // ── 模型（仅前端暂存，见下方 setActiveModel 注释）───────────
  const activeModelId = ref("");

  // ── 内部可变状态（不进响应式：改了也不该触发重渲染）────────
  /** SSE 续传游标：`last_stream_id` */
  let lastStreamId = "";
  /** 轮询游标：`after_event_id` */
  let pollCursor: string | null = null;
  let abort: AbortController | null = null;
  /** 每次"开始/停止一条流"自增，旧循环看到 token 不一致就自行退出 */
  let runToken = 0;
  let attempt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollBusy = false;
  let awaitingTimer: ReturnType<typeof setTimeout> | null = null;
  let tempSeq = 0;

  // ── 小工具 ──────────────────────────────────────────────
  function nextTempId(): string {
    tempSeq += 1;
    return `local-${Date.now()}-${tempSeq}`;
  }

  /** 没有服务端 seq 的本地消息：排在当前最大值之后，保证"已读回执"单调 */
  function nextSeq(): number {
    let max = 0;
    for (const m of messages.value) if (m.seq > max) max = m.seq;
    return max + 1;
  }

  function startAwaiting(): void {
    awaitingReply.value = true;
    if (awaitingTimer) clearTimeout(awaitingTimer);
    awaitingTimer = setTimeout(() => {
      awaitingReply.value = false;
      awaitingTimer = null;
    }, AWAITING_REPLY_TIMEOUT);
  }

  function stopAwaiting(): void {
    awaitingReply.value = false;
    if (awaitingTimer) {
      clearTimeout(awaitingTimer);
      awaitingTimer = null;
    }
  }

  /**
   * 合并一条服务端消息。
   * 去重只认 `message_id`：SSE 重连重放、轮询窗口重叠、POST 返回值都会带来同一条消息，
   * 按内容去重会把"用户连发两句一样的话"错吃掉，按 id 才不会。
   */
  function upsertMessage(incoming: AgentMessageView): void {
    applyServerMessage(incoming);
    // 助手消息一到，"等回复/思考中"就该收：降级到轮询时没有 SSE 的 agent_message，
    // 这里不兜住的话指示器会一直挂到 60s 超时。
    if (incoming.role === 2) {
      modelStep.value = null;
      modelStepLabel.value = "";
      stopAwaiting();
    }
  }

  function applyServerMessage(incoming: AgentMessageView): void {
    const fromServer: AgentMessageView = { ...incoming, payload: incoming.payload ?? {}, _optimistic: false };
    const idx = messages.value.findIndex((m) => m.message_id === fromServer.message_id);
    if (idx >= 0) {
      messages.value[idx] = { ...messages.value[idx], ...fromServer, _optimistic: false, _error: undefined };
      return;
    }
    // 兜底：POST 已落库但响应丢了（乐观消息拿不到正式 id），服务端回显会带另一条 id。
    // 此时按"同角色 + 同内容 + 仍是乐观态"认领，避免同一条发言在界面上出现两遍。
    if (fromServer.role === 1) {
      const optimisticIdx = messages.value.findIndex(
        (m) => m._optimistic === true && m.role === 1 && m.content === fromServer.content,
      );
      if (optimisticIdx >= 0) {
        messages.value[optimisticIdx] = { ...fromServer, _optimistic: false };
        return;
      }
    }
    messages.value.push(fromServer);
  }

  function mergeFetched(list: AgentMessage[]): void {
    for (const m of list) upsertMessage({ ...m, payload: m.payload ?? {}, _optimistic: false });
  }

  function replaceSession(next: AgentSession): void {
    const idx = sessions.value.findIndex((s) => s.session_id === next.session_id);
    if (idx >= 0) sessions.value[idx] = next;
    else sessions.value.unshift(next);
  }

  // ── REST ────────────────────────────────────────────────
  async function loadSessions(): Promise<void> {
    sessionsLoading.value = true;
    listError.value = "";
    try {
      const res = await api.get<AgentSessionPage>(`${canvasBase()}/chat/sessions?page=1&page_size=20`);
      sessions.value = res.list ?? [];
      // 首次挂载直接进入最近一个活跃会话：否则右侧面板看起来像坏的（有历史却空白）
      if (!activeSessionId.value && sessions.value.length > 0) {
        const first = sessions.value.find((s) => s.status === 1) ?? sessions.value[0];
        if (first) await selectSession(first.session_id);
      }
    } catch (e) {
      listError.value = (e as Error).message || "读取会话失败";
      // 不清空已加载的列表：面板一次网络抖动不该把用户正在看的会话下拉洗掉
    } finally {
      sessionsLoading.value = false;
    }
  }

  async function createSession(title?: string): Promise<string | null> {
    if (creating.value) return null;
    creating.value = true;
    listError.value = "";
    try {
      const res = await api.post<{ session: AgentSession }>(
        `${canvasBase()}/chat/sessions`,
        title ? { title } : {},
      );
      replaceSession(res.session);
      await selectSession(res.session.session_id, true);
      return res.session.session_id;
    } catch (e) {
      listError.value = (e as Error).message || "新建会话失败";
      return null;
    } finally {
      creating.value = false;
    }
  }

  /** 切会话：先彻底停掉上一条通道，再清空本地态，最后重建 */
  async function selectSession(sessionId: string, force = false): Promise<void> {
    if (!force && activeSessionId.value === sessionId) return;
    stopStream();
    stopPolling();
    runToken += 1;
    activeSessionId.value = sessionId;
    messages.value = [];
    taskProgress.value = {};
    modelStep.value = null;
    modelStepLabel.value = "";
    streamError.value = "";
    lastSendError.value = "";
    pollCursor = null;
    lastStreamId = "";
    stopAwaiting();
    await loadMessages(sessionId);
    if (!ended.value) void runStream(sessionId, runToken);
  }

  async function loadMessages(sessionId: string): Promise<void> {
    messagesLoading.value = true;
    try {
      const res = await api.get<AgentMessagePage>(
        `${canvasBase()}/chat/sessions/${encodeURIComponent(sessionId)}/messages?page_size=50`,
      );
      messages.value = (res.list ?? []).map((m) => ({
        ...m,
        payload: m.payload ?? {},
        _optimistic: false,
      }));
      pollCursor = res.next_event_id;
      void markRead();
    } catch (e) {
      listError.value = (e as Error).message || "读取消息失败";
    } finally {
      messagesLoading.value = false;
    }
  }

  async function endSession(): Promise<boolean> {
    const current = activeSession.value;
    if (!current || ending.value) return false;
    ending.value = true;
    try {
      const res = await api.patch<{ session: AgentSession }>(
        `${canvasBase()}/chat/sessions/${encodeURIComponent(current.session_id)}`,
        { status: 2 },
      );
      replaceSession(res.session ?? { ...current, status: 2 });
      // 结束会话后服务端不会再推事件，留着连接只会空转重连
      stopStream();
      stopPolling();
      runToken += 1;
      streamState.value = "idle";
      stopAwaiting();
      return true;
    } catch (e) {
      listError.value = (e as Error).message || "结束会话失败";
      return false;
    } finally {
      ending.value = false;
    }
  }

  async function send(content: string, referenceNodeIds: string[] = []): Promise<boolean> {
    const sessionId = activeSessionId.value;
    const text = content.trim();
    if (!sessionId || !text || sending.value || ended.value) return false;

    sending.value = true;
    streamError.value = "";
    lastSendError.value = "";
    // 乐观回显：先出气泡，再等服务端确认 message_id。E2E 断言"输入框清空 + 出现 user 气泡"
    // 依赖它，而且真实网络下用户也不该盯着空白的发送按钮。
    const optimistic: AgentMessageView = {
      message_id: nextTempId(),
      role: 1,
      content: text,
      content_type: 1,
      payload: {},
      task_id: null,
      seq: nextSeq(),
      created_at: new Date().toISOString(),
      reaction: 0,
      _optimistic: true,
    };
    messages.value.push(optimistic);

    try {
      const body: AgentSendBody = { content: text, content_type: 1 };
      if (referenceNodeIds.length > 0) body.reference_node_ids = [...referenceNodeIds];
      const res = await api.post<AgentSendResult>(
        `${canvasBase()}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        body,
      );
      // 用服务端正式 id 覆盖临时 id：后续 SSE/轮询回显就靠这个 id 命中，不再依赖内容比对。
      // 竞态兜底：服务端的 user_message 事件可能比这个 POST 响应先到，此时正式 id 已在列表里，
      // 再改临时消息的 id 就会出现两条同一个 id 的消息（Vue 列表 key 重复 + 界面重复气泡）。
      const target = messages.value.find((m) => m.message_id === optimistic.message_id);
      const alreadyArrived = messages.value.some(
        (m) => m.message_id === res.message_id && m.message_id !== optimistic.message_id,
      );
      if (target && alreadyArrived) {
        messages.value = messages.value.filter((m) => m.message_id !== optimistic.message_id);
      } else if (target) {
        target.message_id = res.message_id;
        target.task_id = res.task_id ?? null;
        target._optimistic = false;
      }
      if (res.stream_id) lastStreamId = res.stream_id;
      startAwaiting();
      return true;
    } catch (e) {
      // 落库失败：撤掉乐观气泡（否则界面会显示一条服务端根本不存在的发言），
      // 并把错误抛回给组件去还原输入框
      messages.value = messages.value.filter((m) => m.message_id !== optimistic.message_id);
      lastSendError.value = (e as Error).message || "发送失败";
      return false;
    } finally {
      sending.value = false;
    }
  }

  /**
   * 提交 HITL 决策。
   * `content` 传空串是刻意的：决策不是用户发言，不能编一句"同意"塞进会话记录里
   * （否则历史里会出现用户没说过的内容）。后端需按 `decision` 分支处理。
   */
  async function decide(message: AgentMessageView, decision: AgentDecisionKind): Promise<boolean> {
    const sessionId = activeSessionId.value;
    if (!sessionId || ended.value) return false;
    const interruptId =
      typeof message.payload?.interrupt_id === "string" ? message.payload.interrupt_id : "";
    if (!interruptId) {
      lastSendError.value = "这条消息缺少 interrupt_id，无法提交决策";
      return false;
    }
    try {
      const body: AgentSendBody = {
        content: "",
        content_type: 1,
        decision: { interrupt_id: interruptId, decision },
      };
      await api.post<AgentSendResult>(
        `${canvasBase()}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        body,
      );
      return true;
    } catch (e) {
      lastSendError.value = (e as Error).message || "决策提交失败";
      return false;
    }
  }

  async function react(message: AgentMessageView, action: AgentReactionAction): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId || message._optimistic || !message.message_id) return;
    const prev = message.reaction;
    const next: 0 | 1 | 2 = action === "like" ? 1 : action === "dislike" ? 2 : 0;
    // 先本地翻转（点赞是高频轻动作，等一个 RTT 才亮会很别扭），失败再回滚
    message.reaction = next;
    try {
      await api.post<{ ok: boolean }>(
        `${chatBase()}/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(message.message_id)}/reaction`,
        { reaction: action },
      );
    } catch (e) {
      message.reaction = prev;
      streamError.value = `反馈提交失败：${(e as Error).message}`;
    }
  }

  /**
   * 记录"这条消息的节点已被创建到画布"。
   * 不吞掉返回值（父组件要建完节点才知道 id），但失败只记 console：
   * 这只是溯源元数据，绑定失败不应让"节点已创建"这件事看起来失败。
   */
  async function bindNodes(
    messageId: string,
    nodeIds: string[],
    bindingKind?: 1 | 2 | 3,
  ): Promise<number> {
    const sessionId = activeSessionId.value;
    if (!sessionId || nodeIds.length === 0) return 0;
    try {
      const res = await api.post<{ bound: number }>(
        `${chatBase()}/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/node-binding`,
        bindingKind === undefined ? { node_ids: nodeIds } : { node_ids: nodeIds, binding_kind: bindingKind },
      );
      return res.bound ?? 0;
    } catch (e) {
      console.warn("[canvas-agent] node-binding 失败（不影响节点创建）", e);
      return 0;
    }
  }

  async function loadOutputs(): Promise<void> {
    outputsLoading.value = true;
    outputsError.value = "";
    try {
      const res = await api.get<AgentOutputPage>(`${canvasBase()}/chat/writing-outputs?page=1&page_size=20`);
      outputs.value = res.list ?? [];
    } catch (e) {
      outputsError.value = (e as Error).message || "读取历史产出失败";
      outputs.value = [];
    } finally {
      outputsLoading.value = false;
    }
  }

  /** 已读回执：失败无所谓（下次进来再报），所以不设置任何错误态 */
  async function markRead(): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    let maxSeq = 0;
    for (const m of messages.value) if (m.seq > maxSeq) maxSeq = m.seq;
    if (maxSeq <= 0) return;
    try {
      await api.post<{ unread_count: number }>(
        `${chatBase()}/${encodeURIComponent(sessionId)}/read`,
        { last_read_seq: maxSeq },
      );
    } catch {
      /* 已读只是角标数据，静默失败 */
    }
  }

  // ── SSE ────────────────────────────────────────────────
  function streamHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    // 原生 EventSource 无法带这两个头，这也是必须手写 fetch 解析器的直接原因
    if (auth.state.value.accessToken) headers.Authorization = `Bearer ${auth.state.value.accessToken}`;
    if (activeSpace.value) headers["X-Space-Id"] = activeSpace.value;
    // 续传：服务端按 agent_events(seq > cursor) 重放（契约 §4.4.2）
    if (lastStreamId) headers["Last-Event-ID"] = lastStreamId;
    return headers;
  }

  function streamUrl(sessionId: string): string {
    const q = lastStreamId ? `?last_stream_id=${encodeURIComponent(lastStreamId)}` : "";
    return `${origin}/v1${chatBase()}/${encodeURIComponent(sessionId)}/stream${q}`;
  }

  interface SseFrame {
    id: string;
    event: string;
    data: string[];
  }

  /**
   * 把一帧交给事件处理器。返回 true 表示"链路确实在动"（哪怕只是心跳），
   * 用来判断这次连接是否算一次成功打开（决定要不要重置退避计数）。
   */
  function dispatchFrame(frame: SseFrame): boolean {
    if (frame.data.length === 0) return false;
    const raw = frame.data.join("\n");
    if (!raw.trim()) return false;
    // 心跳：契约要求必须忽略，且不能当作错误
    if (frame.event === "ping" || frame.event === "heartbeat") return true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 非 JSON 帧（代理注入的注释/保活文本）直接丢，不影响后续帧
      return true;
    }
    if (typeof parsed !== "object" || parsed === null) return true;
    const envelope = parsed as Record<string, unknown>;

    const type = typeof envelope.type === "string" && envelope.type ? envelope.type : frame.event;
    if (!type || type === "ping" || type === "heartbeat") return true;

    const payload =
      typeof envelope.payload === "object" && envelope.payload !== null
        ? (envelope.payload as Record<string, unknown>)
        : typeof envelope.data === "object" && envelope.data !== null
          ? (envelope.data as Record<string, unknown>)
          : {};

    const frameId = typeof envelope.id === "string" ? envelope.id : frame.id;
    if (frameId) lastStreamId = frameId;

    applyEvent(type, payload);
    return true;
  }

  function applyEvent(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case "session_opened":
        // 会话就绪通知，无需动作
        return;

      case "user_message": {
        // 契约字段是 content，参照站 bundle 里也见过 text，两个都认（后端用哪个都不至于是空白气泡）
        const content = pickString(payload, "content", "text");
        const messageId = pickString(payload, "message_id");
        if (!content && !messageId) return;
        upsertMessage({
          message_id: messageId || nextTempId(),
          role: 1,
          content,
          content_type: 1,
          payload: {},
          task_id: null,
          seq: pickNumber(payload, "seq") ?? nextSeq(),
          created_at: new Date().toISOString(),
          reaction: 0,
        });
        return;
      }

      case "model_step": {
        const step = pickString(payload, "step", "step_type");
        if (step === "thinking" || step === "writing") {
          modelStep.value = step;
          modelStepLabel.value = pickString(payload, "label");
        }
        return;
      }

      case "agent_message": {
        const inner =
          typeof payload.payload === "object" && payload.payload !== null
            ? (payload.payload as Record<string, unknown>)
            : {};
        const contentType = pickNumber(payload, "content_type") ?? 1;
        const messageId = pickString(payload, "message_id");
        upsertMessage({
          message_id: messageId || nextTempId(),
          role: 2,
          content: pickString(payload, "content", "text"),
          content_type: (contentType >= 1 && contentType <= 4 ? contentType : 1) as 1 | 2 | 3 | 4,
          payload: inner as AgentMessagePayload,
          task_id: typeof payload.task_id === "string" ? payload.task_id : null,
          seq: pickNumber(payload, "seq") ?? nextSeq(),
          created_at: new Date().toISOString(),
          reaction: 0,
        });
        void markRead();
        return;
      }

      case "task_progress": {
        const taskId = pickString(payload, "task_id");
        if (!taskId) return;
        const progress = pickNumber(payload, "progress") ?? 0;
        taskProgress.value = {
          ...taskProgress.value,
          [taskId]: {
            status: pickString(payload, "status"),
            progress: Math.max(0, Math.min(100, progress)),
          },
        };
        return;
      }

      case "error": {
        // 契约要求：错误只落在消息区（红色提示），不弹全局 toast —— 否则一次断点会把整页打断
        const message = pickString(payload, "message", "msg") || "Agent 返回了错误";
        const code = pickNumber(payload, "code");
        streamError.value = code === null ? message : `[${code}] ${message}`;
        stopAwaiting();
        return;
      }

      default:
        // 未知类型静默忽略：后端新增事件类型不能把前端打断（契约 §1.4）
        return;
    }
  }

  function stopStream(): void {
    if (abort) {
      abort.abort();
      abort = null;
    }
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollBusy = false;
  }

  /**
   * SSE 主循环：连上就解析，断开就按 `min(1000·2^n, 30000)` 退避重连；
   * 连续失败超过 maxAttempts，或者端点压根不是事件流，就切轮询（ADR-012 硬要求）。
   */
  async function runStream(sessionId: string, token: number): Promise<void> {
    while (token === runToken && activeSessionId.value === sessionId) {
      const controller = new AbortController();
      abort = controller;
      let openedAt = 0;
      let linkAlive = false;

      try {
        streamState.value = "connecting";
        const res = await fetch(streamUrl(sessionId), {
          method: "GET",
          headers: streamHeaders(),
          // refresh token 在 HttpOnly Cookie 里，流式请求同样要带上（ADR-008）
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        // 非 200 / 非事件流 = 网关把流缓冲成了普通响应或端点没上：重试不会变好，直接降级
        if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
          startPolling(sessionId, token);
          return;
        }

        openedAt = Date.now();
        streamState.value = "live";
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let frame: SseFrame = { id: "", event: "", data: [] };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += decoder.decode(value, { stream: true });

          // 按行解析（而不是按 "\n\n" 切块）：代理可能把两个帧塞进同一个 chunk，
          // 也可能把一帧拆到两个 chunk，行缓冲是唯一稳的边界。
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const rawLine = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

            if (line === "") {
              // 空行 = 一帧结束
              if (dispatchFrame(frame)) linkAlive = true;
              frame = { id: "", event: "", data: [] };
            } else if (line.startsWith(":")) {
              // SSE 注释帧（保活），忽略
            } else if (line.startsWith("id:")) {
              frame.id = line.slice(3).trim();
            } else if (line.startsWith("event:")) {
              frame.event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              frame.data.push(line.slice(5).replace(/^ /, ""));
            }
            nl = buffer.indexOf("\n");
          }
        }
      } catch {
        // 主动 abort（切会话/卸载）：不重连、不降级
        if (controller.signal.aborted) return;
        // 网络层错误落到下面的退避逻辑
      } finally {
        if (abort === controller) abort = null;
      }

      if (token !== runToken || activeSessionId.value !== sessionId) return;

      // 等价原生 EventSource 的 onopen 重置：只有"真的连上且真的有帧"或"稳定存活超过 1s"才算成功，
      // 否则服务端秒断会造成 1s 一次的热重连（把 CPU 和限流打满）。
      if (linkAlive || (openedAt > 0 && Date.now() - openedAt > 1000)) attempt = 0;
      attempt += 1;
      if (attempt > MAX_ATTEMPTS) {
        startPolling(sessionId, token);
        return;
      }
      streamState.value = "connecting";
      await sleep(Math.min(BASE_DELAY * 2 ** (attempt - 1), MAX_DELAY));
    }
  }

  function startPolling(sessionId: string, token: number): void {
    if (token !== runToken || activeSessionId.value !== sessionId) return;
    stopStream();
    if (pollTimer) return;
    // 连接已经被判定不可用：立刻亮降级条，让用户知道"消息会晚 3s，但不会丢"
    streamState.value = "polling";
    const tick = (): void => void pollOnce(sessionId);
    pollTimer = setInterval(tick, POLL_INTERVAL);
    tick();
  }

  async function pollOnce(sessionId: string): Promise<void> {
    if (pollBusy || activeSessionId.value !== sessionId) return;
    pollBusy = true;
    const hadPollError = streamError.value.startsWith("轮询补消息失败");
    try {
      const q = new URLSearchParams({ page_size: "50" });
      if (pollCursor) q.set("after_event_id", pollCursor);
      const res = await api.get<AgentMessagePage>(
        `${canvasBase()}/chat/sessions/${encodeURIComponent(sessionId)}/messages?${q.toString()}`,
      );
      mergeFetched(res.list ?? []);
      pollCursor = res.next_event_id;
      // 恢复了就别留着上一次的失败红字，否则用户会以为轮询一直是坏的
      if (hadPollError) streamError.value = "";
    } catch (e) {
      // 轮询失败不升级成 degraded（状态不变），只在消息区给出可读原因
      streamError.value = `轮询补消息失败：${(e as Error).message}`;
    } finally {
      pollBusy = false;
    }
  }

  /** 降级条上的"重试实时连接"：用户手动触发，比后台每 60s 静默试探更省连接、也更可解释 */
  function retryRealtime(): void {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    stopPolling();
    stopStream();
    attempt = 0;
    streamError.value = "";
    runToken += 1;
    void runStream(sessionId, runToken);
  }

  /**
   * 模型选择只做前端暂存。
   * 为什么不在发送时带上：契约冻结的 `POST …/messages` body 里没有模型字段，
   * 擅自加字段在 `forbidNonWhitelisted` 的校验下会直接 400。
   * 后端下发字段后，只需在这里把 `activeModelId` 拼进 `AgentSendBody` 即可。
   */
  function setActiveModel(modelId: string): void {
    activeModelId.value = modelId;
  }

  function dispose(): void {
    stopStream();
    stopPolling();
    runToken += 1;
    stopAwaiting();
    streamState.value = "idle";
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    // 会话
    sessions,
    activeSessionId,
    activeSession,
    sessionsLoading,
    creating,
    ending,
    listError,
    ended,
    // 消息
    messages,
    messagesLoading,
    sending,
    awaitingReply,
    streamError,
    lastSendError,
    modelStep,
    modelStepLabel,
    taskProgress,
    // 通道
    streamState,
    degraded,
    // 历史产出
    outputs,
    outputsLoading,
    outputsError,
    // 模型
    activeModelId,
    setActiveModel,
    // 动作
    loadSessions,
    createSession,
    selectSession,
    endSession,
    send,
    decide,
    react,
    loadOutputs,
    bindNodes,
    markRead,
    retryRealtime,
    dispose,
  };
};
