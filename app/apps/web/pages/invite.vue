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

const api = useApi();
const toast = useToast();

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
      return "兑换码不存在";
    case "disabled":
      return "该码已停用";
    case "expired":
      return "该码已过期";
    case "exhausted":
      return "该码已被兑换完了";
    case "already_redeemed":
      return "你已经兑换过这个码";
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
    errorMsg.value = (e as Error).message || "邀请信息加载失败";
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast.success("邀请链接已复制");
  } catch {
    // 剪贴板被浏览器拒绝时给出可手动复制的文案，而不是静默失败
    toast.info(`复制失败，请手动复制：${inviteLink.value}`);
  }
}

async function verifyInvite() {
  const code = verifyCodeInput.value.trim();
  if (!code) {
    toast.error("请输入邀请码");
    return;
  }
  busy.value = "verify";
  try {
    const res = await api.post<{ verified: boolean; replayed: boolean; credits: number }>("/op/invite-code/verify", {
      code,
    });
    if (res.replayed) {
      // 回放不是失败：竞品登录时已带过邀请码、用户又点一次是常见路径
      toast.info("这个邀请码你已经用过了");
    } else if (res.credits > 0) {
      toast.success(`邀请码已生效，到账 ${res.credits} 积分`);
    } else {
      toast.success("邀请码已生效");
    }
    verifyCodeInput.value = "";
    distributor.value = await api.post<DistributorOverviewDto>("/op/distributor/overview", {});
  } catch (e) {
    toast.error((e as Error).message || "邀请码核销失败");
  } finally {
    busy.value = "";
  }
}

async function claimDaily() {
  busy.value = "daily";
  try {
    const res = await api.post<DailyRewardDto>("/op/daily-reward", {});
    daily.value = res;
    if (res.rewarded) toast.success(`领取成功，到账 ${res.credits} 积分`);
    else toast.info("今天已经领过了，明天再来");
  } catch (e) {
    toast.error((e as Error).message || "领取失败");
  } finally {
    busy.value = "";
  }
}

async function queryRedeem() {
  const code = redeemInput.value.trim();
  if (!code) {
    toast.error("请输入兑换码");
    return;
  }
  busy.value = "redeem-info";
  redeemResult.value = null;
  try {
    redeemInfo.value = await api.post<RedeemCodeInfoDto>("/op/redeem-code/info", { code });
    if (!redeemInfo.value.valid) toast.info(redeemReasonLabel.value || "该码当前不可兑换");
  } catch (e) {
    toast.error((e as Error).message || "查询失败");
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
    if (res.replayed) toast.info("你之前已经兑换过这个码了，不重复发放");
    else toast.success(`兑换成功，到账 ${res.credits} 积分`);
    // 兑换后刷新码信息（used_count 会变），让按钮态立刻正确
    redeemInfo.value = await api.post<RedeemCodeInfoDto>("/op/redeem-code/info", { code });
  } catch (e) {
    toast.error((e as Error).message || "兑换失败");
  } finally {
    busy.value = "";
  }
}

onMounted(loadAll);
</script>

