<script setup lang="ts">
// 定价/充值页：SKU 目录来自后端，支持下单→支付→轮询入账（PRD §10）
// 支付渠道：mock（联调一键模拟）/ 微信 APIv3（Native 二维码、H5 跳转）/ 支付宝（收银台跳转、扫码）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
// i18n（第 8 批）：SKU 名称/金额/渠道名里的商户信息来自后端与配置，不翻译；
// 页面骨架、计费说明、支付引导与提示语走语言包（中文原文与改造前逐字一致）。
const { t } = useI18n();
useHead({ title: () => t('pricing.metaTitle') });

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

// 购买目标空间（2026-10-26）：活动空间决定订单入账到哪个 space。
// 团队上下文下充进团队积分池（ADR-011），个人上下文充进个人余额。
const activeSpace = useActiveSpaceId();
const buyingFor = ref("");
const isTeamContext = computed(() => !!activeSpace.value);

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
    label: c.channel === "mock" ? t("pricing.channelMock") : c.channel === "wechat" ? t("pricing.channelWechat") : t("pricing.channelAlipay"),
    enabled: c.configured,
    hint: c.configured ? "" : c.reason || (c.missing?.length ? t("pricing.channelMissing", { list: c.missing.join(", ") }) : t("pricing.channelUnavailable")),
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
    error.value = e instanceof Error ? e.message : t("pricing.loadFailed");
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
    error.value = t("pricing.selectChannel");
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
    toast.info(t("pricing.orderCreated", { amount: (order.amount_cents / 100).toFixed(2), credits: order.credits }));

    // mock 联调：一键模拟渠道回调（PAYMENT_LIVE=true 时后端会 403）
    if (selectedChannel.value === "mock") {
      const paid = await api.post<{ credited: boolean; credits: number }>(
        `/billing/orders/${order.order_id}/mock-pay`,
        {},
      );
      if (paid.credited) {
        toast.success(t("pricing.paid", { credits: paid.credits }));
        activeOrder.value = null;
        await load();
        return;
      }
      startPoll(order.order_id);
      return;
    }

    const params = order.pay_params;
    if (!params) {
      error.value = t("pricing.noPayParams");
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
    const msg = e instanceof Error ? e.message : t("pricing.orderFailed");
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
        toast.success(t("pricing.paid", { credits: o.credits }));
        activeOrder.value = null;
        await load();
      } else if (o.status === 3) {
        stopPoll();
        resetPaymentView();
        toast.error(t("pricing.orderClosed"));
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
    toast.info(t("pricing.orderClosed"));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t("pricing.closeFailed"));
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
  toast.info(t("pricing.redeemSoon"));
}

onMounted(async () => {
  isMobile.value = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  // 显示"当前购买至哪个空间"，避免在团队上下文里误以为充到个人账户
  try {
    const mine = await useApi().get<{ list: Array<{ space_id: string; name: string; type: number }> }>("/cam/teams/mine");
    const target = activeSpace.value
      ? mine.list.find((s) => s.space_id === activeSpace.value)
      : mine.list.find((s) => s.type === 1);
    buyingFor.value = target ? `${target.name}${target.type === 2 ? "" : t("pricing.personalSuffix")}` : "";
  } catch {
    buyingFor.value = "";
  }
  await load();
});
onUnmounted(stopPoll);
</script>

