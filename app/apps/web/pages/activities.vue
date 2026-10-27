<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 活动中心（对照竞品 `/activities`、`/activities/:activityKey`，`rt:4`；数据来自
 * `campaign/*` 6 端点 `rt:267-272`，我用 `/v1/campaigns/*` 承载）。
 *
 * 交互按竞品的**双通道**设计复刻：
 *   - `campaign_id` 与 `campaign_key` 双主键（`d-commerce-account.md:431`）——前端展示可读 slug，
 *     请求可以带 key；我方后端两种都接受。
 *   - 报名草稿可续填（`signup/draft` GET+POST）——本页把"选作品 + 渠道"先存草稿，
 *     再提交；提交后不删草稿（"我上次填到哪"仍然可见）。
 *
 * 三态齐全：加载 / 空（没有可报名活动）/ 错误（可重试）。
 */

import type {
  CampaignDto,
  CampaignSignupDto,
  CampaignSignupResultDto,
  CreatorWorkDto,
  Paged,
} from "~/types/api";

const api = useApi();
const toast = useToast();

type Mode = "public" | "mine";
const mode = ref<Mode>("public");
const MODES: Array<{ key: Mode; label: string }> = [
  { key: "public", label: "可报名活动" },
  { key: "mine", label: "我报名的" },
];

const loading = ref(true);
const errorMsg = ref("");
const busy = ref("");
const campaigns = ref<CampaignDto[]>([]);
const myWorks = ref<CreatorWorkDto[]>([]);

const selected = ref<CampaignDto | null>(null);
const detail = ref<CampaignDto | null>(null);
const shortlist = ref<Paged<{ signup_id: string; user_id: string; nickname: string | null; status_label: string | null }> | null>(null);
const awards = ref<{ list: Array<{ signup_id: string; user_id: string; nickname: string | null }>; count: number; reward_credits: number } | null>(null);

const signupForm = reactive({ work_id: "", channel: "" });

function fmtTime(v?: string | null) {
  if (!v) return "长期";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(c: CampaignDto) {
  if (c.status === 2) return "进行中";
  if (c.status === 3) return "已结束";
  if (c.status === 1) return "未开始";
  return "已下线";
}

async function loadList() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const path = mode.value === "mine" ? "/crc/activity/list" : "/crc/activity/public";
    const res = await api.post<Paged<CampaignDto>>(path, { page_size: 50 });
    campaigns.value = res.list;
    if (mode.value === "public") {
      const works = await api.get<Paged<CreatorWorkDto>>("/crc/assets/me?status=3");
      myWorks.value = works.list;
    }
  } catch (e) {
    errorMsg.value = (e as Error).message || "活动列表加载失败";
  } finally {
    loading.value = false;
  }
}

async function openDetail(c: CampaignDto) {
  selected.value = c;
  detail.value = null;
  shortlist.value = null;
  awards.value = null;
  busy.value = "detail";
  try {
    detail.value = await api.get<CampaignDto>(`/crc/activity/info?id=${encodeURIComponent(c.id)}`);
    const draft = await api.get<{ has_draft: boolean; draft: { work_id: string | null; channel: string | null } | null }>(
      `/campaigns/${encodeURIComponent(c.id)}/signup`,
    );
    signupForm.work_id = draft.draft?.work_id ?? "";
    signupForm.channel = draft.draft?.channel ?? "";
    shortlist.value = await api.get<Paged<{ signup_id: string; user_id: string; nickname: string | null; status_label: string | null }>>(
      `/campaigns/${encodeURIComponent(c.id)}/shortlist?page_size=20`,
    );
    awards.value = await api.get<{ list: Array<{ signup_id: string; user_id: string; nickname: string | null }>; count: number; reward_credits: number }>(
      `/campaigns/${encodeURIComponent(c.id)}/awards`,
    );
  } catch (e) {
    toast.error((e as Error).message || "活动详情加载失败");
  } finally {
    busy.value = "";
  }
}

