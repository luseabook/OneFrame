<script setup lang="ts">
import type { AgentMessageDto, AgentSessionDto } from "~/components/agent/useAgentChat";

/**
 * Agent 编辑模式（竞品 /agent/editor 的对应页）
 *
 * 定位：把 Agent 会话里**助手产出**变成可编辑的草稿，并给出落到项目的动作。
 * 边界（如实）：
 *  - 服务端没有"文档"实体，草稿先落 localStorage（按 session_id 分键），刷新不丢；
 *  - 「复制全文」「下载 .md」是纯前端能力，不产生任何写请求；
 *  - 「去剧本创作」跳到 /script（真正建项目在那里，避免这里再造一套创建逻辑）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const toast = useToast();
const { t } = useI18n();
useHead({ title: () => t("agentEditor.metaTitle") });

const sessions = ref<AgentSessionDto[]>([]);
const activeId = ref("");
const messages = ref<AgentMessageDto[]>([]);
const loading = ref(true);
const error = ref("");
const draft = ref("");
const savedAt = ref("");
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const draftKey = computed(() => `agent-draft:${activeId.value}`);
const assistantMessages = computed(() => messages.value.filter((m) => m.role === 2 && m.content));

function buildDraft(): string {
  return assistantMessages.value.map((m) => m.content.trim()).join("\n\n");
}

async function loadSessions(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.get<{ list: AgentSessionDto[] }>("/agent/sessions?scope=1&page=1&page_size=20");
    sessions.value = data.list ?? [];
    if (!activeId.value && sessions.value[0]) activeId.value = sessions.value[0].session_id;
    if (activeId.value) await loadMessages();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("agentEditor.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function loadMessages(): Promise<void> {
  messages.value = [];
  draft.value = "";
  if (!activeId.value) return;
  try {
    const data = await api.get<{ list: AgentMessageDto[] }>(
      `/agent/sessions/${encodeURIComponent(activeId.value)}/messages?after_event_id=0`,
    );
    messages.value = data.list ?? [];
    const stored = localStorage.getItem(draftKey.value);
    draft.value = stored ?? buildDraft();
    savedAt.value = stored ? t("agentEditor.restored") : "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("agentEditor.loadFailed");
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(draftKey.value, draft.value);
      savedAt.value = new Date().toLocaleTimeString();
    } catch {
      toast.error(t("agentEditor.saveFailed"));
    }
  }, 600);
}

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(draft.value);
    toast.success(t("agentEditor.copied"));
  } catch {
    toast.error(t("agentEditor.copyFailed"));
  }
}

function download(): void {
  const blob = new Blob([draft.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agent-draft-${activeId.value.slice(-6) || "empty"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(() => void loadSessions());
onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer);
  if (activeId.value && draft.value) {
    try {
      localStorage.setItem(draftKey.value, draft.value);
    } catch {
      /* 卸载时尽力而为 */
    }
  }
});
</script>

<template>
  <div class="ae">
    <header class="ae-head">
      <NuxtLink to="/agent" class="ae-back">← {{ t("agentEditor.back") }}</NuxtLink>
      <h1>{{ t("agentEditor.title") }}</h1>
      <p class="ae-sub">{{ t("agentEditor.sub") }}</p>
    </header>

    <div class="ae-body">
      <aside class="ae-rail">
        <p v-if="loading" class="ae-hint">{{ t("common.loading") }}</p>
        <p v-else-if="!sessions.length" class="ae-hint">{{ t("agentEditor.noSessions") }}</p>
        <button
          v-for="s in sessions"
          :key="s.session_id"
          type="button"
          class="ae-session"
          :class="{ on: s.session_id === activeId }"
          @click="activeId = s.session_id; loadMessages()"
        >
          <b>{{ s.title || t("agentEditor.untitled") }}</b>
          <em>{{ s.message_count }}</em>
        </button>
      </aside>

      <section class="ae-editor">
        <div class="ae-toolbar">
          <span v-if="savedAt" class="ae-saved">{{ t("agentEditor.savedAt", { time: savedAt }) }}</span>
          <span v-else class="ae-saved">{{ t("agentEditor.unsaved") }}</span>
          <span class="ae-spacer" />
          <button type="button" class="ae-btn" :disabled="!draft" @click="copyAll">{{ t("agentEditor.copy") }}</button>
          <button type="button" class="ae-btn" :disabled="!draft" @click="download">{{ t("agentEditor.download") }}</button>
          <NuxtLink to="/script" class="ae-btn ae-btn--primary">{{ t("agentEditor.goScript") }}</NuxtLink>
        </div>
        <p v-if="error" class="ae-error" role="alert">{{ error }}</p>
        <textarea
          v-model="draft"
          class="ae-textarea"
          :placeholder="t('agentEditor.placeholder')"
          @input="scheduleSave"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.ae {
  padding: 20px 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
  color: #2a2f3a;
}
.ae-back {
  display: inline-block;
  margin-bottom: 8px;
  color: #6b7280;
  text-decoration: none;
  font-size: 13px;
}
.ae-head h1 {
  font-size: 22px;
  font-weight: 600;
}
.ae-sub {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}
.ae-body {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  margin-top: 16px;
}
.ae-rail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 620px;
  overflow: auto;
}
.ae-session {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #fff;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.ae-session.on {
  border-color: #7c3aed;
  box-shadow: inset 2px 0 0 #7c3aed;
}
.ae-session em {
  color: #9ca3af;
  font-style: normal;
}
.ae-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ae-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ae-saved {
  color: #6b7280;
  font-size: 12px;
}
.ae-spacer {
  flex: 1;
}
.ae-btn {
  height: 30px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.ae-btn--primary {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
}
.ae-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.ae-textarea {
  min-height: 560px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #111827;
  font-size: 14px;
  line-height: 1.7;
  resize: vertical;
}
.ae-hint {
  color: #9ca3af;
  font-size: 12px;
}
.ae-error {
  color: #b91c1c;
  font-size: 13px;
}
</style>
