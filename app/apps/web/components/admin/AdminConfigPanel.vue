<script setup lang="ts">
/**
 * 配置中心面板（前端契约 §3.2 / API 契约 §2.5）。
 *
 * 这是「配置驱动」的写入口：`app_configs` 的读取方是公开的 `GET /v1/ops/config/:key`，
 * 所以这里保存后**公开读接口立即可见**，面板本身就是运营改公告/文案/开关的地方。
 * 值统一按 JSON 存取（`jsonb` 列）：纯字符串要写 `"文本"`，对象/数组/数字直接写。
 *
 * 为什么从"前端截断 200 条"改成服务端分页：契约 §2.5 给 `GET /ops/admin/configs`
 * 补了 `page/page_size/module/q`，配置条数会随模块增长（每个模型/活动都可能挂配置），
 * 一次性拉全表再截断会让"第 201 条之后的配置"变成看不见也改不了的孤儿。
 * `q` 只搜 key（ilike）：配置的 key 是唯一定位符，描述文本是解释，不适合当检索键。
 */
import { adminApi, adminErrorCode } from "~/composables/useAdminApi";

interface ConfigRow {
  key: string;
  module: string;
  description: string | null;
  /** 列表接口不保证回传 value（可能只给摘要），编辑时缺失则回读单条 */
  value?: unknown;
  updated_at: string;
  updated_by?: string | null;
}

/** 列表返回分页信封；仍兼容"直接给数组"的旧行为（老后端不传参数时） */
type ConfigListResponse = { list: ConfigRow[]; total: number; page: number; page_size: number } | ConfigRow[];

const { t } = useI18n();

const PAGE_SIZES = [20, 50, 100];

const rows = ref<ConfigRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref("");
const ok = ref("");

const formOpen = ref(false);
/** 正在编辑的 key；null = 新建 */
const editingKey = ref<string | null>(null);
const formError = ref("");
const saving = ref(false);
const deletingKey = ref("");
const editBusy = ref(false);

const form = reactive({ key: "", module: "", description: "", valueText: "{}" });

/** 输入中的筛选条件 */
const filters = reactive({ q: "", module: "", defaultOnly: false });
/**
 * 已生效条件快照。
 * 为什么不直接读 filters：翻页时若读输入框，运营改了关键词却没点「搜索」，
 * 第 2 页就会和第 1 页用不同条件，看起来像"数据串了"。
 */
const applied = ref({ q: "", module: "", defaultOnly: false });

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

