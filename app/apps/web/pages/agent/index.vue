<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AgentMessageItem from "~/components/agent/AgentMessageItem.vue";
import AgentRecommendCards from "~/components/agent/AgentRecommendCards.vue";
import AgentSkillDrawer from "~/components/agent/AgentSkillDrawer.vue";
import AgentVoiceRecorder from "~/components/agent/AgentVoiceRecorder.vue";
import { useAgentChat } from "~/components/agent/useAgentChat";
import type { AgentRecommendCard, AgentSkill } from "~/types/api";

/**
 * 创作 Agent（独立创作页，竞品 `/agent`，`routes.txt:14-16`；能力见
 * `docs/01-product/_parts/d-canvas-agent.md`）。完成计划 4.1（`completion-plan-to-100.md:177`）。
 *
 * 页面只做三件事：**会话侧栏 / 消息流（含任务卡）/ 输入区（含 Skill 卡与语音）**。
 * 所有状态机在 `components/agent/useAgentChat.ts`（SSE 重连、3s 降级轮询、seq 游标去重），
 * 这里不重复实现，避免"两处各有一套去重逻辑"。
 *
 * 三条产品约束：
 * 1. **不允许假数据**：没有会话就显示空态与推荐卡，不塞示例对话；
 * 2. **不允许点了没反应**：发送/新建/结束/收藏/录音每一处都有 loading 或可读失败提示；
 * 3. **分享是任务级的**：复用 `POST /tasks/:id/share`（任务卡上的分享按钮），
 *    不新造"分享会话"体系（竞品的 `agent/task/share/{id}/sse` 只覆盖任务产物）。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t } = useI18n();
useHead({ title: () => t("agent.metaTitle") });

const chat = useAgentChat();

const composer = ref("");
const pickedSkills = ref<AgentSkill[]>([]);
const drawerOpen = ref(false);
const scroller = ref<HTMLElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
let pendingRecommendSkillIds: string[] = [];

const messages = chat.messages;

const isEmpty = computed(() => messages.value.length === 0 && !chat.messagesLoading.value);
const canSend = computed(
  () => composer.value.trim().length > 0 && !chat.sending.value && !chat.ended.value && !!chat.activeSessionId.value,
);
/** 输入区状态提示：优先级 结束 > 发送中 > 等回复 > 思考中 */
const composerHint = computed(() => {
  if (chat.ended.value) return t("agent.hintEnded");
  if (chat.sending.value) return t("agent.sending");
  if (chat.modelStep.value === "thinking") return t("agent.hintThinking");
  if (chat.modelStep.value === "writing") return t("agent.hintWriting");
  if (chat.awaitingReply.value) return t("agent.awaiting");
  return "";
});
const channelLabel = computed(() => {
  if (chat.streamState.value === "live") return t("agent.channelLive");
  if (chat.streamState.value === "polling") return t("agent.channelPolling");
  if (chat.streamState.value === "connecting") return t("agent.channelConnecting");
  return t("agent.channelOffline");
});

function scrollToBottom(): void {
  void nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(
  () => messages.value.length,
  () => scrollToBottom(),
);

// 侧栏的「标题 / 条数 / 最后一句」是服务端算的：发送后与回复到达后各刷一次，
// 否则用户会看到「新会话 · 0 条」明明已经在聊了（E2E 截图里就是这个现象）
watch(
  () => chat.awaitingReply.value,
  (awaiting, before) => {
    if (before && !awaiting) void chat.loadSessions();
  },
);

onMounted(async () => {
  await chat.loadSessions();
  scrollToBottom();
});

async function newSession(): Promise<void> {
  const id = await chat.createSession();
  if (id) {
    composer.value = "";
    pickedSkills.value = [];
    pendingRecommendSkillIds = [];
    textarea.value?.focus();
  }
}

async function removeSession(sessionId: string, title: string): Promise<void> {
  if (!window.confirm(t("agent.deleteConfirm", { title: title || t("agent.untitled") }))) return;
  await chat.removeSession(sessionId);
}

async function endSession(): Promise<void> {
  if (!window.confirm(t("agent.endConfirm"))) return;
  await chat.endSession();
}

async function submit(): Promise<void> {
  if (!canSend.value) return;
  const text = composer.value;
  const skillIds = [...pickedSkills.value.map((item) => item.skill_id), ...pendingRecommendSkillIds];
  const ok = await chat.send(text, Array.from(new Set(skillIds)));
  if (!ok) return;
  composer.value = "";
  pickedSkills.value = [];
  pendingRecommendSkillIds = [];
  scrollToBottom();
  void chat.loadSessions();
}

/** Enter 发送 / Shift+Enter 换行（与画布内面板一致） */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void submit();
}

