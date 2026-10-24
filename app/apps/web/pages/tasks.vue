<script setup lang="ts">
import type { TaskDto } from "~/types/api";
import { statusLabel } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true });

const api = useApi();
const auth = useAuth();
const list = ref<TaskDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const statusFilter = ref<string>("");
const detail = ref<TaskDto | null>(null);
const shareInfo = ref<{ share_path: string; expires_at: string } | null>(null);
const error = ref("");
const info = ref("");
const expiring = ref<Array<{ task_id: string; days_left: number }>>([]);
const projects = ref<Array<{ id: string; title: string }>>([]);
const projectTarget = ref("");
let timer: ReturnType<typeof setInterval> | undefined;

async function load(): Promise<void> {
  const query = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
  if (statusFilter.value) query.set("status", statusFilter.value);
  const data = await api.get<{ list: TaskDto[]; total: number }>(`/tasks?${query.toString()}`);
  list.value = data.list;
  total.value = data.total;
  try {
    expiring.value = await api.get<Array<{ task_id: string; days_left: number }>>("/assets/expiring-tasks");
  } catch {
    expiring.value = [];
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
    info.value = `分享链接已生成并复制：${url}`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "分享失败";
  }
}

async function revokeShare(): Promise<void> {
  if (!detail.value) return;
  try {
    await api.delete(`/tasks/${detail.value.task_id}/share`);
    shareInfo.value = null;
    info.value = "已取消分享";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "取消失败";
  }
}

async function cancel(item: TaskDto): Promise<void> {
  try {
    await api.post(`/tasks/${item.task_id}/cancel`);
    await load();
    await auth.me();
    info.value = "已取消并解冻积分";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "取消失败";
  }
}

async function retry(item: TaskDto): Promise<void> {
  try {
    await api.post(`/tasks/${item.task_id}/retry`);
    await load();
    await auth.me();
    info.value = "已创建重试任务";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "重试失败";
  }
}

async function download(item: TaskDto): Promise<void> {
  try {
    const data = await api.get<{ url: string }>(`/tasks/${item.task_id}/results/1/download-url`);
    if (data.url.startsWith("mock://")) {
      info.value = "当前为 mock 结果（真实供应商接入后可下载）";
      return;
    }
    window.open(data.url, "_blank");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "下载失败";
  }
}

async function addToProject(): Promise<void> {
  if (!detail.value || !projectTarget.value) {
    info.value = "请选择项目";
    return;
  }
  try {
    await api.post(`/projects/${projectTarget.value}/shot-materials`, { task_id: detail.value.task_id });
    info.value = "已加入项目分镜素材";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加入项目失败";
  }
}

async function transferAsset(): Promise<void> {
  if (!detail.value) return;
  try {
    await api.post("/assets/from-task", { task_id: detail.value.task_id, index: 0 });
    info.value = "已转存资产库";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "转存失败";
  }
}

async function batchDownload(): Promise<void> {
  const ids = list.value
    .filter((item) => item.status === 3)
    .slice(0, 50)
    .map((item) => item.task_id);
  if (ids.length === 0) {
    info.value = "当前页没有已完成任务可打包";
    return;
  }
  try {
    const data = await api.post<{ url: string }>("/tasks/batch-download", { task_ids: ids });
    window.open(data.url, "_blank");
    info.value = `已打包 ${ids.length} 个任务`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "批量下载失败";
  }
}

function canCancel(item: TaskDto): boolean {
  return item.status === 1 || item.status === 2;
}

