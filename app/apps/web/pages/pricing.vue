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

// 参照产品定价页顶部：积分加购 / 兑换码 + 连续包月 / 按月购买
const priceTab = ref<"credits" | "redeem">("credits");
const billingCycle = ref<"monthly" | "once">("monthly");
const redeemCode = ref("");
function redeem(): void {
  toast.info("兑换码功能即将上线，敬请期待");
}

onMounted(async () => {
  isMobile.value = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  await load();
});
onUnmounted(stopPoll);
</script>

<template>
  <div class="pricing">
    <nav class="price-tabs">
      <button type="button" class="price-tab" :class="{ on: priceTab === 'credits' }" @click="priceTab = 'credits'">
        积分加购
      </button>
      <button type="button" class="price-tab" :class="{ on: priceTab === 'redeem' }" @click="priceTab = 'redeem'">
        兑换码
      </button>
    </nav>

    <section v-if="priceTab === 'redeem'" class="redeem-card">
      <h2>兑换码</h2>
      <p class="sub">输入活动兑换码，兑换积分或会员权益。</p>
      <div class="redeem-row">
        <input v-model="redeemCode" class="redeem-input" placeholder="请输入兑换码" maxlength="64" />
        <Button :disabled="!redeemCode.trim()" @click="redeem">兑换</Button>
      </div>
      <p class="redeem-hint">兑换码功能即将上线，敬请期待。</p>
    </section>

    <template v-else>
    <section class="promo-banner">
      <p class="promo-title">算力积分补贴活动</p>
      <p class="promo-text">
        全模型通用积分，按实际消耗计费；生成失败自动返还。模型价格以任务报价为准，运营可热更。
      </p>
    </section>

    <div class="mode-tabs">
      <button type="button" class="mode-tab" :class="{ on: billingCycle === 'monthly' }" @click="billingCycle = 'monthly'">
        团队购买
      </button>
      <button type="button" class="mode-tab" :class="{ on: billingCycle === 'once' }" @click="billingCycle = 'once'">
        个人订阅
      </button>
    </div>
    <p class="mode-note">ⓘ 团队积分购买后一次性发放，可叠加，有效期一年</p>

    <div class="cycle-row">
      <div class="cycle-toggle">
        <button type="button" :class="{ on: billingCycle === 'monthly' }" @click="billingCycle = 'monthly'">
          连续包月
        </button>
        <button type="button" :class="{ on: billingCycle === 'once' }" @click="billingCycle = 'once'">
          按月购买
        </button>
      </div>
    </div>

    <header class="head">
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
        <article
          v-for="(s, idx) in skus"
          :key="s.sku"
          class="card"
          :class="{ featured: idx === skus.length - 1 }"
        >
          <span v-if="idx === skus.length - 1" class="ribbon">限时加赠 · 最高性价比</span>
          <div class="card-top">
            <p class="label">{{ s.label }}</p>
            <Tag v-if="s.cents_per_credit !== null" tone="neutral" size="sm">
              ¥{{ s.cents_per_credit }}/积分
            </Tag>
          </div>
          <p class="price">
            <span class="cur">¥</span>{{ yuan(s.price_cents) }}
          </p>
          <p class="unit-line">
            1积分 = ¥{{ s.credits > 0 ? (s.price_cents / s.credits / 100).toFixed(3) : "—" }}
          </p>
          <p class="credits">✦ {{ s.credits }} 积分</p>
          <Button class="buy-btn" block :loading="paying === s.sku" :disabled="!!paying" @click="buy(s)">
            {{ paying === s.sku ? "处理中" : "立即购买" }}
          </Button>
          <p class="seconds">约可生成 {{ Math.floor(s.credits / 8) }} 条 5s/720p 视频</p>
          <div class="perks">
            <p class="perks-title">限时活动</p>
            <ul>
              <li>全模型通用，永久有效</li>
              <li>生成失败/取消自动返还积分</li>
              <li>支持微信 / 支付宝支付</li>
            </ul>
          </div>
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
    </template>
  </div>
</template>

