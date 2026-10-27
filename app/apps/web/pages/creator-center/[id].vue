<script setup lang="ts">
/**
 * 作品详情页（模块 #10 · 竞品 `/creator-center/:id`，`rea-reelmate/routes.txt:44`）。
 *
 * 与 `index.vue` 的分工：index 是"我的作品列表 + 上传资产"（crc 域），本页是**单个集市作品**
 * 的管理台（market 域）：审核状态、上架前置条件、提审/下架、收益概览入口。
 *
 * 三条判断：
 * 1. **状态机只读后端**：1 草稿 / 2 待审 / 3 在售 / 4 驳回 / 5 下架 / 6 预售中；
 *    按钮可用性按状态推导（草稿→提审、在售→下架、驳回→重新提审），不让用户点出 400101。
 * 2. **上架前置条件由后端一次给全**（`ready` + `missing[]`）：前端逐条展示而不是自己复算，
 *    否则"价格>0""本子已定稿"这类规则会两处漂移。
 * 3. 编辑保存走 `POST /market/creator/works`（带 `id` 即更新），提交审核走 `.../submit`，
 *    下架走 `.../offline`；三个动作都要重新拉详情（状态由服务端定）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t, locale } = useI18n();
useHead({ title: () => t("workDetail.metaTitle") });

const api = useApi();
const toast = useToast();
const route = useRoute();
const router = useRouter();

interface WorkDetail {
  id: string;
  title: string;
  summary: string;
  kind: number;
  kind_name: string;
  price_credits: number;
  preorder_price_credits?: number | null;
  status: number;
  status_name?: string;
  audit_note?: string | null;
  sales_count?: number;
  revenue_credits?: number;
  published_at?: string | null;
  /** 上架前置条件（后端算，见 market.service.creatorWorkDetail） */
  readiness?: {
    has_novel: boolean;
    novel_finalized: boolean | null;
    price_set: boolean;
    can_submit: boolean;
  } | null;
  counts?: { chapters?: number; episodes?: number; words?: number } | null;
}

const workId = computed(() => String(route.params.id ?? ""));
const work = ref<WorkDetail | null>(null);
const loading = ref(true);
const busy = ref("");
const error = ref("");

// 状态文案走 i18n（computed：常量在 setup 期固化，切语言不更新）
const STATUS_LABEL = computed<Record<number, string>>(() => ({
  1: t("workDetail.statuses.draft"),
  2: t("workDetail.statuses.pending"),
  3: t("workDetail.statuses.onSale"),
  4: t("workDetail.statuses.rejected"),
  5: t("workDetail.statuses.offline"),
  6: t("workDetail.statuses.preorder"),
}));

const canSubmit = computed(() => work.value && [1, 4, 5].includes(work.value.status));
const canOffline = computed(() => work.value && [3, 6].includes(work.value.status));

const form = reactive({ title: "", summary: "", price: 0, preorder: 0 });
const editing = ref(false);

