<script setup lang="ts">
/**
 * 订阅档位面板（模块 #23 计费/订阅的"界面"维度补齐）。
 *
 * 背景：后端的 13 档订阅（`GET /billing/plans`、`/billing/subscribe`、`/billing/sku-price`、
 * `/billing/subscription`、`/billing/subscription/cancel`）在第 1 轮已落地并有 12 例契约测试，
 * 但定价页仍只有"积分充值包"——**有端点没界面等于没有**，所以这里按同一份
 * `plans` 数据渲染，不在前端写死档位与价格（价格变更由运营热更，前端只负责展示与下单）。
 *
 * 三条实现判断：
 * 1. **按"产品线 × 周期"两维展示**：13 档平铺会让用户看不出"同一档位年付更便宜"，
 *    分组后同组内切周期即可比价。
 * 2. **活动价来自后端**：`sku-price` 的折扣逻辑（限时/首购/立减）不在前端复刻，
 *    否则运营改活动后前端算出的价格与订单金额会不一致（客诉来源）。
 * 3. **mock 渠道立即模拟支付**：本地/联调环境 `PAYMENT_LIVE=false`，走 `/mock-pay`；
 *    真实渠道把 `pay_params` 里的跳转/二维码交给页面处理（与积分包购买同一套）。
 */
defineProps<{ compact?: boolean }>();

interface PlanDto {
  id: string;
  sku: string;
  label: string;
  period: string | null;
  credits: number;
  list_price_cents: number;
  price_cents: number;
  promotion_label: string | null;
}

interface SubscriptionDto {
  sku: string;
  start_at: string;
  end_at: string;
  auto_renew: boolean;
  days_left: number;
}

interface OrderDto {
  order_id: string;
  status: number;
  amount_cents: number;
  sku: string;
  pay_params?: {
    code_url?: string;
    h5_url?: string;
    qr_code?: string;
    pay_url?: string;
  } | null;
}

const api = useApi();
const toast = useToast();
// i18n（第 8 批）：本组件文案跟随全站语言；档位/价格/活动标签仍全部来自后端（前端不复刻折扣）
const { t } = useI18n();

const plans = ref<PlanDto[]>([]);
const subscription = ref<SubscriptionDto | null>(null);
const loading = ref(true);
const error = ref("");
const busySku = ref("");
const livePayment = ref(false);

/** 周期展示名（后端 period 取值：month/quarter/halfyear/year，未知值原样展示） */
const periodLabel = (period: string | null): string => {
  switch (period) {
    case "month":
      return t("billing.periodMonth");
    case "quarter":
      return t("billing.periodQuarter");
    case "halfyear":
      return t("billing.periodHalfYear");
    case "year":
      return t("billing.periodYear");
    default:
      return period ?? "";
  }
};
const PERIOD_ORDER = ["month", "quarter", "halfyear", "year"];

/** 产品线：sku 前缀（vip / df-vip / pro / studio）→ 展示名 */
const lineLabel = (line: string): string => {
  switch (line) {
    case "vip":
      return t("billing.lineVip");
    case "df-vip":
      return t("billing.lineDfVip");
    case "pro":
      return t("billing.linePro");
    case "studio":
      return t("billing.lineStudio");
    default:
      return line;
  }
};

const lineOf = (sku: string): string => {
  // `df-vip-month` → `df-vip`（产品线是前缀，周期是最后一个 `-` 之后）
  const parts = sku.split("-");
  parts.pop();
  return parts.join("-");
};

const groups = computed(() => {
  const map = new Map<string, PlanDto[]>();
  for (const plan of plans.value) {
    const line = lineOf(plan.sku);
    const list = map.get(line) ?? [];
    list.push(plan);
    map.set(line, list);
  }
  return [...map.entries()].map(([line, list]) => ({
    line,
    label: lineLabel(line),
    plans: [...list].sort(
      (a, b) => PERIOD_ORDER.indexOf(a.period ?? "") - PERIOD_ORDER.indexOf(b.period ?? ""),
    ),
  }));
});

const selectedPeriod = ref<Record<string, string>>({});

const periodOfGroup = (line: string): string => {
  const chosen = selectedPeriod.value[line];
  if (chosen) return chosen;
  // 默认选"年付"（竞品默认引导年付：单位月价最低），没有则选第一档
  const list = groups.value.find((g) => g.line === line)?.plans ?? [];
  return (list.find((p) => p.period === "year") ?? list[0])?.period ?? "";
};

const activePlan = (line: string): PlanDto | undefined => {
  const list = groups.value.find((g) => g.line === line)?.plans ?? [];
  const period = periodOfGroup(line);
  return list.find((p) => p.period === period) ?? list[0];
};

const money = (cents: number): string => `¥${(cents / 100).toFixed(2)}`;
/** 单位月价：跨周期比价用（年付 ÷ 12），四舍五入到分 */
const perMonth = (plan: PlanDto): string => {
  const months = { month: 1, quarter: 3, halfyear: 6, year: 12 }[plan.period ?? "month"] ?? 1;
  return money(Math.round(plan.price_cents / months));
};

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [plansRes, subRes, channelsRes] = await Promise.all([
      api.get<{ plans: PlanDto[] }>("/billing/plans"),
      api.get<SubscriptionDto | null>("/billing/subscription"),
      api.get<{ live: boolean }>("/billing/channels"),
    ]);
    plans.value = plansRes.plans ?? [];
    subscription.value = subRes ?? null;
    livePayment.value = Boolean(channelsRes?.live);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("billing.loadFailed");
  } finally {
    loading.value = false;
  }
}

