<script setup lang="ts">
/**
 * 邀请码面板（前端契约 §3.1 / API 契约 §2.3）。
 *
 * 为什么创建是"批量 + 一次性展示生成的码"：
 * 后端 `POST /ops/admin/invite-codes` 一次最多生成 50 条并回全量 `codes`，
 * 运营发码的实际动作是"给一批人各发一个"——逐条建既慢又容易漏。
 * 生成的码只在这一次响应里出现，所以面板必须立刻展示并可复制，
 * 否则运营关掉提示后只能去列表里翻（而列表按创建时间倒序，翻到第 3 页很常见）。
 *
 * 为什么"已耗尽的码"禁用启用按钮：后端对 `used_count >= max_uses` 的码重新启用会 400101，
 * 前端先把按钮禁掉并给出原因，省掉一次注定失败的点击（契约 §2.3）。
 *
 * 为什么"已核销的码"禁用删除按钮：核销记录外键指向邀请码，删掉已用码会连带毁掉
 * 返利/核销的来源，后端同样 400101。已用码的唯一处置是停用；删除只服务"发错/测试码"。
 */
import { adminApi, adminErrorCode } from "~/composables/useAdminApi";

interface InviteCodeRow {
  id: string;
  code: string;
  credits: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  /** 1 有效 / 2 停用 / 3 耗尽（由后端判定） */
  status: number;
  /** admin_users.id 字符串，可能为 null（历史数据/系统生成） */
  created_by: string | null;
  created_at: string;
}

interface InviteCodeList {
  list: InviteCodeRow[];
  total: number;
  page: number;
  page_size: number;
}

const { t } = useI18n();

const PAGE_SIZES = [20, 50, 100];

const rows = ref<InviteCodeRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref("");
const ok = ref("");
/** 行内 busy：`<id>:status` / `<id>:delete` */
const busy = ref("");

/** 输入中的筛选条件 */
const form = reactive({ status: "" });
/** 已生效条件快照：翻页与列表刷新沿用"点搜索时"的条件 */
const applied = ref({ status: "" });

/** 创建表单：数值一律存字符串，"空"与"0"才能区分（空 = 走后端默认值） */
const createForm = reactive({ credits: "", maxUses: "", expiresAt: "", count: "" });
const creating = ref(false);
/** 刚生成出来的码：只在本次创建响应里存在，必须立刻给运营复制 */
const created = ref<InviteCodeRow[]>([]);

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const STATUS_KEYS: Record<number, string> = {
  1: "adminInvites.statusActive",
  2: "adminInvites.statusDisabled",
  3: "adminInvites.statusExhausted",
};

function statusLabel(status: number): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : String(status);
}

