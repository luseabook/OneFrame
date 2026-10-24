<script setup lang="ts">
// 定价/充值页：SKU 目录来自后端，支持下单→支付→轮询入账（PRD §10）
// 支付渠道：mock（联调一键模拟）/ 微信 APIv3（Native 二维码、H5 跳转）/ 支付宝（收银台跳转、扫码）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "定价 · 一帧" });

import { toDataURL } from "qrcode";

interface SkuDto {
  id: string;
  sku: string;
  kind: string;
  label: string;
  price_cents: number;
  credits: number;
  cents_per_credit: number | null;
}

interface PayParams {
  channel?: string;
  mode?: string;
  out_trade_no?: string;
  amount_cents?: number;
  /** 微信 Native：二维码内容 */
  code_url?: string;
  /** 微信 H5：跳转地址 */
  h5_url?: string;
  /** 支付宝 precreate：二维码内容 */
  qr_code?: string;
  /** 支付宝 page.pay：收银台地址 */
  pay_url?: string;
  prepay_id?: string;
  pay_sign?: Record<string, string>;
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
  pay_params: PayParams | null;
  paid_at: string | null;
  expires_at: string;
}

interface ChannelDto {
  channel: string;
  configured: boolean;
  modes: string[];
  missing?: string[];
  reason?: string;
}

interface ChannelsDto {
  live: boolean;
  channels: ChannelDto[];
}

const api = useApi();
const toast = useToast();

const skus = ref<SkuDto[]>([]);
const balance = ref<number | null>(null);
const loading = ref(true);
const error = ref("");

const live = ref(false);
const channels = ref<ChannelDto[]>([]);
const selectedChannel = ref("mock");

const paying = ref("");
const activeOrder = ref<OrderDto | null>(null);
const qrDataUrl = ref("");
const payLink = ref("");
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);
const pollCount = ref(0);

const isMobile = ref(false);

const channelOptions = computed(() =>
  channels.value.map((c) => ({
    id: c.channel,
    label: c.channel === "mock" ? "模拟支付（联调）" : c.channel === "wechat" ? "微信支付" : "支付宝",
    enabled: c.configured,
    hint: c.configured ? "" : c.reason || (c.missing?.length ? `缺少 ${c.missing.join(", ")}` : "暂不可用"),
    modes: c.modes,
  })),
);

const selectedChannelMeta = computed(() => channelOptions.value.find((c) => c.id === selectedChannel.value));

/** 渠道默认支付形态：移动端微信优先 H5，桌面端扫码；支付宝桌面走收银台跳转 */
function resolveMode(): string | undefined {
  if (selectedChannel.value === "wechat") {
    const modes = selectedChannelMeta.value?.modes ?? [];
    return isMobile.value && modes.includes("h5") ? "h5" : "native";
  }
  if (selectedChannel.value === "alipay") return "page";
  return undefined;
}

