<script setup lang="ts">
/**
 * AI 标识审计面板（前端契约 §3.1 / API 契约 §2.4）。
 *
 * 数据源是 `tasks.results[].meta.ai_label`（worker `label.ts` 写入的 JSONB），
 * **不是第二套埋点表**：所以这里没有"回填/修正 AI 标识"的操作——
 * 标识在生成时写死，事后改只能改任务结果，那是另一件事（且会破坏审计意义）。
 * 面板的用途是回答"哪些成品没打上 AI 标识、打上的都写了什么"。
 *
 * 为什么把 from/to 默认留空：后端不传时间区间就是"全部成功任务"，
 * 运营第一次进来最想看的是"有没有漏标"，而不是"今天有没有漏标"。
 * 注意后端按 `finished_at desc` 最多取 5000 行再在内存里过滤/分页，所以
 * 区间越窄越准；`total` 是过滤后的总数，≥5000 时要意识到它可能是被截断的上限。
 */
import { adminApi, downloadAdminCsv, adminErrorCode } from "~/composables/useAdminApi";

interface AiLabelRow {
  task_id: string;
  space_id: string;
  model_id: string;
  model_name: string | null;
  mode: string;
  status: number;
  has_ai_label: boolean;
  /** 以下四项来自 ai_label JSONB；没有标签时全是 null（不是 false） */
  enabled: boolean | null;
  explicit: boolean | null;
  implicit: boolean | null;
  explicit_reason: string | null;
  result_count: number;
  finished_at: string | null;
  created_at: string;
}

interface AiLabelList {
  list: AiLabelRow[];
  total: number;
  page: number;
  page_size: number;
}

const { t } = useI18n();

const PAGE_SIZES = [20, 50, 100];

const rows = ref<AiLabelRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref("");
const exporting = ref(false);

/** 输入中的筛选条件 */
const form = reactive({ from: "", to: "", onlyMissing: false });
/** 已生效条件快照：翻页与导出都沿用它，保证"看到的"和"导出的"是同一口径 */
const applied = ref({ from: "", to: "", onlyMissing: false });

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

function shortId(id: string): string {
  if (!id) return "-";
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}

/** 三态布尔：null 是"没有标签/未写入"，与 false 的语义完全不同，必须分开显示 */
function boolText(value: boolean | null): string {
  if (value === null) return t("adminAiLabel.unknown");
  return value ? t("adminAiLabel.yes") : t("adminAiLabel.no");
}

/**
 * `<input type="datetime-local">` 给的是本地时区无秒无 Z 的字符串，
 * 直接交给服务端 `Date.parse` 会被当成本地时间甚至 400101，所以显式转 UTC ISO。
 */
