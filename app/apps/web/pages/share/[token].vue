<script setup lang="ts">
import type { ShareView } from "~/types/api";
import { statusLabel } from "~/types/api";

definePageMeta({ ssr: false });

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

async function submitReport(): Promise<void> {
  reporting.value = true;
  reportMsg.value = "";
  try {
    await api.post(`/share/${String(route.params.token)}/report`, {
      reason: reportReason.value,
      detail: reportDetail.value || undefined,
      contact: reportContact.value || undefined,
    });
    reportMsg.value = "举报已提交，我们会尽快处理。";
    reportOpen.value = false;
    reportDetail.value = "";
  } catch (e) {
    reportMsg.value = e instanceof Error ? e.message : "举报提交失败";
  } finally {
    reporting.value = false;
  }
}

onMounted(async () => {
  try {
    share.value = await api.get<ShareView>(`/share/${String(route.params.token)}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "分享不存在或已过期";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="page">
    <p v-if="loading" class="loading">加载中…</p>
    <section v-else-if="error" class="panel">
      <h1>分享不可用</h1>
      <p class="muted">{{ error }}</p>
      <NuxtLink to="/" class="link">返回首页</NuxtLink>
    </section>
    <section v-else-if="share" class="panel">
      <header class="head">
        <h1>作品分享</h1>
        <p class="meta">
          {{ share.mode }} · {{ statusLabel(share.status) }} · {{ new Date(share.created_at).toLocaleString() }}
        </p>
      </header>

      <div v-if="share.results.length > 0" class="results">
        <div v-for="(item, index) in share.results" :key="index" class="result">
          <template v-if="item.text">
            <pre>{{ item.text }}</pre>
          </template>
          <template v-else>
            <p class="muted">结果 {{ index + 1 }}</p>
            <a :href="item.url" target="_blank" rel="noreferrer" class="download">下载 / 打开结果</a>
          </template>
        </div>
      </div>
      <p v-else class="muted">生成完成后即可查看结果。</p>

      <p v-if="share.error?.message" class="error">{{ share.error.message }}</p>
      <p class="muted small">链接有效期至 {{ new Date(share.expires_at).toLocaleString() }} · 内容由 AI 生成，请仔细甄别</p>

      <div class="report">
        <Button v-if="!reportOpen" variant="ghost" size="sm" @click="reportOpen = true">举报内容</Button>
        <div v-else class="report-form">
          <label class="field">
            <span class="label">举报类型</span>
            <select v-model="reportReason" class="input">
              <option value="illegal">违法违规</option>
              <option value="porn">色情低俗</option>
              <option value="violence">暴力血腥</option>
              <option value="infringement">侵权盗用</option>
              <option value="spam">垃圾广告</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label class="field">
            <span class="label">补充说明（可选）</span>
            <textarea v-model="reportDetail" class="input textarea" maxlength="500" />
          </label>
          <label class="field">
            <span class="label">联系方式（可选）</span>
            <input v-model="reportContact" class="input" maxlength="100" />
          </label>
          <div class="report-actions">
            <Button size="sm" :loading="reporting" @click="submitReport">
              {{ reporting ? "提交中…" : "提交举报" }}
            </Button>
            <Button variant="ghost" size="sm" @click="reportOpen = false">取消</Button>
          </div>
        </div>
        <p v-if="reportMsg" class="info">{{ reportMsg }}</p>
      </div>

      <NuxtLink to="/" class="link">AI 漫剧工作台</NuxtLink>
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
