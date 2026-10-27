<script setup lang="ts">
/**
 * 创作者收益页（模块 #10 · 竞品 `/creator-center/earnings`，`rea-reelmate/routes.txt:45`）。
 *
 * 三条业务事实决定了这一页的形态：
 * 1. **收益不是积分余额**（竞品 `d-commerce-account.md:415-417`："提现按作品维度而非账户余额，
 *    说明收益是分作品分账"）。所以这里显示的是"可提现收益"，与顶栏积分**无关**，
 *    页头必须写清，否则用户会以为赚的钱能直接当积分花。
 * 2. **提现走人工审核 + 渠道打款**（`settlement_note`），状态机 1 待审 → 2 已通过 → 3 已打款 /
 *    4 驳回 / 5 已撤销。前端不做任何余额扣减，只提交申请并回读服务端状态。
 * 3. **同一用户同时只允许 1 笔待审**（服务端 advisory 锁保证）：有待审时"申请提现"按钮置灰，
 *    并提示先去撤销或等待审核——避免用户反复点、以为系统吞了请求。
 *
 * 所有金额来自后端（`available_credits` / `min_withdraw_credits`），前端不复算可提现额度：
 * 抽成比例、锁定额度都会变，前端算一份必然与后端不一致（客诉来源）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t, locale } = useI18n();
useHead({ title: () => t("earnings.metaTitle") });

const api = useApi();
const toast = useToast();

interface OverviewDto {
  revenue_credits: number;
  total_sales: number;
  commission_bps: number;
  available_credits: number;
  locked_credits: number;
  paid_credits: number;
  min_withdraw_credits: number;
  settlement_note: string;
}

interface RevenueRow {
  id?: string;
  work_id?: string;
  work_title?: string;
  amount_credits?: number;
  status?: number;
  status_name?: string;
  created_at?: string;
}

interface WithdrawalRow {
  id: string;
  amount_credits: number;
  status: number;
  status_name?: string;
  channel?: string;
  review_note?: string | null;
  created_at?: string;
  paid_at?: string | null;
}

interface Page<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}

const overview = ref<OverviewDto | null>(null);
const revenues = ref<RevenueRow[]>([]);
const withdrawals = ref<WithdrawalRow[]>([]);
const loading = ref(true);
const submitting = ref(false);
const error = ref("");

/** 提现表单 */
const form = reactive({
  amount: 0,
  channel: "alipay",
  account: "",
  holder: "",
});
const amountError = ref("");

const revenueTotal = computed(() => revenues.value.length);
const pendingWithdrawals = computed(() => withdrawals.value.filter((row) => row.status === 1));
const canApply = computed(
  () =>
    !!overview.value &&
    pendingWithdrawals.value.length === 0 &&
    form.amount > 0 &&
    form.amount <= (overview.value?.available_credits ?? 0),
);

const money = (credits: number): string =>
  t("earnings.creditUnit", { value: Number(credits ?? 0).toLocaleString(locale.value) });
const pct = (bps: number): string => `${(Number(bps ?? 0) / 100).toFixed(2)}%`;
const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString(locale.value) : "—";

// 状态文案走 i18n（computed：常量在 setup 期固化，切语言不更新）
const WITHDRAW_STATUS = computed<Record<number, string>>(() => ({
  1: t("earnings.statusPending"),
  2: t("earnings.statusApproved"),
  3: t("earnings.statusPaid"),
  4: t("earnings.statusRejected"),
  5: t("earnings.statusCancelled"),
}));

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [ov, rev, wd] = await Promise.all([
      api.get<OverviewDto>("/market/creator/revenues/overview"),
      api.get<Page<RevenueRow>>("/market/creator/revenues?page=1&page_size=20"),
      api.get<Page<WithdrawalRow>>("/market/creator/withdrawals?page=1&page_size=20"),
    ]);
    overview.value = ov;
    revenues.value = rev.list ?? [];
    withdrawals.value = wd.list ?? [];
    if (form.amount === 0 && ov.available_credits > 0) {
      form.amount = Math.max(ov.min_withdraw_credits, Math.min(ov.available_credits, ov.min_withdraw_credits));
    }
  } catch (err) {
    error.value = (err as Error).message || t("earnings.loadFailed");
  } finally {
    loading.value = false;
  }
}

