<script setup lang="ts">
import type { ShareBatchDownloadDto, ShareView } from "~/types/api";

definePageMeta({ ssr: false });

// i18n（第 8 批补完）：分享页是公开页，外语用户常直接打开；文案全部走语言包。
// 任务状态名不再用 ~/types/api 的 statusLabel（模块级常量，不能跟随语言）。
const { t, locale } = useI18n();
useHead({ title: () => t('share.title') });

function statusText(status: number): string {
  switch (status) {
    case 1:
      return t('status.queued');
    case 2:
      return t('status.running');
    case 3:
      return t('status.done');
    case 4:
      return t('status.failed');
    case 5:
      return t('status.canceled');
    case 6:
      return t('status.reviewing');
    case 7:
      return t('status.reviewRejected');
    default:
      return t('status.unknown', { status });
  }
}

const route = useRoute();
const api = useApi();
const share = ref<ShareView | null>(null);
const error = ref("");
const loading = ref(true);
const reportOpen = ref(false);
const reportReason = ref("illegal");
const reportDetail = ref("");
const reportContact = ref("");
const reportMsg = ref("");
const reporting = ref(false);
const downloading = ref(false);
const downloadMsg = ref("");

/**
 * 打包下载（模块 #26 收尾）。
 *
 * 这里**不带任何凭证**：`POST /share/:token/batch-download` 是公开只读端点，只认本页面的
 * share token；打包范围由服务端按 share 行决定（不接受前端传 task_ids），所以越权读取
 * 在服务端就被挡住，前端不参与授权判断。
 */
async function downloadAll(): Promise<void> {
  downloading.value = true;
  downloadMsg.value = "";
  try {
    const data = await api.post<ShareBatchDownloadDto>(`/share/${String(route.params.token)}/batch-download`, {});
    downloadMsg.value = t("share.packed", { count: data.count });
    // 预签名 URL 有时效（默认 1 小时），直接交给浏览器下载/打开
    window.open(data.url, "_blank", "noopener,noreferrer");
  } catch (e) {
    downloadMsg.value = e instanceof Error ? e.message : t("share.packFailed");
  } finally {
    downloading.value = false;
  }
}

async function submitReport(): Promise<void> {
  reporting.value = true;
  reportMsg.value = "";
  try {
    await api.post(`/share/${String(route.params.token)}/report`, {
      reason: reportReason.value,
      detail: reportDetail.value || undefined,
      contact: reportContact.value || undefined,
    });
    reportMsg.value = t("share.ok");
    reportOpen.value = false;
    reportDetail.value = "";
  } catch (e) {
    reportMsg.value = e instanceof Error ? e.message : t("share.failed");
  } finally {
    reporting.value = false;
  }
}