function toIso(local: string): string | null {
  const raw = local.trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 列表与导出共用的过滤参数（不含分页） */
function filterQuery(): string {
  const parts: string[] = [];
  const fromIso = toIso(applied.value.from);
  const toIsoValue = toIso(applied.value.to);
  if (fromIso) parts.push(`from=${encodeURIComponent(fromIso)}`);
  if (toIsoValue) parts.push(`to=${encodeURIComponent(toIsoValue)}`);
  // 后端按 0/1 收（emptyToUndefined + 枚举），这里始终显式带 0/1 更省心
  parts.push(`only_missing=${applied.value.onlyMissing ? 1 : 0}`);
  return parts.join("&");
}

/**
 * 身份类错误：401101 回登录页；403/403101 就地提示（viewer 重登还是 viewer）。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  const code = adminErrorCode(err);
  if (code === 401101) {
    await adminLogout();
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (code === 403 || code === 403101) {
    error.value = t("adminAiLabel.needRole");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<AiLabelList>(
      `/ops/admin/ai-labels?${filterQuery()}&page=${page.value}&page_size=${pageSize.value}`,
    );
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    page.value = data.page ?? page.value;
  } catch (err) {
    await handleError(err, "adminAiLabel.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  // 时间填了却解析不出来时后端会 400101；前端给出明确文案，别让运营对着英文错误码猜
  if (form.from.trim() && !toIso(form.from)) {
    error.value = t("adminAiLabel.timeInvalid");
    return;
  }
  if (form.to.trim() && !toIso(form.to)) {
    error.value = t("adminAiLabel.timeInvalid");
    return;
  }
  applied.value = { from: form.from, to: form.to, onlyMissing: form.onlyMissing };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  form.from = "";
  form.to = "";
  form.onlyMissing = false;
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

/** 导出与当前筛选同口径（导出端不分页，后端上限 5000 行） */
async function exportCsv(): Promise<void> {
  exporting.value = true;
  error.value = "";
  try {
    await downloadAdminCsv(`/ops/admin/ai-labels.csv?${filterQuery()}`, "ai-labels.csv");
  } catch (err) {
    await handleError(err, "adminAiLabel.exportFailed");
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
    <header class="head">
      <h2>{{ t("adminAiLabel.title") }}</h2>
      <p class="muted small">{{ t("adminAiLabel.hint") }}</p>
    </header>

    <div class="filters">
      <label class="field">
        <span class="label">{{ t("adminAiLabel.fFrom") }}</span>
        <input v-model="form.from" class="input" type="datetime-local" />
      </label>
      <label class="field">
        <span class="label">{{ t("adminAiLabel.fTo") }}</span>
        <input v-model="form.to" class="input" type="datetime-local" />
      </label>
      <label class="check">
        <input v-model="form.onlyMissing" type="checkbox" />
        <span>{{ t("adminAiLabel.fOnlyMissing") }}</span>
      </label>
      <select
        v-model.number="pageSize"
        class="input narrow"
        :aria-label="t('adminAiLabel.pageSize')"
        @change="changePageSize"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <button class="mini primary" :disabled="loading" @click="applyFilters">{{ t("adminAiLabel.search") }}</button>
      <button class="mini" :disabled="loading" @click="resetFilters">{{ t("adminAiLabel.reset") }}</button>
      <button class="mini" :disabled="exporting" @click="exportCsv">
        {{ exporting ? t("adminAiLabel.exporting") : t("adminAiLabel.export") }}
      </button>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>

    <p v-if="loading" class="muted small">{{ t("adminAiLabel.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted small">{{ t("adminAiLabel.empty") }}</p>

    <div v-else class="table-scroll">
      <div class="table-inner">
        <div class="row head-row">
          <span>{{ t("adminAiLabel.colTask") }}</span>
          <span>{{ t("adminAiLabel.colModel") }}</span>
          <span>{{ t("adminAiLabel.colMode") }}</span>
          <span>{{ t("adminAiLabel.colHasLabel") }}</span>
          <span>{{ t("adminAiLabel.colExplicit") }}</span>
          <span>{{ t("adminAiLabel.colImplicit") }}</span>
          <span>{{ t("adminAiLabel.colEnabled") }}</span>
          <span>{{ t("adminAiLabel.colReason") }}</span>
          <span>{{ t("adminAiLabel.colResults") }}</span>
          <span>{{ t("adminAiLabel.colFinished") }}</span>
        </div>

        <div v-for="row in rows" :key="row.task_id" class="row">
          <span class="mono ellipsis" :title="row.task_id">{{ shortId(row.task_id) }}</span>
          <span class="ellipsis" :title="row.model_name || row.model_id">
            {{ row.model_name || row.model_id || "-" }}
          </span>
          <span class="mono ellipsis" :title="row.mode">{{ row.mode || "-" }}</span>
          <span :class="row.has_ai_label ? 'state-on' : 'state-warn'">
            {{ row.has_ai_label ? t("adminAiLabel.yes") : t("adminAiLabel.missing") }}
          </span>
          <span :class="row.explicit === null ? 'muted' : ''">{{ boolText(row.explicit) }}</span>
          <span :class="row.implicit === null ? 'muted' : ''">{{ boolText(row.implicit) }}</span>
          <span :class="row.enabled === null ? 'muted' : ''">{{ boolText(row.enabled) }}</span>
          <span class="muted ellipsis" :title="row.explicit_reason || ''">{{ row.explicit_reason || "-" }}</span>
          <span class="muted">{{ row.result_count }}</span>
          <span class="muted">{{ formatTime(row.finished_at) }}</span>
        </div>
      </div>
    </div>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">{{ t("adminAiLabel.prev") }}</button>
      <span class="muted small">
        {{ t("adminAiLabel.pageInfo", { page: page, pages: pages, total: total }) }}
      </span>
      <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">{{ t("adminAiLabel.next") }}</button>
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
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  padding-bottom: 7px;
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
.table-scroll {
  overflow-x: auto;
}
.table-inner {
  /* 10 列在窄屏必然挤：给最小宽度 + 横向滚动，比压缩到看不清更有用 */
  min-width: 1080px;
}
.row {
  display: grid;
  grid-template-columns:
    minmax(88px, 0.7fr) minmax(110px, 1fr) minmax(70px, 0.6fr) 84px
    72px 72px 72px minmax(150px, 1.4fr) 72px minmax(130px, 1fr);
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
.state-warn {
  color: #ffb02e;
  font-size: 12px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