<template>
  <div class="pricing">
    <nav class="price-tabs">
      <button type="button" class="price-tab" :class="{ on: priceTab === 'credits' }" @click="priceTab = 'credits'">
        {{ t("pricing.tabCredits") }}
      </button>
      <button type="button" class="price-tab" :class="{ on: priceTab === 'redeem' }" @click="priceTab = 'redeem'">
        {{ t("pricing.tabRedeem") }}
      </button>
    </nav>

    <section v-if="priceTab === 'redeem'" class="redeem-card">
      <h2>{{ t("pricing.redeemTitle") }}</h2>
      <p class="sub">{{ t("pricing.redeemSub") }}</p>
      <div class="redeem-row">
        <input v-model="redeemCode" class="redeem-input" :placeholder="t('pricing.redeemPlaceholder')" maxlength="64" />
        <Button :disabled="!redeemCode.trim()" @click="redeem">{{ t("pricing.redeemButton") }}</Button>
      </div>
      <p class="redeem-hint">{{ t("pricing.redeemSoon") }}</p>
    </section>

    <template v-else>
    <!-- 购买目标空间提示（2026-10-26）：团队空间下单会直接充进团队积分池，
         避免用户在团队上下文里误以为充到了个人账户 -->
    <p v-if="buyingFor" class="buy-target">
      {{ t("pricing.buyTarget") }} <b>{{ buyingFor }}</b>
      <span v-if="isTeamContext" class="buy-target-tag">{{ t("pricing.teamPool") }}</span>
      <NuxtLink v-else class="buy-target-switch" to="/team">{{ t("pricing.switchTeam") }}</NuxtLink>
    </p>
    <section class="promo-banner">
      <p class="promo-title">{{ t("pricing.promoTitle") }}</p>
      <p class="promo-text">
        {{ t("pricing.promoText") }}
      </p>
    </section>

    <div class="mode-tabs">
      <button type="button" class="mode-tab" :class="{ on: billingCycle === 'monthly' }" @click="billingCycle = 'monthly'">
        {{ t("pricing.modeTeam") }}
      </button>
      <button type="button" class="mode-tab" :class="{ on: billingCycle === 'once' }" @click="billingCycle = 'once'">
        {{ t("pricing.modePersonal") }}
      </button>
    </div>
    <p class="mode-note">{{ t("pricing.modeNote") }}</p>

    <div class="cycle-row">
      <div class="cycle-toggle">
        <button type="button" :class="{ on: billingCycle === 'monthly' }" @click="billingCycle = 'monthly'">
          {{ t("pricing.cycleMonthly") }}
        </button>
        <button type="button" :class="{ on: billingCycle === 'once' }" @click="billingCycle = 'once'">
          {{ t("pricing.cycleOnce") }}
        </button>
      </div>
    </div>

    <header class="head">
      <div v-if="balance !== null" class="balance-chip">
        {{ t("pricing.balance") }} <b>{{ balance }}</b> {{ t("pricing.balanceUnit") }}
      </div>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="3" />

    <template v-else>
      <div class="channels">
        <span class="ch-label">{{ t("pricing.channelTitle") }}</span>
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
        <span v-if="live" class="ch-live">{{ t("pricing.channelLive") }}</span>
      </div>

      <div v-if="skus.length" class="cards">
        <article
          v-for="(s, idx) in skus"
          :key="s.sku"
          class="card"
          :class="{ featured: idx === skus.length - 1 }"
        >
          <span v-if="idx === skus.length - 1" class="ribbon">{{ t("pricing.ribbon") }}</span>
          <div class="card-top">
            <p class="label">{{ s.label }}</p>
            <Tag v-if="s.cents_per_credit !== null" tone="neutral" size="sm">
              {{ t("pricing.perCredit", { value: s.cents_per_credit }) }}
            </Tag>
          </div>
          <p class="price">
            <span class="cur">¥</span>{{ yuan(s.price_cents) }}
          </p>
          <p class="unit-line">
            {{ t("pricing.unitLine", { value: s.credits > 0 ? (s.price_cents / s.credits / 100).toFixed(3) : "—" }) }}
          </p>
          <p class="credits">{{ t("pricing.creditsAmount", { count: s.credits }) }}</p>
          <Button class="buy-btn" block :loading="paying === s.sku" :disabled="!!paying" @click="buy(s)">
            {{ paying === s.sku ? t("pricing.buying") : t("pricing.buy") }}
          </Button>
          <p class="seconds">{{ t("pricing.secondsVideo", { count: Math.floor(s.credits / 8) }) }}</p>
          <div class="perks">
            <p class="perks-title">{{ t("pricing.perksTitle") }}</p>
            <ul>
              <li>{{ t("pricing.perk1") }}</li>
              <li>{{ t("pricing.perk2") }}</li>
              <li>{{ t("pricing.perk3") }}</li>
            </ul>
          </div>
        </article>
      </div>

      <EmptyState
        v-else
        icon="◇"
        :title="t('pricing.emptyTitle')"
        :description="t('pricing.emptyDesc')"
      />

      <!-- 会员订阅（13 档，Lead 提供；价格与活动价全部来自后端 /billing/plans，前端不复刻折扣） -->
      <SubscriptionPlans />

      <div v-if="activeOrder" class="pending">
        <div class="p-main">
          <p class="p-title">{{ t("pricing.pendingTitle") }}</p>
          <p class="p-meta">
            {{ t("pricing.pendingMeta", { id: activeOrder.order_id.slice(-10), amount: yuan(activeOrder.amount_cents), credits: activeOrder.credits }) }}
          </p>

          <div v-if="qrDataUrl" class="qr-wrap">
            <img :src="qrDataUrl" :alt="t('pricing.qrWechat')" class="qr" />
            <p class="qr-tip">
              {{ activeOrder.channel === "wechat" ? t("pricing.qrWechat") : t("pricing.qrAlipay") }}
            </p>
          </div>

          <div v-else-if="payLink" class="pay-link">
            <p class="qr-tip">{{ t("pricing.payLinkTip") }}</p>
            <a :href="payLink" target="_blank" rel="noopener noreferrer" class="pay-a">{{ t("pricing.payLinkOpen") }}</a>
          </div>
        </div>
        <div class="p-ops">
          <span class="p-poll">{{ t("pricing.polling", { n: pollCount }) }}</span>
          <Button size="sm" variant="text" @click="closeOrder">{{ t("pricing.closeOrder") }}</Button>
        </div>
      </div>

      <section class="notes">
        <h3>{{ t("pricing.notesTitle") }}</h3>
        <ul>
          <li>{{ t("pricing.notes1") }}</li>
          <li>{{ t("pricing.notes2") }}</li>
          <li v-if="live">{{ t("pricing.notesLive") }}</li>
          <li v-else>{{ t("pricing.notesMock") }}</li>
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
  color: #9d9d9f;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.price-tab.on {
  color: #ffffff;
}
/* GL9：下划线白 2px、宽=文字宽（竞品 pricing-full.png 下划线 y90–91 / x239–303 为 #FFFFFF） */
.price-tab.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--tab-line);
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
/* 购买目标空间提示 */
.buy-target {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-2);
}
.buy-target b {
  color: var(--text-1);
}
.buy-target-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--brand-soft, rgba(126, 112, 255, 0.14));
  color: var(--brand-1);
  font-size: 12px;
}
.buy-target-switch {
  color: var(--brand-1);
  text-decoration: none;
  font-size: 12px;
}
.buy-target-switch:hover {
  text-decoration: underline;
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
  background: var(--tab-line);
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
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-lg);
  background: var(--brand-soft);
}
.p-title {
  margin: 0 0 2px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--brand-on-soft);
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
  color: var(--brand-300);
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
