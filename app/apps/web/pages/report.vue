<script setup lang="ts">
definePageMeta({ ssr: false });

const { t } = useI18n();
useHead({ title: () => t("report.metaTitle") });

const api = useApi();
const route = useRoute();
const token = ref(String(route.query.token ?? ""));
const reason = ref("illegal");
const detail = ref("");
const contact = ref("");
const message = ref("");
const sending = ref(false);

async function submit(): Promise<void> {
  if (!token.value) {
    message.value = t("report.missingToken");
    return;
  }
  sending.value = true;
  message.value = "";
  try {
    await api.post(`/share/${token.value}/report`, {
      reason: reason.value,
      detail: detail.value || undefined,
      contact: contact.value || undefined,
    });
    message.value = t("report.submitted");
  } catch (e) {
    message.value = e instanceof Error ? e.message : t("report.failed");
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>{{ t("report.title") }}</h1>
      <p class="sub">{{ t("report.sub") }}</p>
    </header>

    <section class="panel">
      <label class="field">
        <span class="label">{{ t("report.tokenLabel") }}</span>
        <input v-model="token" class="input" :placeholder="t('report.tokenPlaceholder')" />
      </label>
      <label class="field">
        <span class="label">{{ t("report.reasonLabel") }}</span>
        <select v-model="reason" class="input">
          <option value="illegal">{{ t("report.reasons.illegal") }}</option>
          <option value="porn">{{ t("report.reasons.porn") }}</option>
          <option value="violence">{{ t("report.reasons.violence") }}</option>
          <option value="infringement">{{ t("report.reasons.infringement") }}</option>
          <option value="spam">{{ t("report.reasons.spam") }}</option>
          <option value="other">{{ t("report.reasons.other") }}</option>
        </select>
      </label>
      <label class="field">
        <span class="label">{{ t("report.detailLabel") }}</span>
        <textarea v-model="detail" class="input textarea" maxlength="500" />
      </label>
      <label class="field">
        <span class="label">{{ t("report.contactLabel") }}</span>
        <input v-model="contact" class="input" maxlength="100" />
      </label>
      <div class="actions">
        <Button :loading="sending" @click="submit">{{ sending ? t("report.submitting") : t("report.submit") }}</Button>
      </div>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <p class="footnote">{{ t("report.footnote") }}</p>
    <NuxtLink to="/" class="home">{{ t("report.backHome") }}</NuxtLink>
  </main>
</template>

<style scoped>
/* 页容器：法务/公共页统一 960 行宽 + 32/32/80 内距 */
.page {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
.head {
  margin-bottom: var(--space-6);
}
h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.sub {
  margin: var(--space-2) 0 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.8;
}
/* 卡片范式 C：实底面板 + 1px 边框 + 16 圆角 + 24 内距 */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-6);
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
  padding: 9px var(--space-3);
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
  min-height: 120px;
  line-height: 1.7;
  resize: vertical;
}
select.input {
  cursor: pointer;
}
.actions {
  display: flex;
}
.msg {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.7;
}
.footnote {
  margin: var(--space-5) 0 0;
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.home {
  display: inline-block;
  margin-top: var(--space-4);
  color: var(--brand-300);
  font-size: var(--text-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.home:hover {
  color: var(--text-1);
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
