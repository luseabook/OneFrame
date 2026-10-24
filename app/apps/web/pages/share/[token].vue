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
    <p v-if="loading" class="muted">加载中…</p>
    <section v-else-if="error" class="card">
      <h1>分享不可用</h1>
      <p class="muted">{{ error }}</p>
      <NuxtLink to="/" class="home">返回首页</NuxtLink>
    </section>
    <section v-else-if="share" class="card">
      <h1>作品分享</h1>
      <p class="muted">
        {{ share.mode }} · {{ statusLabel(share.status) }} · {{ new Date(share.created_at).toLocaleString() }}
      </p>

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
        <button v-if="!reportOpen" class="report-btn" @click="reportOpen = true">举报内容</button>
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
            <button class="report-btn" :disabled="reporting" @click="submitReport">
              {{ reporting ? "提交中…" : "提交举报" }}
            </button>
            <button class="report-btn ghost" @click="reportOpen = false">取消</button>
          </div>
        </div>
        <p v-if="reportMsg" class="info">{{ reportMsg }}</p>
      </div>

      <NuxtLink to="/" class="home">AI 漫剧工作台</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 48px 24px;
}
.card {
  width: min(640px, 100%);
  background: var(--dark-container);
  border: 1px solid var(--border-inverse);
  border-radius: var(--radius-xl);
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result {
  border: 1px solid var(--border-inverse);
  border-radius: var(--radius-md);
  padding: 12px;
}
.result pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text-inverse-2);
}
.download {
  color: var(--brand-500);
  font-size: 13px;
}
.home {
  margin-top: 8px;
  color: var(--text-inverse-3);
  font-size: 12px;
}
.report {
  border-top: 1px solid var(--border-inverse);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.report-btn {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--border-inverse);
  border-radius: var(--radius-sm);
  color: var(--text-inverse-2);
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
}
.report-btn.ghost {
  color: var(--text-inverse-3);
}
.report-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.report-actions {
  display: flex;
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  color: var(--text-inverse-2);
  font-size: 12px;
}
.input {
  background: var(--dark-container);
  border: 1px solid var(--border-inverse);
  border-radius: var(--radius-md);
  color: var(--text-inverse);
  padding: 6px 8px;
  font-size: 12px;
  outline: none;
}
.textarea {
  min-height: 60px;
  resize: vertical;
}
.info {
  color: var(--text-inverse-2);
  font-size: 12px;
}
.muted {
  color: var(--text-inverse-3);
  font-size: 12px;
}
.small {
  font-size: 11px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
</style>