function formatTime(iso: string | null): string {
  if (!iso) return t("adminInvites.never");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

function usageText(row: InviteCodeRow): string {
  return `${row.used_count}/${row.max_uses}`;
}

/**
 * 已耗尽：不能再启用（后端同样拒绝），列表里也要把按钮禁掉。
 *
 * `max_uses = 0` 是"不限次"（契约 §2.3、`OpService` 同口径），永远不算耗尽——
 * 旧判断漏了这个分支，会把不限次码渲染成"耗尽"并禁掉启用按钮。
 */
function isExhausted(row: InviteCodeRow): boolean {
  return row.status === 3 || (row.max_uses > 0 && row.used_count >= row.max_uses);
}

/** 行内按钮的 busy 判定收进函数：模板里少写反引号表达式，`vue-tsc` 与模板解析都更稳 */
function isBusy(row: InviteCodeRow): boolean {
  return busy.value === `${row.id}:status`;
}

function isDeleting(row: InviteCodeRow): boolean {
  return busy.value === `${row.id}:delete`;
}

/**
 * `<input type="datetime-local">` 给的是本地时区无秒无 Z 的字符串，
 * 直接丢给服务端 `Date.parse` 会被当成本地时间甚至 400，所以显式转 UTC ISO。
 */
function toIso(local: string): string | null {
  const raw = local.trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * 整数字段校验：空 → null（走后端默认值）；越界/非整数 → 抛错，由调用方翻成文案。
 *
 * 入参可能是 **number** 而不是 string：`<input type="number">` 上的 `v-model` 由 Vue
 * 自动做 looseToNumber（不需要 `.number` 修饰符），所以运营一填数字，
 * `createForm.credits` 就从 `""` 变成 `0`/`500`。这里若还按 string 调 `.trim()`，
 * 会抛 "…trim is not a function"，被上层 catch 成一条看不懂的红条，
 * **请求根本发不出去**——第 107 批运营后台浏览器 E2E 实测：邀请码「生成」点击后
 * api 侧一个 POST 都没有，而 typecheck / lint / build 全绿。
 */
function parseIntField(raw: string | number, min: number, max: number, rangeKey: string): number | null {
  if (raw === "") return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(t(rangeKey, { min: min, max: max }));
  }
  return value;
}

function buildQuery(): string {
  const parts = [`page=${page.value}`, `page_size=${pageSize.value}`];
  if (applied.value.status) parts.push(`status=${encodeURIComponent(applied.value.status)}`);
  return parts.join("&");
}

/**
 * 身份类错误：401101 回登录页；403/403101 就地提示（viewer 发码重登还是 viewer）。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  const code = adminErrorCode(err);
  if (code === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (code === 403 || code === 403101) {
    error.value = t("adminInvites.needRole");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<InviteCodeList>(`/ops/admin/invite-codes?${buildQuery()}`);
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    page.value = data.page ?? page.value;
  } catch (err) {
    await handleError(err, "adminInvites.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  applied.value = { status: form.status };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  form.status = "";
  applyFilters();
}

function changePageSize(): void {
  page.value = 1;
  void load();
}

function go(next: number): void {
  if (next < 1 || next > pages.value) return;
  page.value = next;
  void load();
}

async function createCodes(): Promise<void> {
  error.value = "";
  ok.value = "";
  created.value = [];
  let credits: number | null;
  let maxUses: number | null;
  let count: number | null;
  try {
    // 范围与后端 zod 同口径（契约 §2.3），前端先挡，免得运营填完才吃一次 400101
    credits = parseIntField(createForm.credits, 0, 100000, "adminInvites.creditsRange");
    maxUses = parseIntField(createForm.maxUses, 1, 1000, "adminInvites.maxUsesRange");
    count = parseIntField(createForm.count, 1, 50, "adminInvites.countRange");
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("adminInvites.createFailed");
    return;
  }
  const expiresAt = toIso(createForm.expiresAt);
  if (createForm.expiresAt.trim() && !expiresAt) {
    error.value = t("adminInvites.expiresInvalid");
    return;
  }
  creating.value = true;
  try {
    const data = await adminApi<{ codes: InviteCodeRow[] }>("/ops/admin/invite-codes", {
      method: "POST",
      body: {
        ...(credits === null ? {} : { credits }),
        ...(maxUses === null ? {} : { max_uses: maxUses }),
        // null 表示"永不过期"：显式传 null 而不是省略，语义更清楚（后端两者等价）
        expires_at: expiresAt,
        ...(count === null ? {} : { count }),
      },
    });
    created.value = data.codes ?? [];
    ok.value = t("adminInvites.created", { n: created.value.length });
    // 新码按创建时间倒序落在第 1 页；运营刚建完通常在找它们，所以无条件回第 1 页并重拉
    page.value = 1;
    await load();
  } catch (err) {
    await handleError(err, "adminInvites.createFailed");
  } finally {
    creating.value = false;
  }
}

/**
 * 复制：优先走 clipboard API（需要 secure context）。
 * 不可用时不静默失败——用 prompt 把码原样递给运营手动复制，
 * 否则"点了复制但什么都没发生"会让人以为码丢了。
 */
async function copyText(text: string): Promise<void> {
  error.value = "";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    ok.value = t("adminInvites.copied", { code: text });
  } catch {
    window.prompt(t("adminInvites.copyManual"), text);
  }
}