function validateAmount(): boolean {
  amountError.value = "";
  const ov = overview.value;
  if (!ov) return false;
  if (!Number.isFinite(form.amount) || form.amount <= 0) {
    amountError.value = t("earnings.amountRequired");
    return false;
  }
  if (form.amount < ov.min_withdraw_credits) {
    amountError.value = t("earnings.amountTooLow", { min: ov.min_withdraw_credits });
    return false;
  }
  if (form.amount > ov.available_credits) {
    amountError.value = t("earnings.amountTooHigh", { max: ov.available_credits });
    return false;
  }
  return true;
}

async function applyWithdraw(): Promise<void> {
  if (!validateAmount()) return;
  if (!form.account.trim()) {
    amountError.value = t("earnings.accountRequired");
    return;
  }
  submitting.value = true;
  try {
    await api.post("/market/creator/withdraw", {
      amount_credits: Math.floor(form.amount),
      channel: form.channel,
      account_info: {
        account: form.account.trim(),
        holder: form.holder.trim() || undefined,
      },
    });
    toast.success(t("earnings.submitted"));
    form.amount = 0;
    form.account = "";
    form.holder = "";
    await load();
  } catch (err) {
    // 服务端错误码原样展示（例如"已有待审提现"），前端不猜测、不改写
    amountError.value = (err as Error).message || t("earnings.submitFailed");
  } finally {
    submitting.value = false;
  }
}

async function cancelWithdrawal(row: WithdrawalRow): Promise<void> {
  if (!window.confirm(t("earnings.revokeConfirm", { amount: row.amount_credits }))) return;
  try {
    await api.post(`/market/creator/withdrawals/${row.id}/cancel`, {});
    toast.success(t("earnings.revoked"));
    await load();
  } catch (err) {
    toast.error((err as Error).message || t("earnings.revokeFailed"));
  }
}

onMounted(load);
</script>

