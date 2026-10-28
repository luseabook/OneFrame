<script setup lang="ts">
import type {
  MarketConfigDto,
  MarketCreatorParseDto,
  MarketCreatorProfileDto,
  MarketRevenueOverviewDto,
  MarketRevenueRowDto,
  MarketWithdrawalDto,
  MarketWorkDto,
} from "~/types/api";
import { ApiError } from "~/composables/useApi";

/**
 * 集市上架管理（`/novel-market/manage`）—— 创作者侧，对照竞品 `df/novel_market/creator/*`
 * （`routes.txt:601-613`）。
 *
 * 页面上每个按钮都对应一个真实端点，且**状态机不允许的动作直接不渲染**：
 * - 草稿/已驳回/已下架 → 显示「提交审核」；在售/预售中 → 显示「下架」；
 * - 待审 → 两个都不可用（审核中改不了，否则审核看的内容和最终上架的不一致）；
 * - 提现：只有「待审」可撤销，已通过/已打款不可撤（可能已在打款流程）。
 *
 * 收益口径（与后端一致）：`revenue_credits` 只累计、**不进积分余额**；
 * 可提现 = 累计收益 − 已申请未终结的提现。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t, locale } = useI18n();
useHead({ title: () => t("marketManage.metaTitle") });

const api = useApi();
const toast = useToast();

const loading = ref(true);
const errorMsg = ref("");
const profile = ref<MarketCreatorProfileDto | null>(null);
const works = ref<MarketWorkDto[]>([]);
const overview = ref<MarketRevenueOverviewDto | null>(null);
const revenues = ref<MarketRevenueRowDto[]>([]);
const withdrawals = ref<MarketWithdrawalDto[]>([]);
const config = ref<MarketConfigDto | null>(null);

const creating = ref(false);
const form = reactive({
  novel_id: "",
  title: "",
  summary: "",
  price_credits: 100,
  preorder_price_credits: "" as string | number,
  category_id: "",
  tag_ids: [] as string[],
});
const parsing = ref(false);
const parsed = ref<MarketCreatorParseDto | null>(null);

const withdrawAmount = ref<number | "">("");
const withdrawChannel = ref<"alipay" | "wechat" | "bank">("alipay");
const withdrawAccount = ref("");
const withdrawing = ref(false);

/**
 * 我的作品列表的筛选（第 94 批）。
 *
 * 后端 `GET /market/creator/works` 支持 `status` + `keyword`（与竞品 query 对齐）；
 * 此前前端一次性拉 `page_size=50` 全量、不在前端过滤，所以作品一多就只能靠肉眼找。
 * 这里把两个参数真正接到 UI 上 —— 光有后端参数没有可点的入口，
 * 等于「能力在但不可达」（第 65/66 批踩过的坑）。
 */
const worksKeyword = ref("");
const worksStatus = ref<"" | number>("");
const worksLoading = ref(false);
/** 作品数超过后端单页上限（50）时提示还有未展示的，避免"列表看着像全量" */
const worksTotal = ref(0);
const WORKS_PAGE_SIZE = 50;

async function loadWorks() {
  worksLoading.value = true;
  try {
    const params = new URLSearchParams({ page_size: String(WORKS_PAGE_SIZE) });
    const kw = worksKeyword.value.trim();
    if (kw) params.set("keyword", kw);
    if (worksStatus.value !== "") params.set("status", String(worksStatus.value));
    const res = await api.get<{ list: MarketWorkDto[]; total: number }>(
      `/market/creator/works?${params.toString()}`,
    );
    works.value = res.list;
    worksTotal.value = res.total;
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.worksLoadFailed"));
  } finally {
    worksLoading.value = false;
  }
}

function resetWorksFilters() {
  worksKeyword.value = "";
  worksStatus.value = "";
  void loadWorks();
}

