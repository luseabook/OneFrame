<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 邀请 / 兑换（对照竞品 `/partner/invite`、`/partner-center`，`rt:67-68`；
 * 数据来自 op 域 `invite-code` / `referral-link` / `distributor/*` / `daily-reward` /
 * `redeem-code` 五组端点，`rt:835-856+`）。
 *
 * 三个真实约束（本页按它们设计交互，而不是"能点就行"）：
 *
 * 1. **邀请码一人一码**：`POST /op/invite-code` 幂等，重复调用返回同一个码——
 *    所以"生成"按钮第一次之后变成"复制链接"，不给用户刷码的机会。
 * 2. **兑换码两段式**（竞品刻意拆 `op/redeem-code/info` 与 `redeem-code/redeem`）：
 *    先查询展示"这是什么码、给多少分"，再让用户确认兑换；
 *    已兑换过/已用尽的码直接禁用按钮并显示原因，不做"点了才报错"。
 * 3. **每日奖励一天一次**：领过之后按钮变灰，文案说明"明天再来"。
 */

import type {
  DailyRewardDto,
  DistributorOverviewDto,
  InviteCodeDto,
  RedeemCodeInfoDto,
  RedeemResultDto,
} from "~/types/api";

const { t, locale } = useI18n();
useHead({ title: () => t("invite.metaTitle") });

const api = useApi();
const toast = useToast();
const route = useRoute();
const auth = useAuth();

const loading = ref(true);
const errorMsg = ref("");
const busy = ref("");

const invite = ref<InviteCodeDto | null>(null);
const distributor = ref<DistributorOverviewDto | null>(null);
const daily = ref<DailyRewardDto | null>(null);

const verifyCodeInput = ref("");
const redeemInput = ref("");
const redeemInfo = ref<RedeemCodeInfoDto | null>(null);
const redeemResult = ref<RedeemResultDto | null>(null);

