<script setup lang="ts">
/**
 * 操作日志面板（契约 §3.4）。
 *
 * 为什么独立成组件：`pages/admin/index.vue` 已近千行，而这三个新面板各自都有
 * 「筛选条件 + 分页 + 错误/空态」三份状态；塞回单页会让它变成"改一处怕碰十处"。
 * 面板只依赖 `useAdminApi`（后台是独立身份域，token 存 `localStorage.admin_token`）。
 */
import { adminApi, downloadAdminCsv, adminErrorCode } from "~/composables/useAdminApi";
const { t } = useI18n();

/** 审计行：字段名与服务端 DTO 一致（本仓库 admin DTO 统一 snake_case，见 admin.service.ts） */
interface AuditLogRow {
  id: string;
  admin_id: string | null;
  admin_username: string;
  method: string;
  path: string;
  action: string;
  status_code: number;
  ok: boolean;
  ip: string | null;
  request_id: string | null;
  payload: unknown;
  created_at: string;
}

interface AuditLogList {
  list: AuditLogRow[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 每页 20 条：审计表只增不减，一次拉全表既慢又会把浏览器内存顶起来；
 * 运营排查问题时通常按时间倒序看最近几条，20 条足够定位。
 */
const PAGE_SIZE = 20;

const rows = ref<AuditLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref("");
/** 导出 busy：CSV 可能要几秒（后端最多 5000 行），按钮必须防连点 */
const exporting = ref(false);

/** 表单里正在输入的条件 */
const form = reactive({ admin_id: "", action: "", from: "", to: "" });
/**
 * 已生效的条件快照。
 * 为什么不直接读 `form`：翻页时若读表单，用户改了输入框却没点「查询」，
 * 第 2 页就会和第 1 页用不同条件，看起来像"数据串了"。
 */
const applied = ref({ admin_id: "", action: "", from: "", to: "" });

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

/**
 * `<input type="datetime-local">` 给的是本地时区的 `2026-10-29T09:00`（无秒无 Z），
 * 服务端按 ISO 8601 解析会拿它当"本地时间"甚至直接 400，所以这里显式转 UTC ISO。
 */
function toIso(local: string): string | null {
  const raw = local.trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 管理员列：优先用冗余快照的用户名（账号改名后历史日志仍显示当时的名字） */
function adminLabel(row: AuditLogRow): string {
  if (row.admin_username) return row.admin_username;
  return row.admin_id ? `#${row.admin_id}` : "-";
}

function payloadSummary(payload: unknown): string {
  if (payload === null || payload === undefined) return "-";
  let text: string;
  try {
    text = typeof payload === "string" ? payload : (JSON.stringify(payload) ?? String(payload));
  } catch {
    // JSONB 理论上不会循环引用，但这里不能因为一条脏数据把整张表打挂
    return String(payload);
  }
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function buildFilterQuery(): string {
  const parts: string[] = [];
  const { admin_id, action, from, to } = applied.value;
  if (admin_id.trim()) parts.push(`admin_id=${encodeURIComponent(admin_id.trim())}`);
  if (action.trim()) parts.push(`action=${encodeURIComponent(action.trim())}`);
  const fromIso = toIso(from);
  const toIsoValue = toIso(to);
  if (fromIso) parts.push(`from=${encodeURIComponent(fromIso)}`);
  if (toIsoValue) parts.push(`to=${encodeURIComponent(toIsoValue)}`);
  return parts.join("&");
}

function buildQuery(): string {
  return [`page=${page.value}`, `page_size=${PAGE_SIZE}`, buildFilterQuery()].filter(Boolean).join("&");
}

/**
 * 身份类错误统一处理：
 * - 401101（token 过期/被踢）：清 token 回登录页，这是唯一该把运营送出后台的情况；
 * - 403101（角色不够）：**就地提示**而不是回登录页 —— 换成 viewer 账号重新登录后
 *   角色还是 viewer，会被反复弹回登录页形成死循环（角色问题只能由 super 改）。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  const code = adminErrorCode(err);
  if (code === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  // 403（HTTP 层）与 403101（业务码）都按"角色不够"就地提示
  if (code === 403 || code === 403101) {
    error.value = t("adminAudit.needRole");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<AuditLogList>(`/ops/admin/audit-logs?${buildQuery()}`);
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    // 服务端会把越界 page 归一到最后一页；以返回值为准，否则分页按钮状态会错
    page.value = data.page ?? page.value;
  } catch (err) {
    await handleError(err, "adminAudit.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  const adminId = form.admin_id.trim();
  // 服务端 `admin_id` 只接受纯数字（`/^\d{1,20}$/`）；前端先挡，
  // 免得运营在筛选框里填了用户名只看到一句英文 400101
  if (adminId && !/^\d{1,20}$/.test(adminId)) {
    error.value = t("adminAudit.adminIdInvalid");
    return;
  }
  applied.value = {
    admin_id: adminId,
    action: form.action,
    from: form.from,
    to: form.to,
  };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  form.admin_id = "";
  form.action = "";
  form.from = "";
  form.to = "";
  applyFilters();
}

function go(next: number): void {
  if (next < 1 || next > pages.value) return;
  page.value = next;
  void load();
}

/**
 * 导出 CSV：只带**已生效**的筛选条件（不含分页），保证"看到的口径"与"导出的口径"一致。
 * 后端同样按时间倒序最多 5000 行；导出是排查用的原始凭证，不做二次加工。
 */
async function exportCsv(): Promise<void> {
  exporting.value = true;
  error.value = "";
  try {
    const query = buildFilterQuery();
    await downloadAdminCsv(`/ops/admin/audit-logs.csv${query ? `?${query}` : ""}`, "audit-logs.csv");
  } catch (err) {
    await handleError(err, "adminAudit.exportFailed");
  } finally {
    exporting.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="card">
    <h2>{{ t("adminAudit.title") }}</h2>
    <p class="hint">{{ t("adminAudit.hint") }}</p>

    <div class="toolbar">
      <label class="field">
        <span class="label">{{ t("adminAudit.fAdmin") }}</span>
        <input
          v-model="form.admin_id"
          class="input"
          :placeholder="t('adminAudit.fAdminPlaceholder')"
          maxlength="20"
          inputmode="numeric"
          @keyup.enter="applyFilters"
        />
      </label>
      <label class="field grow">
        <span class="label">{{ t("adminAudit.fAction") }}</span>
        <input
          v-model="form.action"
          class="input"
          :placeholder="t('adminAudit.fActionPlaceholder')"
          maxlength="200"
          @keyup.enter="applyFilters"
        />
      </label>
      <label class="field">
        <span class="label">{{ t("adminAudit.fFrom") }}</span>
        <input v-model="form.from" class="input" type="datetime-local" />
      </label>
      <label class="field">
        <span class="label">{{ t("adminAudit.fTo") }}</span>
        <input v-model="form.to" class="input" type="datetime-local" />
      </label>
      <div class="toolbar-actions">
        <button class="mini primary" :disabled="loading" @click="applyFilters">
          {{ t("adminAudit.search") }}
        </button>
        <button class="mini" :disabled="loading" @click="resetFilters">
          {{ t("adminAudit.reset") }}
        </button>
        <button class="mini" :disabled="exporting" @click="exportCsv">
          {{ exporting ? t("adminAudit.exporting") : t("adminAudit.export") }}
        </button>
      </div>
    </div>

    <p v-if="error" class="banner">{{ error }}</p>

    <p v-if="loading" class="muted">{{ t("adminAudit.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted">{{ t("adminAudit.empty") }}</p>

    <template v-else>
      <div class="row head-row">
        <span>{{ t("adminAudit.colTime") }}</span>
        <span>{{ t("adminAudit.colAdmin") }}</span>
        <span>{{ t("adminAudit.colMethod") }}</span>
        <span>{{ t("adminAudit.colPath") }}</span>
        <span>{{ t("adminAudit.colStatus") }}</span>
        <span>{{ t("adminAudit.colPayload") }}</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="row">
        <span class="muted">{{ formatTime(row.created_at) }}</span>
        <span class="ellipsis" :title="adminLabel(row)">{{ adminLabel(row) }}</span>
        <span class="mono">{{ row.method }}</span>
        <span class="stack">
          <span class="ellipsis" :title="row.path">{{ row.path }}</span>
          <span v-if="row.action" class="muted small ellipsis" :title="row.action">{{ row.action }}</span>
        </span>
        <span :class="row.ok ? 'state-ok' : 'state-fail'">
          {{ row.status_code }} · {{ row.ok ? t("adminAudit.okTag") : t("adminAudit.failTag") }}
        </span>
        <span class="mono small ellipsis" :title="payloadSummary(row.payload)">
          {{ payloadSummary(row.payload) }}
        </span>
      </div>

      <div class="pager">
        <span class="muted">{{ t("adminAudit.total", { n: total }) }}</span>
        <span class="muted">{{ t("adminAudit.pageInfo", { page, pages }) }}</span>
        <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">
          {{ t("adminAudit.prev") }}
        </button>
        <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">
          {{ t("adminAudit.next") }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* 风格对齐 pages/admin/index.vue 的 .card/.row/.mini/.input（scoped 复制，避免引全局新样式） */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
}
h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
.hint {
  margin: 0 0 12px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field.grow {
  flex: 1;
  min-width: 220px;
}
.label {
  color: var(--text-3);
  font-size: 12px;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 150px;
}
.toolbar-actions {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
}
.row {
  display: grid;
  grid-template-columns: 148px 110px 66px minmax(0, 1.3fr) 92px minmax(0, 1.6fr);
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.mono {
  font-family: ui-monospace, monospace;
}
.small {
  font-size: 11px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.state-ok {
  color: #4ade80;
  font-size: 12px;
}
.state-fail {
  color: #ff6b6b;
  font-size: 12px;
}
.banner {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-bg, rgba(255, 107, 107, 0.12));
  color: #ff6b6b;
  font-size: 12px;
}
.mini {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}
.mini.primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
}
.pager .mini:first-of-type {
  margin-left: auto;
}
@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
