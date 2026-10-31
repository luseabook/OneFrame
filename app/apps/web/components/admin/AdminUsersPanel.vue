<script setup lang="ts">
/**
 * 用户管理面板（前端契约 §3.1 / API 契约 §2.1）。
 *
 * 为什么只做「封禁/解封 + 注销恢复」两类写操作：后端 P2 只开放了
 * `PATCH /ops/admin/users/:id`（status）与 `POST .../restore`，多做编辑入口只会
 * 点一次失败一次；要改昵称只能走 restore（注销后昵称已被匿名化，原值不可恢复）。
 *
 * 手机号永远只显示后端给的 `phone_masked`（`138****1234`）：
 * 平台侧 `phone_cipher` 解密失败时后端返回 null，这时显示「不可用」而不是空白——
 * 空白会让运营误判成「该用户没绑手机」，而真相是「我们解不出来」。
 *
 * 已注销用户（`deleted_at != null`）不给状态按钮：后端对该情况直接 400101（要求先 restore），
 * 前端先把按钮换成「恢复」，省掉一次注定失败的点击。
 */
import { adminApi, adminErrorCode } from "~/composables/useAdminApi";

/** 行 DTO 字段名与服务端保持一致（本仓库 admin DTO 统一 snake_case） */
interface UserRow {
  id: string;
  nickname: string | null;
  avatar_uri: string | null;
  /** 1 正常 / 2 封禁 */
  status: number;
  deleted_at: string | null;
  last_login_at: string | null;
  created_at: string;
  /** 打码手机号；后端解密失败为 null */
  phone_masked: string | null;
  space_id: string | null;
}

interface UserList {
  list: UserRow[];
  total: number;
  page: number;
  page_size: number;
}

const { t } = useI18n();

/** 每页条数候选：审计/用户这类"要翻着找"的表，50 条是排查时的常用档 */
const PAGE_SIZES = [20, 50, 100];

const rows = ref<UserRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref("");
const ok = ref("");
/** 行内写操作 busy：`<id>:status` / `<id>:restore`，只禁用正在跑的那个按钮 */
const busy = ref("");

/** 输入中的筛选条件 */
const form = reactive({ q: "", status: "", deleted: "" });
/**
 * 已生效的条件快照。
 * 为什么不直接读 form：翻页时若读 form，用户改了输入框却没点「搜索」，
 * 第 2 页就会和第 1 页用不同条件，看起来像"数据串了"。
 */
const applied = ref({ q: "", status: "", deleted: "" });

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

