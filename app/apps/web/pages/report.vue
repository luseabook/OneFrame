<script setup lang="ts">
definePageMeta({ ssr: false });

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
    message.value = "缺少分享 token：请从被举报的作品分享链接进入本页";
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
    message.value = "举报已提交，我们会尽快核查并处置（违规内容将被下线）。";
  } catch (e) {
    message.value = e instanceof Error ? e.message : "提交失败，请稍后重试";
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>举报 / 投诉</h1>
    <p class="muted">
      如发现违规内容，请填写下方表单。平台将在核实后撤销对应分享链接、下架内容；
      涉及违法犯罪的将依法移交主管部门。
    </p>

    <section class="card">
      <label class="field">
        <span class="label">被举报的分享 token</span>
        <input v-model="token" class="input" placeholder="从作品分享链接中复制 token" />
      </label>
      <label class="field">
        <span class="label">举报类型</span>
        <select v-model="reason" class="input">
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
        <textarea v-model="detail" class="input textarea" maxlength="500" />
      </label>
      <label class="field">
        <span class="label">联系方式（可选）</span>
        <input v-model="contact" class="input" maxlength="100" />
      </label>
      <button class="btn" :disabled="sending" @click="submit">
        {{ sending ? "提交中…" : "提交举报" }}
      </button>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <p class="muted small">
      也可以直接发送邮件至举报邮箱（上线后公示）；举报记录将进入运营后台处置队列并留痕。
    </p>
    <NuxtLink to="/" class="home">返回首页</NuxtLink>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
h1 {
  font-size: 22px;
  margin: 0 0 6px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  color: var(--text-2);
  font-size: 12px;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
}
.textarea {
  min-height: 80px;
  resize: vertical;
}
.btn {
  align-self: flex-start;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-m);
  color: #fff;
  padding: 8px 18px;
  font-size: 13px;
  cursor: pointer;
}
.msg {
  color: var(--text-2);
  font-size: 12px;
}
.muted {
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.7;
}
.muted.small {
  font-size: 12px;
}
.home {
  display: inline-block;
  margin-top: 16px;
  color: var(--text-3);
  font-size: 12px;
}
</style>
