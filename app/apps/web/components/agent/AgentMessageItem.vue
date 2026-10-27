<script setup lang="ts">
import { computed } from "vue";
import AgentTaskCard from "./AgentTaskCard.vue";
import type { AgentMessageView, AgentTaskProgress } from "./useAgentChat";

/**
 * 单条对话消息。
 *
 * 渲染分派照契约 `content_type`：1 文本 / 2 卡片（可落地节点）/ 3 计划 / 4 HITL。
 * `/agent` 是**独立创作页、没有画布**，所以卡片里的 `nodes` 只做"将会产出什么"的展示，
 * 不出现画布内那套「在画布中创建 N 个节点」按钮（那是 `CanvasAgentPanel` 的职责）。
 */

const props = defineProps<{
  message: AgentMessageView;
  progress?: AgentTaskProgress | null;
}>();

const isUser = computed(() => props.message.role === 1);
const isSystem = computed(() => props.message.role === 3);
const nodes = computed<Array<{ node_type?: string; name?: string }>>(() => {
  const raw = props.message.payload?.nodes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is { node_type?: string; name?: string } => typeof item === "object" && item !== null);
});
const steps = computed<string[]>(() => {
  const raw = props.message.payload?.steps;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
});
const question = computed(() => {
  const raw = props.message.payload?.question;
  return typeof raw === "string" ? raw : "";
});
const skillIds = computed<string[]>(() => {
  const raw = props.message.payload?.skill_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
});
</script>

<template>
  <article
    class="msg"
    :class="{
      'msg--user': isUser,
      'msg--assistant': props.message.role === 2,
      'msg--system': isSystem,
    }"
  >
    <div class="msg__avatar" aria-hidden="true">{{ isUser ? "我" : isSystem ? "!" : "AI" }}</div>
    <div class="msg__body">
      <p v-if="props.message.content" class="msg__text">{{ props.message.content }}</p>

      <!-- 卡片类：助手说明"将产出哪些东西" -->
      <ul v-if="nodes.length > 0" class="msg__list">
        <li v-for="(node, index) in nodes" :key="index">
          {{ node.name || node.node_type || "节点" }}
          <span v-if="node.node_type" class="msg__tag">{{ node.node_type }}</span>
        </li>
      </ul>

      <!-- 计划类：步骤清单 -->
      <ol v-if="steps.length > 0" class="msg__list msg__list--ordered">
        <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
      </ol>

      <!-- HITL：只展示待确认的问题。独立创作页不提供画布态决策卡，交给对话继续沟通 -->
      <div v-if="question" class="msg__hitl">
        <span class="msg__hitl-label">需要你确认</span>
        <p class="msg__hitl-text">{{ question }}</p>
      </div>

      <p v-if="skillIds.length > 0" class="msg__meta">使用 Skill 卡 ×{{ skillIds.length }}</p>

      <!-- 任务卡：一次真实投递（生成中 / 完成 / 失败三态由 AgentTaskCard 负责） -->
      <AgentTaskCard
        v-if="props.message.task_id"
        class="msg__task"
        :task-id="props.message.task_id"
        :progress-hint="props.progress ?? null"
      />

      <p v-if="props.message._error" class="msg__error">{{ props.message._error }}</p>
    </div>
  </article>
</template>

<style scoped>
.msg {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
}
.msg--user {
  flex-direction: row-reverse;
}
.msg__avatar {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  display: grid;
  place-items: center;
  font-size: var(--text-xs);
  color: var(--text-2);
  background: var(--bg-raised);
  border: 1px solid var(--border-2);
}
.msg--assistant .msg__avatar {
  color: var(--brand-on-soft);
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.msg--system .msg__avatar {
  color: var(--warning);
  border-color: var(--warning);
}
.msg__body {
  min-width: 0;
  max-width: min(720px, 86%);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.msg--user .msg__body {
  align-items: flex-end;
}
.msg__text {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: var(--text-sm-lh);
  white-space: pre-wrap;
  word-break: break-word;
}
.msg--user .msg__text {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--text-1);
}
.msg--system .msg__text {
  background: transparent;
  border-style: dashed;
  color: var(--text-3);
}
.msg__list {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--text-2);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.msg__list--ordered {
  list-style: decimal;
}
.msg__tag {
  margin-left: var(--space-2);
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--border-2);
  color: var(--text-4);
  font-size: var(--text-xs);
}
.msg__hitl {
  border: 1px dashed var(--warning);
  border-radius: 12px;
  padding: var(--space-3);
  background: var(--warning-bg);
}
.msg__hitl-label {
  color: var(--warning);
  font-size: var(--text-xs);
}
.msg__hitl-text {
  margin: var(--space-1) 0 0;
  color: var(--text-2);
  font-size: var(--text-sm);
}
.msg__meta {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.msg__task {
  margin-top: var(--space-1);
}
.msg__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
</style>
