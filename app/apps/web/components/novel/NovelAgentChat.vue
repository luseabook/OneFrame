<script setup lang="ts">
import type {
  NovelAgentChatResultDto,
  NovelEditMessageDto,
  NovelEditPendingDto,
  NovelEditSessionDto,
} from "~/types/api";

/**
 * 剧本编辑 Agent 面板（会话式逐集 diff）—— 本批的产品差异点。
 *
 * 交互契约（与后端 16 条路由一一对应）：
 *   enter → chat（只产出待确认 diff，**不改正文**）→ 逐集 apply/reject
 *   → apply_all/reject_all → exit（关闭会话并把未确认 diff 作废）
 *
 * 三个刻意的 UI 决定：
 * 1. **发送按钮在 pending 未清空时不禁用**：用户可以继续追加要求，新 diff 会替换同集的旧 diff
 *    （后端按 (session, episode) 只保留一条未决）。禁用会让人以为"必须点完才能继续"。
 * 2. **每条 diff 都显示变更说明**：只说"已优化"的 diff 无法确认，等于把审核成本推给用户。
 * 3. **错误一律显式展示**：746005（同一会话并发一轮）、400100（会话已关闭）都直接显示，
 *    不做"自动重试"——重试会掩盖"你的上一条要求其实没被处理"这个事实。
 */
const props = defineProps<{
  novelId: string;
  /** 定稿后正文冻结，apply 会被后端拒；这里提前禁用并说明原因 */
  locked?: boolean;
}>();

const emit = defineEmits<{ applied: []; changed: [] }>();

const api = useApi();
const toast = useToast();

const session = ref<NovelEditSessionDto | null>(null);
const sessions = ref<NovelEditSessionDto[]>([]);
const messages = ref<NovelEditMessageDto[]>([]);
const pending = ref<NovelEditPendingDto[]>([]);
const content = ref("");
const loading = ref(false);
const sending = ref(false);
const deciding = ref<string | null>(null);
const error = ref("");

const base = computed(() => `/novel/${props.novelId}/script_edit_agent`);

async function loadSessions(): Promise<void> {
  const data = await api.get<{ list: NovelEditSessionDto[]; total: number }>(`${base.value}/sessions`);
  sessions.value = data.list ?? [];
}

async function loadSessionDetail(sid: string): Promise<void> {
  const data = await api.get<{ session: NovelEditSessionDto; messages: NovelEditMessageDto[]; pending: NovelEditPendingDto[] }>(
    `${base.value}/sessions/${sid}`,
  );
  session.value = data.session;
  messages.value = data.messages ?? [];
  pending.value = data.pending ?? [];
}

async function enter(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.post<{ session: NovelEditSessionDto; pending: NovelEditPendingDto[]; replayed: boolean }>(
      `${base.value}/enter`,
      {},
    );
    session.value = data.session;
    pending.value = data.pending ?? [];
    if (data.replayed) toast.info("已复用当前编辑会话");
    await loadSessions();
    await loadSessionDetail(data.session.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "进入编辑态失败";
  } finally {
    loading.value = false;
  }
}

async function exit(): Promise<void> {
  if (!session.value) return;
  loading.value = true;
  error.value = "";
  try {
    const data = await api.post<{ closed: string[]; discarded_pending: number }>(`${base.value}/exit`, {});
    toast.success(
      data.discarded_pending > 0
        ? `已退出编辑态，${data.discarded_pending} 条未确认变更已作废`
        : "已退出编辑态",
    );
    session.value = null;
    messages.value = [];
    pending.value = [];
    await loadSessions();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "退出失败";
  } finally {
    loading.value = false;
  }
}