<template>
  <div class="inv">
    <header class="inv-head">
      <div>
        <h1 class="inv-title">邀请与兑换</h1>
        <p class="inv-sub">邀请码归因 → 分销关系（单层）→ 奖励走积分账本</p>
      </div>
      <button type="button" class="inv-btn" :disabled="loading" @click="loadAll">刷新</button>
    </header>

    <p v-if="errorMsg" class="inv-alert">
      {{ errorMsg }}
      <button type="button" class="inv-link" @click="loadAll">重试</button>
    </p>

    <div v-if="loading" class="inv-skeleton">加载中…</div>

    <div v-else class="inv-grid">
      <!-- 我的邀请码 -->
      <section class="inv-card">
        <h2 class="inv-card-title">我的邀请码</h2>
        <p class="inv-hint">一人一码（重复生成返回同一个），被邀请人核销后你与他建立单层分销关系。</p>
        <div v-if="invite?.code" class="inv-code-box">
          <code class="inv-code">{{ invite.code }}</code>
          <button type="button" class="inv-btn primary sm" @click="copyLink">复制邀请链接</button>
        </div>
        <p v-else class="inv-muted">还没生成邀请码，点右上「刷新」触发一次生成。</p>
        <p class="inv-link-text">{{ inviteLink }}</p>
        <dl class="inv-kv">
          <div><dt>核销赠分</dt><dd>{{ invite?.credits ?? 0 }}</dd></div>
          <div><dt>已邀请</dt><dd>{{ invite?.invitee_count ?? 0 }}</dd></div>
        </dl>
      </section>

      <!-- 补填邀请码 -->
      <section class="inv-card">
        <h2 class="inv-card-title">补填邀请码</h2>
        <p class="inv-hint">
          登录时没填邀请码？这里可以补。核销幂等：重复核销返回「已用过」，不会重复发分。
        </p>
        <div class="inv-form">
          <input v-model="verifyCodeInput" class="inv-input" maxlength="64" placeholder="请输入邀请码，如 OFA1B2C3D4" />
          <button type="button" class="inv-btn primary" :disabled="busy === 'verify'" @click="verifyInvite">
            {{ busy === "verify" ? "核销中…" : "核销" }}
          </button>
        </div>
      </section>

      <!-- 每日奖励 -->
      <section class="inv-card">
        <h2 class="inv-card-title">每日奖励</h2>
        <p class="inv-hint">每人每天 1 次，发 5 积分（运营可调的常量）。</p>
        <button
          type="button"
          class="inv-btn primary"
          :disabled="busy === 'daily' || daily?.already_rewarded === true"
          :title="daily?.already_rewarded ? '今天已领取' : ''"
          @click="claimDaily"
        >
          {{ daily?.already_rewarded ? "今天已领取，明天再来" : busy === "daily" ? "领取中…" : "领取今日奖励" }}
        </button>
        <p v-if="daily?.balance_after != null" class="inv-ok">领取后余额：{{ daily.balance_after }}</p>
      </section>

      <!-- 分销概览 -->
      <section class="inv-card">
        <h2 class="inv-card-title">分销概览</h2>
        <p class="inv-hint">
          `commission_bps` 默认 0：佣金结算要接订单分账，本批只建立关系与口径，不计佣。
        </p>
        <dl v-if="distributor" class="inv-kv">
          <div><dt>有效邀请人数</dt><dd>{{ distributor.invitee_count }}</dd></div>
          <div><dt>佣金比例</dt><dd>{{ (distributor.me.commission_bps / 100).toFixed(2) }}%</dd></div>
          <div><dt>已结算佣金</dt><dd>{{ distributor.income_credits }}</dd></div>
          <div><dt>上级邀请人</dt><dd class="inv-mono">{{ distributor.me.parent_user_id ?? "—" }}</dd></div>
        </dl>
      </section>

      <!-- 兑换码（两段式） -->
      <section class="inv-card inv-card-wide">
        <h2 class="inv-card-title">兑换码</h2>
        <p class="inv-hint">
          两段式：先「查询」看到这是什么码、给多少分，再确认「兑换」。并发安全靠唯一键，不会重复到账。
        </p>
        <div class="inv-form">
          <input v-model="redeemInput" class="inv-input" maxlength="32" placeholder="请输入兑换码" />
          <button type="button" class="inv-btn" :disabled="busy === 'redeem-info'" @click="queryRedeem">
            {{ busy === "redeem-info" ? "查询中…" : "查询" }}
          </button>
          <button
            type="button"
            class="inv-btn primary"
            :disabled="busy === 'redeem' || !redeemInfo?.valid"
            :title="redeemInfo && !redeemInfo.valid ? redeemReasonLabel : ''"
            @click="doRedeem"
          >
            {{ redeemInfo && !redeemInfo.valid ? redeemReasonLabel || "不可兑换" : busy === "redeem" ? "兑换中…" : "确认兑换" }}
          </button>
        </div>

        <div v-if="redeemInfo" class="inv-result">
          <template v-if="redeemInfo.found">
            <p>
              面额 <strong>{{ redeemInfo.credits }}</strong> 积分 ·
              剩余次数 <strong>{{ redeemInfo.remaining_uses < 0 ? "不限" : redeemInfo.remaining_uses }}</strong> ·
              有效期至 {{ redeemInfo.expires_at ? new Date(redeemInfo.expires_at).toLocaleString("zh-CN", { hour12: false }) : "长期" }}
            </p>
            <p v-if="!redeemInfo.valid" class="inv-warn">{{ redeemReasonLabel }}</p>
          </template>
          <p v-else class="inv-warn">兑换码不存在，请检查是否输错。</p>
        </div>

        <p v-if="redeemResult" class="inv-ok">
          <template v-if="redeemResult.replayed">该码你之前已兑换过，本次未重复发放。</template>
          <template v-else>兑换成功，到账 {{ redeemResult.credits }} 积分（余额 {{ redeemResult.balance_after }}）。</template>
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
