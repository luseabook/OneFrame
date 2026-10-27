<script setup lang="ts">
import type {
  MarketAgreementTextDto,
  MarketBuyResultDto,
  MarketCharacterDto,
  MarketContentTreeDto,
  MarketScriptDetailDto,
} from "~/types/api";
import { ApiError } from "~/composables/useApi";

/**
 * 集市作品详情（`/novel-market/:id`）—— 对照竞品 `/novel-market/:id`（`routes.txt:62`）
 * 与 `scripts/{nm_id}/detail|content-tree|characters|agreement|download`（`routes.txt:615-627`）。
 *
 * 关键交互（与竞品一致的"两步式"）：
 * - **详情/作者/协议公开可看**，真内容（内容树/角色/正文下载）**必须先购买**；
 * - 未购买时不是"空白页"，而是明确提示"购买后可见"并给出购买按钮——
 *   后端 403 的 details.reason 是 `not_purchased`，前端据此区分"没权限"与"出错"；
 * - 预售中的作品只能付定金（`preorder`），在售作品才能买断（`buy`），
 *   两个按钮按 status 切换，点错会被后端 400101 拒绝（前端也不给错按钮）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const toast = useToast();
const auth = useAuth();
const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const activeSpaceId = useActiveSpaceId();
const workId = computed(() => String(route.params.id ?? ""));

const loading = ref(true);
const errorMsg = ref("");
const detail = ref<MarketScriptDetailDto | null>(null);
const business = ref<Record<string, unknown> | null>(null);

const tab = ref<"overview" | "content" | "agreement">("overview");
const contentTree = ref<MarketContentTreeDto | null>(null);
const characters = ref<MarketCharacterDto[]>([]);
const contentLocked = ref(false);
const contentLoading = ref(false);
const contentError = ref("");

const agreement = ref<MarketAgreementTextDto | null>(null);
const agreementKind = ref(1);

const buying = ref(false);

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    detail.value = await api.get<MarketScriptDetailDto>(`/market/scripts/${workId.value}/detail`);
    business.value = await api.get<Record<string, unknown>>(`/market/scripts/${workId.value}/business`);
  } catch (e) {
    errorMsg.value = (e as Error).message || "作品加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadContent() {
  if (contentTree.value || contentLocked.value) return;
  contentLoading.value = true;
  contentError.value = "";
  try {
    contentTree.value = await api.get<MarketContentTreeDto>(`/market/scripts/${workId.value}/content-tree`);
    const chars = await api.get<{ list: MarketCharacterDto[] }>(`/market/scripts/${workId.value}/characters`);
    characters.value = chars.list;
  } catch (e) {
    if (e instanceof ApiError && e.code === 403101) {
      contentLocked.value = true;
    } else {
      contentError.value = (e as Error).message || "内容加载失败";
    }
  } finally {
    contentLoading.value = false;
  }
}

async function loadAgreement(kind?: number) {
  if (kind !== undefined) agreementKind.value = kind;
  try {
    agreement.value = await api.get<MarketAgreementTextDto>(
      `/market/scripts/${workId.value}/agreement?kind=${agreementKind.value}`,
    );
  } catch (e) {
    toast.error((e as Error).message || "协议加载失败");
  }
}

async function switchTab(next: "overview" | "content" | "agreement") {
  tab.value = next;
  if (next === "content") await loadContent();
  if (next === "agreement" && !agreement.value) await loadAgreement();
}

/** 买断 / 付定金：成功后立即刷新详情（余额与购买状态会变） */
async function purchase(kind: "buy" | "preorder") {
  if (!detail.value || buying.value) return;
  const price =
    kind === "buy" ? detail.value.price_credits : (detail.value.preorder_price_credits ?? 0);
  const label = kind === "buy" ? "买断" : "支付定金";
  if (!window.confirm(`确认${label}《${detail.value.title}》？将扣除 ${price.toLocaleString()} 积分。`)) return;
  buying.value = true;
  try {
    const res = await api.post<MarketBuyResultDto>(`/market/scripts/${workId.value}/${kind}`);
    if (res.idempotent) {
      toast.info("你已经买过这部作品，未重复扣分");
    } else {
      toast.success(`${label}成功，已扣除 ${price.toLocaleString()} 积分`);
    }
    contentTree.value = null;
    contentLocked.value = false;
    await load();
    await loadContent();
    tab.value = "content";
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 745701) toast.error("积分余额不足，请先充值");
    else toast.error(err.message || "购买失败");
  } finally {
    buying.value = false;
  }
}