const inviteLink = computed(() => {
  if (!invite.value?.code) return "";
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}${invite.value.share_link ?? `/invite?code=${invite.value.code}`}`;
});

const redeemReasonLabel = computed(() => {
  switch (redeemInfo.value?.reason) {
    case "not_found":
      return t("invite.reasons.notFound");
    case "disabled":
      return t("invite.reasons.disabled");
    case "expired":
      return t("invite.reasons.expired");
    case "exhausted":
      return t("invite.reasons.exhausted");
    case "already_redeemed":
      return t("invite.reasons.alreadyRedeemed");
    default:
      return "";
  }
});

async function loadAll() {
  loading.value = true;
  errorMsg.value = "";
  try {
    // 只读接口：GET 拿不到码时再 POST 生成（POST 幂等）
    const mine = await api.get<InviteCodeDto>("/op/invite-code");
    invite.value = mine.code ? mine : await api.post<InviteCodeDto>("/op/invite-code", {});
    distributor.value = await api.post<DistributorOverviewDto>("/op/distributor/overview", {});
  } catch (e) {
    errorMsg.value = (e as Error).message || t("invite.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.success(t("invite.toastCopied"));
  } catch {
    // 剪贴板被浏览器拒绝时给出可手动复制的文案，而不是静默失败
    toast.info(t("invite.toastCopyFailed", { link: inviteLink.value }));
  }
}

async function verifyInvite() {
  const code = verifyCodeInput.value.trim();
  if (!code) {
    toast.error(t("invite.toastCodeRequired"));
    return;
  }
  busy.value = "verify";
  try {
    const res = await api.post<{ verified: boolean; replayed: boolean; credits: number }>("/op/invite-code/verify", {
      code,
    });
    if (res.replayed) {
      // 回放不是失败：竞品登录时已带过邀请码、用户又点一次是常见路径
      toast.info(t("invite.toastCodeReplayed"));
    } else if (res.credits > 0) {
      toast.success(t("invite.toastCodeAppliedCredits", { credits: res.credits }));
    } else {
      toast.success(t("invite.toastCodeApplied"));
    }
    verifyCodeInput.value = "";
    distributor.value = await api.post<DistributorOverviewDto>("/op/distributor/overview", {});
  } catch (e) {
    toast.error((e as Error).message || t("invite.toastVerifyFailed"));
  } finally {
    busy.value = "";
  }
}

async function claimDaily() {
  busy.value = "daily";
  try {
    const res = await api.post<DailyRewardDto>("/op/daily-reward", {});
    daily.value = res;
    if (res.rewarded) toast.success(t("invite.toastDailySuccess", { credits: res.credits }));
    else toast.info(t("invite.toastDailyReplay"));
  } catch (e) {
    toast.error((e as Error).message || t("invite.toastDailyFailed"));
  } finally {
    busy.value = "";
  }
}

async function queryRedeem() {
  const code = redeemInput.value.trim();
  if (!code) {
    toast.error(t("invite.toastRedeemCodeRequired"));
    return;
  }
  busy.value = "redeem-info";
  redeemResult.value = null;
  try {
    redeemInfo.value = await api.post<RedeemCodeInfoDto>("/op/redeem-code/info", { code });
    if (!redeemInfo.value.valid) toast.info(redeemReasonLabel.value || t("invite.toastNotRedeemableNow"));
  } catch (e) {
    toast.error((e as Error).message || t("invite.toastQueryFailed"));
  } finally {
    busy.value = "";
  }
}

async function doRedeem() {
  const code = redeemInput.value.trim();
  if (!code) return;
  busy.value = "redeem";
  try {
    const res = await api.post<RedeemResultDto>("/redeem-code/redeem", { code });
    redeemResult.value = res;
    if (res.replayed) toast.info(t("invite.toastRedeemReplay"));
    else toast.success(t("invite.toastRedeemSuccess", { credits: res.credits }));
    // 兑换后刷新码信息（used_count 会变），让按钮态立刻正确
    redeemInfo.value = await api.post<RedeemCodeInfoDto>("/op/redeem-code/info", { code });
  } catch (e) {
    toast.error((e as Error).message || t("invite.toastRedeemFailed"));
  } finally {
    busy.value = "";
  }
}

/**
 * 被邀请人点分享链接（`/invite?code=…`，由 `op.service.ts:158` 生成）时：
 * 未登录 → 直接带去注册页并预填邀请码（`/login?invite=…`）；已登录 → 保持原行为，
 * 这页对已登录用户是「我的邀请 / 兑换」工作台。
 *
 * 为什么必须有这段：邀请码改成注册必填之后，分享链接若停在 `/invite`，
 * 被邀请人既没有账号也拿不到码，注册流程对新用户直接断掉。
 * 先尝试一次 bootstrap：刷新页面时 accessToken 还在内存之外，只有 refresh Cookie，
 * 不先续期就把已登录用户也当成未登录，会把他踢到登录页。
 */
onMounted(async () => {
  const code = String(route.query.code ?? "").trim();
  if (code !== "") {
    if (!auth.state.value.accessToken) await auth.bootstrap().catch(() => {});
    if (!auth.state.value.accessToken) {
      await navigateTo(`/login?invite=${encodeURIComponent(code)}`, { replace: true });
      return;
    }
  }
  await loadAll();
});
</script>

<template>
  <div class="inv">
    <header class="inv-head">
      <div>
        <h1 class="inv-title">{{ t("invite.title") }}</h1>
        <p class="inv-sub">{{ t("invite.sub") }}</p>
      </div>
      <button type="button" class="inv-btn" :disabled="loading" @click="loadAll">{{ t("invite.refresh") }}</button>
    </header>

    <p v-if="errorMsg" class="inv-alert">
      {{ errorMsg }}
      <button type="button" class="inv-link" @click="loadAll">{{ t("common.retry") }}</button>
    </p>

    <div v-if="loading" class="inv-skeleton">{{ t("invite.loading") }}</div>

    <div v-else class="inv-grid">
      <!-- 我的邀请码 -->
      <section class="inv-card">
        <h2 class="inv-card-title">{{ t("invite.myCode") }}</h2>
        <p class="inv-hint">{{ t("invite.myCodeHint") }}</p>
        <div v-if="invite?.code" class="inv-code-box">
          <code class="inv-code">{{ invite.code }}</code>
          <button type="button" class="inv-btn primary sm" @click="copyLink">{{ t("invite.copyLink") }}</button>
        </div>
        <p v-else class="inv-muted">{{ t("invite.noCode") }}</p>
        <p class="inv-link-text">{{ inviteLink }}</p>
        <dl class="inv-kv">
          <div><dt>{{ t("invite.codeCredits") }}</dt><dd>{{ invite?.credits ?? 0 }}</dd></div>
          <div><dt>{{ t("invite.invitedCount") }}</dt><dd>{{ invite?.invitee_count ?? 0 }}</dd></div>
        </dl>
      </section>

      <!-- 补填邀请码 -->
      <section class="inv-card">
        <h2 class="inv-card-title">{{ t("invite.fillCode") }}</h2>
        <p class="inv-hint">{{ t("invite.fillCodeHint") }}</p>
        <div class="inv-form">
          <input v-model="verifyCodeInput" class="inv-input" maxlength="64" :placeholder="t('invite.codePlaceholder')" />
          <button type="button" class="inv-btn primary" :disabled="busy === 'verify'" @click="verifyInvite">
            {{ busy === "verify" ? t("invite.verifying") : t("invite.verify") }}
          </button>
        </div>
      </section>

      <!-- 每日奖励 -->
      <section class="inv-card">
        <h2 class="inv-card-title">{{ t("invite.dailyTitle") }}</h2>
        <p class="inv-hint">{{ t("invite.dailyHint") }}</p>
        <button
          type="button"
          class="inv-btn primary"
          :disabled="busy === 'daily' || daily?.already_rewarded === true"
          :title="daily?.already_rewarded ? t('invite.dailyClaimedTitle') : ''"
          @click="claimDaily"
        >
          {{ daily?.already_rewarded ? t("invite.dailyClaimed") : busy === "daily" ? t("invite.dailyClaiming") : t("invite.dailyClaim") }}
        </button>
        <p v-if="daily?.balance_after != null" class="inv-ok">{{ t("invite.balanceAfter", { balance: daily.balance_after }) }}</p>
      </section>

      <!-- 分销概览 -->
      <section class="inv-card">
        <h2 class="inv-card-title">{{ t("invite.distributorTitle") }}</h2>
        <p class="inv-hint">{{ t("invite.distributorHint") }}</p>
        <dl v-if="distributor" class="inv-kv">
          <div><dt>{{ t("invite.validInvitees") }}</dt><dd>{{ distributor.invitee_count }}</dd></div>
          <div><dt>{{ t("invite.commissionRate") }}</dt><dd>{{ (distributor.me.commission_bps / 100).toFixed(2) }}%</dd></div>
          <div><dt>{{ t("invite.settledIncome") }}</dt><dd>{{ distributor.income_credits }}</dd></div>
          <div><dt>{{ t("invite.parentUser") }}</dt><dd class="inv-mono">{{ distributor.me.parent_user_id ?? "—" }}</dd></div>
        </dl>
      </section>

      <!-- 兑换码（两段式） -->
      <section class="inv-card inv-card-wide">
        <h2 class="inv-card-title">{{ t("invite.redeemTitle") }}</h2>
        <p class="inv-hint">{{ t("invite.redeemHint") }}</p>
        <div class="inv-form">
          <input v-model="redeemInput" class="inv-input" maxlength="32" :placeholder="t('invite.redeemPlaceholder')" />
          <button type="button" class="inv-btn" :disabled="busy === 'redeem-info'" @click="queryRedeem">
            {{ busy === "redeem-info" ? t("invite.querying") : t("invite.query") }}
          </button>
          <button
            type="button"
            class="inv-btn primary"
            :disabled="busy === 'redeem' || !redeemInfo?.valid"
            :title="redeemInfo && !redeemInfo.valid ? redeemReasonLabel : ''"
            @click="doRedeem"
          >
            {{ redeemInfo && !redeemInfo.valid ? redeemReasonLabel || t("invite.notRedeemable") : busy === "redeem" ? t("invite.redeeming") : t("invite.confirmRedeem") }}
          </button>
        </div>

        <div v-if="redeemInfo" class="inv-result">
          <template v-if="redeemInfo.found">
            <p>
              {{ t("invite.faceValue", { credits: redeemInfo.credits }) }} ·
              {{ t("invite.remainingUses", { uses: redeemInfo.remaining_uses < 0 ? t("invite.unlimited") : String(redeemInfo.remaining_uses) }) }} ·
              {{ t("invite.validUntil", { expiry: redeemInfo.expires_at ? new Date(redeemInfo.expires_at).toLocaleString(locale, { hour12: false }) : t("invite.longTerm") }) }}
            </p>
            <p v-if="!redeemInfo.valid" class="inv-warn">{{ redeemReasonLabel }}</p>
          </template>
          <p v-else class="inv-warn">{{ t("invite.notFound") }}</p>
        </div>

        <p v-if="redeemResult" class="inv-ok">
          <template v-if="redeemResult.replayed">{{ t("invite.resultReplayed") }}</template>
          <template v-else>{{ t("invite.resultSuccess", { credits: redeemResult.credits, balance: redeemResult.balance_after ?? 0 }) }}</template>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inv { display: flex; flex-direction: column; gap: var(--space-4); }
.inv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.inv-title { font-size: 24px; font-weight: 700; margin: 0; }
.inv-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.inv-alert { margin: 0; padding: var(--space-3); border-radius: var(--radius-2); font-size: 13px; background: color-mix(in srgb, var(--danger-1, #e03131) 12%, transparent); color: var(--danger-1, #e03131); }
.inv-skeleton { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.inv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }
.inv-card { padding: var(--space-4); background: var(--surface-1); border: 1px solid var(--border-1); border-radius: var(--radius-3); display: flex; flex-direction: column; gap: var(--space-2); }
.inv-card-wide { grid-column: 1 / -1; }
.inv-card-title { font-size: 15px; font-weight: 600; margin: 0; }
.inv-hint { color: var(--text-3); font-size: 12px; margin: 0; line-height: 1.6; }
.inv-muted { color: var(--text-3); font-size: 13px; margin: 0; }
.inv-code-box { display: flex; align-items: center; gap: var(--space-2); }
.inv-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px; letter-spacing: 2px;
  padding: 8px 14px; border-radius: var(--radius-2); background: var(--surface-2); color: var(--text-1);
}
.inv-link-text { font-size: 12px; color: var(--text-3); word-break: break-all; margin: 0; }
.inv-form { display: flex; gap: 6px; flex-wrap: wrap; }
.inv-input { flex: 1 1 220px; padding: 8px 10px; font-size: 13px; border: 1px solid var(--border-1); border-radius: var(--radius-2); background: var(--surface-1); color: var(--text-1); }
.inv-btn { border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-1); font-size: 13px; padding: 7px 12px; border-radius: var(--radius-2); cursor: pointer; width: fit-content; }
.inv-btn.sm { padding: 4px 10px; font-size: 12px; }
.inv-btn.primary { background: var(--brand-1, #7e70ff); border-color: transparent; color: #fff; }
.inv-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.inv-link { border: 0; background: transparent; color: var(--brand-1, #7e70ff); cursor: pointer; font-size: 13px; }
.inv-kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); margin: 0; }
.inv-kv dt { color: var(--text-3); font-size: 12px; margin: 0; }
.inv-kv dd { margin: 2px 0 0; font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.inv-mono { font-size: 13px !important; font-weight: 500 !important; font-family: ui-monospace, monospace; }
.inv-result { padding: var(--space-3); background: var(--surface-2); border-radius: var(--radius-2); font-size: 13px; }
.inv-result p { margin: 0; }
.inv-ok { margin: 0; color: var(--success-1, #2f9e44); font-size: 13px; }
.inv-warn { margin: 4px 0 0; color: var(--danger-1, #e03131); font-size: 12px; }

@media (max-width: 1080px) {
  .inv-grid { grid-template-columns: 1fr; }
}
</style>