function pickSkill(skill: AgentSkill): void {
  pickedSkills.value = [skill];
  // 预置 prompt 以 `/slug` 开头：用户可以直接改后半句，也可以原样发送
  composer.value = skill.prompt_template || `/${skill.name_en} `;
  drawerOpen.value = false;
  textarea.value?.focus();
}

function pickRecommend(card: AgentRecommendCard): void {
  composer.value = card.preset_prompt || card.description;
  // 推荐卡挂的是真实 Skill 卡：记下 id，发送时用于 use_count 与"这条用了哪张卡"留痕
  pendingRecommendSkillIds = card.skills.map((item) => item.skill_id);
  pickedSkills.value = [];
  textarea.value?.focus();
}

function dropSkill(): void {
  pickedSkills.value = [];
  pendingRecommendSkillIds = [];
}

function onVoiceText(text: string): void {
  // 语音结果追加而不是覆盖：用户可能已经先写了半句
  composer.value = composer.value ? `${composer.value} ${text}` : text;
  textarea.value?.focus();
}
</script>

<template>
  <div class="agent-page">
    <!-- ── 左：历史会话 ───────────────────────────── -->
    <aside class="ag-side">
      <div class="ag-side__head">
        <span class="ag-side__title">{{ t("agent.sideTitle") }}</span>
        <button class="btn btn--primary ag-new" type="button" :disabled="chat.creating.value" @click="newSession">
          {{ chat.creating.value ? t("agent.creating") : t("agent.newSession") }}
        </button>
      </div>
      <p v-if="chat.listError.value" class="ag-error">{{ chat.listError.value }}</p>
      <p v-if="chat.sessionsLoading.value" class="ag-hint">{{ t("agent.loading") }}</p>
      <p v-else-if="chat.sessions.value.length === 0" class="ag-hint">{{ t("agent.emptySessions") }}</p>
      <ul v-else class="ag-sessions">
        <li
          v-for="session in chat.sessions.value"
          :key="session.session_id"
          class="ag-session"
          :class="{ 'ag-session--active': session.session_id === chat.activeSessionId.value }"
        >
          <button class="ag-session__main" type="button" @click="chat.selectSession(session.session_id)">
            <span class="ag-session__title">{{ session.title || t("agent.untitled") }}</span>
            <span class="ag-session__preview">{{ session.last_message_preview || t("agent.noPreview") }}</span>
            <span class="ag-session__meta">
              {{ t("agent.sessionMeta", { count: session.message_count, status: session.status === 1 ? t("agent.statusOngoing") : session.status === 2 ? t("agent.statusEnded") : t("agent.statusArchived") }) }}
            </span>
          </button>
          <button
            class="ag-session__del"
            type="button"
            :aria-label="t('agent.deleteSession')"
            @click="removeSession(session.session_id, session.title)"
          >
            ✕
          </button>
        </li>
      </ul>
    </aside>

    <!-- ── 右：对话 ───────────────────────────────── -->
    <main class="ag-main">
      <header class="ag-head">
        <h1 class="ag-head__title">{{ chat.activeSession.value?.title || t("agent.headDefault") }}</h1>
        <span class="ag-head__channel" :class="{ 'ag-head__channel--off': chat.degraded.value }">{{ channelLabel }}</span>
        <button
          v-if="chat.degraded.value"
          class="btn btn--ghost ag-degraded"
          type="button"
          @click="chat.retryRealtime()"
        >
          {{ t("agent.retryRealtime") }}
        </button>
        <button
          v-if="chat.activeSession.value && !chat.ended.value"
          class="btn btn--ghost"
          type="button"
          :disabled="chat.ending.value"
          @click="endSession"
        >
          {{ chat.ending.value ? t("agent.ending") : t("agent.endSession") }}
        </button>
      </header>

      <div ref="scroller" class="ag-stream">
        <p v-if="chat.streamError.value" class="ag-error ag-error--inline">{{ chat.streamError.value }}</p>

        <div v-if="chat.messagesLoading.value" class="ag-hint">{{ t("agent.messagesLoading") }}</div>
        <div v-else-if="isEmpty" class="ag-empty">
          <p class="ag-empty__title">{{ t("agent.emptyTitle") }}</p>
          <p class="ag-empty__desc">{{ t("agent.emptyDesc") }}</p>
          <AgentRecommendCards class="ag-recommend" @pick="pickRecommend" />
        </div>

        <template v-else>
          <AgentMessageItem
            v-for="message in messages"
            :key="message.message_id"
            :message="message"
            :progress="message.task_id ? chat.taskProgress.value[message.task_id] ?? null : null"
          />
          <p v-if="chat.modelStep.value === 'thinking'" class="ag-typing">{{ t("agent.thinking") }}</p>
          <p v-else-if="chat.awaitingReply.value" class="ag-typing">{{ t("agent.awaiting") }}</p>
        </template>
      </div>

      <footer class="ag-composer">
        <div v-if="pickedSkills.length > 0" class="ag-chips">
          <span v-for="skill in pickedSkills" :key="skill.skill_id" class="ag-chip">
            {{ skill.name }}
            <button class="ag-chip__x" type="button" :aria-label="t('agent.removeSkill')" @click="dropSkill">✕</button>
          </span>
        </div>
        <div v-if="chat.ended.value" class="ag-ended">{{ t("agent.endedHint") }}</div>
        <textarea
          ref="textarea"
          v-model="composer"
          class="ag-input"
          rows="3"
          :disabled="chat.ended.value || !chat.activeSessionId.value"
          :placeholder="chat.activeSessionId.value ? t('agent.placeholderActive') : t('agent.placeholderInactive')"
          @keydown="onKeydown"
        />
        <div class="ag-actions">
          <button class="btn btn--ghost ag-skill-trigger" type="button" @click="drawerOpen = true">{{ t("agent.skillTrigger") }}</button>
          <AgentVoiceRecorder :disabled="chat.ended.value || chat.sending.value" @text="onVoiceText" />
          <span class="ag-hint ag-hint--inline">{{ composerHint }}</span>
          <button class="btn btn--primary ag-send" type="button" :disabled="!canSend" @click="submit">
            {{ chat.sending.value ? t("agent.sending") : t("agent.send") }}
          </button>
        </div>
        <p v-if="chat.lastSendError.value" class="ag-error">{{ chat.lastSendError.value }}</p>
      </footer>
    </main>

    <AgentSkillDrawer :open="drawerOpen" @close="drawerOpen = false" @pick="pickSkill" />
  </div>