/** 存草稿（竞品 signup/draft POST 的等价物；本页在提交前一并保存，保证可续填） */
async function saveDraft() {
  if (!selected.value) return;
  busy.value = "draft";
  try {
    await api.put(`/campaigns/${encodeURIComponent(selected.value.id)}/signup`, {
      work_id: signupForm.work_id || null,
      channel: signupForm.channel || null,
    });
    toast.success("草稿已保存，可以稍后继续");
  } catch (e) {
    toast.error((e as Error).message || "保存草稿失败");
  } finally {
    busy.value = "";
  }
}

async function submitSignup() {
  if (!selected.value) return;
  busy.value = "signup";
  try {
    const res = await api.post<CampaignSignupResultDto>(
      `/campaigns/${encodeURIComponent(selected.value.id)}/signup`,
      { work_id: signupForm.work_id || null, channel: signupForm.channel || null },
    );
    if (res.replayed) {
      toast.info(res.revived ? "已重新报名（奖励不重复发放）" : "你已经报名过了");
    } else if (res.rewarded_credits > 0) {
      toast.success(`报名成功，到账 ${res.rewarded_credits} 积分`);
    } else {
      toast.success("报名成功");
    }
    await openDetail(selected.value);
    await loadList();
  } catch (e) {
    toast.error((e as Error).message || "报名失败");
  } finally {
    busy.value = "";
  }
}

async function cancelSignup() {
  if (!selected.value) return;
  if (!window.confirm("取消报名？已发放的奖励不会回收，但取消后重报不会再发一次。")) return;
  busy.value = "cancel";
  try {
    await api.delete(`/campaigns/${encodeURIComponent(selected.value.id)}/signup`);
    toast.success("已取消报名");
    await openDetail(selected.value);
    await loadList();
  } catch (e) {
    toast.error((e as Error).message || "取消失败");
  } finally {
    busy.value = "";
  }
}

async function switchMode(m: Mode) {
  mode.value = m;
  selected.value = null;
  detail.value = null;
  await loadList();
}

const mySignup = computed<CampaignSignupDto | null>(() => detail.value?.my_signup ?? null);

onMounted(loadList);
</script>