function valueSummary(value: unknown): string {
  if (value === undefined) return "-";
  if (value === null) return "null";
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * 身份类错误统一处理：
 * - 401101：清 token 回登录页（唯一该把运营送出后台的情况）；
 * - 403101：就地提示"角色不够"。配置写操作要 ops/super，viewer 重登还是 viewer，
 *   回登录页只会形成死循环。
 */
async function handleError(err: unknown, fallbackKey: string, target: "page" | "form" = "page"): Promise<void> {
  const code = adminErrorCode(err);
  const message =
    code === 403101 || code === 403
      ? t("adminConfig.needRole")
      : err instanceof Error && err.message
        ? err.message
        : t(fallbackKey);
  if (code === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (target === "form") formError.value = message;
  else error.value = message;
}

function buildQuery(): string {
  const parts = [`page=${page.value}`, `page_size=${pageSize.value}`];
  if (applied.value.q.trim()) parts.push(`q=${encodeURIComponent(applied.value.q.trim())}`);
  const module = applied.value.module.trim();
  if (module) {
    parts.push(`module=${encodeURIComponent(module)}`);
  } else if (applied.value.defaultOnly) {
    /**
     * `?module=`（空串）才是"默认域（module=''）那一行"的地址；**不传** module 是"不筛"。
     * 服务端为此专门没有把空串折叠成 undefined，前端也必须真的发出这个空值——
     * 否则「只看默认域」在运营眼里是个点了没反应的开关。
     */
    parts.push("module=");
  }
  return parts.join("&");
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<ConfigListResponse>(`/ops/admin/configs?${buildQuery()}`);
    // 兼容旧后端"直接给数组"：那时没有 total/page，就按当前页长兜底，分页按钮退化成单页
    if (Array.isArray(data)) {
      rows.value = data;
      total.value = data.length;
      return;
    }
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    // 服务端会把越界 page 归一到最后一页；以返回值为准，否则分页按钮状态会错
    page.value = data.page ?? page.value;
  } catch (err) {
    // 保留上一份成功数据，只把错误显示在上方：网络抖动不该把整张表清空
    await handleError(err, "adminConfig.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  // 勾了「只看默认域」就不再按模块文本筛：两者是互斥寻址（精确 module vs 空串），
  // 同时留着输入框内容会让运营以为"默认域 + home"能叠加，实际只有一个生效。
  applied.value = { q: filters.q, module: filters.defaultOnly ? "" : filters.module, defaultOnly: filters.defaultOnly };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  filters.q = "";
  filters.module = "";
  filters.defaultOnly = false;
  applyFilters();
}

function changePageSize(): void {
  // 换页长后旧页码没有意义，统一回第 1 页
  page.value = 1;
  void load();
}

function go(next: number): void {
  if (next < 1 || next > pages.value) return;
  page.value = next;
  void load();
}

function resetForm(): void {
  form.key = "";
  form.module = "";
  form.description = "";
  form.valueText = "{}";
  formError.value = "";
}

function openCreate(): void {
  editingKey.value = null;
  resetForm();
  formOpen.value = true;
  error.value = "";
  ok.value = "";
}

async function openEdit(row: ConfigRow): Promise<void> {
  editingKey.value = row.key;
  form.key = row.key;
  form.module = row.module ?? "";
  form.description = row.description ?? "";
  formError.value = "";
  formOpen.value = true;
  error.value = "";
  ok.value = "";
  // 列表如果没带上 value，就回读单条（公开读接口，管理员带 token 请求同样可用）
  if (row.value !== undefined) {
    form.valueText = JSON.stringify(row.value, null, 2) ?? "null";
    return;
  }
  // 回读期间先清空：若沿用上一个 key 的 JSON，运营很容易在"看起来有值"的框里保存错内容
  form.valueText = "";
  editBusy.value = true;
  try {
    const data = await adminApi<{ value: unknown }>(
      `/ops/config/${encodeURIComponent(row.key)}${row.module ? `?module=${encodeURIComponent(row.module)}` : ""}`,
    );
    form.valueText = JSON.stringify(data.value, null, 2) ?? "null";
  } catch (err) {
    await handleError(err, "adminConfig.editFailed", "form");
  } finally {
    editBusy.value = false;
  }
}

function closeForm(): void {
  formOpen.value = false;
  editingKey.value = null;
  formError.value = "";
}

async function save(): Promise<void> {
  formError.value = "";
  ok.value = "";
  const key = form.key.trim();
  // key 是读取方的契约（1..64 字符且不含空白，服务端 zod 同口径）：前端先挡，免得白跑一次 400
  if (key.length < 1 || key.length > 64 || /\s/.test(key)) {
    formError.value = t("adminConfig.keyInvalid");
    return;
  }
  let value: unknown;
  try {
    // JSON.parse 的结果可能被当成 any；显式落到 unknown，调用方不再假设结构
    value = JSON.parse(form.valueText) as unknown;
  } catch (err) {
    formError.value = t("adminConfig.jsonInvalid", {
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  saving.value = true;
  try {
    // PUT 是 upsert：新建与编辑同一个端点，key 进路径（服务端按 key 唯一约束）
    await adminApi<unknown>(`/ops/admin/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: {
        value,
        // module/description 用空字符串表示"清空"，而不是 null：schema 里 description 可空，
        // 但空串对 zod 的 string 校验同样安全，避免不同接口对 nullable 的处理不一致
        module: form.module.trim(),
        description: form.description.trim(),
      },
    });
    // 写后刷新自身数据（契约 §4.3），并关闭表单回到列表
    await load();
    ok.value = t("adminConfig.saved", { key });
    closeForm();
  } catch (err) {
    await handleError(err, "adminConfig.saveFailed", "form");
  } finally {
    saving.value = false;
  }
}

async function remove(row: ConfigRow): Promise<void> {
  if (!window.confirm(t("adminConfig.deleteConfirm", { key: row.key }))) return;
  deletingKey.value = row.key;
  error.value = "";
  ok.value = "";
  try {
    // 必须带 module：列表一行 = 一个 (key, module)。不带 module 会删掉同 key 的所有语言变体
    //（`?module=` 空串是默认域那一行的地址，不能省略）
    await adminApi<unknown>(
      `/ops/admin/config/${encodeURIComponent(row.key)}?module=${encodeURIComponent(row.module)}`,
      { method: "DELETE" },
    );
    await load();
    ok.value = t("adminConfig.deleted", { key: row.key });
    // 删掉的正是当前编辑项时收起表单，避免对已不存在的 key 继续保存
    if (editingKey.value === row.key) closeForm();
  } catch (err) {
    await handleError(err, "adminConfig.deleteFailed");
  } finally {
    deletingKey.value = "";
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="card">
    <div class="head">
      <div>
        <h2>{{ t("adminConfig.title") }}</h2>
        <p class="hint">{{ t("adminConfig.hint") }}</p>
      </div>
      <button class="mini primary" :disabled="loading" @click="openCreate">{{ t("adminConfig.new") }}</button>
    </div>

    <p v-if="error" class="banner">{{ error }}</p>
    <p v-if="ok" class="ok">{{ ok }}</p>

    <!-- 新建 / 编辑表单：key 在编辑态只读（改 key 等于"删旧建新"，会悄悄留下孤儿配置） -->
    <div v-if="formOpen" class="form">
      <h3>{{ editingKey ? t("adminConfig.editTitle", { key: editingKey }) : t("adminConfig.createTitle") }}</h3>
      <div class="form-grid">
        <label class="field">
          <span class="label">{{ t("adminConfig.fKey") }}</span>
          <input
            v-model="form.key"
            class="input"
            :placeholder="t('adminConfig.fKeyPlaceholder')"
            maxlength="64"
            :disabled="editingKey !== null"
          />
        </label>
        <label class="field">
          <span class="label">{{ t("adminConfig.fModule") }}</span>
          <input
            v-model="form.module"
            class="input"
            :placeholder="t('adminConfig.fModulePlaceholder')"
            maxlength="64"
          />
        </label>
        <label class="field wide">
          <span class="label">{{ t("adminConfig.fDescription") }}</span>
          <input
            v-model="form.description"
            class="input"
            :placeholder="t('adminConfig.fDescriptionPlaceholder')"
            maxlength="500"
          />
        </label>
      </div>
      <label class="field">
        <span class="label">{{ t("adminConfig.fValue") }}</span>
        <textarea
          v-model="form.valueText"
          class="input mono value"
          rows="8"
          spellcheck="false"
          :disabled="editBusy"
        />
      </label>
      <p class="muted small">{{ t("adminConfig.valueHint") }}</p>
      <p v-if="formError" class="banner">{{ formError }}</p>
      <div class="form-actions">
        <button class="mini primary" :disabled="saving || editBusy" @click="save">
          {{ saving ? t("adminConfig.saving") : t("adminConfig.save") }}
        </button>
        <button class="mini" :disabled="saving" @click="closeForm">{{ t("adminConfig.cancel") }}</button>
        <span v-if="editBusy" class="muted">{{ t("adminConfig.loading") }}</span>
      </div>
    </div>

    <div class="filters">
      <input
        v-model="filters.q"
        class="input grow"
        :placeholder="t('adminConfig.fQPlaceholder')"
        :aria-label="t('adminConfig.fQ')"
        maxlength="64"
        @keyup.enter="applyFilters"
      />
      <input
        v-model="filters.module"
        class="input"
        :placeholder="t('adminConfig.fModuleFilterPlaceholder')"
        :aria-label="t('adminConfig.fModuleFilter')"
        maxlength="64"
        :disabled="filters.defaultOnly"
        @keyup.enter="applyFilters"
      />
      <label class="check" :title="t('adminConfig.fDefaultOnlyHint')">
        <input v-model="filters.defaultOnly" type="checkbox" />
        <span>{{ t("adminConfig.fDefaultOnly") }}</span>
      </label>
      <select
        v-model.number="pageSize"
        class="input narrow"
        :aria-label="t('adminConfig.pageSize')"
        @change="changePageSize"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <button class="mini" :disabled="loading" @click="applyFilters">{{ t("adminConfig.search") }}</button>
      <button class="mini" :disabled="loading" @click="resetFilters">{{ t("adminConfig.reset") }}</button>
    </div>

    <p v-if="loading" class="muted">{{ t("adminConfig.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted">{{ t("adminConfig.empty") }}</p>

    <template v-else>
      <div class="row head-row">
        <span>{{ t("adminConfig.colKey") }}</span>
        <span>{{ t("adminConfig.colModule") }}</span>
        <span>{{ t("adminConfig.colUpdated") }}</span>
        <span>{{ t("adminConfig.colValue") }}</span>
        <span>{{ t("adminConfig.colOps") }}</span>
      </div>
      <div v-for="row in rows" :key="row.key" class="row">
        <span class="mono ellipsis" :title="row.key">{{ row.key }}</span>
        <span class="muted ellipsis" :title="row.module">{{ row.module || "-" }}</span>
        <span class="muted">{{ formatTime(row.updated_at) }}</span>
        <span class="mono small ellipsis" :title="valueSummary(row.value)">{{ valueSummary(row.value) }}</span>
        <span class="ops">
          <button class="mini" :disabled="editBusy || deletingKey === row.key" @click="openEdit(row)">
            {{ t("adminConfig.edit") }}
          </button>
          <button class="mini danger" :disabled="deletingKey === row.key" @click="remove(row)">
            {{ deletingKey === row.key ? t("adminConfig.deleting") : t("adminConfig.delete") }}
          </button>
        </span>
      </div>
    </template>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">{{ t("adminConfig.prev") }}</button>
      <span class="muted small">
        {{ t("adminConfig.pageInfo", { page: page, pages: pages, total: total }) }}
      </span>
      <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">{{ t("adminConfig.next") }}</button>
    </div>
  </section>
</template>

<style scoped>
/* 风格对齐 pages/admin/index.vue 的 .card/.row/.mini/.input（scoped 复制，避免引全局新样式） */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
}
.hint {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}
.form {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 160px;
}
.field.wide {
  flex: 2;
}
.label {
  color: var(--text-3);
  font-size: 12px;
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
  width: 100%;
}
.filters .input {
  width: auto;
  min-width: 140px;
}
.filters .input.grow {
  flex: 1;
  min-width: 220px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.check input {
  accent-color: var(--brand-500);
}
.input.narrow {
  min-width: 72px;
  width: 72px;
}
.input.value {
  min-height: 150px;
  resize: vertical;
  line-height: 1.5;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) 90px 150px minmax(0, 1.6fr) 130px;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
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
.small {
  font-size: 11px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.banner {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-bg, rgba(255, 107, 107, 0.12));
  color: #ff6b6b;
  font-size: 12px;
}
.ok {
  margin: 0;
  color: #4ade80;
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
.mini.danger {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
