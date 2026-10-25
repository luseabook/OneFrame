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
    <header class="head">
      <h1>举报 / 投诉</h1>
      <p class="sub">
        如发现违规内容，请填写下方表单。平台将在核实后撤销对应分享链接、下架内容；
        涉及违法犯罪的将依法移交主管部门。
      </p>
    </header>

    <section class="panel">
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
      <div class="actions">
        <Button :loading="sending" @click="submit">{{ sending ? "提交中…" : "提交举报" }}</Button>
      </div>
      <p v-if="message" class="msg">{{ message }}</p>
    </section>

    <p class="footnote">
      也可以直接发送邮件至举报邮箱（上线后公示）；举报记录将进入运营后台处置队列并留痕。
    </p>
    <NuxtLink to="/" class="home">返回首页</NuxtLink>
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