onMounted(async () => {
  try {
    share.value = await api.get<ShareView>(`/share/${String(route.params.token)}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("share.expired");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="page">
    <p v-if="loading" class="loading">{{ t("common.loading") }}</p>
    <section v-else-if="error" class="panel">
      <h1>{{ t("share.unavailable") }}</h1>
      <p class="muted">{{ error }}</p>
      <NuxtLink to="/" class="link">{{ t("share.backHome") }}</NuxtLink>
    </section>
    <section v-else-if="share" class="panel">
      <header class="head">
        <h1>{{ t("share.title") }}</h1>
        <p class="meta">
          {{ share.mode }} · {{ statusText(share.status) }} · {{ new Date(share.created_at).toLocaleString(locale) }}
        </p>
      </header>

      <div v-if="share.results.length > 0" class="results">
        <div v-for="(item, index) in share.results" :key="index" class="result">
          <template v-if="item.text">
            <pre>{{ item.text }}</pre>
          </template>
          <template v-else>
            <p class="muted">{{ t("share.resultIndex", { index: index + 1 }) }}</p>
            <a :href="item.url" target="_blank" rel="noreferrer" class="download">{{ t("share.openResult") }}</a>
          </template>
        </div>
      </div>
      <p v-else class="muted">{{ t("share.pending") }}</p>

      <p v-if="share.error?.message" class="error">{{ share.error.message }}</p>

      <!-- 批量下载：公开接口（只认本页 token），打包范围由服务端按 share 行决定 -->
      <div v-if="share.results.length > 0" class="batch">
        <Button size="sm" :loading="downloading" @click="downloadAll">
          {{ downloading ? t("share.batching") : t("share.batchAll") }}
        </Button>
        <span v-if="downloadMsg" class="muted small">{{ downloadMsg }}</span>
      </div>

      <p class="muted small">{{ t("share.expires", { date: new Date(share.expires_at).toLocaleString(locale) }) }}</p>

      <div class="report">
        <Button v-if="!reportOpen" variant="ghost" size="sm" @click="reportOpen = true">{{ t("share.report") }}</Button>
        <div v-else class="report-form">
          <label class="field">
            <span class="label">{{ t("share.reasonLabel") }}</span>
            <select v-model="reportReason" class="input">
              <option value="illegal">{{ t("share.reasonIllegal") }}</option>
              <option value="porn">{{ t("share.reasonPorn") }}</option>
              <option value="violence">{{ t("share.reasonViolence") }}</option>
              <option value="infringement">{{ t("share.reasonInfringement") }}</option>
              <option value="spam">{{ t("share.reasonSpam") }}</option>
              <option value="other">{{ t("share.reasonOther") }}</option>
            </select>
          </label>
          <label class="field">
            <span class="label">{{ t("share.detailLabel") }}</span>
            <textarea v-model="reportDetail" class="input textarea" maxlength="500" />
          </label>
          <label class="field">
            <span class="label">{{ t("share.contactLabel") }}</span>
            <input v-model="reportContact" class="input" maxlength="100" />
          </label>
          <div class="report-actions">
            <Button size="sm" :loading="reporting" @click="submitReport">
              {{ reporting ? t("share.submitting") : t("share.submit") }}
            </Button>
            <Button variant="ghost" size="sm" @click="reportOpen = false">{{ t("common.cancel") }}</Button>
          </div>
        </div>
        <p v-if="reportMsg" class="info">{{ reportMsg }}</p>
      </div>

      <NuxtLink to="/" class="link">{{ t("share.brand") }}</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
/* 页容器：分享页放宽到 1040，便于承载成片信息 */
.page {
  flex: 1;
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
.loading {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
/* 卡片范式 C：成片信息区 */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-6);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.batch {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.meta {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.results {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
/* 成片/播放区域：下沉底 + 12 圆角 */
.result {
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: var(--space-4);
}
.result pre {
  margin: 0;
  white-space: pre-wrap;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.7;
}
.download {
  display: inline-block;
  color: var(--brand-300);
  font-size: var(--text-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.download:hover {
  color: var(--text-1);
}
.link {
  display: inline-block;
  color: var(--brand-300);
  font-size: var(--text-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.link:hover {
  color: var(--text-1);
}
/* 举报区：与成片信息用 1px 分隔线分开 */
.report {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  border-top: 1px solid var(--border-1);
  padding-top: var(--space-4);
}
.report-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
}
.report-actions {
  display: flex;
  gap: var(--space-2);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.label {
  color: var(--text-2);
  font-size: var(--text-sm);
  font-weight: 500;
}
/* 表单控件：raised 底 + border-2 边 + radius-md，聚焦 brand-500 */
.input {
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 8px var(--space-3);
  font-size: var(--text-sm);
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}
.input::placeholder {
  color: var(--text-4);
}
.input:hover {
  border-color: var(--border-3);
}
.input:focus {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.textarea {
  min-height: 88px;
  line-height: 1.7;
  resize: vertical;
}
select.input {
  cursor: pointer;
}
.info {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.7;
}
.muted {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.7;
}
.small {
  font-size: var(--text-xs);
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}

@media (max-width: 768px) {
  .page {
    padding: 16px;
  }
  .panel {
    padding: var(--space-4);
  }
}
</style>