<template>
  <div class="earn">
    <header class="head">
      <div>
        <h1>{{ t("earnings.title") }}</h1>
        <p class="muted">{{ t("earnings.sub") }}</p>
      </div>
      <NuxtLink to="/creator-center" class="link">{{ t("earnings.backToCenter") }}</NuxtLink>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="loading" class="muted">{{ t("earnings.loading") }}</p>

    <template v-else-if="overview">
      <!-- 总览：全部数字来自后端 -->
      <section class="cards">
        <article class="card">
          <p class="k">{{ t("earnings.kRevenue") }}</p>
          <p class="v">{{ money(overview.revenue_credits) }}</p>
          <p class="s">{{ t("earnings.salesLine", { count: overview.total_sales, pct: pct(overview.commission_bps) }) }}</p>
        </article>
        <article class="card strong">
          <p class="k">{{ t("earnings.kAvailable") }}</p>
          <p class="v">{{ money(overview.available_credits) }}</p>
          <p class="s">{{ t("earnings.availableHint") }}</p>
        </article>
        <article class="card">
          <p class="k">{{ t("earnings.kLocked") }}</p>
          <p class="v">{{ money(overview.locked_credits) }}</p>
          <p class="s">{{ t("earnings.paidLine", { amount: money(overview.paid_credits) }) }}</p>
        </article>
      </section>

      <p class="note">{{ overview.settlement_note }}</p>

      <!-- 提现申请 -->
      <section class="panel">
        <div class="panel-head">
          <h2>{{ t("earnings.applyTitle") }}</h2>
          <span v-if="pendingWithdrawals.length" class="warn">{{ t("earnings.pendingWarn") }}</span>
        </div>
        <div class="form">
          <label class="field">
            <span>{{ t("earnings.amountLabel") }}</span>
            <input
              v-model.number="form.amount"
              type="number"
              :min="overview.min_withdraw_credits"
              :max="overview.available_credits"
              step="1"
            />
            <small class="muted">{{ t("earnings.amountHint", { min: overview.min_withdraw_credits, max: overview.available_credits }) }}</small>
          </label>
          <label class="field">
            <span>{{ t("earnings.channelLabel") }}</span>
            <select v-model="form.channel">
              <option value="alipay">{{ t("earnings.channelAlipay") }}</option>
              <option value="wechat">{{ t("earnings.channelWechat") }}</option>
              <option value="bank">{{ t("earnings.channelBank") }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ t("earnings.accountLabel") }}</span>
            <input v-model="form.account" :placeholder="t('earnings.accountPlaceholder')" maxlength="120" />
          </label>
          <label class="field">
            <span>{{ t("earnings.holderLabel") }}</span>
            <input v-model="form.holder" :placeholder="t('earnings.holderPlaceholder')" maxlength="60" />
          </label>
        </div>
        <p v-if="amountError" class="err small">{{ amountError }}</p>
        <div class="row">
          <button
            type="button"
            class="btn primary"
            :disabled="submitting || !canApply"
            @click="applyWithdraw"
          >
            {{ submitting ? t("earnings.submitting") : t("earnings.submitWithdraw") }}
          </button>
          <span class="muted small">{{ t("earnings.submitHint") }}</span>
        </div>
      </section>

      <!-- 提现记录 -->
      <section class="panel">
        <h2>{{ t("earnings.recordsTitle") }}</h2>
        <table v-if="withdrawals.length" class="table">
          <thead>
            <tr><th>{{ t("earnings.thAmount") }}</th><th>{{ t("earnings.thChannel") }}</th><th>{{ t("earnings.thStatus") }}</th><th>{{ t("earnings.thSubmittedAt") }}</th><th>{{ t("earnings.thNote") }}</th><th>{{ t("earnings.thOps") }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in withdrawals" :key="row.id">
              <td>{{ money(row.amount_credits) }}</td>
              <td>{{ row.channel ?? "—" }}</td>
              <td>
                <span class="tag" :class="`tag-${row.status}`">
                  {{ row.status_name ?? WITHDRAW_STATUS[row.status] ?? row.status }}
                </span>
              </td>
              <td>{{ fmtTime(row.created_at) }}</td>
              <td class="muted">{{ row.review_note || "—" }}</td>
              <td>
                <button
                  v-if="row.status === 1"
                  type="button"
                  class="btn tiny ghost"
                  @click="cancelWithdrawal(row)"
                >
                  {{ t("earnings.revoke") }}
                </button>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">{{ t("earnings.recordsEmpty") }}</p>
      </section>

      <!-- 收益明细 -->
      <section class="panel">
        <h2>{{ t("earnings.revenueTitle") }}</h2>
        <table v-if="revenues.length" class="table">
          <thead>
            <tr><th>{{ t("earnings.thWork") }}</th><th>{{ t("earnings.thAmount") }}</th><th>{{ t("earnings.thStatus") }}</th><th>{{ t("earnings.thTime") }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in revenues" :key="row.id ?? index">
              <td>{{ row.work_title ?? row.work_id ?? "—" }}</td>
              <td>{{ money(row.amount_credits ?? 0) }}</td>
              <td>{{ row.status_name ?? row.status ?? "—" }}</td>
              <td>{{ fmtTime(row.created_at) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">{{ t("earnings.revenueEmpty") }}</p>
        <p class="muted small">{{ t("earnings.revenueTotal", { count: revenueTotal }) }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.earn {
  max-width: 1040px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.head p {
  margin: 0;
  max-width: 620px;
  line-height: 1.6;
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  background: var(--bg-sunken);
}
.card.strong {
  border-color: var(--brand-1);
}
.card .k {
  margin: 0 0 6px;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.card .v {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
}
.card .s {
  margin: 6px 0 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.note {
  margin: 0 0 var(--space-4);
  color: var(--text-3);
  font-size: var(--text-sm);
}
.panel {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
  background: var(--bg-sunken);
}
.panel h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-md);
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.warn {
  color: #f0a020;
  font-size: var(--text-xs);
}
.form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-sm);
}
.field input,
.field select {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
  font: inherit;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  font: inherit;
}
.btn.primary {
  background: var(--brand-1);
  border-color: transparent;
  color: #fff;
}
.btn.tiny {
  padding: 4px 10px;
  font-size: var(--text-xs);
}
.btn.ghost {
  color: var(--text-2);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.table th,
.table td {
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border-1);
}
.tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--text-xs);
  background: var(--bg-app);
}
.tag-1 {
  color: #f0a020;
}
.tag-2,
.tag-3 {
  color: #42d392;
}
.tag-4,
.tag-5 {
  color: var(--text-3);
}
.err {
  color: #ff6b6b;
  font-size: var(--text-sm);
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