async function send(): Promise<void> {
  const text = content.value.trim();
  if (!text || !session.value) return;
  sending.value = true;
  error.value = "";
  try {
    const data = await api.post<NovelAgentChatResultDto>(
      `${base.value}/sessions/${session.value.id}/chat`,
      { content: text },
    );
    content.value = "";
    messages.value = [...messages.value, data.user_message, data.message];
    pending.value = data.pending ?? [];
    if (data.ignored_episode_nos.length > 0) {
      toast.error(`模型返回了不存在的集号：${data.ignored_episode_nos.join("、")}（已忽略，请换个说法再试）`);
    } else if (pending.value.length === 0) {
      toast.info("本轮没有产生变更（可以直接继续提要求）");
    }
    emit("changed");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "对话失败";
  } finally {
    sending.value = false;
  }
}

async function applyOne(episodeId: string): Promise<void> {
  if (!session.value) return;
  deciding.value = episodeId;
  error.value = "";
  try {
    await api.post(`${base.value}/sessions/${session.value.id}/episodes/${episodeId}/apply`, {});
    toast.success("已应用到正文（生成了新版本）");
    await loadSessionDetail(session.value.id);
    emit("applied");
  } catch (e) {
    // 746002 = 这条变更已被决定；不是"失败"，但必须让用户看见真实原因
    error.value = e instanceof Error ? e.message : "应用失败";
  } finally {
    deciding.value = null;
  }
}

