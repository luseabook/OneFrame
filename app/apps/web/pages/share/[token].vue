<script setup lang="ts">
import type { ShareView } from "~/types/api";
import { statusLabel } from "~/types/api";

definePageMeta({ ssr: false });

const route = useRoute();
const api = useApi();
const share = ref<ShareView | null>(null);
const error = ref("");
const loading = ref(true);

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
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 12px;
}
.result pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--text-2);
}
.download {
  color: var(--color-primary);
  font-size: 13px;
}
.home {
  margin-top: 8px;
  color: var(--text-3);
  font-size: 12px;
}
.muted {
  color: var(--text-3);
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