/** 下载正文：token 在请求头里，所以必须用 fetch 取 blob 再触发下载（a[href] 带不上凭据） */
async function download() {
  if (!detail.value) return;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.state.value.accessToken ?? ""}`,
    };
    if (activeSpaceId.value) headers["X-Space-Id"] = activeSpaceId.value;
    const text = await $fetch<string>(`${runtimeConfig.public.apiBase}/v1/market/scripts/${workId.value}/download`, {
      headers,
      responseType: "text",
    });
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.value.title}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("已开始下载");
  } catch (e) {
    toast.error((e as Error).message || "下载失败（购买后才可下载）");
  }
}

const canBuy = computed(() => detail.value?.status === 3);
const canPreorder = computed(() => detail.value?.status === 6);
const kindName = computed(() => {
  const map: Record<number, string> = { 1: "购买协议", 2: "预售协议", 3: "授权协议" };
  return map[agreementKind.value] ?? "协议";
});

onMounted(load);
</script>

<template>
  <div class="md-page">
    <NuxtLink to="/novel-market" class="md-back">← 返回集市</NuxtLink>

    <p v-if="loading" class="md-state">正在加载作品…</p>
    <div v-else-if="errorMsg" class="md-state md-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="md-btn" @click="load">重试</button>
    </div>

    <template v-else-if="detail">
      <header class="md-head">
        <div class="md-cover">
          <img v-if="detail.cover_uri" :src="detail.cover_uri" :alt="detail.title" class="md-cover-img">
          <span v-else>{{ detail.kind_name }}</span>
        </div>
        <div class="md-head-main">
          <h1 class="md-title">{{ detail.title }}</h1>
          <p class="md-meta">
            <span class="md-status">{{ detail.status_name }}</span>
            <span>{{ detail.kind_name }}</span>
            <span>作者 {{ detail.author.nickname || "匿名" }}</span>
            <span>已售 {{ detail.sales_count }}</span>
          </p>
          <p class="md-summary">{{ detail.summary || "作者没有写简介" }}</p>
          <div class="md-actions">
            <span class="md-price">
              {{ detail.price_credits.toLocaleString() }} 积分
              <em v-if="detail.preorder_price_credits !== null" class="md-presale">
                （预售定金 {{ detail.preorder_price_credits.toLocaleString() }}）
              </em>
            </span>
            <button
              v-if="canBuy"
              type="button"
              class="md-btn md-btn-primary"
              :disabled="buying"
              @click="purchase('buy')"
            >
              立即买断
            </button>
            <button
              v-else-if="canPreorder"
              type="button"
              class="md-btn md-btn-primary"
              :disabled="buying"
              @click="purchase('preorder')"
            >
              支付预售定金
            </button>
            <span v-else class="md-hint">当前状态不可购买（{{ detail.status_name }}）</span>
            <button type="button" class="md-btn" @click="switchTab('agreement')">查看协议</button>
          </div>
        </div>
      </header>

      <nav class="md-tabs">
        <button
          v-for="t in ([
            { key: 'overview', label: '作品信息' },
            { key: 'content', label: '内容结构' },
            { key: 'agreement', label: '协议条款' },
          ] as const)"
          :key="t.key"
          type="button"
          class="md-tab"
          :class="{ 'md-tab-active': tab === t.key }"
          @click="switchTab(t.key)"
        >
          {{ t.label }}
        </button>
      </nav>

      <!-- 作品信息 -->
      <section v-if="tab === 'overview'" class="md-panel">
        <dl class="md-dl">
          <div><dt>章节</dt><dd>{{ detail.counts.chapters }}</dd></div>
          <div><dt>分集剧本</dt><dd>{{ detail.counts.episodes }}</dd></div>
          <div><dt>角色卡</dt><dd>{{ detail.counts.characters }}</dd></div>
          <div><dt>总字数</dt><dd>{{ detail.counts.total_word_count.toLocaleString() }}</dd></div>
        </dl>
        <p v-if="detail.audit_note" class="md-note">审核意见：{{ detail.audit_note }}</p>
        <div v-if="business" class="md-business">
          <h3 class="md-h3">商务条款</h3>
          <p class="md-business-line">
            平台抽成 {{ Number(business.commission_bps ?? 0) / 100 }}% ·
            创作者实收 {{ Number(business.creator_share_bps ?? 0) / 100 }}% ·
            最低提现 {{ String((business.settlement as Record<string, unknown>)?.min_withdraw_credits ?? "—") }} 积分
          </p>
          <p class="md-note">{{ String((business.settlement as Record<string, unknown>)?.note ?? "") }}</p>
        </div>
      </section>

      <!-- 内容结构（需购买） -->
      <section v-else-if="tab === 'content'" class="md-panel">
        <p v-if="contentLoading" class="md-state">正在加载内容结构…</p>
        <div v-else-if="contentLocked" class="md-locked">
          <p>内容结构、角色卡与正文下载需先购买本作品。</p>
          <p class="md-note">未购买时只展示公开信息；这是竞品的购买闸门语义，不是加载失败。</p>
          <button v-if="canBuy" type="button" class="md-btn md-btn-primary" @click="purchase('buy')">
            立即买断（{{ detail.price_credits.toLocaleString() }} 积分）
          </button>
          <button v-else-if="canPreorder" type="button" class="md-btn md-btn-primary" @click="purchase('preorder')">
            支付预售定金（{{ (detail.preorder_price_credits ?? 0).toLocaleString() }} 积分）
          </button>
        </div>
        <div v-else-if="contentError" class="md-state md-state-error">
          <p>{{ contentError }}</p>
          <button type="button" class="md-btn" @click="contentError = ''; loadContent()">重试</button>
        </div>
        <template v-else-if="contentTree">
          <div class="md-content-head">
            <p class="md-note">
              共 {{ contentTree.chapter_count }} 章 / {{ contentTree.total_word_count.toLocaleString() }} 字
            </p>
            <button type="button" class="md-btn" @click="download">下载正文（.md）</button>
          </div>
          <ol class="md-chapters">
            <li v-for="c in contentTree.chapters" :key="c.chapter_no" class="md-chapter">
              <span class="md-chapter-no">第 {{ c.chapter_no }} 章</span>
              <span class="md-chapter-title">{{ c.title }}</span>
              <span class="md-chapter-words">{{ c.word_count }} 字</span>
            </li>
          </ol>
          <p v-if="contentTree.chapters.length === 0" class="md-state">该作品还没有分章内容。</p>
          <h3 v-if="characters.length > 0" class="md-h3">角色卡（{{ characters.length }}）</h3>
          <ul v-if="characters.length > 0" class="md-chars">
            <li v-for="c in characters" :key="c.id" class="md-char">
              <strong>{{ c.name }}</strong>
              <span class="md-char-role">{{ c.role_type_name }}</span>
              <span class="md-char-desc">{{ c.description || c.personality }}</span>
            </li>
          </ul>
        </template>
      </section>

      <!-- 协议 -->
      <section v-else class="md-panel">
        <div class="md-agreement-head">
          <div class="md-agreement-kinds">
            <button
              v-for="k in ([
                { kind: 1, label: '购买' },
                { kind: 2, label: '预售' },
                { kind: 3, label: '授权' },
              ] as const)"
              :key="k.kind"
              type="button"
              class="md-tab"
              :class="{ 'md-tab-active': agreementKind === k.kind }"
              @click="loadAgreement(k.kind)"
            >
              {{ k.label }}
            </button>
          </div>
          <span class="md-note">{{ kindName }}（平台按成交信息自动生成）</span>
        </div>
        <p v-if="!agreement" class="md-state">正在加载协议…</p>
        <pre v-else class="md-agreement">{{ agreement.body }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.md-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  color: var(--text-2);
}
.md-back {
  font-size: 13px;
  color: var(--text-3);
  text-decoration: none;
}
.md-state {
  padding: var(--space-8);
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
}
.md-state-error {
  color: var(--danger);
  border-color: var(--danger);
}
.md-head {
  display: flex;
  gap: var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-5);
}
.md-cover {
  width: 168px;
  height: 168px;
  flex: 0 0 168px;
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-4);
  font-size: 13px;
  overflow: hidden;
}
.md-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.md-head-main {
  flex: 1;
  min-width: 0;
}
.md-title {
  margin: 0 0 var(--space-2);
  font-size: 20px;
  color: var(--text-1);
}
.md-meta {
  margin: 0 0 var(--space-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-3);
}
.md-status {
  color: var(--brand-on-soft);
}
.md-summary {
  margin: 0 0 var(--space-3);
  font-size: 13px;
  color: var(--text-2);
}
.md-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.md-price {
  font-size: 15px;
  font-weight: 600;
  color: var(--brand-on-soft);
}
.md-presale {
  font-size: 12px;
  font-style: normal;
  color: var(--warning);
}
.md-hint {
  font-size: 12px;
  color: var(--text-4);
}
.md-btn {
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.md-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.md-btn-primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
}
.md-tabs {
  display: flex;
  gap: var(--space-2);
}
.md-tab {
  background: transparent;
  border: 1px solid var(--border-2);
  color: var(--text-2);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: var(--radius-full);
  cursor: pointer;
}
.md-tab-active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.md-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-5);
}
.md-dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
  margin: 0 0 var(--space-4);
}
.md-dl dt {
  font-size: 12px;
  color: var(--text-4);
}
.md-dl dd {
  margin: var(--space-1) 0 0;
  font-size: 16px;
  color: var(--text-1);
}
.md-h3 {
  margin: var(--space-4) 0 var(--space-2);
  font-size: 14px;
  color: var(--text-1);
}
.md-note {
  font-size: 12px;
  color: var(--text-4);
  margin: var(--space-1) 0;
}
.md-business-line {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
}
.md-locked {
  text-align: center;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
}
.md-content-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}
.md-chapters {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.md-chapter {
  display: flex;
  gap: var(--space-3);
  font-size: 13px;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-1);
}
.md-chapter-no {
  color: var(--text-4);
  min-width: 64px;
}
.md-chapter-title {
  color: var(--text-1);
  flex: 1;
}
.md-chapter-words {
  color: var(--text-4);
}
.md-chars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-2);
}
.md-char {
  background: var(--bg-raised);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.md-char-role {
  color: var(--brand-on-soft);
  font-size: 11px;
}
.md-char-desc {
  color: var(--text-3);
}
.md-agreement-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}
.md-agreement-kinds {
  display: flex;
  gap: var(--space-2);
}
.md-agreement {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-2);
  background: var(--bg-sunken);
  border-radius: var(--radius-xl);
  padding: var(--space-4);
}
</style>