async function load(): Promise<void> {
  if (!workId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const detail = await api.get<WorkDetail>(`/market/creator/works/${workId.value}`);
    work.value = detail;
    form.title = detail.title;
    form.summary = detail.summary ?? "";
    form.price = detail.price_credits;
    form.preorder = detail.preorder_price_credits ?? 0;
  } catch (err) {
    error.value = (err as Error).message || t("workDetail.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    toast.error(t("workDetail.titleRequired"));
    return;
  }
  busy.value = "save";
  try {
    // 更新用 `work_id`（不是 `id`）：server 端 creatorSaveWork 按 work_id 判定更新，
    // 传 id 会被当成"新建"从而多出一条作品。
    await api.post("/market/creator/works", {
      work_id: workId.value,
      title: form.title.trim(),
      summary: form.summary.trim(),
      price_credits: Math.floor(form.price),
      preorder_price_credits: form.preorder > 0 ? Math.floor(form.preorder) : null,
    });
    toast.success(t("workDetail.saved"));
    editing.value = false;
    await load();
  } catch (err) {
    toast.error((err as Error).message || t("workDetail.saveFailed"));
  } finally {
    busy.value = "";
  }
}

async function action(kind: "submit" | "offline"): Promise<void> {
  if (kind === "offline" && !window.confirm(t("workDetail.offlineConfirm"))) return;
  busy.value = kind;
  try {
    await api.post(`/market/creator/works/${workId.value}/${kind}`, {});
    toast.success(kind === "submit" ? t("workDetail.submitted") : t("workDetail.offlineDone"));
    await load();
  } catch (err) {
    toast.error((err as Error).message || t("workDetail.opFailed"));
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="detail">
    <header class="head">
      <div>
        <h1>{{ work?.title || t("workDetail.titleFallback") }}</h1>
        <p v-if="work" class="muted">
          {{ work.kind_name }} ·
          <span class="tag" :class="`tag-${work.status}`">
            {{ work.status_name ?? STATUS_LABEL[work.status] ?? work.status }}
          </span>
          {{ t("workDetail.stats", { sales: work.sales_count ?? 0, revenue: work.revenue_credits ?? 0 }) }}
        </p>
      </div>
      <div class="head-actions">
        <NuxtLink :to="`/creator-center/preview/${workId}`" class="link">{{ t("workDetail.preview") }}</NuxtLink>
        <NuxtLink to="/creator-center/earnings" class="link">{{ t("workDetail.earnings") }}</NuxtLink>
        <NuxtLink to="/creator-center" class="link">{{ t("workDetail.back") }}</NuxtLink>
      </div>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="loading" class="muted">{{ t("workDetail.loading") }}</p>

    <template v-else-if="work">
      <!-- 审核意见 -->
      <p v-if="work.audit_note" class="audit-note">
        {{ t("workDetail.auditNote", { note: work.audit_note }) }}
      </p>

      <!-- 上架前置条件（后端 readiness 一次给全，前端逐条展示不复算） -->
      <p v-if="work.readiness && !work.readiness.can_submit" class="missing">
        {{ t("workDetail.cannotSubmit") }}
        <span v-if="!work.readiness.price_set">{{ t("workDetail.needPrice") }}</span>
        <span v-if="work.readiness.has_novel && work.readiness.novel_finalized !== true">
          <template v-if="!work.readiness.price_set"> · </template>{{ t("workDetail.needFinalized") }}
        </span>
      </p>

      <section class="panel">
        <div class="panel-head">
          <h2>{{ t("workDetail.basicTitle") }}</h2>
          <button type="button" class="btn tiny" @click="editing = !editing">
            {{ editing ? t("workDetail.cancel") : t("workDetail.edit") }}
          </button>
        </div>
        <div v-if="editing" class="grid">
          <label class="field">
            <span>{{ t("workDetail.titleLabel") }}</span>
            <input v-model="form.title" maxlength="120" />
          </label>
          <label class="field">
            <span>{{ t("workDetail.priceLabel") }}</span>
            <input v-model.number="form.price" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span>{{ t("workDetail.preorderLabel") }}</span>
            <input v-model.number="form.preorder" type="number" min="0" step="1" />
          </label>
          <label class="field wide">
            <span>{{ t("workDetail.summaryLabel") }}</span>
            <textarea v-model="form.summary" rows="4" maxlength="2000" />
          </label>
          <div class="row">
            <button type="button" class="btn primary" :disabled="busy === 'save'" @click="save">
              {{ busy === "save" ? t("workDetail.saving") : t("workDetail.save") }}
            </button>
          </div>
        </div>
        <dl v-else class="kv">
          <dt>{{ t("workDetail.priceRow") }}</dt><dd>{{ t("earnings.creditUnit", { value: work.price_credits }) }}</dd>
          <dt>{{ t("workDetail.preorderRow") }}</dt><dd>{{ work.preorder_price_credits ?? t("workDetail.notEnabled") }}</dd>
          <dt>{{ t("workDetail.contentRow") }}</dt>
          <dd>
            {{ t("workDetail.chaptersEpisodes", { count: work.counts?.chapters ?? work.counts?.episodes ?? 0 }) }}<template v-if="work.counts?.words">{{ t("workDetail.wordsSuffix", { count: work.counts.words }) }}</template>
          </dd>
          <dt>{{ t("workDetail.publishedRow") }}</dt>
          <dd>{{ work.published_at ? new Date(work.published_at).toLocaleString(locale) : t("workDetail.notPublished") }}</dd>
          <dt>{{ t("workDetail.summaryRow") }}</dt><dd class="summary">{{ work.summary || t("workDetail.noSummary") }}</dd>
        </dl>
      </section>

      <section class="panel">
        <h2>{{ t("workDetail.opsTitle") }}</h2>
        <div class="row">
          <button
            v-if="canSubmit"
            type="button"
            class="btn primary"
            :disabled="busy === 'submit'"
            @click="action('submit')"
          >
            {{ busy === "submit" ? t("workDetail.submitting") : work.status === 4 ? t("workDetail.resubmit") : t("workDetail.submitReview") }}
          </button>
          <button
            v-if="canOffline"
            type="button"
            class="btn"
            :disabled="busy === 'offline'"
            @click="action('offline')"
          >
            {{ busy === "offline" ? t("workDetail.offlining") : t("workDetail.offline") }}
          </button>
          <span class="muted small">
            {{ t("workDetail.statusHint") }}
          </span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.head p {
  margin: 0;
  font-size: var(--text-sm);
}
.head-actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-sunken);
  font-size: var(--text-xs);
}
.tag-3,
.tag-6 {
  color: #42d392;
}
.tag-2 {
  color: #f0a020;
}
.tag-4 {
  color: #ff6b6b;
}
.audit-note {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: rgba(255, 107, 107, 0.08);
  color: #ff9b9b;
  font-size: var(--text-sm);
}
.missing {
  margin: 0 0 var(--space-3);
  color: #f0a020;
  font-size: var(--text-sm);
}
.panel {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
}
.panel h2 {
  margin: 0;
  font-size: var(--text-md);
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-sm);
}
.field.wide {
  grid-column: 1 / -1;
}
.field input,
.field textarea {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
  font: inherit;
}
.kv {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: var(--text-sm);
}
.kv dt {
  color: var(--text-3);
}
.kv dd {
  margin: 0;
  color: var(--text-1);
}
.kv dd.summary {
  white-space: pre-wrap;
  line-height: 1.7;
}
.row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  font: inherit;
}
.btn.primary {
  background: var(--brand-1);
  border-color: transparent;
  color: #fff;
}
.btn.tiny {
  padding: 4px 10px;
  font-size: var(--text-xs);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.err {
  color: #ff6b6b;
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
