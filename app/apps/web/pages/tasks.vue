<script setup lang="ts">
import type { TaskDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

// i18n（第 8 批）：`mode`/`task_id` 等是后端数据不翻译；页面骨架、状态名、提示语走语言包，
// 中文原文与改造前逐字一致。状态名不再用 `~/types/api` 的 statusLabel（全局常量无法跟随语言）。
const { t, locale } = useI18n();
useHead({ title: () => t("tasks.metaTitle") });

const api = useApi();
const auth = useAuth();
const list = ref<TaskDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const statusFilter = ref<string>("");
const folderFilter = ref<string>("");
const folders = ref<Array<{ id: string; name: string; task_count: number }>>([]);
const newFolderName = ref("");
const folderBusy = ref(false);
const detail = ref<TaskDto | null>(null);
const shareInfo = ref<{ share_path: string; expires_at: string } | null>(null);
const error = ref("");
const info = ref("");
const expiring = ref<Array<{ task_id: string; days_left: number }>>([]);
const projects = ref<Array<{ id: string; title: string }>>([]);
const projectTarget = ref("");
let timer: ReturnType<typeof setInterval> | undefined;

async function load(): Promise<void> {
  loading.value = true;
  const query = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
  if (statusFilter.value) query.set("status", statusFilter.value);
  if (folderFilter.value) query.set("folder_id", folderFilter.value);
  try {
    const data = await api.get<{ list: TaskDto[]; total: number }>(`/tasks?${query.toString()}`);
    list.value = data.list;
    total.value = data.total;
    try {
      expiring.value = await api.get<Array<{ task_id: string; days_left: number }>>("/assets/expiring-tasks");
    } catch {
      expiring.value = [];
    }
  } finally {
    loading.value = false;
  }
}

async function loadFolders(): Promise<void> {
  try {
    const data = await api.get<{ list: Array<{ id: string; name: string; task_count: number }> }>("/tasks/folders");
    folders.value = data.list;
  } catch {
    folders.value = [];
  }
}

async function createFolder(): Promise<void> {
  const name = newFolderName.value.trim();
  if (!name) return;
  folderBusy.value = true;
  try {
    await api.post("/tasks/folders", { name });
    newFolderName.value = "";
    await loadFolders();
    info.value = t("tasks.folderCreated");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.folderCreateFailed");
  } finally {
    folderBusy.value = false;
  }
}

async function assignFolder(taskId: string, folderId: string): Promise<void> {
  try {
    const updated = await api.patch<TaskDto>(`/tasks/${taskId}/folder`, {
      folder_id: folderId || null,
    });
    if (detail.value?.task_id === taskId) detail.value = { ...detail.value, folder_id: updated.folder_id };
    await Promise.all([load(), loadFolders()]);
    info.value = t("tasks.folderAssigned");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.folderAssignFailed");
  }
}

async function openDetail(item: TaskDto): Promise<void> {
  detail.value = await api.get<TaskDto>(`/tasks/${item.task_id}`);
  shareInfo.value = null;
}

async function createShare(): Promise<void> {
  if (!detail.value) return;
  try {
    shareInfo.value = await api.post<{ share_path: string; expires_at: string }>(
      `/tasks/${detail.value.task_id}/share`,
      { expires_in_days: 7 },
    );
    const url = `${window.location.origin}${shareInfo.value.share_path}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    info.value = t("tasks.shareCopied", { url });
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.shareFailed");
  }
}

async function revokeShare(): Promise<void> {
  if (!detail.value) return;
  try {
    await api.delete(`/tasks/${detail.value.task_id}/share`);
    shareInfo.value = null;
    info.value = t("tasks.shareRevoked");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.revokeFailed");
  }
}

async function cancel(item: TaskDto): Promise<void> {
  try {
    await api.post(`/tasks/${item.task_id}/cancel`);
    await load();
    await loadFolders();
    await auth.me();
    info.value = t("tasks.canceled");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.cancelFailed");
  }
}

async function retry(item: TaskDto): Promise<void> {
  try {
    await api.post(`/tasks/${item.task_id}/retry`);
    await load();
    await auth.me();
    info.value = t("tasks.retried");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.retryFailed");
  }
}

async function download(item: TaskDto): Promise<void> {
  try {
    const data = await api.get<{ url: string }>(`/tasks/${item.task_id}/results/1/download-url`);
    if (data.url.startsWith("mock://")) {
      info.value = t("tasks.mockResult");
      return;
    }
    window.open(data.url, "_blank", "noopener");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.downloadFailed");
  }
}

async function addToProject(): Promise<void> {
  if (!detail.value || !projectTarget.value) {
    info.value = t("tasks.selectProjectFirst");
    return;
  }
  try {
    await api.post(`/projects/${projectTarget.value}/shot-materials`, { task_id: detail.value.task_id });
    info.value = t("tasks.addedToProject");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.addToProjectFailed");
  }
}

async function transferAsset(): Promise<void> {
  if (!detail.value) return;
  try {
    await api.post("/assets/from-task", { task_id: detail.value.task_id, index: 0 });
    info.value = t("tasks.transferred");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.transferFailed");
  }
}

async function batchDownload(): Promise<void> {
  const ids = list.value
    .filter((item) => item.status === 3)
    .slice(0, 50)
    .map((item) => item.task_id);
  if (ids.length === 0) {
    info.value = t("tasks.noDoneOnPage");
    return;
  }
  try {
    const data = await api.post<{ url: string }>("/tasks/batch-download", { task_ids: ids });
    window.open(data.url, "_blank", "noopener");
    info.value = t("tasks.packed", { count: ids.length });
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.batchFailed");
  }
}

function canCancel(item: TaskDto): boolean {
  return item.status === 1 || item.status === 2;
}

onMounted(async () => {
  // 延后到浏览器完成首帧绘制后再拉取并启动轮询：
  // 否则在 hydration 未完成时改数据会触发 hydration mismatch
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await load();
    const data = await api.get<{ list: Array<{ id: string; title: string }> }>("/projects?page=1&page_size=50");
    projects.value = data.list;
    timer = setInterval(() => void load().catch(() => undefined), 5000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("tasks.loadFailed");
  }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
// 状态筛选页签与颜色映射（UI 层，不改业务逻辑）；文案随语言切换
const statusTabs = computed<Array<{ value: string; label: string }>>(() => [
  { value: "", label: t("tasks.tabAll") },
  { value: "1", label: t("tasks.tabQueued") },
  { value: "2", label: t("tasks.tabRunning") },
  { value: "3", label: t("tasks.tabDone") },
  { value: "4", label: t("tasks.tabFailed") },
  { value: "5", label: t("tasks.tabCanceled") },
]);

/**
 * 任务状态文案。为什么不用 `~/types/api` 的 `statusLabel`：那是模块级常量（构建期定死），
 * 无法跟随运行时切换语言。本页是唯一需要本地化它的消费方，收在这里不扩散影响。
 */
function statusText(status: number): string {
  switch (status) {
    case 1:
      return t("tasks.statusQueued");
    case 2:
      return t("tasks.statusRunning");
    case 3:
      return t("tasks.statusDone");
    case 4:
      return t("tasks.statusFailed");
    case 5:
      return t("tasks.statusCanceled");
    case 6:
      return t("tasks.statusReviewing");
    case 7:
      return t("tasks.statusReviewRejected");
    default:
      return t("tasks.statusUnknown", { status });
  }
}
function statusTone(status: number): "neutral" | "info" | "success" | "danger" | "warning" {
  if (status === 3) return "success";
  if (status === 4) return "danger";
  if (status === 5) return "neutral";
  if (status === 2) return "warning";
  return "info";
}
const loading = ref(false);
// 本页有 5s 轮询与本地数据，SSR 与客户端首帧必然不同：
// 统一用 mounted 门控渲染，保证 hydrate 前后结构一致。
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <!-- 整页 ClientOnly：本页数据完全依赖客户端（含 5s 轮询），
       参与 SSR 会在 hydrate 期间因数据变化产生 mismatch -->
  <ClientOnly>
    <div class="tasks">
      <header class="head">
        <div class="head-main">
          <h1>{{ t("tasks.title") }}</h1>
          <p class="sub">{{ t("tasks.sub") }}</p>
        </div>
        <div class="head-actions">
          <Button variant="ghost" size="sm" @click="batchDownload">{{ t("tasks.batchDownload") }}</Button>
        </div>
      </header>

      <!-- 状态筛选：下划线 tab（GL9 已改白字白线） -->
      <nav class="tabs">
        <button
          v-for="s in statusTabs"
          :key="s.value"
          type="button"
          class="tab"
          :class="{ on: statusFilter === s.value }"
          @click="statusFilter = s.value; page = 1; load()"
        >
          {{ s.label }}
        </button>
        <span class="total">{{ t("common.totalItems", { count: total }) }}</span>
      </nav>

      <div class="folder-bar">
        <select v-model="folderFilter" class="mini-select" @change="page = 1; load()">
          <option value="">{{ t("tasks.folderAll") }}</option>
          <option value="unfiled">{{ t("tasks.folderUnfiled") }}</option>
          <option v-for="folder in folders" :key="folder.id" :value="folder.id">
            {{ folder.name }} ({{ folder.task_count }})
          </option>
        </select>
        <input v-model="newFolderName" class="folder-input" maxlength="80" :placeholder="t('tasks.folderNamePlaceholder')" />
        <Button size="sm" variant="ghost" :loading="folderBusy" @click="createFolder">{{ t("tasks.createFolder") }}</Button>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="info" class="ok">{{ info }}</p>

      <!-- 动态区（到期提醒 / 列表 / 分页）用 mounted 门控：
           本页有 5s 轮询，若参与 SSR 会与 hydration 时的数据不一致 -->
      <template v-if="mounted">
        <p v-if="expiring.length > 0" class="warn">
          <span class="dot" />{{ t("tasks.expiring", { count: expiring.length }) }}
          <NuxtLink to="/assets">{{ t("tasks.expiringLink") }}</NuxtLink>{{ t("tasks.expiringSuffix") }}
        </p>

        <Skeleton v-if="loading" :rows="4" />

        <template v-else>
          <div v-if="list.length" class="task-table">
            <div class="t-row t-head">
              <span class="c-id">{{ t("tasks.tableTask") }}</span>
              <span class="c-status">{{ t("tasks.tableStatus") }}</span>
              <span class="c-mode">{{ t("tasks.tableMode") }}</span>
              <span class="c-credits">{{ t("tasks.tableCredits") }}</span>
              <span class="c-time">{{ t("tasks.tableTime") }}</span>
              <span class="c-ops">{{ t("tasks.tableOps") }}</span>
            </div>
            <div v-for="item in list" :key="item.task_id" class="t-row">
              <button class="id-link" @click="openDetail(item)">{{ item.task_id.slice(-8) }}</button>
              <span class="c-status">
                <Tag :tone="statusTone(item.status)" size="sm" dot>{{ statusText(item.status) }}</Tag>
              </span>
              <span class="c-mode mono">{{ item.mode }}</span>
              <span class="c-credits mono">{{ item.credits_frozen }}</span>
              <span class="c-time muted">{{ new Date(item.created_at).toLocaleString(locale) }}</span>
              <span class="c-ops ops">
                <Button size="sm" variant="ghost" :disabled="item.status !== 3" @click="download(item)">{{ t("tasks.download") }}</Button>
                <Button size="sm" variant="text" :disabled="!canCancel(item)" @click="cancel(item)">{{ t("tasks.cancel") }}</Button>
                <Button size="sm" variant="text" :disabled="item.status !== 4" @click="retry(item)">{{ t("tasks.retry") }}</Button>
              </span>
            </div>
          </div>

          <div v-else class="empty-wrap">
            <EmptyState
              icon="◷"
              :title="t('tasks.emptyTitle')"
              :description="t('tasks.emptyDesc')"
            >
              <Button @click="$router.push('/create/text-to-video')">{{ t("tasks.emptyCta") }}</Button>
            </EmptyState>
          </div>

          <div v-if="total > pageSize" class="pager">
            <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">{{ t("common.prevPage") }}</Button>
            <span class="muted">{{ t("common.pageNo", { page }) }}</span>
            <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">{{ t("common.nextPage") }}</Button>
          </div>
        </template>
      </template>

    <Modal :open="!!detail" :title="t('tasks.detailTitle')" width="560px" @close="detail = null">
      <template v-if="detail">
        <dl class="kv-list">
          <div class="kv"><dt>{{ t("tasks.detailTaskId") }}</dt><dd class="mono">{{ detail.task_id }}</dd></div>
          <div class="kv">
            <dt>{{ t("common.status") }}</dt>
            <dd><Tag :tone="statusTone(detail.status)" size="sm" dot>{{ statusText(detail.status) }}</Tag></dd>
          </div>
          <div class="kv"><dt>{{ t("common.mode") }}</dt><dd class="mono">{{ detail.mode }}</dd></div>
          <div class="kv"><dt>{{ t("tasks.detailPrompt") }}</dt><dd>{{ detail.input?.prompt || "—" }}</dd></div>
          <div class="kv">
            <dt>{{ t("tasks.detailRatio") }}</dt>
            <dd>{{ detail.options?.ratio }} / {{ detail.options?.resolution }}</dd>
          </div>
          <div class="kv"><dt>{{ t("tasks.detailResult") }}</dt><dd class="mono break">{{ detail.results?.[0]?.uri ?? "—" }}</dd></div>
          <div class="kv">
            <dt>{{ t("tasks.folderTitle") }}</dt>
            <dd>
              <select class="mini-select" :value="detail.folder_id ?? ''" @change="assignFolder(detail.task_id, ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t("tasks.folderNone") }}</option>
                <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.name }}</option>
              </select>
            </dd>
          </div>
        </dl>
        <p v-if="detail.error" class="err">{{ detail.error.message }}</p>

        <div v-if="detail.status === 3" class="detail-ops">
          <p class="block-label">{{ t("tasks.detailOps") }}</p>
          <div class="op-row">
            <Button size="sm" variant="ghost" @click="transferAsset">{{ t("tasks.transferAsset") }}</Button>
            <Button size="sm" variant="ghost" @click="createShare">{{ t("tasks.createShare") }}</Button>
            <Button v-if="shareInfo" size="sm" variant="text" @click="revokeShare">{{ t("tasks.revokeShare") }}</Button>
            <NuxtLink v-if="shareInfo" :to="shareInfo.share_path" class="share-link" target="_blank">
              {{ t("tasks.openShare") }}
            </NuxtLink>
          </div>
          <div class="op-row">
            <select v-model="projectTarget" class="mini-select">
              <option value="">{{ t("tasks.selectProject") }}</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
            </select>
            <Button size="sm" variant="ghost" @click="addToProject">{{ t("tasks.addToProject") }}</Button>
          </div>
          <p v-if="shareInfo" class="muted small">
            {{ t("tasks.shareExpires", { date: new Date(shareInfo.expires_at).toLocaleString(locale) }) }}
          </p>
        </div>
      </template>
    </Modal>
    </div>
  </ClientOnly>
</template>

<style scoped>
/* GL2：竞品内容区是**圆角面板 #191A22**，右缩 10 / 下缩 22（task.png x240–1589 / y64–977，圆角 12）。
   全站只有 /tasks 与 /novel-market 有面板，其余页面内容区是平色 #0B0B10，故本规则只留在本页。 */
.tasks {
  background: var(--bg-panel);
  border-radius: 12px;
  margin: 0 10px 22px 0;
  padding: 28px 40px 40px;
  min-height: calc(100vh - 64px - 22px);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.head-main {
  min-width: 0;
}
.head h1 {
  /* GL16：有 h1 的页面统一 26px/700 */
  font-size: 26px;
  font-weight: 700;
  color: var(--text-1);
}
.sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* GL9：Tab 选中 = 白字 #FFFFFF + 白 2px 下划线（宽=文字宽、无内缩），容器无全宽底线。
   旧值 15px/600 + 紫下划线是"另一个产品"的语言（竞品 pricing-full.png 下划线 y90–91 为 #FFFFFF）。 */
.tabs {
  display: flex;
  align-items: center;
  gap: 28px;
  margin-bottom: var(--space-6);
}
.tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: #9d9d9f;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--text-1);
}
.tab.on {
  color: #ffffff;
}
.tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--tab-line);
}
.total {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.folder-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -12px 0 20px;
}
.folder-input {
  min-height: 32px;
  width: 200px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-raised);
  color: var(--text-1);
  padding: 0 10px;
  font-size: 13px;
}

.err {
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.ok {
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--info-bg);
  color: var(--info);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.warn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--warning-bg);
  color: var(--warning);
  border: 1px solid #6b4d12;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin: 0 0 var(--space-4);
}
.warn a {
  color: var(--warning);
  text-decoration: underline;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
  flex-shrink: 0;
}

/* 列表卡片范式 C：实底面板 + 1px 白 8% 边框 + 16 圆角，无投影光晕 */
.task-table {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--bg-surface);
}
.t-row {
  display: grid;
  grid-template-columns: 96px 96px minmax(0, 1fr) 72px 176px 208px;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-sm);
}
.t-row:last-child {
  border-bottom: 0;
}
.t-row:not(.t-head):hover {
  background: var(--bg-hover);
}
.t-head {
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: var(--text-xs);
  font-weight: 600;
}
.id-link {
  background: none;
  border: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--brand-300);
  cursor: pointer;
  text-align: left;
}
.id-link:hover {
  text-decoration: underline;
}
.mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.muted {
  color: var(--text-3);
}
.ops {
  display: flex;
  gap: var(--space-1);
  justify-content: flex-end;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-8);
  color: var(--text-3);
  font-size: var(--text-sm);
}
/* 空态：复用 EmptyState，整块上下居中（参照项目页范式） */
.empty-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 420px;
}

.kv-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.kv {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: baseline;
}
.kv dt {
  color: var(--text-3);
  font-size: var(--text-xs);
}
.kv dd {
  margin: 0;
  color: var(--text-1);
  font-size: var(--text-sm);
}
.break {
  word-break: break-all;
}
.detail-ops {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-1);
}
.block-label {
  margin: 0 0 var(--space-2);
  color: var(--text-3);
  font-size: var(--text-xs);
  font-weight: 600;
}
.op-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}
.mini-select {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.share-link {
  color: var(--brand-300);
  font-size: var(--text-sm);
}
.small {
  font-size: var(--text-xs);
}

@media (max-width: 1000px) {
  .t-row {
    grid-template-columns: 88px 92px minmax(0, 1fr) 176px;
  }
  .c-credits,
  .c-mode {
    display: none;
  }
}
@media (max-width: 720px) {
  .t-row {
    grid-template-columns: 84px 88px 1fr;
  }
  .c-time {
    display: none;
  }
  .ops .btn:not(:last-child) {
    display: none;
  }
}
/* 窄屏：页内容左右留白降级（与 home/tools 一致） */
@media (max-width: 1024px) {
  .tasks {
    padding: 24px;
  }
}
@media (max-width: 768px) {
  .tasks {
    padding: 16px;
  }
  .head {
    flex-direction: column;
    gap: var(--space-3);
  }
  .tabs {
    gap: 20px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
}
</style>
