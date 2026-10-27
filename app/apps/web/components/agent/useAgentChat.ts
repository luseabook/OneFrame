import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import { useApi } from "~/composables/useApi";
import { useAuth } from "~/composables/useAuth";
import { useActiveSpaceId } from "~/composables/useActiveSpace";

/**
 * 独立创作 Agent（scope=1）会话状态机 —— `/agent` 页面专用。
 *
 * 形状来自 `_acceptance/_gap/agent-chat-frontend-contract.md`（会话/消息/SSE 协议），
 * 但作用域换成 `/agent/sessions/*`（画布内那套在 `useCanvasAgent.ts`，不要互相 import：
 * 一个绑 canvasId、一个不绑，路径与作用域闸门都不同，硬合并会让两边都长满 if）。
 *
 * 三条不可省的取舍（与画布面板同源，理由见 `useCanvasAgent.ts` 顶部注释）：
 * 1. **不用原生 `EventSource`**：它不能带 `Authorization` 头，而 access token 只在内存（ADR-008）；
 * 2. **SSE 只是加速器**：连不上必须在 3s 轮询下降级成等价行为（ADR-012 硬要求），
 *    所以所有状态都要能从 REST 幂等读回；
 * 3. **去重只认 `message_id`**：SSE 重连重放、轮询窗口重叠、POST 回执都会带来同一条消息。
 *
 * `seq` 游标：轮询用 `after_event_id`（= 上一页 `next_event_id`），SSE 用 `last_stream_id`
 * （= 上一帧 id）。两条游标都只前进不后退，避免"重放→重复→UI 闪"。
 */

export interface AgentSessionDto {
  session_id: string;
  title: string;
  status: number;
  scope: number;
  canvas_id: string | null;
  last_active_at: string | null;
  created_at: string;
  message_count: number;
  last_message_preview: string;
}

export interface AgentMessageDto {
  message_id: string;
  /** 1 用户 2 助手 3 系统 */
  role: number;
  content: string;
  /** 1 文本 2 卡片 3 计划 4 HITL */
  content_type: number;
  payload: Record<string, unknown>;
  task_id: string | null;
  seq: number;
  created_at: string;
  reaction: number;
}

export interface AgentMessageView extends AgentMessageDto {
  /** 尚未被服务端确认的本地回显（禁止点赞/分享） */
  _optimistic?: boolean;
  _error?: string;
}

export interface AgentTaskProgress {
  status: number | string;
  progress: number;
}

interface SessionPage {
  list: AgentSessionDto[];
  total: number;
  page: number;
  page_size: number;
}

interface MessagePage {
  list: AgentMessageDto[];
  next_event_id: string | null;
  has_more: boolean;
}

interface SendResult {
  message_id: string;
  stream_id: string;
  queued: boolean;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;
/** ADR-012：降级轮询周期固定 3s */
const POLL_INTERVAL = 3000;
const AWAITING_TIMEOUT = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asString = (src: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string") return value;
  }
  return "";
};

