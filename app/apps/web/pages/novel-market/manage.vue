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
      api.get<{ list: MarketWorkDto[] }>("/market/creator/works?page_size=50"),
      api.get<MarketRevenueOverviewDto>("/market/creator/revenues/overview"),
      api.get<{ list: MarketRevenueRowDto[] }>("/market/creator/revenues?page_size=20"),
      api.get<{ list: MarketWithdrawalDto[] }>("/market/creator/withdrawals?page_size=20"),
      api.get<MarketConfigDto>("/market/scripts/config"),
    ]);
    profile.value = p;
    works.value = w.list;
    overview.value = o;
    revenues.value = rev.list;
    withdrawals.value = wd.list;
    config.value = cfg;
    if (withdrawAmount.value === "") withdrawAmount.value = o.available_credits;
  } catch (e) {
    errorMsg.value = (e as Error).message || "创作者数据加载失败";
  } finally {
    loading.value = false;
  }
}

/** 作品解析：本子 → 上架表单建议值（后端不写库，只是"填表助手"） */
async function parseNovel() {
  if (!form.novel_id.trim()) {
    toast.error("先填本子 ID（小说改编页里那本书的 id）");
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
    if (!res.finalized) toast.info("该本子还没定稿，定稿后才能提交审核");
    else toast.success(`解析完成：${res.chapter_count} 章 / ${res.character_count} 个角色`);
  } catch (e) {
    toast.error((e as Error).message || "解析失败");
  } finally {
    parsing.value = false;
  }
}

async function saveDraft() {
  if (!form.title.trim()) {
    toast.error("请填作品标题");
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
    toast.success("已保存为草稿");
    form.title = "";
    form.summary = "";
    parsed.value = null;
    await load();
  } catch (e) {
    toast.error((e as Error).message || "保存失败");
  } finally {
    creating.value = false;
  }
}

async function submitWork(work: MarketWorkDto) {
  try {
    await api.post(`/market/creator/works/${work.id}/submit`);
    toast.success("已提交审核");
    await load();
  } catch (e) {
    toast.error((e as Error).message || "提交失败");
  }
}

async function offlineWork(work: MarketWorkDto) {
  if (!window.confirm(`下架《${work.title}》？已购用户仍可下载，但新用户不能再买。`)) return;
  try {
    await api.post(`/market/creator/works/${work.id}/offline`);
    toast.success("已下架");
    await load();
  } catch (e) {
    toast.error((e as Error).message || "下架失败");
  }
}

async function requestWithdraw() {
  const amount = Number(withdrawAmount.value);
  if (!Number.isInteger(amount) || amount <= 0) {
    toast.error("请输入正整数积分");
    return;
  }
  withdrawing.value = true;
  try {
    await api.post("/market/creator/withdraw", {
      amount_credits: amount,
      channel: withdrawChannel.value,
      account_info: withdrawAccount.value.trim() ? { account: withdrawAccount.value.trim() } : {},
    });
    toast.success("提现申请已提交，等待运营审核");
    withdrawAmount.value = "";
    await load();
  } catch (e) {
    const err = e as ApiError;
    toast.error(err.message || "提现申请失败");
  } finally {
    withdrawing.value = false;
  }
}