async function rejectOne(episodeId: string): Promise<void> {
  if (!session.value) return;
  deciding.value = episodeId;
  error.value = "";
  try {
    await api.post(`${base.value}/sessions/${session.value.id}/episodes/${episodeId}/reject`, { reason: "" });
    toast.info("已驳回（正文没有任何改动）");
    await loadSessionDetail(session.value.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "驳回失败";
  } finally {
    deciding.value = null;
  }
}

async function decideAll(action: "apply_all" | "reject_all"): Promise<void> {
  if (!session.value) return;
  if (pending.value.length === 0) {
    toast.info("当前没有待确认变更");
    return;
  }
  deciding.value = action;
  error.value = "";
  try {
    const data = await api.post<{ applied?: number; rejected?: number; remaining: number }>(
      `${base.value}/sessions/${session.value.id}/${action}`,
      {},
    );
    const count = action === "apply_all" ? (data.applied ?? 0) : (data.rejected ?? 0);
    toast.success(`${action === "apply_all" ? "已应用" : "已驳回"} ${count} 集，剩余 ${data.remaining} 条待确认`);
    await loadSessionDetail(session.value.id);
    if (action === "apply_all") emit("applied");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "批量操作失败";
  } finally {
    deciding.value = null;
  }
}

async function abort(): Promise<void> {
  if (!session.value) return;
  try {
    const data = await api.post<{ aborted: boolean; in_flight: boolean; reason: string }>(
      `${base.value}/sessions/${session.value.id}/abort`,
      {},
    );
    // 「没有在途轮次」不是错误，但也绝不显示成"已中止"——那是在骗用户
    toast.info(data.aborted ? "已请求中止本轮" : "当前没有在跑的轮次");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "中止失败";
  }
}

async function heartbeat(): Promise<void> {
  try {
    await api.post(`${base.value}/heartbeat`, { dirty: pending.value.length > 0 });
  } catch {
    // 心跳失败通常意味着会话已被关闭；刷新会话状态即可，不弹错打扰正在输入的用户
    session.value = null;
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
onMounted(async () => {
  try {
    await loadSessions();
    const active = sessions.value.find((row) => row.status === 1 && row.is_current) ?? sessions.value.find((row) => row.status === 1);
    if (active) await loadSessionDetail(active.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载编辑会话失败";
  }
  heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
});

onBeforeUnmount(() => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
});

function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="agent">
    <header class="agent__bar">
      <div class="agent__state">
        <span class="dot" :class="{ on: !!session }" aria-hidden="true" />
        <span>{{ session ? `编辑中 · ${session.title || "未命名会话"}` : "未进入编辑态" }}</span>
      </div>
      <div class="agent__bar-actions">
        <Button v-if="session" size="sm" variant="ghost" :disabled="sending" @click="abort">中止本轮</Button>
        <Button v-if="session" size="sm" variant="secondary" :loading="loading" @click="exit">退出编辑</Button>
        <Button v-else size="sm" :loading="loading" @click="enter">进入编辑态</Button>
      </div>
    </header>

    <p v-if="locked" class="agent__locked">
      本子已定稿（status=16），正文冻结：可以继续生成建议，但「应用」会被拒绝。需要改稿请先撤销定稿（当前版本未提供，已登记待办）。
    </p>
    <p v-if="error" class="agent__err">{{ error }}</p>

    <div v-if="!session" class="agent__empty">
      <EmptyState
        icon="✎"
        title="剧本编辑 Agent"
        description="进入编辑态后，用一句话提要求（例如「把第 3 集改成悲剧结局」），Agent 只会产出逐集变更建议，逐集确认后才写入正文。"
      />
    </div>

    <template v-else>
      <div class="agent__body">
        <div class="agent__chat">
          <div class="agent__messages" role="log">
            <p v-if="messages.length === 0" class="agent__tip">
              还没有对话。试试：「把第 2 集的结尾改成留白，别把话说尽」。
            </p>
            <article v-for="message in messages" :key="message.id" class="msg" :class="{ mine: message.role === 1 }">
              <p class="msg__who">{{ message.role === 1 ? "我" : "编辑 Agent" }}<span class="msg__time">{{ fmtTime(message.created_at) }}</span></p>
              <pre class="msg__text">{{ message.content }}</pre>
            </article>
          </div>
          <div class="agent__composer">
            <TextAreaField
              v-model="content"
              :rows="3"
              :maxlength="4000"
              placeholder="描述你要的改动（会生成逐集待确认变更，不会直接改正文）"
            />
            <div class="agent__composer-foot">
              <span class="agent__count">{{ pending.length }} 条待确认</span>
              <Button size="sm" :loading="sending" :disabled="!content.trim()" @click="send">发送</Button>
            </div>
          </div>
        </div>

        <aside class="agent__diffs">
          <header class="diffs__head">
            <strong>待确认变更（{{ pending.length }}）</strong>
            <div class="diffs__bulk">
              <Button size="sm" variant="ghost" :disabled="pending.length === 0 || !!deciding" @click="decideAll('reject_all')">
                全部驳回
              </Button>
              <Button size="sm" :loading="deciding === 'apply_all'" :disabled="pending.length === 0 || !!deciding" @click="decideAll('apply_all')">
                全部应用
              </Button>
            </div>
          </header>
          <div class="diffs__list">
            <NovelPendingDiff
              v-for="item in pending"
              :key="item.id"
              :pending="item"
              :busy="deciding === item.episode_id"
              @apply="applyOne"
              @reject="rejectOne"
            />
            <p v-if="pending.length === 0" class="diffs__empty">没有待确认变更。提一条要求后，这里会逐集列出「原文 / 建议文 / 变更说明」。</p>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.agent {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.agent__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-1);
  background: var(--panel-tint);
}
.agent__state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: var(--text-sm);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-5);
}
.dot.on {
  background: var(--success);
  box-shadow: 0 0 0 3px #5fd08a22;
}
.agent__bar-actions {
  display: flex;
  gap: 8px;
}
.agent__locked {
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: var(--text-xs);
  line-height: 1.6;
}
.agent__err {
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-xs);
}
.agent__empty {
  padding: 24px;
}
.agent__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
}
@media (max-width: 1080px) {
  .agent__body {
    grid-template-columns: 1fr;
  }
}
.agent__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border-1);
}
.agent__messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.agent__tip,
.diffs__empty {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.msg {
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-1);
  background: var(--bg-sunken);
  padding: 8px 10px;
}
.msg.mine {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.msg__who {
  margin: 0 0 4px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.msg__time {
  color: var(--text-5);
}
.msg__text {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-xs);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.agent__composer {
  border-top: 1px solid var(--border-1);
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent__composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.agent__count {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.agent__diffs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.diffs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-1);
  color: var(--text-2);
  font-size: var(--text-sm);
}
.diffs__bulk {
  display: flex;
  gap: 8px;
}
.diffs__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