/** 状态 → 可用动作（与后端状态机一一对应，前端不猜） */
function actionsOf(work: MarketWorkDto): { submit: boolean; offline: boolean } {
  return {
    submit: [1, 4, 5].includes(work.status),
    offline: [3, 6].includes(work.status),
  };
}

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [p, w, o, rev, wd, cfg] = await Promise.all([
      api.get<MarketCreatorProfileDto>("/market/creator/profile"),
      api.get<{ list: MarketWorkDto[]; total: number }>(
        `/market/creator/works?page_size=${WORKS_PAGE_SIZE}`,
      ),
      api.get<MarketRevenueOverviewDto>("/market/creator/revenues/overview"),
      api.get<{ list: MarketRevenueRowDto[] }>("/market/creator/revenues?page_size=20"),
      api.get<{ list: MarketWithdrawalDto[] }>("/market/creator/withdrawals?page_size=20"),
      api.get<MarketConfigDto>("/market/scripts/config"),
    ]);
    profile.value = p;
    works.value = w.list;
    worksTotal.value = w.total;
    overview.value = o;
    revenues.value = rev.list;
    withdrawals.value = wd.list;
    config.value = cfg;
    if (withdrawAmount.value === "") withdrawAmount.value = o.available_credits;
  } catch (e) {
    errorMsg.value = (e as Error).message || t("marketManage.creatorLoadFailed");
  } finally {
    loading.value = false;
  }
}

/** 作品解析：本子 → 上架表单建议值（后端不写库，只是"填表助手"） */
async function parseNovel() {
  if (!form.novel_id.trim()) {
    toast.error(t("marketManage.novelIdRequired"));
    return;
  }
  parsing.value = true;
  try {
    const res = await api.post<MarketCreatorParseDto>("/market/creator/works/parse", {
      novel_id: form.novel_id.trim(),
    });
    parsed.value = res;
    form.title = res.suggested.title;
    form.summary = res.suggested.summary;
    if (!res.finalized) toast.info(t("marketManage.notFinalized"));
    else toast.success(t("marketManage.parsedOk", { chapters: res.chapter_count, characters: res.character_count }));
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.parseFailed"));
  } finally {
    parsing.value = false;
  }
}

async function saveDraft() {
  if (!form.title.trim()) {
    toast.error(t("marketManage.titleRequired"));
    return;
  }
  creating.value = true;
  try {
    await api.post("/market/creator/works/save", {
      title: form.title.trim(),
      summary: form.summary.trim() || undefined,
      ...(form.novel_id.trim() ? { novel_id: form.novel_id.trim() } : {}),
      price_credits: Number(form.price_credits),
      preorder_price_credits:
        form.preorder_price_credits === "" ? null : Number(form.preorder_price_credits),
      ...(form.category_id ? { category_id: form.category_id } : {}),
      ...(form.tag_ids.length > 0 ? { tag_ids: form.tag_ids } : {}),
    });
    toast.success(t("marketManage.savedDraft"));
    form.title = "";
    form.summary = "";
    parsed.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.saveFailed"));
  } finally {
    creating.value = false;
  }
}

async function submitWork(work: MarketWorkDto) {
  try {
    await api.post(`/market/creator/works/${work.id}/submit`);
    toast.success(t("marketManage.submitted"));
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.submitFailed"));
  }
}

async function offlineWork(work: MarketWorkDto) {
  if (!window.confirm(t("marketManage.offlineConfirm", { title: work.title }))) return;
  try {
    await api.post(`/market/creator/works/${work.id}/offline`);
    toast.success(t("marketManage.offlineDone"));
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.offlineFailed"));
  }
}