</template>

<style scoped>
.agent-page {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  height: calc(100vh - 56px);
  background: var(--bg-app);
  color: var(--text-2);
}
.ag-side {
  border-right: 1px solid var(--border-1);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-3);
  gap: var(--space-2);
}
.ag-side__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.ag-side__title {
  color: var(--text-1);
  font-size: var(--text-sm);
  font-weight: 600;
}
.ag-sessions {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ag-session {
  display: flex;
  align-items: stretch;
  border-radius: 10px;
}
.ag-session:hover {
  background: var(--bg-hover);
}
.ag-session--active {
  background: var(--brand-soft);
}
.ag-session__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-2);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.ag-session__title {
  color: var(--text-2);
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ag-session__preview {
  color: var(--text-4);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ag-session__meta {
  color: var(--text-5);
  font-size: var(--text-xs);
}
.ag-session__del {
  flex: 0 0 auto;
  width: 28px;
  background: transparent;
  border: 0;
  color: var(--text-5);
  cursor: pointer;
}
.ag-session__del:hover {
  color: var(--danger);
}
.ag-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.ag-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-surface);
}
.ag-head__title {
  margin: 0;
  color: var(--text-1);
  font-size: var(--text-base);
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ag-head__channel {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.ag-head__channel--off {
  color: var(--warning);
}
.ag-stream {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 0;
}
.ag-empty {
  margin: auto;
  max-width: 720px;
  padding: var(--space-8) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  text-align: center;
}
.ag-empty__title {
  margin: 0;
  color: var(--text-1);
  font-size: var(--text-xl);
  font-weight: 600;
}
.ag-empty__desc {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.6;
}
.ag-recommend {
  margin-top: var(--space-4);
  text-align: left;
}
.ag-typing {
  margin: 0;
  padding: 0 var(--space-6);
  color: var(--text-4);
  font-size: var(--text-xs);
}
.ag-composer {
  border-top: 1px solid var(--border-1);
  background: var(--bg-surface);
  padding: var(--space-3) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ag-input {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  background: var(--bg-raised);
  border: 1px solid var(--border-2);
  border-radius: 12px;
  color: var(--text-2);
  font-family: inherit;
  font-size: var(--text-sm);
  line-height: 1.6;
  padding: var(--space-3);
}
.ag-input:focus {
  outline: 1px solid var(--brand-border);
}
.ag-input:disabled {
  color: var(--text-5);
}
.ag-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.ag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.ag-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: 1px solid var(--brand-border);
  background: var(--brand-soft);
  color: var(--text-1);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  padding: 2px 10px;
}
.ag-chip__x {
  background: transparent;
  border: 0;
  color: var(--text-3);
  cursor: pointer;
  font-size: var(--text-xs);
}
.ag-ended {
  color: var(--warning);
  font-size: var(--text-xs);
}
.ag-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
  padding: 0 var(--space-5);
}
.ag-error--inline {
  padding: 0 var(--space-6);
}
.ag-hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.ag-hint--inline {
  margin-left: auto;
}
.btn {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border-radius: 10px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
}
.btn--primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}
.btn--ghost:hover {
  background: var(--bg-hover);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
@media (max-width: 900px) {
  .agent-page {
    grid-template-columns: 1fr;
  }
  .ag-side {
    display: none;
  }
}
</style>