<template>
  <div class="act">
    <header class="act-head">
      <div>
        <h1 class="act-title">活动中心</h1>
        <p class="act-sub">投稿征集与命题创作：报名 → 投稿 → 入围 → 获奖</p>
      </div>
      <button type="button" class="act-btn" :disabled="loading" @click="loadList">刷新</button>
    </header>

    <nav class="act-tabs">
      <button
        v-for="m in MODES"
        :key="m.key"
        type="button"
        class="act-tab"
        :class="{ active: mode === m.key }"
        @click="switchMode(m.key)"
      >
        {{ m.label }}
      </button>
    </nav>

    <p v-if="errorMsg" class="act-alert">
      {{ errorMsg }}
      <button type="button" class="act-link" @click="loadList">重试</button>
    </p>

    <div v-if="loading" class="act-skeleton">加载中…</div>

    <p v-else-if="campaigns.length === 0" class="act-empty">
      <template v-if="mode === 'public'">当前没有进行中的活动。运营开活动后会出现在这里。</template>
      <template v-else>你还没有报名任何活动。切到「可报名活动」看看。</template>
    </p>

    <div v-else class="act-layout">
      <ul class="act-cards">
        <li v-for="c in campaigns" :key="c.id" class="act-card" :class="{ active: selected?.id === c.id }">
          <div class="act-card-head">
            <h2 class="act-card-title">{{ c.title }}</h2>
            <span class="act-tag">{{ statusLabel(c) }}</span>
          </div>
          <p class="act-card-brief">{{ c.brief || "（暂无活动说明）" }}</p>
          <p class="act-card-meta">
            奖励 <strong>{{ c.reward_credits }}</strong> 积分 · {{ fmtTime(c.start_at) }} ~ {{ fmtTime(c.end_at) }}
            <template v-if="c.campaign_key"> · 标识 {{ c.campaign_key }}</template>
          </p>
          <p v-if="c.my_signup" class="act-card-mine">
            我的报名：<span>{{ c.my_signup.status_label }}</span>
            <span v-if="c.my_signup.work_id" class="act-muted">（已提交作品）</span>
          </p>
          <div class="act-card-actions">
            <button type="button" class="act-btn sm" :disabled="busy === 'detail'" @click="openDetail(c)">
              查看详情
            </button>
            <button
              v-if="mode === 'public' && !c.my_signup"
              type="button"
              class="act-btn primary sm"
              :disabled="busy === 'signup'"
              @click="selected = c; openDetail(c)"
            >
              去报名
            </button>
          </div>
        </li>
      </ul>

      <aside v-if="selected" class="act-detail">
        <h2 class="act-detail-title">{{ selected.title }}</h2>
        <div v-if="busy === 'detail'" class="act-skeleton">详情加载中…</div>
        <template v-else-if="detail">
          <p class="act-card-brief">{{ detail.brief || "（暂无活动说明）" }}</p>
          <dl class="act-kv">
            <div><dt>报名奖励</dt><dd>{{ detail.reward_credits }} 积分</dd></div>
            <div><dt>报名窗口</dt><dd>{{ detail.open_for_signup ? "开放中" : "未开放" }}</dd></div>
            <div><dt>已报名</dt><dd>{{ detail.signup_count ?? 0 }}</dd></div>
            <div><dt>已入围</dt><dd>{{ detail.shortlist_count ?? 0 }}</dd></div>
          </dl>

          <!-- 报名表单 -->
          <section class="act-block">
            <h3>报名</h3>
            <template v-if="mySignup && mySignup.status !== 4">
              <p class="act-ok">
                当前状态：{{ mySignup.status_label }}
                <template v-if="mySignup.work_id"> · 作品 {{ mySignup.work_id }}</template>
              </p>
              <p class="act-hint">已入围/已获奖的报名不能自行取消（运营态）；取消后重报不会再发奖励。</p>
              <button
                type="button"
                class="act-btn sm"
                :disabled="busy === 'cancel' || mySignup.status !== 1"
                :title="mySignup.status !== 1 ? '已入围/获奖的报名不可自行取消' : ''"
                @click="cancelSignup"
              >
                {{ mySignup.status !== 1 ? "不可取消（已入围/获奖）" : "取消报名" }}
              </button>
            </template>
            <template v-else>
              <label class="act-field">
                <span>投稿作品（可选）</span>
                <select v-model="signupForm.work_id" class="act-input">
                  <option value="">先不选，报名后再投稿</option>
                  <option v-for="w in myWorks" :key="w.id" :value="w.id">{{ w.title }}</option>
                </select>
              </label>
              <label class="act-field">
                <span>来源渠道（可选）</span>
                <input v-model="signupForm.channel" class="act-input" maxlength="40" placeholder="如 douyin / wechat" />
              </label>
              <p v-if="myWorks.length === 0" class="act-hint">
                你还没有「已通过」的作品可投稿：先去创作者中心创建并通过审核，再回来选作品。
              </p>
              <div class="act-form-actions">
                <button type="button" class="act-btn sm" :disabled="busy === 'draft'" @click="saveDraft">
                  保存草稿
                </button>
                <button
                  type="button"
                  class="act-btn primary sm"
                  :disabled="busy === 'signup' || !detail.open_for_signup"
                  :title="detail.open_for_signup ? '' : '活动未开放报名'"
                  @click="submitSignup"
                >
                  {{ detail.open_for_signup ? "提交报名" : "未开放报名" }}
                </button>
              </div>
            </template>
          </section>

          <!-- 入围名单 -->
          <section class="act-block">
            <h3>入围名单（{{ shortlist?.count ?? 0 }}）</h3>
            <p v-if="!shortlist || shortlist.list.length === 0" class="act-muted">还没有入围名单。</p>
            <ul v-else class="act-name-list">
              <li v-for="s in shortlist.list" :key="s.signup_id">
                {{ s.nickname || s.user_id }} <span class="act-tag">{{ s.status_label }}</span>
              </li>
            </ul>
          </section>

          <!-- 获奖名单 -->
          <section class="act-block">
            <h3>获奖名单（{{ awards?.count ?? 0 }}）</h3>
            <p v-if="!awards || awards.list.length === 0" class="act-muted">还没有获奖名单。</p>
            <ul v-else class="act-name-list">
              <li v-for="a in awards.list" :key="a.signup_id">{{ a.nickname || a.user_id }}</li>
            </ul>
            <p class="act-hint">
              奖项结构未取证（竞品 `campaign/awards` 只给了路径）；我方以获奖名单承载，额度见「报名奖励」。
            </p>
          </section>
        </template>
        <p v-else class="act-alert">详情加载失败，请重试。</p>
      </aside>
      <aside v-else class="act-detail act-detail-empty">
        <p class="act-muted">左侧选一个活动查看详情、报名与名单。</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.act { display: flex; flex-direction: column; gap: var(--space-4); }