onMounted(async () => {
  try {
    await load();
    const data = await api.get<{ list: Array<{ id: string; title: string }> }>("/projects?page=1&page_size=50");
    projects.value = data.list;
    timer = setInterval(() => void load().catch(() => undefined), 5000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <main class="page">
    <div class="head">
      <h1>任务中心</h1>
      <div class="filters">
        <select v-model="statusFilter" class="input" @change="page = 1; load()">
          <option value="">全部状态</option>
          <option value="1">排队中</option>
          <option value="2">生成中</option>
          <option value="3">已完成</option>
          <option value="4">失败</option>
          <option value="5">已取消</option>
        </select>
        <span class="muted">共 {{ total }} 条</span>
        <Button variant="ghost" @click="batchDownload">批量下载 zip</Button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="info" class="info">{{ info }}</p>
    <p v-if="expiring.length > 0" class="expiring">
      有 {{ expiring.length }} 个任务结果将在 7 天内到期，请尽快
      <NuxtLink to="/assets">转存资产库</NuxtLink>（到期后自动清理）。
    </p>

    <div class="table">
      <div class="row head-row">
        <span>任务</span><span>状态</span><span>模式</span><span>积分</span><span>创建时间</span><span>操作</span>
      </div>
      <div v-for="item in list" :key="item.task_id" class="row">
        <button class="link" @click="openDetail(item)">{{ item.task_id.slice(-8) }}</button>
        <span class="badge" :data-status="item.status">{{ statusLabel(item.status) }}</span>
        <span>{{ item.mode }}</span>
        <span>{{ item.credits_frozen }}</span>
        <span class="muted">{{ new Date(item.created_at).toLocaleString() }}</span>
        <span class="ops">
          <button class="mini" :disabled="item.status !== 3" @click="download(item)">下载</button>
          <button class="mini" :disabled="!canCancel(item)" @click="cancel(item)">取消</button>
          <button class="mini" :disabled="item.status !== 4" @click="retry(item)">重试</button>
        </span>
      </div>
      <p v-if="list.length === 0" class="muted empty">暂无任务</p>
    </div>

    <div class="pager">
      <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
      <span class="muted">第 {{ page }} 页</span>
      <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
    </div>

    <Modal :open="!!detail" title="任务详情" @close="detail = null">
      <template v-if="detail">
        <p class="kv"><span>任务 ID</span><code>{{ detail.task_id }}</code></p>
        <p class="kv"><span>状态</span><span>{{ statusLabel(detail.status) }}</span></p>
        <p class="kv"><span>模式</span><span>{{ detail.mode }}</span></p>
        <p class="kv"><span>提示词</span><span>{{ detail.input?.prompt }}</span></p>
        <p class="kv"><span>比例/分辨率</span><span>{{ detail.options?.ratio }} / {{ detail.options?.resolution }}</span></p>
        <p class="kv"><span>结果</span><span>{{ detail.results?.[0]?.uri ?? "-" }}</span></p>
        <p v-if="detail.error" class="error">{{ detail.error.message }}</p>
        <div class="share">
          <Button v-if="detail.status === 3" variant="ghost" @click="transferAsset">转存资产</Button>
          <template v-if="detail.status === 3">
            <select v-model="projectTarget" class="input">
              <option value="">选择项目…</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
            </select>
            <Button variant="ghost" @click="addToProject">加入项目</Button>
          </template>
          <Button variant="ghost" @click="createShare">生成分享链接</Button>
          <Button v-if="shareInfo" variant="ghost" @click="revokeShare">取消分享</Button>
          <NuxtLink v-if="shareInfo" :to="shareInfo.share_path" class="share-link" target="_blank">
            打开分享页
          </NuxtLink>
        </div>
        <p v-if="shareInfo" class="muted">有效期至 {{ new Date(shareInfo.expires_at).toLocaleString() }}</p>
      </template>
    </Modal>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  padding: 24px 32px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
}
.table {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 120px 90px 1fr 70px 170px 200px;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  align-items: center;
  font-size: 13px;
}
.row:last-child {
  border-bottom: 0;
}
.head-row {
  background: var(--color-surface);
  color: var(--text-3);
  font-size: 12px;
}
.badge {
  font-size: 12px;
  color: var(--text-2);
}
.badge[data-status="3"] {
  color: #4ade80;
}
.badge[data-status="4"],
.badge[data-status="7"] {
  color: #ff6b6b;
}
.badge[data-status="2"],
.badge[data-status="6"] {
  color: #fbbf24;
}
.link {
  background: none;
  border: 0;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  text-align: left;
  font-size: 12px;
}
.ops {
  display: flex;
  gap: 6px;
}
.mini {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.mini:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.empty {
  padding: 24px;
  text-align: center;
}
.error {
  color: #ff6b6b;
  font-size: 13px;
}
.info {
  color: var(--text-2);
  font-size: 13px;
}
.expiring {
  background: #78350f;
  border: 1px solid #f59e0b;
  color: #fde68a;
  padding: 8px 12px;
  border-radius: var(--radius-m);
  font-size: 12px;
}
.expiring a {
  color: #fff;
  text-decoration: underline;
}
.kv {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--text-2);
}
.kv span:first-child {
  width: 84px;
  color: var(--text-3);
  flex: none;
}
code {
  font-size: 11px;
  word-break: break-all;
}
.share {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.share-link {
  color: var(--color-primary);
  font-size: 12px;
}
</style>