async function toggleStatus(row: InviteCodeRow): Promise<void> {
  const next = row.status === 1 ? 2 : 1;
  if (next === 2 && !window.confirm(t("adminInvites.disableConfirm", { code: row.code }))) return;
  busy.value = `${row.id}:status`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/invite-codes/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: { status: next },
    });
    // 以服务端为准：耗尽状态由 used_count/max_uses 推导，前端不该自己算
    await load();
    ok.value = t("adminInvites.updated", { code: row.code });
  } catch (err) {
    await handleError(err, "adminInvites.updateFailed");
  } finally {
    busy.value = "";
  }
}

/**
 * 删除：只对"从未核销"的码开放（后端同日径，已核销会 400101）。
 *
 * 前端先按 `used_count > 0` 把按钮禁掉：已用码点下去注定失败，
 * 而"为什么不能删"比一次报错更值得直接写在 title 里。
 */
async function removeCode(row: InviteCodeRow): Promise<void> {
  if (row.used_count > 0) return;
  if (!window.confirm(t("adminInvites.deleteConfirm", { code: row.code }))) return;
  busy.value = `${row.id}:delete`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/invite-codes/${encodeURIComponent(row.id)}`, { method: "DELETE" });
    // 删除会改变 total 与分页：重拉而不是本地 splice，避免最后一页变成空页
    await load();
    ok.value = t("adminInvites.deleted", { code: row.code });
  } catch (err) {
    await handleError(err, "adminInvites.deleteFailed");
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
      <h2>{{ t("adminInvites.title") }}</h2>
      <p class="muted small">{{ t("adminInvites.hint") }}</p>
    </header>

    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="ok" class="banner ok">{{ ok }}</p>

    <!-- 创建表单：一次最多 50 条；不填数值就走后端默认（credits=0 / max_uses=1 / count=1） -->
    <div class="create">
      <h3>{{ t("adminInvites.createTitle") }}</h3>
      <div class="create-form">
        <label class="field">
          <span class="label">{{ t("adminInvites.fCredits") }}</span>
          <input
            v-model="createForm.credits"
            class="input narrow"
            type="number"
            min="0"
            max="100000"
            step="1"
            :placeholder="t('adminInvites.defaultCredits')"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("adminInvites.fMaxUses") }}</span>
          <input
            v-model="createForm.maxUses"
            class="input narrow"
            type="number"
            min="1"
            max="1000"
            step="1"
            :placeholder="t('adminInvites.defaultMaxUses')"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("adminInvites.fExpiresAt") }}</span>
          <input v-model="createForm.expiresAt" class="input" type="datetime-local" />
        </label>
        <label class="field">
          <span class="label">{{ t("adminInvites.fCount") }}</span>
          <input
            v-model="createForm.count"
            class="input narrow"
            type="number"
            min="1"
            max="50"
            step="1"
            :placeholder="t('adminInvites.defaultCount')"
          />
        </label>
        <button class="mini primary create-btn" :disabled="creating" @click="createCodes">
          {{ creating ? t("adminInvites.creating") : t("adminInvites.create") }}
        </button>
      </div>
      <p class="muted small">{{ t("adminInvites.expiresHint") }}</p>
    </div>

    <!-- 刚生成的码：只出现在本次响应里，必须立刻可复制 -->
    <div v-if="created.length > 0" class="created">
      <div class="created-head">
        <h3>{{ t("adminInvites.createdTitle", { n: created.length }) }}</h3>
        <button class="mini" @click="copyText(created.map((item) => item.code).join('\n'))">
          {{ t("adminInvites.copyAll") }}
        </button>
      </div>
      <div class="chips">
        <span v-for="item in created" :key="item.id" class="chip">
          <span class="mono">{{ item.code }}</span>
          <button class="mini" @click="copyText(item.code)">{{ t("adminInvites.copy") }}</button>
        </span>
      </div>
      <p class="muted small">{{ t("adminInvites.createdHint") }}</p>
    </div>

    <div class="filters">
      <select v-model="form.status" class="input" :aria-label="t('adminInvites.fStatus')" @change="applyFilters">
        <option value="">{{ t("adminInvites.statusAll") }}</option>
        <option value="1">{{ t("adminInvites.statusActive") }}</option>
        <option value="2">{{ t("adminInvites.statusDisabled") }}</option>
        <option value="3">{{ t("adminInvites.statusExhausted") }}</option>
      </select>
      <select
        v-model.number="pageSize"
        class="input narrow"
        :aria-label="t('adminInvites.pageSize')"
        @change="changePageSize"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <button class="mini" :disabled="loading" @click="applyFilters">{{ t("adminInvites.refresh") }}</button>
      <button class="mini" :disabled="loading" @click="resetFilters">{{ t("adminInvites.reset") }}</button>
    </div>

    <p v-if="loading" class="muted small">{{ t("adminInvites.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted small">{{ t("adminInvites.empty") }}</p>

    <div v-else class="table-scroll">
      <div class="table-inner">
        <div class="row head-row">
          <span>{{ t("adminInvites.colCode") }}</span>
          <span>{{ t("adminInvites.colCredits") }}</span>
          <span>{{ t("adminInvites.colUsage") }}</span>
          <span>{{ t("adminInvites.colStatus") }}</span>
          <span>{{ t("adminInvites.colExpires") }}</span>
          <span>{{ t("adminInvites.colCreatedBy") }}</span>
          <span>{{ t("adminInvites.colCreatedAt") }}</span>
          <span>{{ t("adminInvites.colOps") }}</span>
        </div>

        <div v-for="row in rows" :key="row.id" class="row">
          <span class="mono ellipsis" :title="row.code">{{ row.code }}</span>
          <span class="muted">{{ row.credits }}</span>
          <span class="muted">{{ usageText(row) }}</span>
          <span :class="row.status === 1 ? 'state-on' : 'state-off'">{{ statusLabel(row.status) }}</span>
          <span class="muted">{{ formatTime(row.expires_at) }}</span>
          <span class="mono muted ellipsis" :title="row.created_by || ''">{{ row.created_by || "-" }}</span>
          <span class="muted">{{ formatTime(row.created_at) }}</span>
          <span class="ops">
            <button class="mini" @click="copyText(row.code)">{{ t("adminInvites.copy") }}</button>
            <button
              class="mini"
              :disabled="isBusy(row) || isDeleting(row) || (row.status === 2 && isExhausted(row))"
              :title="row.status === 2 && isExhausted(row) ? t('adminInvites.exhaustedHint') : ''"
              @click="toggleStatus(row)"
            >
              {{ row.status === 1 ? t("adminInvites.disable") : t("adminInvites.enable") }}
            </button>
            <button
              class="mini danger"
              :disabled="isBusy(row) || isDeleting(row) || row.used_count > 0"
              :title="row.used_count > 0 ? t('adminInvites.deleteUsedHint') : ''"
              @click="removeCode(row)"
            >
              {{ isDeleting(row) ? t("adminInvites.deleting") : t("adminInvites.delete") }}
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">{{ t("adminInvites.prev") }}</button>
      <span class="muted small">
        {{ t("adminInvites.pageInfo", { page: page, pages: pages, total: total }) }}
      </span>
      <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">{{ t("adminInvites.next") }}</button>
    </div>
  </section>
</template>

<style scoped>
/* 样式刻意复制 `pages/admin/index.vue` 的 .card/.row/.mini/.input 口径（scoped，不引全局新样式） */
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
.input.narrow {
  min-width: 88px;
  width: 88px;
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
.mini.danger {
  color: #ff6b6b;
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
.create {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.create h3 {
  margin: 0;
  font-size: 13px;
}
.create p {
  margin: 0;
}
.create-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  color: var(--text-3);
  font-size: 12px;
}
.create-btn {
  margin-bottom: 1px;
}
.created {
  border: 1px solid var(--brand-500);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.created-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.created h3 {
  margin: 0;
  font-size: 13px;
}
.created p {
  margin: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  font-size: 12px;
}
.table-scroll {
  overflow-x: auto;
}
.table-inner {
  /* 8 列（含两个写操作按钮）在窄屏会挤：给最小宽度 + 横向滚动 */
  min-width: 1000px;
}
.row {
  display: grid;
  grid-template-columns:
    minmax(96px, 0.9fr) 72px 72px 72px minmax(130px, 1fr) minmax(96px, 0.8fr)
    minmax(130px, 1fr) 196px;
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
  color: var(--text-3);
  font-size: 12px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
