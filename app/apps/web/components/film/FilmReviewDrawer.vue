<script setup lang="ts">
import type { FilmReviewDto, FilmTaskDto } from "~/types/api";

/**
 * 审核抽屉 —— 影视版**机制 #1（审核版本链）**的前端呈现。
 *
 * 三件事必须让用户看见，否则版本链等于没做：
 * 1. **版本号不可变**：每次提交新增 V0x，旧版本永远在列表里（不能"覆盖上一版"）；
 * 2. **评论挂版本**：每条评论显示它属于哪一版，审核意见不会串到别的版本上；
 * 3. **已读按版本**：未读徽标是"我没读过的版本数"，点开抽屉即标记本页版本已读。
 *
 * 决策（通过/驳回）走 `POST .../tasks/:id/status`：竞品没有 review/approve 端点
 * （契约 §7 A3），我方照抄这个承载方式，抽屉只是入口。
 */

const props = defineProps<{
  projectId: string;
  tableId: string;
  task: FilmTaskDto | null;
  /** 只有管理特权能改状态（与后端 L3 一致，避免按钮点了必然 403） */
  canManage: boolean;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const api = useApi();
const toast = useToast();

const loading = ref(false);
const busy = ref(false);
const errorMsg = ref("");
const data = ref<FilmReviewDto | null>(null);
const commentDraft = ref("");
const decisionComment = ref("");

const visible = computed(() => props.task !== null);

async function load() {
  if (!props.task) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    data.value = await api.get<FilmReviewDto>(
      `/film/projects/${props.projectId}/task-tables/${props.tableId}/tasks/${props.task.id}/review`,
    );
    await markRead();
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载审核信息失败";
  } finally {
    loading.value = false;
  }
}

/** 打开抽屉即标记所有版本已读（后端按版本记回执；重复标记是幂等的） */
async function markRead() {
  if (!props.task || !data.value || data.value.versions.length === 0) return;
  const unreadIds = data.value.versions.filter((v) => !v.read_by_me).map((v) => v.version_id);
  if (unreadIds.length === 0) return;
  try {
    await api.post(`/film/projects/${props.projectId}/task-tables/${props.tableId}/tasks/${props.task.id}/review/read`, {
      version_ids: unreadIds,
    });
    data.value = { ...data.value, unread: 0, versions: data.value.versions.map((v) => ({ ...v, read_by_me: true })) };
  } catch {
    // 已读是辅助动作：失败不回滚抽屉，用户可再点"标记已读"
  }
}

watch(
  () => props.task?.id,
  () => {
    if (props.task) void load();
  },
);

async function submitVersion() {
  if (!props.task) return;
  busy.value = true;
  try {
    await api.post(`/film/projects/${props.projectId}/task-tables/${props.tableId}/tasks/${props.task.id}/review`, {
      asset_ids: [],
      comment: commentDraft.value || undefined,
    });
    commentDraft.value = "";
    toast.success("已提交新版本（版本号不会复用）");
    await load();
    emit("changed");
  } catch (e) {
    toast.error((e as Error).message || "提交失败");
  } finally {
    busy.value = false;
  }
}

async function addComment(versionId: string) {
  if (!props.task || !commentDraft.value.trim()) return;
  busy.value = true;
  try {
    await api.post(
      `/film/projects/${props.projectId}/task-tables/${props.tableId}/tasks/${props.task.id}/review/comments`,
      { version_id: versionId, content: commentDraft.value.trim() },
    );
    commentDraft.value = "";
    await load();
  } catch (e) {
    toast.error((e as Error).message || "评论失败");
  } finally {
    busy.value = false;
  }
}

async function decide(status: 2 | 3) {
  if (!props.task) return;
  busy.value = true;
  try {
    await api.post(`/film/projects/${props.projectId}/task-tables/${props.tableId}/tasks/${props.task.id}/status`, {
      // 双轨：通过 → 5(done) / 驳回 → 4(rejected)；服务端同时落版本状态
      status: status === 2 ? 5 : 4,
      comment: decisionComment.value || undefined,
    });
    decisionComment.value = "";
    toast.success(status === 2 ? "已通过并定稿" : "已驳回，等待重新提交");
    await load();
    emit("changed");
  } catch (e) {
    toast.error((e as Error).message || "决策失败");
  } finally {
    busy.value = false;
  }
}

const VERSION_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: "待审", cls: "pending" },
  2: { label: "已通过", cls: "approved" },
  3: { label: "已驳回", cls: "rejected" },
};