async function requestWithdraw() {
  const amount = Number(withdrawAmount.value);
  if (!Number.isInteger(amount) || amount <= 0) {
    toast.error(t("marketManage.creditsPositive"));
    return;
  }
  withdrawing.value = true;
  try {
    await api.post("/market/creator/withdraw", {
      amount_credits: amount,
      channel: withdrawChannel.value,
      account_info: withdrawAccount.value.trim() ? { account: withdrawAccount.value.trim() } : {},
    });
    toast.success(t("marketManage.withdrawSubmitted"));
    withdrawAmount.value = "";
    await load();
  } catch (e) {
    const err = e as ApiError;
    toast.error(err.message || t("marketManage.withdrawFailed"));
  } finally {
    withdrawing.value = false;
  }
}

async function cancelWithdrawal(row: MarketWithdrawalDto) {
  try {
    await api.post(`/market/creator/withdrawals/${row.id}/cancel`);
    toast.success(t("marketManage.revoked"));
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("marketManage.revokeFailed"));
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

const commissionText = computed(() =>
  config.value ? `${config.value.commission_bps / 100}%` : "—",
);

/** 状态筛选项：与后端 `MARKET_WORK_STATUS`（1-6）一致，标签走 i18n */
const workStatusOptions = computed(() =>
  ([
    { value: 1, key: "statusDraft" },
    { value: 2, key: "statusPending" },
    { value: 3, key: "statusOnSale" },
    { value: 4, key: "statusRejected" },
    { value: 5, key: "statusOffline" },
    { value: 6, key: "statusPreorder" },
  ] as const).map((s) => ({ value: s.value, label: t(`marketManage.${s.key}`) })),
);

onMounted(load);
</script>

<template>
  <div class="mg-page">
    <header class="mg-head">
      <div>
        <h1 class="mg-title">{{ t("marketManage.title") }}</h1>
        <p class="mg-sub">{{ t("marketManage.sub", { commission: commissionText }) }}</p>
      </div>
      <div class="mg-head-actions">
        <NuxtLink to="/novel-market" class="mg-btn">{{ t("marketManage.browse") }}</NuxtLink>
        <button type="button" class="mg-btn" :disabled="loading" @click="load">{{ t("marketManage.refresh") }}</button>
      </div>
    </header>

    <p v-if="loading" class="mg-state">{{ t("marketManage.loading") }}</p>
    <div v-else-if="errorMsg" class="mg-state mg-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="mg-btn" @click="load">{{ t("marketManage.retry") }}</button>
    </div>

    <template v-else>
      <!-- 收益概览 -->
      <section class="mg-kpis">
        <div class="mg-kpi">
          <span class="mg-kpi-label">{{ t("marketManage.kpiRevenue") }}</span>
          <strong class="mg-kpi-num">{{ (overview?.revenue_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">{{ t("marketManage.kpiAvailable") }}</span>
          <strong class="mg-kpi-num">{{ (overview?.available_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">{{ t("marketManage.kpiApplied") }}</span>
          <strong class="mg-kpi-num">{{ (overview?.locked_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">{{ t("marketManage.kpiPaid") }}</span>
          <strong class="mg-kpi-num">{{ (overview?.paid_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">{{ t("marketManage.kpiWorks") }}</span>
          <strong class="mg-kpi-num">{{ profile?.works_count ?? 0 }} / {{ profile?.on_sale_count ?? 0 }}</strong>
        </div>
      </section>
      <p class="mg-note">{{ overview?.settlement_note ?? "" }}</p>

      <!-- 上架表单 -->
      <section class="mg-panel">
        <h2 class="mg-h2">{{ t("marketManage.publishTitle") }}</h2>
        <div class="mg-form">
          <label class="mg-field">
            <span class="mg-label">{{ t("marketManage.novelIdLabel") }}</span>
            <div class="mg-inline">
              <input v-model="form.novel_id" class="mg-input" :placeholder="t('marketManage.novelIdPlaceholder')">
              <button type="button" class="mg-btn" :disabled="parsing" @click="parseNovel">
                {{ parsing ? t("marketManage.parsing") : t("marketManage.parseNovel") }}
              </button>
            </div>
          </label>
          <p v-if="parsed" class="mg-note">
            {{
              t("marketManage.parsedResult", {
                chapters: parsed.chapter_count,
                words: parsed.total_word_count.toLocaleString(locale),
                characters: parsed.character_count,
                episodes: parsed.episode_count,
                finalized: parsed.finalized ? t("marketManage.finalizedYes") : t("marketManage.finalizedNo"),
              })
            }}
          </p>
          <label class="mg-field">
            <span class="mg-label">{{ t("marketManage.titleLabel") }}</span>
            <input v-model="form.title" class="mg-input" :placeholder="t('marketManage.titlePlaceholder')">
          </label>
          <label class="mg-field">
            <span class="mg-label">{{ t("marketManage.summaryLabel") }}</span>
            <textarea v-model="form.summary" class="mg-input mg-textarea" rows="3" :placeholder="t('marketManage.summaryPlaceholder')" />
          </label>
          <div class="mg-row">
            <label class="mg-field">
              <span class="mg-label">{{ t("marketManage.priceLabel") }}</span>
              <input v-model.number="form.price_credits" class="mg-input" type="number" min="0">
            </label>
            <label class="mg-field">
              <span class="mg-label">{{ t("marketManage.preorderLabel") }}</span>
              <input v-model="form.preorder_price_credits" class="mg-input" type="number" min="0" :placeholder="t('marketManage.preorderPlaceholder')">
            </label>
            <label class="mg-field">
              <span class="mg-label">{{ t("marketManage.categoryLabel") }}</span>
              <select v-model="form.category_id" class="mg-input">
                <option value="">{{ t("marketManage.noCategory") }}</option>
                <option v-for="c in config?.categories ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
          </div>
          <div v-if="(config?.tags ?? []).length > 0" class="mg-field">
            <span class="mg-label">{{ t("marketManage.tagsLabel") }}</span>
            <div class="mg-tags">
              <button
                v-for="t in config?.tags ?? []"
                :key="t.id"
                type="button"
                class="mg-tag"
                :class="{ 'mg-tag-active': form.tag_ids.includes(t.id) }"
                @click="
                  form.tag_ids.includes(t.id)
                    ? form.tag_ids.splice(form.tag_ids.indexOf(t.id), 1)
                    : form.tag_ids.push(t.id)
                "
              >
                {{ t.name }}
              </button>
            </div>
          </div>
          <div class="mg-form-actions">
            <button type="button" class="mg-btn mg-btn-primary" :disabled="creating" @click="saveDraft">
              {{ t("marketManage.saveDraft") }}
            </button>
            <span class="mg-note">{{ t("marketManage.draftHint") }}</span>
          </div>
        </div>
      </section>

      <!-- 我的作品 -->
      <section class="mg-panel">
        <h2 class="mg-h2">{{ t("marketManage.worksTitle", { count: worksTotal }) }}</h2>
        <div class="mg-works-filters">
          <input
            v-model="worksKeyword"
            class="mg-input"
            type="search"
            :placeholder="t('marketManage.worksSearchPlaceholder')"
            @keyup.enter="loadWorks"
          >
          <select v-model="worksStatus" class="mg-input mg-select" @change="loadWorks">
            <option value="">{{ t("marketManage.worksStatusAll") }}</option>
            <option v-for="s in workStatusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <button type="button" class="mg-btn" :disabled="worksLoading" @click="loadWorks">
            {{ worksLoading ? t("marketManage.worksSearching") : t("marketManage.worksSearch") }}
          </button>
          <button
            v-if="worksKeyword.trim() || worksStatus !== ''"
            type="button"
            class="mg-btn"
            :disabled="worksLoading"
            @click="resetWorksFilters"
          >
            {{ t("marketManage.worksReset") }}
          </button>
        </div>
        <!-- 后端单页上限 50：超了要说清楚，否则列表看着像全量 -->
        <p v-if="worksTotal > works.length" class="mg-note">
          {{ t("marketManage.worksTruncated", { shown: works.length, total: worksTotal }) }}
        </p>
        <p v-if="works.length === 0" class="mg-state">
          {{ worksKeyword.trim() || worksStatus !== "" ? t("marketManage.worksNoMatch") : t("marketManage.worksEmpty") }}
        </p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>{{ t("marketManage.thTitle") }}</th>
              <th>{{ t("marketManage.thStatus") }}</th>
              <th>{{ t("marketManage.thPrice") }}</th>
              <th>{{ t("marketManage.thSold") }}</th>
              <th>{{ t("marketManage.thRevenue") }}</th>
              <th>{{ t("marketManage.thOps") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in works" :key="w.id">
              <td>
                <NuxtLink :to="`/novel-market/${w.id}`" class="mg-link">{{ w.title }}</NuxtLink>
                <p v-if="w.audit_note" class="mg-audit">{{ t("marketManage.auditNote", { note: w.audit_note }) }}</p>
              </td>
              <td>
                <span class="mg-status">{{ w.status_name }}</span>
              </td>
              <td>{{ w.price_credits.toLocaleString() }}</td>
              <td>{{ w.sales_count }}</td>
              <td>{{ w.revenue_credits.toLocaleString() }}</td>
              <td class="mg-ops">
                <button
                  v-if="actionsOf(w).submit"
                  type="button"
                  class="mg-btn mg-btn-sm"
                  @click="submitWork(w)"
                >
                  {{ t("marketManage.submitReview") }}
                </button>
                <button
                  v-if="actionsOf(w).offline"
                  type="button"
                  class="mg-btn mg-btn-sm"
                  @click="offlineWork(w)"
                >
                  {{ t("marketManage.offline") }}
                </button>
                <span v-if="!actionsOf(w).submit && !actionsOf(w).offline" class="mg-note">
                  {{ w.status === 2 ? t("marketManage.statusReviewing") : t("marketManage.noAction") }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 提现 -->
      <section class="mg-panel">
        <h2 class="mg-h2">{{ t("marketManage.withdrawTitle") }}</h2>
        <div class="mg-form">
          <div class="mg-row">
            <label class="mg-field">
              <span class="mg-label">
                {{ t("marketManage.withdrawAmount", { min: overview?.min_withdraw_credits ?? 100 }) }}
              </span>
              <input v-model.number="withdrawAmount" class="mg-input" type="number" min="1">
            </label>
            <label class="mg-field">
              <span class="mg-label">{{ t("marketManage.channelLabel") }}</span>
              <select v-model="withdrawChannel" class="mg-input">
                <option value="alipay">{{ t("marketManage.channelAlipay") }}</option>
                <option value="wechat">{{ t("marketManage.channelWechat") }}</option>
                <option value="bank">{{ t("marketManage.channelBank") }}</option>
              </select>
            </label>
            <label class="mg-field">
              <span class="mg-label">{{ t("marketManage.accountLabel") }}</span>
              <input v-model="withdrawAccount" class="mg-input" :placeholder="t('marketManage.accountPlaceholder')">
            </label>
          </div>
          <div class="mg-form-actions">
            <button type="button" class="mg-btn mg-btn-primary" :disabled="withdrawing" @click="requestWithdraw">
              {{ t("marketManage.submitWithdraw") }}
            </button>
            <span class="mg-note">
              {{ t("marketManage.withdrawHint") }}
            </span>
          </div>
        </div>

        <p v-if="withdrawals.length === 0" class="mg-state">{{ t("marketManage.withdrawEmpty") }}</p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>{{ t("marketManage.thAmount") }}</th>
              <th>{{ t("marketManage.thStatus") }}</th>
              <th>{{ t("marketManage.thChannel") }}</th>
              <th>{{ t("marketManage.thAuditNote") }}</th>
              <th>{{ t("marketManage.thAppliedAt") }}</th>
              <th>{{ t("marketManage.thOps") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in withdrawals" :key="row.id">
              <td>{{ row.amount_credits.toLocaleString() }}</td>
              <td><span class="mg-status">{{ row.status_name }}</span></td>
              <td>{{ row.channel }}</td>
              <td>{{ row.review_note || "—" }}</td>
              <td>{{ fmtTime(row.created_at) }}</td>
              <td class="mg-ops">
                <button
                  v-if="row.status === 1"
                  type="button"
                  class="mg-btn mg-btn-sm"
                  @click="cancelWithdrawal(row)"
                >
                  {{ t("marketManage.revoke") }}
                </button>
                <span v-else class="mg-note">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 收益明细 -->
      <section class="mg-panel">
        <h2 class="mg-h2">{{ t("marketManage.revenueTitle") }}</h2>
        <p v-if="revenues.length === 0" class="mg-state">{{ t("marketManage.revenueEmpty") }}</p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>{{ t("marketManage.thWork") }}</th>
              <th>{{ t("marketManage.thKind") }}</th>
              <th>{{ t("marketManage.thDealPrice") }}</th>
              <th>{{ t("marketManage.thCommission") }}</th>
              <th>{{ t("marketManage.thMyRevenue") }}</th>
              <th>{{ t("marketManage.thStatus") }}</th>
              <th>{{ t("marketManage.thTime") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in revenues" :key="r.agreement_id">
              <td>{{ r.work_title }}</td>
              <td>{{ r.kind_name }}</td>
              <td>{{ r.price_credits.toLocaleString() }}</td>
              <td>{{ r.commission_credits.toLocaleString() }}</td>
              <td>{{ r.revenue_credits.toLocaleString() }}</td>
              <td>{{ r.status_name }}</td>
              <td>{{ fmtTime(r.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mg-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  color: var(--text-2);
}
.mg-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.mg-title {
  margin: 0;
  font-size: 20px;
  color: var(--text-1);
}
.mg-sub {
  margin: var(--space-1) 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.mg-head-actions {
  display: flex;
  gap: var(--space-2);
}
.mg-state {
  padding: var(--space-6);
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
}
.mg-state-error {
  color: var(--danger);
  border-color: var(--danger);
}
.mg-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-3);
}
.mg-kpi {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.mg-kpi-label {
  font-size: 12px;
  color: var(--text-3);
}
.mg-kpi-num {
  font-size: 18px;
  color: var(--text-1);
}
.mg-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-5);
}
.mg-h2 {
  margin: 0 0 var(--space-3);
  font-size: 15px;
  color: var(--text-1);
}
.mg-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.mg-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 160px;
}
.mg-label {
  font-size: 12px;
  color: var(--text-3);
}
.mg-input {
  background: var(--bg-sunken);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 12px;
  width: 100%;
}
.mg-textarea {
  resize: vertical;
  font-family: inherit;
}
.mg-row {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.mg-inline {
  display: flex;
  gap: var(--space-2);
}
.mg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.mg-tag {
  background: transparent;
  border: 1px solid var(--border-2);
  color: var(--text-2);
  border-radius: var(--radius-full);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.mg-tag-active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.mg-form-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.mg-works-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.mg-works-filters .mg-input {
  max-width: 260px;
}
.mg-select {
  max-width: 160px;
}
.mg-btn {
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.mg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mg-btn-primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
}
.mg-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.mg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mg-table th {
  text-align: left;
  font-weight: 500;
  color: var(--text-3);
  font-size: 12px;
  padding: var(--space-2);
  border-bottom: 1px solid var(--border-1);
}
.mg-table td {
  padding: var(--space-2);
  border-bottom: 1px solid var(--border-1);
  vertical-align: top;
}
.mg-status {
  color: var(--brand-on-soft);
}
.mg-ops {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.mg-link {
  color: var(--text-1);
  text-decoration: none;
}
.mg-audit {
  margin: var(--space-1) 0 0;
  font-size: 11px;
  color: var(--warning);
}
.mg-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-4);
}
</style>