/** 长 ID 只显示尾部 8 位：表格宽度有限，完整值放 title 里供悬停/复制 */
function shortId(id: string | null): string {
  if (!id) return "-";
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

function phoneText(row: UserRow): string {
  return row.phone_masked && row.phone_masked.trim() ? row.phone_masked : t("adminUsers.phoneUnavailable");
}

function isBusy(row: UserRow, action: string): boolean {
  return busy.value === `${row.id}:${action}`;
}

function buildQuery(): string {
  const parts = [`page=${page.value}`, `page_size=${pageSize.value}`];
  const { q, status, deleted } = applied.value;
  if (q.trim()) parts.push(`q=${encodeURIComponent(q.trim())}`);
  // 空串必须不传：后端把空串当"未传"（emptyToUndefined），但显式不带更省一次解释成本
  if (status) parts.push(`status=${encodeURIComponent(status)}`);
  if (deleted) parts.push(`deleted=${encodeURIComponent(deleted)}`);
  return parts.join("&");
}

/**
 * 身份类错误统一处理：
 * - 401101（token 过期/被停用）：清 token 回登录页，这是唯一该把运营送出后台的情况；
 * - 403/403101（角色不够，viewer 点了写操作）：**就地提示**。换成 viewer 重登还是 viewer，
 *   回登录页只会形成"登录→再被拒"的死循环。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  const code = adminErrorCode(err);
  if (code === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (code === 403 || code === 403101) {
    error.value = t("adminUsers.needRole");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<UserList>(`/ops/admin/users?${buildQuery()}`);
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    // 服务端会把越界 page 归一到最后一页；以返回值为准，否则分页按钮状态会错
    page.value = data.page ?? page.value;
  } catch (err) {
    // 保留上一份成功数据，只把错误显示在上方：网络抖动不该把整张表清空
    await handleError(err, "adminUsers.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  applied.value = { q: form.q, status: form.status, deleted: form.deleted };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  form.q = "";
  form.status = "";
  form.deleted = "";
  applyFilters();
}

function changePageSize(): void {
  // 换页长后旧页码没有意义（第 5 页 × 20 条 ≠ 第 5 页 × 100 条），统一回第 1 页
  page.value = 1;
  void load();
}

function go(next: number): void {
  if (next < 1 || next > pages.value) return;
  page.value = next;
  void load();
}

async function toggleStatus(row: UserRow): Promise<void> {
  const next = row.status === 1 ? 2 : 1;
  // 封禁是不可逆体验（用户下一次请求就 401），必须二次确认；解封无需确认
  if (next === 2 && !window.confirm(t("adminUsers.banConfirm", { name: row.nickname || row.id }))) return;
  busy.value = `${row.id}:status`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/users/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: { status: next },
    });
    // 以服务端为准重新拉取：封禁会连带影响该行的 deleted_at/最后登录展示
    await load();
    ok.value = next === 2 ? t("adminUsers.banned", { name: row.nickname || row.id }) : t("adminUsers.unbanned", { name: row.nickname || row.id });
  } catch (err) {
    await handleError(err, "adminUsers.updateFailed");
  } finally {
    busy.value = "";
  }
}

/**
 * 注销恢复：昵称是可选的（后端只在传了才覆盖）。
 * 用 `window.prompt` 而不是自建弹窗：与后台改密/退款填写风格一致，不额外引组件；
 * 返回 `null` 表示用户点了取消（此时什么都不做），返回空串表示"不填昵称，只恢复账号"。
 */
async function restore(row: UserRow): Promise<void> {
  const input = window.prompt(t("adminUsers.restorePrompt"), "");
  if (input === null) return;
  const nickname = input.trim();
  busy.value = `${row.id}:restore`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/users/${encodeURIComponent(row.id)}/restore`, {
      method: "POST",
      // 不传 nickname 时后端保持匿名化昵称不变；空串同样按"不传"处理，避免把昵称写成空
      body: nickname ? { nickname } : {},
    });
    await load();
    ok.value = t("adminUsers.restored", { name: nickname || row.id });
  } catch (err) {
    await handleError(err, "adminUsers.restoreFailed");
  } finally {
    busy.value = "";
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="card">
    <header class="head">
      <h2>{{ t("adminUsers.title") }}</h2>
      <p class="muted small">{{ t("adminUsers.hint") }}</p>
    </header>

    <div class="filters">
      <input
        v-model="form.q"
        class="input grow"
        :placeholder="t('adminUsers.fQPlaceholder')"
        :aria-label="t('adminUsers.fQ')"
        maxlength="64"
        @keyup.enter="applyFilters"
      />
      <select v-model="form.status" class="input" :aria-label="t('adminUsers.fStatus')">
        <option value="">{{ t("adminUsers.statusAll") }}</option>
        <option value="1">{{ t("adminUsers.statusNormal") }}</option>
        <option value="2">{{ t("adminUsers.statusBanned") }}</option>
      </select>
      <select v-model="form.deleted" class="input" :aria-label="t('adminUsers.fDeleted')">
        <option value="">{{ t("adminUsers.deletedAll") }}</option>
        <option value="0">{{ t("adminUsers.deletedNo") }}</option>
        <option value="1">{{ t("adminUsers.deletedYes") }}</option>
      </select>
      <select v-model.number="pageSize" class="input narrow" :aria-label="t('adminUsers.pageSize')" @change="changePageSize">
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <button class="mini primary" :disabled="loading" @click="applyFilters">{{ t("adminUsers.search") }}</button>
      <button class="mini" :disabled="loading" @click="resetFilters">{{ t("adminUsers.reset") }}</button>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="ok" class="banner ok">{{ ok }}</p>

    <p v-if="loading" class="muted small">{{ t("adminUsers.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted small">{{ t("adminUsers.empty") }}</p>

    <div v-else class="table-scroll">
      <div class="table-inner">
        <div class="row head-row">
          <span>{{ t("adminUsers.colId") }}</span>
          <span>{{ t("adminUsers.colNickname") }}</span>
          <span>{{ t("adminUsers.colPhone") }}</span>
          <span>{{ t("adminUsers.colStatus") }}</span>
          <span>{{ t("adminUsers.colDeletedAt") }}</span>
          <span>{{ t("adminUsers.colLastLogin") }}</span>
          <span>{{ t("adminUsers.colCreated") }}</span>
          <span>{{ t("adminUsers.colSpace") }}</span>
          <span>{{ t("adminUsers.colOps") }}</span>
        </div>

        <div v-for="row in rows" :key="row.id" class="row">
          <span class="mono ellipsis" :title="row.id">{{ shortId(row.id) }}</span>
          <span class="ellipsis" :title="row.nickname || ''">{{ row.nickname || "-" }}</span>
          <span class="mono ellipsis" :title="phoneText(row)">{{ phoneText(row) }}</span>
          <span :class="row.status === 1 ? 'state-on' : 'state-off'">
            {{ row.status === 1 ? t("adminUsers.stateNormal") : t("adminUsers.stateBanned") }}
          </span>
          <span class="muted">{{ row.deleted_at ? formatTime(row.deleted_at) : "-" }}</span>
          <span class="muted">{{ formatTime(row.last_login_at) }}</span>
          <span class="muted">{{ formatTime(row.created_at) }}</span>
          <span class="mono muted ellipsis" :title="row.space_id || ''">{{ shortId(row.space_id) }}</span>
          <span class="ops">
            <!-- 已注销的行只能恢复：后端拒绝对其改 status（先 restore 再操作） -->
            <button
              v-if="row.deleted_at"
              class="mini primary"
              :disabled="isBusy(row, 'restore')"
              @click="restore(row)"
            >
              {{ isBusy(row, "restore") ? t("adminUsers.restoring") : t("adminUsers.restore") }}
            </button>
            <button v-else class="mini" :disabled="isBusy(row, 'status')" @click="toggleStatus(row)">
              {{ row.status === 1 ? t("adminUsers.ban") : t("adminUsers.unban") }}
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">{{ t("adminUsers.prev") }}</button>
      <span class="muted small">
        {{ t("adminUsers.pageInfo", { page: page, pages: pages, total: total }) }}
      </span>
      <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">{{ t("adminUsers.next") }}</button>
    </div>
  </section>
</template>

<style scoped>
/* 样式刻意复制 `pages/admin/index.vue` 的 .card/.row/.mini/.input 口径（scoped，不引全局新样式），
   保证这一屏和后台其它页签看起来是同一套零件。 */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
.head p {
  margin: 0;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 140px;
}
.input.grow {
  flex: 1;
  min-width: 220px;
}
.input.narrow {
  min-width: 72px;
  width: 72px;
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
.banner {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  font-size: 12px;
}
.banner.error {
  background: var(--danger-bg, rgba(255, 107, 107, 0.12));
  color: #ff6b6b;
}
.banner.ok {
  background: var(--bg-subtle, #16161f);
  color: #4ade80;
}
.table-scroll {
  overflow-x: auto;
}
.table-inner {
  /* 9 列在窄屏必然挤：给最小宽度 + 横向滚动，比压缩到看不清更有用 */
  min-width: 1040px;
}
.row {
  display: grid;
  grid-template-columns:
    minmax(88px, 0.7fr) minmax(110px, 1fr) minmax(110px, 0.9fr) 72px
    minmax(130px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(96px, 0.8fr) 96px;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
  padding-top: 4px;
}
.ops {
  display: inline-flex;
  gap: 6px;
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
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.small {
  font-size: 11px;
}
.state-on {
  color: #4ade80;
  font-size: 12px;
}
.state-off {
  color: #ff6b6b;
  font-size: 12px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
