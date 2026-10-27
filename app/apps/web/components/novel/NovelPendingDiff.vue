<script setup lang="ts">
import type { NovelEditPendingDto } from "~/types/api";

/**
 * 逐集 diff 对照（编辑 Agent 的核心 UI）。
 *
 * 产品要点：左边是**当前正文**、右边是**建议正文**，中间不做行级 diff 高亮 ——
 * 因为剧本正文经常整段重写，行级 diff 会把"这一段全换了"渲染成一屏红色噪声。
 * 服务端存的就是 original_text / proposed_text 两段整文（schema 里也是这么设计的），
 * 前端照抄这个语义，用户逐集点「应用」或「驳回」。
 */
const props = defineProps<{
  pending: NovelEditPendingDto;
  busy?: boolean;
}>();

defineEmits<{ apply: [id: string]; reject: [id: string] }>();

const tab = ref<"compare" | "original" | "proposed">("compare");

const originalLines = computed(() => props.pending.original_text.split("\n").length);
const proposedLines = computed(() => props.pending.proposed_text.split("\n").length);
</script>

<template>
  <section class="diff" :data-episode-no="props.pending.episode_no">
    <header class="diff__head">
      <div class="diff__title">
        <strong>第 {{ props.pending.episode_no }} 集</strong>
        <span class="diff__summary">{{ props.pending.change_summary }}</span>
      </div>
      <div class="diff__actions">
        <Button size="sm" variant="ghost" :disabled="props.busy" @click="$emit('reject', props.pending.id)">
          驳回
        </Button>
        <Button size="sm" :loading="props.busy" @click="$emit('apply', props.pending.id)">应用这集</Button>
      </div>
    </header>

    <div class="diff__tabs">
      <button type="button" :class="{ on: tab === 'compare' }" @click="tab = 'compare'">对照</button>
      <button type="button" :class="{ on: tab === 'original' }" @click="tab = 'original'">
        原文 ({{ originalLines }} 行)
      </button>
      <button type="button" :class="{ on: tab === 'proposed' }" @click="tab = 'proposed'">
        建议文 ({{ proposedLines }} 行)
      </button>
    </div>

    <div class="diff__body">
      <div v-if="tab === 'compare'" class="diff__pair">
        <div class="diff__col">
          <p class="diff__col-title">当前正文</p>
          <pre class="diff__text">{{ props.pending.original_text }}</pre>
        </div>
        <div class="diff__col">
          <p class="diff__col-title proposed">建议正文</p>
          <pre class="diff__text">{{ props.pending.proposed_text }}</pre>
        </div>
      </div>

      <div v-else class="diff__single">
        <pre class="diff__text">{{
          tab === "original" ? props.pending.original_text : props.pending.proposed_text
        }}</pre>
      </div>
    </div>

    <p class="diff__note">
      驳回不会改动正文（只把这条待确认变更标记为已驳回）；应用才会写入正文并生成一个新版本。
    </p>
  </section>
</template>

<style scoped>
.diff {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-sunken);
  overflow: hidden;
}
.diff__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--panel-tint);
  border-bottom: 1px solid var(--border-1);
}
.diff__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.diff__title strong {
  color: var(--text-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.diff__summary {
  color: var(--text-3);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.diff__tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.diff__tabs button {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-4);
  font-size: var(--text-xs);
  cursor: pointer;
}
.diff__tabs button.on {
  background: var(--bg-raised);
  color: var(--text-1);
}
.diff__body {
  padding: 8px 12px 12px;
}
.diff__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 900px) {
  .diff__pair {
    grid-template-columns: 1fr;
  }
}
.diff__col-title {
  margin: 0 0 4px;
  font-size: var(--text-xs);
  color: var(--text-4);
}
.diff__col-title.proposed {
  color: var(--brand-300);
}
.diff__text {
  margin: 0;
  max-height: 340px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-2);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff__note {
  margin: 0;
  padding: 0 14px 12px;
  color: var(--text-4);
  font-size: var(--text-xs);
}
</style>