async function loadChannels(): Promise<void> {
  try {
    const res = await api.get<ChannelsDto>("/billing/channels");
    live.value = res.live;
    channels.value = res.channels.filter((c) => c.configured);
    const preferred = res.live
      ? res.channels.find((c) => c.channel === "wechat" && c.configured) ??
        res.channels.find((c) => c.channel === "alipay" && c.configured)
      : res.channels.find((c) => c.channel === "mock" && c.configured);
    if (preferred) selectedChannel.value = preferred.channel;
  } catch {
    // 渠道接口不可用时退回 mock（本地/灰度兼容），真实下单仍由后端二次校验
    channels.value = [{ channel: "mock", configured: true, modes: [] }];
    selectedChannel.value = "mock";
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [list, me] = await Promise.all([
      api.get<SkuDto[]>("/billing/skus"),
      api.get<{ credits: { balance: number } }>("/me"),
      loadChannels(),
    ]);
    skus.value = list;
    balance.value = me.credits.balance;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function renderQr(content: string): Promise<void> {
  try {
    qrDataUrl.value = await toDataURL(content, { width: 220, margin: 1, errorCorrectionLevel: "M" });
  } catch {
    qrDataUrl.value = "";
  }
}

function resetPaymentView(): void {
  qrDataUrl.value = "";
  payLink.value = "";
}

async function buy(sku: SkuDto): Promise<void> {
  if (!selectedChannel.value) {
    error.value = "请选择支付方式";
    return;
  }
  paying.value = sku.sku;
  error.value = "";
  resetPaymentView();
  try {
    const order = await api.post<OrderDto>("/billing/orders", {
      sku: sku.sku,
      channel: selectedChannel.value,
      mode: resolveMode(),
    });
    activeOrder.value = order;
    toast.info(`订单已创建：${(order.amount_cents / 100).toFixed(2)} 元 / ${order.credits} 积分`);

    // mock 联调：一键模拟渠道回调（PAYMENT_LIVE=true 时后端会 403）
    if (selectedChannel.value === "mock") {
      const paid = await api.post<{ credited: boolean; credits: number }>(
        `/billing/orders/${order.order_id}/mock-pay`,
        {},
      );
      if (paid.credited) {
        toast.success(`充值成功，+${paid.credits} 积分`);
        activeOrder.value = null;
        await load();
        return;
      }
      startPoll(order.order_id);
      return;
    }

    const params = order.pay_params;
    if (!params) {
      error.value = "渠道未返回支付参数，请稍后重试";
      return;
    }
    if (params.code_url) {
      // 微信 Native：展示二维码，用户扫码支付
      await renderQr(params.code_url);
    } else if (params.qr_code) {
      // 支付宝 precreate：展示二维码
      await renderQr(params.qr_code);
    } else if (params.h5_url) {
      payLink.value = params.h5_url;
      window.location.href = params.h5_url;
    } else if (params.pay_url) {
      // 支付宝电脑网站支付：新窗口打开收银台
      payLink.value = params.pay_url;
      window.open(params.pay_url, "_blank", "noopener");
    }
    startPoll(order.order_id);
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
        resetPaymentView();
        toast.success(`充值成功，+${o.credits} 积分`);
        activeOrder.value = null;
        await load();
      } else if (o.status === 3) {
        stopPoll();
        resetPaymentView();
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
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "关闭失败");
  } finally {
    stopPoll();
    resetPaymentView();
    activeOrder.value = null;
  }
}

const yuan = (cents: number): string => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

onMounted(async () => {
  isMobile.value = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  await load();
});
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
      <div class="channels">
        <span class="ch-label">支付方式</span>
        <button
          v-for="c in channelOptions"
          :key="c.id"
          type="button"
          class="ch-btn"
          :class="{ active: selectedChannel === c.id, disabled: !c.enabled }"
          :disabled="!c.enabled || !!paying"
          :title="c.hint"
          @click="selectedChannel = c.id"
        >
          {{ c.label }}
          <span v-if="!c.enabled" class="ch-tag">{{ c.hint }}</span>
        </button>
        <span v-if="live" class="ch-live">真实支付已开启</span>
      </div>

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
        <div class="p-main">
          <p class="p-title">订单待支付</p>
          <p class="p-meta">
            订单 {{ activeOrder.order_id.slice(-10) }} · ¥{{ yuan(activeOrder.amount_cents) }} ·
            {{ activeOrder.credits }} 积分
          </p>

          <div v-if="qrDataUrl" class="qr-wrap">
            <img :src="qrDataUrl" alt="支付二维码" class="qr" />
            <p class="qr-tip">
              {{ activeOrder.channel === "wechat" ? "请使用微信扫一扫完成支付" : "请使用支付宝扫一扫完成支付" }}
            </p>
          </div>

          <div v-else-if="payLink" class="pay-link">
            <p class="qr-tip">若未自动跳转，请点击下方按钮继续支付：</p>
            <a :href="payLink" target="_blank" rel="noopener noreferrer" class="pay-a">打开支付页面</a>
          </div>
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
          <li v-if="live">支付由微信支付 / 支付宝官方渠道处理，支付成功由渠道异步通知入账，页面每 3 秒自动确认；</li>
          <li v-else>当前为联调模式（mock 渠道）；配置商户号/证书并开启 PAYMENT_LIVE 后自动切换真实支付。</li>
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

.channels {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}
.ch-label {
  font-size: var(--text-sm);
  color: var(--text-3);
  margin-right: var(--space-1);
}
.ch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    border-color var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    background var(--duration-base) var(--ease-out);
}
.ch-btn:hover:not(.disabled) {
  border-color: var(--brand-300);
  color: var(--brand-700);
}
.ch-btn.active {
  border-color: var(--brand-500);
  background: var(--brand-50);
  color: var(--brand-700);
  font-weight: 600;
}
.ch-btn.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.ch-tag {
  font-size: var(--text-xs);
  color: var(--text-4);
}
.ch-live {
  font-size: var(--text-xs);
  color: var(--brand-600);
  margin-left: var(--space-2);
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
  align-items: flex-start;
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
.qr-wrap {
  margin-top: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.qr {
  width: 132px;
  height: 132px;
  border-radius: var(--radius-md);
  background: #fff;
  padding: 6px;
  border: 1px solid var(--border-1);
}
.qr-tip {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
  line-height: 1.7;
}
.pay-link {
  margin-top: var(--space-2);
}
.pay-a {
  display: inline-block;
  margin-top: var(--space-1);
  color: var(--brand-700);
  font-size: var(--text-sm);
  font-weight: 600;
  text-decoration: underline;
}
.p-ops {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
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