function commentsOf(versionId: string) {
  return (data.value?.comments ?? []).filter((c) => c.version_id === versionId);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <div v-if="visible" class="fl-drawer-mask" @click.self="emit('close')">
    <aside class="fl-drawer">
      <header class="fl-drawer-head">
        <div>
          <h2 class="fl-drawer-title">审核 · {{ task?.title || "未命名行" }}</h2>
          <p class="fl-drawer-sub">
            当前版本 <strong>{{ data?.latest_version_no ?? "—" }}</strong>
            <span v-if="data && data.unread > 0" class="fl-unread">{{ data.unread }} 版未读</span>
          </p>
        </div>
        <button type="button" class="fl-btn" @click="emit('close')">关闭</button>
      </header>

      <p v-if="errorMsg" class="fl-alert">{{ errorMsg }}</p>
      <p v-else-if="loading" class="fl-empty">加载中…</p>

      <template v-else-if="data">
        <p v-if="data.versions.length === 0" class="fl-empty">
          还没有提交过版本。画布节点提交产物（submit-result）或点下方「提交新版本」才会产生 V01。
        </p>

        <ul v-else class="fl-versions">
          <li v-for="v in data.versions" :key="v.version_id" class="fl-version">
            <header class="fl-version-head">
              <strong class="fl-version-no">{{ v.version_no }}</strong>
              <span class="fl-badge" :class="`fl-badge-${VERSION_STATUS[v.status]?.cls}`">
                {{ VERSION_STATUS[v.status]?.label ?? v.status }}
              </span>
              <span class="fl-version-meta">
                {{ fmtTime(v.submitted_at) }} 提交 · {{ v.asset_ids.length }} 个产物
                <template v-if="v.comment_count > 0"> · {{ v.comment_count }} 条意见</template>
              </span>
            </header>

            <p v-if="v.decision_comment" class="fl-decision">决策意见：{{ v.decision_comment }}</p>

            <ul v-if="commentsOf(v.version_id).length > 0" class="fl-comments">
              <li v-for="c in commentsOf(v.version_id)" :key="c.comment_id">
                <span class="fl-comment-author">{{ c.author_id.slice(-6) }}</span>
                <span class="fl-comment-body">{{ c.content }}</span>
                <span class="fl-comment-time">{{ fmtTime(c.created_at) }}</span>
              </li>
            </ul>
            <button type="button" class="fl-link" :disabled="busy" @click="addComment(v.version_id)">
              ＋ 针对 {{ v.version_no }} 追加意见
            </button>
          </li>
        </ul>

        <section class="fl-drawer-form">
          <label class="fl-label" for="fl-comment">评论 / 决策意见</label>
          <textarea
            id="fl-comment"
            v-model="decisionComment"
            class="fl-textarea"
            rows="2"
            placeholder="写清「哪一版、哪里不行」，驳回时必须写理由"
          />
          <div class="fl-drawer-actions">
            <button type="button" class="fl-btn fl-btn-primary" :disabled="busy || !canManage" @click="submitVersion">
              提交新版本
            </button>
            <button type="button" class="fl-btn fl-btn-ok" :disabled="busy || !canManage" @click="decide(2)">通过</button>
            <button type="button" class="fl-btn fl-btn-danger" :disabled="busy || !canManage" @click="decide(3)">驳回</button>
          </div>
          <p v-if="!canManage" class="fl-hint">当前角色只能查看/评论；通过或驳回需要团队管理特权（与后端一致）。</p>
        </section>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.fl-drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 20, 32, 0.32);
  display: flex;
  justify-content: flex-end;
  z-index: 60;
}
.fl-drawer {
  width: min(520px, 96vw);
  height: 100%;
  overflow-y: auto;
  background: #fff;
  /* 深色壳层里抽屉是白底：显式深色文字，否则"看得见框、看不见字" */
  color: #2a2f3a;
  padding: 18px 20px 28px;
  box-shadow: -8px 0 28px rgba(16, 20, 32, 0.16);
}
.fl-drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.fl-drawer-title {
  margin: 0;
  font-size: 16px;
}
.fl-drawer-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #6b7280;
}
.fl-unread {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #ffeaea;
  color: #c53030;
}
.fl-versions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fl-version {
  border: 1px solid #eceef5;
  border-radius: 10px;
  padding: 10px 12px;
}
.fl-version-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fl-version-no {
  font-size: 14px;
}
.fl-version-meta {
  font-size: 12px;
  color: #8a90a6;
}
.fl-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: #f2f4f9;
  color: #5b6178;
}
.fl-badge-pending {
  background: #fff6ec;
  color: #a8621b;
}
.fl-badge-approved {
  background: #eefaf1;
  color: #23824a;
}
.fl-badge-rejected {
  background: #ffeaea;
  color: #c53030;
}
.fl-decision {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b04444;
}
.fl-comments {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fl-comments li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  align-items: baseline;
}
.fl-comment-author {
  color: #2f5bd7;
}
.fl-comment-body {
  flex: 1;
  color: #2a2f3a;
}
.fl-comment-time {
  color: #9aa0b4;
}
.fl-link {
  margin-top: 8px;
  border: none;
  background: none;
  color: #2f5bd7;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.fl-drawer-form {
  margin-top: 16px;
  border-top: 1px solid #eceef5;
  padding-top: 12px;
}
.fl-label {
  display: block;
  font-size: 12px;
  color: #5b6178;
  margin-bottom: 4px;
}
.fl-textarea {
  width: 100%;
  border: 1px solid #e3e6ee;
  border-radius: 8px;
  padding: 8px;
  background: #fff;
  color: #2a2f3a;
  font-size: 13px;
  resize: vertical;
}
.fl-textarea::placeholder {
  color: #9aa0b4;
}
.fl-drawer-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.fl-btn {
  border: 1px solid #e3e6ee;
  background: #fff;
  color: #2a2f3a;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.fl-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.fl-btn-primary {
  background: #2f5bd7;
  border-color: #2f5bd7;
  color: #fff;
}
.fl-btn-ok {
  background: #eefaf1;
  border-color: #bfe6cd;
  color: #237a46;
}
.fl-btn-danger {
  background: #ffeaea;
  border-color: #f4c7c7;
  color: #b33030;
}
.fl-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8a90a6;
}
.fl-empty {
  font-size: 13px;
  color: #8a90a6;
}
.fl-alert {
  font-size: 13px;
  color: #c53030;
}
</style>
