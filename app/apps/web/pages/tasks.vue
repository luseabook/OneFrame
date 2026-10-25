<script setup lang="ts">
import type { TaskDto } from "~/types/api";
import { statusLabel } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

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
  loading.value = true;
  const query = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
  if (statusFilter.value) query.set("status", statusFilter.value);
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
  // 延后到浏览器完成首帧绘制后再拉取并启动轮询：
  // 否则在 hydration 未完成时改数据会触发 hydration mismatch
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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
// 状态筛选页签与颜色映射（UI 层，不改业务逻辑）
const statusTabs = [
  { value: "", label: "全部" },
  { value: "1", label: "排队中" },
  { value: "2", label: "生成中" },
  { value: "3", label: "已完成" },
  { value: "4", label: "失败" },
  { value: "5", label: "已取消" },
];
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
          <h1>任务中心</h1>
          <p class="sub">按「次」查看执行状态；成果请到作品库按剧查看。</p>
        </div>
        <div class="head-actions">
          <Button variant="ghost" size="sm" @click="batchDownload">批量下载 zip</Button>
        </div>
      </header>

      <!-- 状态筛选：沿用 projects/index.vue 的下划线 tab 范式 -->
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
        <span class="total">共 {{ total }} 条</span>
      </nav>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="info" class="ok">{{ info }}</p>

      <!-- 动态区（到期提醒 / 列表 / 分页）用 mounted 门控：
           本页有 5s 轮询，若参与 SSR 会与 hydration 时的数据不一致 -->
      <template v-if="mounted">
        <p v-if="expiring.length > 0" class="warn">
          <span class="dot" />有 {{ expiring.length }} 个任务结果将在 7 天内到期，请尽快
          <NuxtLink to="/assets">转存资产库</NuxtLink>（到期后自动清理）。
        </p>

        <Skeleton v-if="loading" :rows="4" />

        <template v-else>
          <div v-if="list.length" class="task-table">
            <div class="t-row t-head">
              <span class="c-id">任务</span>
              <span class="c-status">状态</span>
              <span class="c-mode">模式</span>
              <span class="c-credits">积分</span>
              <span class="c-time">创建时间</span>
              <span class="c-ops">操作</span>
            </div>
            <div v-for="item in list" :key="item.task_id" class="t-row">
              <button class="id-link" @click="openDetail(item)">{{ item.task_id.slice(-8) }}</button>
              <span class="c-status">
                <Tag :tone="statusTone(item.status)" size="sm" dot>{{ statusLabel(item.status) }}</Tag>
              </span>
              <span class="c-mode mono">{{ item.mode }}</span>
              <span class="c-credits mono">{{ item.credits_frozen }}</span>
              <span class="c-time muted">{{ new Date(item.created_at).toLocaleString("zh-CN") }}</span>
              <span class="c-ops ops">
                <Button size="sm" variant="ghost" :disabled="item.status !== 3" @click="download(item)">下载</Button>
                <Button size="sm" variant="text" :disabled="!canCancel(item)" @click="cancel(item)">取消</Button>
                <Button size="sm" variant="text" :disabled="item.status !== 4" @click="retry(item)">重试</Button>
              </span>
            </div>
          </div>

          <div v-else class="empty-wrap">
            <EmptyState
              icon="◷"
              title="暂无任务"
              description="在工具箱或流水线投递后会出现在这里；可用顶部状态筛选查看。"
            >
              <Button @click="$router.push('/create/text-to-video')">去生成</Button>
            </EmptyState>
          </div>

          <div v-if="total > pageSize" class="pager">
            <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
            <span class="muted">第 {{ page }} 页</span>
            <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
          </div>
        </template>
      </template>

    <Modal :open="!!detail" title="任务详情" width="560px" @close="detail = null">
      <template v-if="detail">
        <dl class="kv-list">
          <div class="kv"><dt>任务 ID</dt><dd class="mono">{{ detail.task_id }}</dd></div>
          <div class="kv">
            <dt>状态</dt>
            <dd><Tag :tone="statusTone(detail.status)" size="sm" dot>{{ statusLabel(detail.status) }}</Tag></dd>
          </div>
          <div class="kv"><dt>模式</dt><dd class="mono">{{ detail.mode }}</dd></div>
          <div class="kv"><dt>提示词</dt><dd>{{ detail.input?.prompt || "—" }}</dd></div>
          <div class="kv">
            <dt>比例 / 分辨率</dt>
            <dd>{{ detail.options?.ratio }} / {{ detail.options?.resolution }}</dd>
          </div>
          <div class="kv"><dt>结果</dt><dd class="mono break">{{ detail.results?.[0]?.uri ?? "—" }}</dd></div>
        </dl>
        <p v-if="detail.error" class="err">{{ detail.error.message }}</p>

        <div v-if="detail.status === 3" class="detail-ops">
          <p class="block-label">成果处理</p>
          <div class="op-row">
            <Button size="sm" variant="ghost" @click="transferAsset">转存资产</Button>
            <Button size="sm" variant="ghost" @click="createShare">生成分享链接</Button>
            <Button v-if="shareInfo" size="sm" variant="text" @click="revokeShare">取消分享</Button>
            <NuxtLink v-if="shareInfo" :to="shareInfo.share_path" class="share-link" target="_blank">
              打开分享页 →
            </NuxtLink>
          </div>
          <div class="op-row">
            <select v-model="projectTarget" class="mini-select">
              <option value="">选择项目…</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
            </select>
            <Button size="sm" variant="ghost" @click="addToProject">加入项目当分镜</Button>
          </div>
          <p v-if="shareInfo" class="muted small">
            分享有效期至 {{ new Date(shareInfo.expires_at).toLocaleString("zh-CN") }}
          </p>
        </div>
      </template>
    </Modal>
    </div>
  </ClientOnly>
</template>

<style scoped>
/* 页内容容器：与 home/tools 同一套 padding 节奏，最大宽度对齐 projects/index.vue */
.tasks {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 72px 80px;
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
  font-size: var(--text-2xl);
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

/* tabs：沿用 projects/index.vue 的下划线范式（激活 2px brand + text-1） */
.tabs {
  display: flex;
  align-items: center;
  gap: 28px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: var(--space-6);
}
.tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--text-1);
}
.tab.on {
  color: var(--text-1);
}
.tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}
.total {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
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