.act-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.act-title { font-size: 24px; font-weight: 700; margin: 0; }
.act-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.act-tabs { display: flex; gap: 4px; background: var(--surface-2); padding: 3px; border-radius: var(--radius-2); width: fit-content; }
.act-tab { border: 0; background: transparent; color: var(--text-2); font-size: 13px; padding: 7px 14px; border-radius: var(--radius-1); cursor: pointer; }
.act-tab.active { background: var(--surface-1); color: var(--text-1); font-weight: 600; }
.act-alert { margin: 0; padding: var(--space-3); border-radius: var(--radius-2); font-size: 13px; background: color-mix(in srgb, var(--danger-1, #e03131) 12%, transparent); color: var(--danger-1, #e03131); }
.act-skeleton { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.act-empty { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.act-layout { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(360px, 1fr); gap: var(--space-4); align-items: start; }
.act-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.act-card { padding: var(--space-4); background: var(--surface-1); border: 1px solid var(--border-1); border-radius: var(--radius-3); display: flex; flex-direction: column; gap: 6px; }
.act-card.active { border-color: var(--brand-1, #7e70ff); }
.act-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.act-card-title { font-size: 15px; font-weight: 600; margin: 0; }
.act-card-brief { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.6; }
.act-card-meta { margin: 0; color: var(--text-3); font-size: 12px; }
.act-card-mine { margin: 0; font-size: 12px; color: var(--brand-1, #7e70ff); }
.act-card-actions { display: flex; gap: 6px; margin-top: 4px; }
.act-detail { padding: var(--space-4); background: var(--surface-1); border: 1px solid var(--border-1); border-radius: var(--radius-3); display: flex; flex-direction: column; gap: var(--space-3); position: sticky; top: var(--space-4); }
.act-detail-empty { color: var(--text-3); font-size: 13px; }
.act-detail-title { font-size: 16px; font-weight: 600; margin: 0; }
.act-kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); margin: 0; }
.act-kv dt { color: var(--text-3); font-size: 12px; margin: 0; }
.act-kv dd { margin: 2px 0 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.act-block { border-top: 1px solid var(--border-1); padding-top: var(--space-3); display: flex; flex-direction: column; gap: 8px; }
.act-block h3 { font-size: 13px; font-weight: 600; margin: 0; }
.act-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-3); }
.act-input { padding: 8px 10px; font-size: 13px; border: 1px solid var(--border-1); border-radius: var(--radius-2); background: var(--surface-1); color: var(--text-1); }
.act-form-actions { display: flex; gap: 6px; }
.act-btn { border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-1); font-size: 13px; padding: 7px 12px; border-radius: var(--radius-2); cursor: pointer; }
.act-btn.sm { padding: 5px 10px; font-size: 12px; }
.act-btn.primary { background: var(--brand-1, #7e70ff); border-color: transparent; color: #fff; }
.act-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.act-link { border: 0; background: transparent; color: var(--brand-1, #7e70ff); cursor: pointer; font-size: 13px; }
.act-tag { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); font-size: 11px; }
.act-muted { color: var(--text-3); font-size: 12px; margin: 0; }
.act-hint { color: var(--text-3); font-size: 12px; margin: 0; line-height: 1.6; }
.act-ok { margin: 0; color: var(--success-1, #2f9e44); font-size: 13px; }
.act-name-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }

@media (max-width: 1080px) {
  .act-layout { grid-template-columns: 1fr; }
  .act-detail { position: static; }
}
</style>
