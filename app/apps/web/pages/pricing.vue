<script setup lang="ts">
// 定价/充值页：SKU 目录来自后端，支持下单→支付→轮询入账（PRD §10）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "定价 · 一帧" });

interface SkuDto {
  id: string;
  sku: string;
  kind: string;
  label: string;
  price_cents: number;
  credits: number;
  cents_per_credit: number | null;
}

interface OrderDto {
  order_id: string;
  sku: string;
  amount_cents: number;
  credits: number;
  channel: string;
  status: number;
  status_label: string;
  pay_token: string | null;
  paid_at: string | null;
  expires_at: string;
}

const api = useApi();
const toast = useToast();

const skus = ref<SkuDto[]>([]);
const balance = ref<number | null>(null);
const loading = ref(true);
const error = ref("");

const paying = ref("");
const activeOrder = ref<OrderDto | null>(null);
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);
const pollCount = ref(0);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [list, me] = await Promise.all([
      api.get<SkuDto[]>("/billing/skus"),
      api.get<{ credits: { balance: number } }>("/me"),
    ]);
    skus.value = list;
    balance.value = me.credits.balance;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function buy(sku: SkuDto): Promise<void> {
  paying.value = sku.sku;
  error.value = "";
  try {
    const order = await api.post<OrderDto>("/billing/orders", { sku: sku.sku, channel: "mock" });
    activeOrder.value = order;
    toast.info(`订单已创建：${(order.amount_cents / 100).toFixed(2)} 元 / ${order.credits} 积分`);

    const paid = await api.post<{ credited: boolean; credits: number }>(
      `/billing/orders/${order.order_id}/mock-pay`,
      {},
    );
    if (paid.credited) {
      toast.success(`充值成功，+${paid.credits} 积分`);
      activeOrder.value = null;
      await load();
    } else {
      startPoll(order.order_id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "下单失败";
    error.value = msg;
    toast.error(msg);
  } finally {
    paying.value = "";
  }
}

function startPoll(orderId: string): void {
  stopPoll();
  pollCount.value = 0;
  pollTimer.value = setInterval(async () => {
    pollCount.value += 1;
    try {
      const o = await api.get<OrderDto>(`/billing/orders/${orderId}`);
      activeOrder.value = o;
      if (o.status === 2) {
        stopPoll();
        toast.success(`充值成功，+${o.credits} 积分`);
        activeOrder.value = null;
        await load();
      } else if (o.status === 3) {
        stopPoll();
        toast.error("订单已关闭");
        activeOrder.value = null;
      }
    } catch {
      /* 忽略单次失败 */
    }
    if (pollCount.value >= 60) stopPoll();
  }, 3000);
}

function stopPoll(): void {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

async function closeOrder(): Promise<void> {
  if (!activeOrder.value) return;
  try {
    await api.post(`/billing/orders/${activeOrder.value.order_id}/close`, {});
    toast.info("订单已关闭");
    activeOrder.value = null;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "关闭失败");
  } finally {
    stopPoll();
  }
}

const yuan = (cents: number): string => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

onMounted(load);
onUnmounted(stopPoll);
</script>

<template>
  <div class="pricing">
    <header class="head">
      <div>
        <h1>价格透明，按量计费</h1>
        <p class="sub">
          10 积分 = 1 元 · 文生视频 5s/720p 低至 8 积分（0.8 元）· 失败与取消不扣积分
        </p>
      </div>
      <div v-if="balance !== null" class="balance-chip">
        当前余额 <b>{{ balance }}</b> 积分
      </div>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" />

    <template v-else>
      <div v-if="skus.length" class="cards">
        <article v-for="s in skus" :key="s.sku" class="card">
          <div class="card-top">
            <p class="label">{{ s.label }}</p>
            <Tag v-if="s.cents_per_credit !== null" tone="neutral" size="sm">
              ¥{{ s.cents_per_credit }}/积分
            </Tag>
          </div>
          <p class="price">
            <span class="cur">¥</span>{{ yuan(s.price_cents) }}
          </p>
          <p class="credits">{{ s.credits }} 积分</p>
          <p class="unit">
            约合 {{ Math.floor(s.credits / 8) }} 条 5s 视频（8 积分/条）
          </p>
          <Button block :loading="paying === s.sku" :disabled="!!paying" @click="buy(s)">
            {{ paying === s.sku ? "处理中" : "立即购买" }}
          </Button>
        </article>
      </div>

      <EmptyState
        v-else
        icon="◇"
        title="暂无可购买的套餐"
        description="运营尚未配置 SKU，请联系管理员或稍后再试。"
      />

      <div v-if="activeOrder" class="pending">
        <div>
          <p class="p-title">订单待支付</p>
          <p class="p-meta">
            订单 {{ activeOrder.order_id.slice(-10) }} · ¥{{ yuan(activeOrder.amount_cents) }} ·
            {{ activeOrder.credits }} 积分
          </p>
        </div>
        <div class="p-ops">
          <span class="p-poll">正在确认支付结果…（{{ pollCount }}/60）</span>
          <Button size="sm" variant="text" @click="closeOrder">关闭订单</Button>
        </div>
      </div>

      <section class="notes">
        <h3>计费说明</h3>
        <ul>
          <li>创建任务时按报价冻结积分，成功结算、失败或取消自动解冻；</li>
          <li>价格由运营在后台热更，下单时冻结价格快照，调价不影响已下单订单；</li>
          <li>当前为联调模式（mock 渠道）；真实微信/支付宝需配置商户号后开启 PAYMENT_LIVE。</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pricing {
  max-width: 1120px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
}
.sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.balance-chip {
  flex-shrink: 0;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: var(--brand-50);
  color: var(--brand-700);
  border: 1px solid var(--brand-200);
  font-size: var(--text-sm);
}
.balance-chip b {
  font-variant-numeric: tabular-nums;
}

.err {
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: var(--space-4);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.card:hover {
  border-color: var(--brand-300);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}
.label {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}
.price {
  margin: 0 0 var(--space-1);
  font-size: var(--text-4xl);
  font-weight: 700;
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.cur {
  font-size: var(--text-lg);
  font-weight: 600;
  margin-right: 2px;
  color: var(--text-3);
}
.credits {
  margin: 0 0 var(--space-2);
  color: var(--brand-600);
  font-size: var(--text-base);
  font-weight: 600;
}
.unit {
  margin: 0 0 var(--space-4);
  color: var(--text-4);
  font-size: var(--text-xs);
  flex: 1;
}

.pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-top: var(--space-5);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--brand-200);
  border-radius: var(--radius-lg);
  background: var(--brand-50);
}
.p-title {
  margin: 0 0 2px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--brand-700);
}
.p-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.p-ops {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.p-poll {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.notes {
  margin-top: var(--space-8);
  padding: var(--space-5);
  background: var(--bg-sunken);
  border-radius: var(--radius-lg);
}
.notes h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}
.notes ul {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.9;
}
</style>