const asNumber = (src: Record<string, unknown>, key: string): number | null => {
  const value = src[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const useAgentChat = () => {
  const api = useApi();
  const auth = useAuth();
  const activeSpace = useActiveSpaceId();
  const config = useRuntimeConfig();
  const origin = (config.public.apiBase as string) || "";

  const base = (): string => "/agent/sessions";

  // ── 会话 ────────────────────────────────────────────────
  const sessions = ref<AgentSessionDto[]>([]);
  const activeSessionId = ref<string | null>(null);
  const sessionsLoading = ref(false);
  const creating = ref(false);
  const ending = ref(false);
  const listError = ref("");

  const activeSession = computed<AgentSessionDto | null>(
    () => sessions.value.find((item) => item.session_id === activeSessionId.value) ?? null,
  );
  /** status !== 1 即只读（2 已结束 / 3 已归档） */
  const ended = computed(() => (activeSession.value ? activeSession.value.status !== 1 : false));

  // ── 消息 ────────────────────────────────────────────────
  const messages = ref<AgentMessageView[]>([]);
  const messagesLoading = ref(false);
  const sending = ref(false);
  const awaitingReply = ref(false);
  const streamError = ref("");
  const lastSendError = ref("");
  const modelStep = ref<"thinking" | "writing" | null>(null);
  const taskProgress = ref<Record<string, AgentTaskProgress>>({});

  // ── 通道 ────────────────────────────────────────────────
  /** idle / connecting / live / polling（polling = 降级中，页面亮降级条） */
  const streamState = ref<"idle" | "connecting" | "live" | "polling">("idle");
  const degraded = computed(() => streamState.value === "polling");
  /** 未读数：服务端只回一个整数，本地不做增量推算 */
  const unreadCount = ref(0);

  // ── 内部可变状态（不进响应式）───────────────────────────
  let lastStreamId = "";
  let pollCursor: string | null = null;
  let abort: AbortController | null = null;
  let runToken = 0;
  let attempt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollBusy = false;
  let awaitingTimer: ReturnType<typeof setTimeout> | null = null;
  let tempSeq = 0;

  function nextTempId(): string {
    tempSeq += 1;
    return `local-${Date.now()}-${tempSeq}`;
  }

  function nextSeq(): number {
    let max = 0;
    for (const item of messages.value) if (item.seq > max) max = item.seq;
    return max + 1;
  }

  function startAwaiting(): void {
    awaitingReply.value = true;
    if (awaitingTimer) clearTimeout(awaitingTimer);
    awaitingTimer = setTimeout(() => {
      awaitingReply.value = false;
      awaitingTimer = null;
    }, AWAITING_TIMEOUT);
  }

  function stopAwaiting(): void {
    awaitingReply.value = false;
    if (awaitingTimer) {
      clearTimeout(awaitingTimer);
      awaitingTimer = null;
    }
  }

  /** 合并一条服务端消息：按 message_id 去重（重复帧/重叠轮询窗口/回执三源同 id） */
  function applyServerMessage(incoming: AgentMessageDto): void {
    const fromServer: AgentMessageView = { ...incoming, payload: incoming.payload ?? {}, _optimistic: false };
    const index = messages.value.findIndex((item) => item.message_id === fromServer.message_id);
    if (index >= 0) {
      messages.value[index] = { ...messages.value[index], ...fromServer, _optimistic: false, _error: undefined };
      return;
    }
    // POST 回执丢了时，服务端回显会带另一个 id：按"同角色 + 同内容 + 仍乐观态"认领，避免重复气泡
    if (fromServer.role === 1) {
      const optimisticIndex = messages.value.findIndex(
        (item) => item._optimistic === true && item.role === 1 && item.content === fromServer.content,
      );
      if (optimisticIndex >= 0) {
        messages.value[optimisticIndex] = { ...fromServer, _optimistic: false };
        return;
      }
    }
    messages.value.push(fromServer);
  }

  function upsertMessage(incoming: AgentMessageDto): void {
    applyServerMessage(incoming);
    if (incoming.role === 2) {
      modelStep.value = null;
      stopAwaiting();
    }
  }

  function replaceSession(next: AgentSessionDto): void {
    const index = sessions.value.findIndex((item) => item.session_id === next.session_id);
    if (index >= 0) sessions.value[index] = next;
    else sessions.value.unshift(next);
  }

  // ── REST ────────────────────────────────────────────────
  async function loadSessions(): Promise<void> {
    sessionsLoading.value = true;
    listError.value = "";
    try {
      const res = await api.get<SessionPage>(`${base()}?page=1&page_size=30`);
      sessions.value = res.list ?? [];
      // 首次进入自动打开最近的活跃会话：否则右侧看起来像"历史都在但打不开"
      if (!activeSessionId.value && sessions.value.length > 0) {
        const first = sessions.value.find((item) => item.status === 1) ?? sessions.value[0];
        if (first) await selectSession(first.session_id);
      }
    } catch (error) {
      listError.value = (error as Error).message || "读取会话失败";
    } finally {
      sessionsLoading.value = false;
    }
  }

  async function createSession(title?: string): Promise<string | null> {
    if (creating.value) return null;
    creating.value = true;
    listError.value = "";
    try {
      const res = await api.post<{ session: AgentSessionDto }>(base(), title ? { title } : {});
      replaceSession(res.session);
      await selectSession(res.session.session_id, true);
      return res.session.session_id;
    } catch (error) {
      listError.value = (error as Error).message || "新建会话失败";
      return null;
    } finally {
      creating.value = false;
    }
  }

  /** 切会话：先停旧通道，再清本地态，最后重建（顺序不能换，否则旧流会往新列表里 push） */
  async function selectSession(sessionId: string, force = false): Promise<void> {
    if (!force && activeSessionId.value === sessionId) return;
    stopStream();
    stopPolling();
    runToken += 1;
    activeSessionId.value = sessionId;
    messages.value = [];
    taskProgress.value = {};
    modelStep.value = null;
    streamError.value = "";
    lastSendError.value = "";
    pollCursor = null;
    lastStreamId = "";
    unreadCount.value = 0;
    stopAwaiting();
    await loadMessages(sessionId);
    if (!ended.value) void runStream(sessionId, runToken);
  }

  async function loadMessages(sessionId: string): Promise<void> {
    messagesLoading.value = true;
    try {
      const res = await api.get<MessagePage>(`${base()}/${encodeURIComponent(sessionId)}/messages?page_size=50`);
      messages.value = (res.list ?? []).map((item) => ({
        ...item,
        payload: item.payload ?? {},
        _optimistic: false,
      }));
      pollCursor = res.next_event_id;
      void markRead();
    } catch (error) {
      listError.value = (error as Error).message || "读取消息失败";
    } finally {
      messagesLoading.value = false;
    }
  }

  async function send(content: string, skillIds: string[] = []): Promise<boolean> {
    const sessionId = activeSessionId.value;
    const text = content.trim();
    if (!sessionId || !text || sending.value || ended.value) return false;

    sending.value = true;
    streamError.value = "";
    lastSendError.value = "";
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
      const res = await api.post<SendResult>(`${base()}/${encodeURIComponent(sessionId)}/messages`, {
        content: text,
        content_type: 1,
        ...(skillIds.length > 0 ? { skill_ids: skillIds } : {}),
      });
      const target = messages.value.find((item) => item.message_id === optimistic.message_id);
      const alreadyArrived = messages.value.some(
        (item) => item.message_id === res.message_id && item.message_id !== optimistic.message_id,
      );
      // 服务端的 user_message 事件可能早于 POST 回执到达：此时正式 id 已在列表，不能再改名（会撞 key）
      if (target && alreadyArrived) {
        messages.value = messages.value.filter((item) => item.message_id !== optimistic.message_id);
      } else if (target) {
        target.message_id = res.message_id;
        target._optimistic = false;
      }
      if (res.stream_id) lastStreamId = res.stream_id;
      startAwaiting();
      return true;
    } catch (error) {
      // 落库失败必须撤掉乐观气泡，否则界面留一条服务端不存在的发言
      messages.value = messages.value.filter((item) => item.message_id !== optimistic.message_id);
      lastSendError.value = (error as Error).message || "发送失败";
      return false;
    } finally {
      sending.value = false;
    }
  }

  async function endSession(): Promise<boolean> {
    const current = activeSession.value;
    if (!current || ending.value) return false;
    ending.value = true;
    try {
      const res = await api.patch<{ session: AgentSessionDto }>(
        `${base()}/${encodeURIComponent(current.session_id)}`,
        { status: 2 },
      );
      replaceSession(res.session ?? { ...current, status: 2 });
      // 结束会话后服务端不再推事件，留着连接只会空转重连
      stopStream();
      stopPolling();
      runToken += 1;
      streamState.value = "idle";
      stopAwaiting();
      return true;
    } catch (error) {
      listError.value = (error as Error).message || "结束会话失败";
      return false;
    } finally {
      ending.value = false;
    }
  }

  async function removeSession(sessionId: string): Promise<boolean> {
    try {
      await api.delete<{ ok: boolean }>(`${base()}/${encodeURIComponent(sessionId)}`);
      sessions.value = sessions.value.filter((item) => item.session_id !== sessionId);
      if (activeSessionId.value === sessionId) {
        stopStream();
        stopPolling();
        runToken += 1;
        activeSessionId.value = null;
        messages.value = [];
        streamState.value = "idle";
      }
      return true;
    } catch (error) {
      listError.value = (error as Error).message || "删除会话失败";
      return false;
    }
  }

  async function renameSession(sessionId: string, title: string): Promise<boolean> {
    try {
      const res = await api.patch<{ session: AgentSessionDto }>(
        `${base()}/${encodeURIComponent(sessionId)}`,
        { title },
      );
      replaceSession(res.session);
      return true;
    } catch (error) {
      listError.value = (error as Error).message || "重命名失败";
      return false;
    }
  }

  /** 已读回执：失败静默（只是角标数据，不该打扰用户） */
  async function markRead(): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    let maxSeq = 0;
    for (const item of messages.value) if (item.seq > maxSeq) maxSeq = item.seq;
    if (maxSeq <= 0) return;
    try {
      const res = await api.post<{ unread_count: number }>(
        `${base()}/${encodeURIComponent(sessionId)}/read`,
        { last_read_seq: maxSeq },
      );
      unreadCount.value = res.unread_count ?? 0;
    } catch {
      /* 已读失败不影响阅读 */
    }
  }

  // ── SSE ────────────────────────────────────────────────
  function streamHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (auth.state.value.accessToken) headers.Authorization = `Bearer ${auth.state.value.accessToken}`;
    if (activeSpace.value) headers["X-Space-Id"] = activeSpace.value;
    if (lastStreamId) headers["Last-Event-ID"] = lastStreamId;
    return headers;
  }

  function streamUrl(sessionId: string): string {
    const q = lastStreamId ? `?last_stream_id=${encodeURIComponent(lastStreamId)}` : "";
    return `${origin}/v1${base()}/${encodeURIComponent(sessionId)}/stream${q}`;
  }

  interface SseFrame {
    id: string;
    event: string;
    data: string[];
  }

  /** 处理一帧；返回 true 表示链路确实在动（心跳也算），用于判断要不要重置退避 */
  function dispatchFrame(frame: SseFrame): boolean {
    if (frame.data.length === 0) return false;
    const raw = frame.data.join("\n");
    if (!raw.trim()) return false;
    if (frame.event === "ping" || frame.event === "heartbeat") return true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 代理注入的非 JSON 保活文本：丢掉，不影响后续帧
      return true;
    }
    if (typeof parsed !== "object" || parsed === null) return true;
    const envelope = parsed as Record<string, unknown>;
    const type = typeof envelope.type === "string" && envelope.type ? envelope.type : frame.event;
    if (!type || type === "ping" || type === "heartbeat") return true;
    const payload =
      typeof envelope.payload === "object" && envelope.payload !== null
        ? (envelope.payload as Record<string, unknown>)
        : {};
    const frameId = typeof envelope.id === "string" ? envelope.id : frame.id;
    if (frameId) lastStreamId = frameId;
    applyEvent(type, payload);
    return true;
  }

  function applyEvent(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case "session_opened":
        return;
      case "user_message": {
        const content = asString(payload, "content", "text");
        const messageId = asString(payload, "message_id");
        if (!content && !messageId) return;
        upsertMessage({
          message_id: messageId || nextTempId(),
          role: 1,
          content,
          content_type: 1,
          payload: {},
          task_id: null,
          seq: asNumber(payload, "seq") ?? nextSeq(),
          created_at: new Date().toISOString(),
          reaction: 0,
        });
        return;
      }
      case "model_step": {
        const step = asString(payload, "step", "step_type");
        if (step === "thinking" || step === "writing") modelStep.value = step;
        return;
      }
      case "agent_message": {
        const inner =
          typeof payload.payload === "object" && payload.payload !== null
            ? (payload.payload as Record<string, unknown>)
            : {};
        const contentType = asNumber(payload, "content_type") ?? 1;
        upsertMessage({
          message_id: asString(payload, "message_id") || nextTempId(),
          role: 2,
          content: asString(payload, "content", "text"),
          content_type: contentType >= 1 && contentType <= 4 ? contentType : 1,
          payload: inner,
          task_id: typeof payload.task_id === "string" ? payload.task_id : null,
          seq: asNumber(payload, "seq") ?? nextSeq(),
          created_at: new Date().toISOString(),
          reaction: 0,
        });
        void markRead();
        return;
      }
      case "task_progress": {
        const taskId = asString(payload, "task_id");
        if (!taskId) return;
        const status = payload.status;
        taskProgress.value = {
          ...taskProgress.value,
          [taskId]: {
            status: typeof status === "number" || typeof status === "string" ? status : "running",
            progress: Math.max(0, Math.min(100, asNumber(payload, "progress") ?? 0)),
          },
        };
        return;
      }
      case "error": {
        // 契约：错误只落在消息区，不弹全局 toast（一次断点不该打断整页）
        const message = asString(payload, "message", "msg") || "Agent 返回了错误";
        const code = asNumber(payload, "code");
        streamError.value = code === null ? message : `[${code}] ${message}`;
        stopAwaiting();
        return;
      }
      default:
        // 未知事件类型静默忽略：后端新增类型不能打断前端
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
          // refresh token 在 HttpOnly Cookie 里，流式请求同样要带（ADR-008）
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        // 非 200 / 非事件流 = 网关把流缓冲成普通响应：重试不会变好，直接降级轮询
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
          // 按行解析（不是按 "\n\n" 切块）：代理可能把多帧塞一个 chunk，也可能把一帧拆两个 chunk
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const rawLine = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
            if (line === "") {
              if (dispatchFrame(frame)) linkAlive = true;
              frame = { id: "", event: "", data: [] };
            } else if (line.startsWith(":")) {
              // 注释帧（保活）
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
        if (controller.signal.aborted) return;
      } finally {
        if (abort === controller) abort = null;
      }
      if (token !== runToken || activeSessionId.value !== sessionId) return;
      // 等价 EventSource 的 onopen 重置：只有"真有帧"或"稳定存活 > 1s"才算成功，
      // 否则服务端秒断会造成 1s 一次热重连（把限流打满）
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
    // 连接已被判定不可用：立刻亮降级条，让用户知道"消息会晚 3s，但不会丢"
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
      const res = await api.get<MessagePage>(
        `${base()}/${encodeURIComponent(sessionId)}/messages?${q.toString()}`,
      );
      for (const item of res.list ?? []) upsertMessage(item);
      pollCursor = res.next_event_id;
      if (hadPollError) streamError.value = "";
    } catch (error) {
      streamError.value = `轮询补消息失败：${(error as Error).message}`;
    } finally {
      pollBusy = false;
    }
  }

  /** 降级条上的"重试实时连接"：用户手动触发，比后台静默试探更省连接也更可解释 */
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

  function dispose(): void {
    stopStream();
    stopPolling();
    runToken += 1;
    stopAwaiting();
    streamState.value = "idle";
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    sessions,
    activeSessionId,
    activeSession,
    sessionsLoading,
    creating,
    ending,
    listError,
    ended,
    messages,
    messagesLoading,
    sending,
    awaitingReply,
    streamError,
    lastSendError,
    modelStep,
    taskProgress,
    streamState,
    degraded,
    unreadCount,
    loadSessions,
    createSession,
    selectSession,
    endSession,
    removeSession,
    renameSession,
    send,
    markRead,
    retryRealtime,
    dispose,
  };
};