<style scoped>
.pricing {
  max-width: 1120px;
  margin: 0 auto;
}
.price-tabs {
  display: flex;
  gap: 28px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: 18px;
}
.price-tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.price-tab.on {
  color: var(--text-1);
}
.price-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}
.cycle-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: #0f0f12;
}
.cycle-toggle button {
  height: 30px;
  padding: 0 18px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
}
.cycle-toggle button.on {
  background: #26262c;
  color: var(--text-1);
  font-weight: 600;
}
.redeem-card {
  max-width: 520px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
}
.redeem-card h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.redeem-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.redeem-input {
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-1);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.redeem-input:focus {
  border-color: var(--brand-500);
}
.redeem-hint {
  margin: 10px 0 0;
  color: var(--text-4);
  font-size: 12px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
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
  background: var(--bg-raised);
  color: var(--text-3);
  border: 1px solid var(--border-1);
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
  border-color: var(--brand-400);
  color: var(--text-1);
}
.ch-btn.active {
  border-color: var(--brand-500);
  background: #2a1b4a;
  color: #d9d2ff;
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

.promo-banner {
  width: 900px;
  max-width: 100%;
  min-height: 120px;
  box-sizing: border-box;
  margin: 0 auto 18px;
  padding: 22px 24px;
  border-radius: 10px;
  background: linear-gradient(100deg, #0d1f2a, #123c3a 45%, #1b2350);
  border: 1px solid #ffffff10;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.promo-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: #eef3ff;
}
.promo-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: #ffffff9a;
}
.mode-tabs {
  display: flex;
  justify-content: center;
  gap: 56px;
  border-bottom: 1px solid #ffffff0f;
  margin-bottom: 10px;
}
.mode-tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.mode-tab.on {
  color: var(--text-1);
}
.mode-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--text-1);
}
.mode-note {
  margin: 0 0 10px;
  text-align: center;
  color: var(--text-4);
  font-size: 12px;
}
.cycle-row {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 14px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, 320px);
  justify-content: start;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.card {
  position: relative;
  overflow: hidden;
  background: #121216;
  border: 1px solid #ffffff12;
  border-radius: 14px;
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  transition:
    border-color var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.card:hover {
  border-color: #ffffff2e;
  transform: translateY(-2px);
}
.card.featured {
  border-color: #7e70ff;
  box-shadow: 0 0 0 1px #7e70ff44, 0 18px 40px #7e70ff1f;
}
.ribbon {
  position: absolute;
  top: 0;
  right: 0;
  padding: 3px 10px;
  border-bottom-left-radius: 10px;
  background: linear-gradient(90deg, #7e70ff, #b06bff);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.label {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}
.price {
  margin: 0 0 6px;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #eae4ff, #b9a6ff);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.cur {
  font-size: 18px;
  font-weight: 600;
  margin-right: 3px;
  background: linear-gradient(180deg, #eae4ff, #b9a6ff);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.unit-line {
  margin: 0 0 12px;
  color: var(--text-4);
  font-size: 11px;
}
.credits {
  margin: 0 0 12px;
  color: #d9d2ff;
  font-size: 17px;
  font-weight: 700;
}
.buy-btn {
  background: linear-gradient(90deg, #f1ecff, #c9b8ff);
  border-color: transparent;
  color: #33288f;
  font-weight: 700;
}
.buy-btn:hover {
  background: linear-gradient(90deg, #ffffff, #d8c9ff);
}
.seconds {
  margin: 10px 0 12px;
  color: var(--text-3);
  font-size: 11px;
}
.perks {
  border-top: 1px solid #ffffff0f;
  padding-top: 10px;
}
.perks-title {
  margin: 0 0 6px;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
}
.perks ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.perks li {
  position: relative;
  padding-left: 14px;
  color: var(--text-3);
  font-size: 11px;
  line-height: 1.5;
}
.perks li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: #8f86c8;
}
@media (max-width: 1100px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .cards {
    grid-template-columns: 1fr;
  }
  .mode-tabs {
    gap: 28px;
  }
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