/** 下单 → （mock 渠道）立即模拟支付 → 轮询订单终态 → 刷新订阅态 */
async function subscribe(line: string): Promise<void> {
  const plan = activePlan(line);
  if (!plan || busySku.value) return;
  busySku.value = plan.sku;
  try {
    const order = await api.post<OrderDto>("/billing/subscribe", {
      sku: plan.sku,
      channel: livePayment.value ? "wechat" : "mock",
    });
    if (!livePayment.value) {
      await api.post(`/billing/orders/${order.order_id}/mock-pay`, {});
    }
    // 支付回调可能异步到达：轮询到 paid(2) 或超时（10 × 800ms）
    for (let i = 0; i < 10; i += 1) {
      const detail = await api.get<{ status: number }>(`/billing/orders/${order.order_id}`);
      if (detail.status === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const sub = await api.get<SubscriptionDto | null>("/billing/subscription");
    subscription.value = sub ?? null;
    if (sub) {
      toast.success(t("billing.subscribed", { period: periodLabel(plan.period) }));
    } else {
      toast.error(t("billing.subscribeDelay"));
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t("billing.subscribeFailed"));
  } finally {
    busySku.value = "";
  }
}

async function cancel(): Promise<void> {
  try {
    await api.post("/billing/subscription/cancel", {});
    subscription.value = subscription.value
      ? { ...subscription.value, auto_renew: false }
      : subscription.value;
    toast.success(t("billing.cancelled"));
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t("billing.cancelFailed"));
  }
}

const fmtDate = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

onMounted(() => void load());
</script>

<template>
  <section class="sub-wrap" :class="{ compact }">
    <header class="sub-head">
      <div>
        <h2>{{ t("billing.title") }}</h2>
        <p class="sub-tip">
          {{ t("billing.tip") }}
        </p>
      </div>
      <div v-if="subscription" class="sub-active">
        <span class="badge">{{ t("billing.active") }}</span>
        <span class="sub-active-text">
          {{ t("billing.activeMeta", { sku: subscription.sku, days: subscription.days_left, date: fmtDate(subscription.end_at) }) }}
        </span>
        <button v-if="subscription.auto_renew" class="btn ghost" @click="cancel">{{ t("billing.cancelAutoRenew") }}</button>
        <span v-else class="muted">{{ t("billing.autoRenewOff") }}</span>
      </div>
    </header>

    <p v-if="error" class="sub-error">{{ error }}</p>
    <p v-else-if="loading" class="muted">{{ t("billing.loading") }}</p>
    <p v-else-if="groups.length === 0" class="muted">
      {{ t("billing.empty") }}
    </p>

    <div v-else class="sub-grid">
      <article v-for="group in groups" :key="group.line" class="sub-card">
        <div class="sub-card-head">
          <h3>{{ group.label }}</h3>
          <div class="periods">
            <button
              v-for="plan in group.plans"
              :key="plan.sku"
              class="period"
              :class="{ on: (plan.period ?? '') === periodOfGroup(group.line) }"
              @click="selectedPeriod[group.line] = plan.period ?? ''"
            >
              {{ periodLabel(plan.period) }}
            </button>
          </div>
        </div>

        <template v-if="activePlan(group.line)">
          <p class="sub-price">
            <span class="now">{{ money(activePlan(group.line)!.price_cents) }}</span>
            <span v-if="activePlan(group.line)!.price_cents !== activePlan(group.line)!.list_price_cents" class="list">
              {{ money(activePlan(group.line)!.list_price_cents) }}
            </span>
            <span class="unit">{{ t("billing.perMonth", { price: perMonth(activePlan(group.line)!) }) }}</span>
          </p>
          <p v-if="activePlan(group.line)!.promotion_label" class="promo">
            {{ activePlan(group.line)!.promotion_label }}
          </p>
          <p class="credits">{{ t("billing.creditsPerMonth", { count: activePlan(group.line)!.credits }) }}</p>
          <button class="btn primary" :disabled="busySku === activePlan(group.line)!.sku" @click="subscribe(group.line)">
            {{ busySku === activePlan(group.line)!.sku ? t("billing.subscribing") : t("billing.subscribe") }}
          </button>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sub-wrap {
  margin-top: 28px;
  padding: 22px;
  border: 1px solid var(--border-1);
  border-radius: 16px;
  background: var(--bg-card, rgba(255, 255, 255, 0.02));
}
.sub-head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}
.sub-head h2 {
  margin: 0 0 6px;
  font-size: 18px;
}
.sub-tip {
  margin: 0;
  max-width: 560px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.6;
}
.sub-active {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  flex-wrap: wrap;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(66, 211, 146, 0.15);
  color: #42d392;
  font-size: 12px;
}
.sub-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-top: 18px;
}
.sub-card {
  padding: 16px;
  border: 1px solid var(--border-1);
  border-radius: 14px;
  background: var(--bg-app);
}
.sub-card-head h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
.periods {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.period {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.period.on {
  border-color: var(--brand-1, #6d5efc);
  color: var(--text-1);
}
.sub-price {
  margin: 14px 0 4px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.sub-price .now {
  font-size: 24px;
  font-weight: 700;
}
.sub-price .list {
  color: var(--text-3);
  text-decoration: line-through;
  font-size: 13px;
}
.sub-price .unit {
  color: var(--text-2);
  font-size: 12px;
}
.promo {
  margin: 0;
  font-size: 12px;
  color: #f0a020;
}
.credits {
  margin: 6px 0 14px;
  font-size: 12px;
  color: var(--text-2);
}
.btn {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.btn.primary {
  background: var(--brand-1, #6d5efc);
  border-color: transparent;
  color: #fff;
}
.btn.ghost {
  width: auto;
  padding: 5px 10px;
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.muted {
  color: var(--text-3);
  font-size: 13px;
}
.sub-error {
  color: #ff6b6b;
  font-size: 13px;
}
</style>