async function cancelWithdrawal(row: MarketWithdrawalDto) {
  try {
    await api.post(`/market/creator/withdrawals/${row.id}/cancel`);
    toast.success("已撤销");
    await load();
  } catch (e) {
    toast.error((e as Error).message || "撤销失败");
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

onMounted(load);
</script>

<template>
  <div class="mg-page">
    <header class="mg-head">
      <div>
        <h1 class="mg-title">我的集市作品</h1>
        <p class="mg-sub">上架 · 审核 · 收益 · 提现（平台抽成 {{ commissionText }}，运营未拍板）</p>
      </div>
      <div class="mg-head-actions">
        <NuxtLink to="/novel-market" class="mg-btn">去集市逛逛</NuxtLink>
        <button type="button" class="mg-btn" :disabled="loading" @click="load">刷新</button>
      </div>
    </header>

    <p v-if="loading" class="mg-state">正在加载创作者数据…</p>
    <div v-else-if="errorMsg" class="mg-state mg-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="mg-btn" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 收益概览 -->
      <section class="mg-kpis">
        <div class="mg-kpi">
          <span class="mg-kpi-label">累计收益</span>
          <strong class="mg-kpi-num">{{ (overview?.revenue_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">可提现</span>
          <strong class="mg-kpi-num">{{ (overview?.available_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">已申请（审核中/已通过）</span>
          <strong class="mg-kpi-num">{{ (overview?.locked_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">已打款</span>
          <strong class="mg-kpi-num">{{ (overview?.paid_credits ?? 0).toLocaleString() }}</strong>
        </div>
        <div class="mg-kpi">
          <span class="mg-kpi-label">作品 / 在售</span>
          <strong class="mg-kpi-num">{{ profile?.works_count ?? 0 }} / {{ profile?.on_sale_count ?? 0 }}</strong>
        </div>
      </section>
      <p class="mg-note">{{ overview?.settlement_note ?? "" }}</p>

      <!-- 上架表单 -->
      <section class="mg-panel">
        <h2 class="mg-h2">上架新作品</h2>
        <div class="mg-form">
          <label class="mg-field">
            <span class="mg-label">本子 ID（可选；填了可用「解析本子」自动填表）</span>
            <div class="mg-inline">
              <input v-model="form.novel_id" class="mg-input" placeholder="例如 108386629107646464">
              <button type="button" class="mg-btn" :disabled="parsing" @click="parseNovel">
                {{ parsing ? "解析中…" : "解析本子" }}
              </button>
            </div>
          </label>
          <p v-if="parsed" class="mg-note">
            解析结果：{{ parsed.chapter_count }} 章 / {{ parsed.total_word_count.toLocaleString() }} 字 /
            {{ parsed.character_count }} 角色 / {{ parsed.episode_count }} 集 ·
            {{ parsed.finalized ? "已定稿，可提交审核" : "未定稿，先定稿再提审" }}
          </p>
          <label class="mg-field">
            <span class="mg-label">标题</span>
            <input v-model="form.title" class="mg-input" placeholder="作品标题">
          </label>
          <label class="mg-field">
            <span class="mg-label">简介</span>
            <textarea v-model="form.summary" class="mg-input mg-textarea" rows="3" placeholder="一句话说清卖点" />
          </label>
          <div class="mg-row">
            <label class="mg-field">
              <span class="mg-label">售价（积分）</span>
              <input v-model.number="form.price_credits" class="mg-input" type="number" min="0">
            </label>
            <label class="mg-field">
              <span class="mg-label">预售定金（留空 = 直接上架在售）</span>
              <input v-model="form.preorder_price_credits" class="mg-input" type="number" min="0" placeholder="留空">
            </label>
            <label class="mg-field">
              <span class="mg-label">分类</span>
              <select v-model="form.category_id" class="mg-input">
                <option value="">不选</option>
                <option v-for="c in config?.categories ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
          </div>
          <div v-if="(config?.tags ?? []).length > 0" class="mg-field">
            <span class="mg-label">标签（可多选）</span>
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
              保存为草稿
            </button>
            <span class="mg-note">存草稿后在上方列表里点「提交审核」进入审核队列</span>
          </div>
        </div>
      </section>

      <!-- 我的作品 -->
      <section class="mg-panel">
        <h2 class="mg-h2">我的作品（{{ works.length }}）</h2>
        <p v-if="works.length === 0" class="mg-state">还没有作品。用上面的表单上架第一部。</p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th>售价</th>
              <th>已售</th>
              <th>收益</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in works" :key="w.id">
              <td>
                <NuxtLink :to="`/novel-market/${w.id}`" class="mg-link">{{ w.title }}</NuxtLink>
                <p v-if="w.audit_note" class="mg-audit">审核意见：{{ w.audit_note }}</p>
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
                  提交审核
                </button>
                <button
                  v-if="actionsOf(w).offline"
                  type="button"
                  class="mg-btn mg-btn-sm"
                  @click="offlineWork(w)"
                >
                  下架
                </button>
                <span v-if="!actionsOf(w).submit && !actionsOf(w).offline" class="mg-note">
                  {{ w.status === 2 ? "审核中，不可操作" : "暂无可执行动作" }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 提现 -->
      <section class="mg-panel">
        <h2 class="mg-h2">提现申请</h2>
        <div class="mg-form">
          <div class="mg-row">
            <label class="mg-field">
              <span class="mg-label">
                提现金额（最低 {{ overview?.min_withdraw_credits ?? 100 }} 积分）
              </span>
              <input v-model.number="withdrawAmount" class="mg-input" type="number" min="1">
            </label>
            <label class="mg-field">
              <span class="mg-label">收款渠道</span>
              <select v-model="withdrawChannel" class="mg-input">
                <option value="alipay">支付宝</option>
                <option value="wechat">微信</option>
                <option value="bank">银行卡</option>
              </select>
            </label>
            <label class="mg-field">
              <span class="mg-label">收款账号（仅落库，不做真实打款）</span>
              <input v-model="withdrawAccount" class="mg-input" placeholder="账号/卡号">
            </label>
          </div>
          <div class="mg-form-actions">
            <button type="button" class="mg-btn mg-btn-primary" :disabled="withdrawing" @click="requestWithdraw">
              提交提现申请
            </button>
            <span class="mg-note">
              同一时间只能有 1 笔待审；打款由运营人工完成，系统只记录打款凭证
            </span>
          </div>
        </div>

        <p v-if="withdrawals.length === 0" class="mg-state">还没有提现记录。</p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>金额</th>
              <th>状态</th>
              <th>渠道</th>
              <th>审核意见</th>
              <th>申请时间</th>
              <th>操作</th>
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
                  撤销
                </button>
                <span v-else class="mg-note">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 收益明细 -->
      <section class="mg-panel">
        <h2 class="mg-h2">成交明细（最近 20 笔）</h2>
        <p v-if="revenues.length === 0" class="mg-state">还没有成交。</p>
        <table v-else class="mg-table">
          <thead>
            <tr>
              <th>作品</th>
              <th>类型</th>
              <th>成交价</th>
              <th>平台抽成</th>
              <th>我的收益</th>
              <th>状态</th>
              <th>时间</th>
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
