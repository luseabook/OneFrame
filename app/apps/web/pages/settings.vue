<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const auth = useAuth();
const error = ref("");
const info = ref("");
const busy = ref(false);
const confirming = ref(false);

// 账号信息在客户端挂载后读取：首屏 SSR 无登录态，直接渲染会与客户端 hydrate 结果不一致
const user = ref<{ nickname?: string | null } | null>(null);
const credits = ref<{ balance?: number; frozen?: number } | null>(null);

onMounted(async () => {
  try {
    const me = await api.get<{
      user: { nickname?: string | null };
      credits: { balance?: number; frozen?: number };
    }>("/me");
    user.value = me.user;
    credits.value = me.credits;
  } catch {
    // 未登录时由全局中间件跳转登录页
  }
});

async function deleteAccount(): Promise<void> {
  if (!confirming.value) {
    confirming.value = true;
    info.value = "请再次点击「确认注销」以执行（注销后 30 天内数据保留并可人工恢复）";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await api.post("/me/delete", {});
    await auth.logout();
    await navigateTo("/");
    info.value = "账号已注销";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "注销失败";
  } finally {
    busy.value = false;
    confirming.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>账号设置</h1>

    <section class="card">
      <h2>账号信息</h2>
      <p class="muted">昵称：{{ user?.nickname ?? "-" }}</p>
      <p class="muted">可用积分：{{ credits?.balance ?? "-" }} · 冻结：{{ credits?.frozen ?? "-" }}</p>
    </section>

    <section class="card">
      <h2>协议与隐私</h2>
      <p class="muted">
        <NuxtLink to="/terms">用户协议</NuxtLink> ·
        <NuxtLink to="/privacy">隐私政策</NuxtLink> ·
        <NuxtLink to="/report">举报 / 投诉</NuxtLink>
      </p>
      <p class="muted small">注册时需确认已满 18 周岁；所有生成内容均带 AI 生成标识。</p>
    </section>

    <section class="card danger">
      <h2>注销账号</h2>
      <p class="muted">
        注销后立即停止登录，任务记录将脱敏，个人数据保留 30 天后物理清理；30 天内可联系客服恢复。
      </p>
      <p v-if="info" class="info">{{ info }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn-danger" :disabled="busy" @click="deleteAccount">
        {{ busy ? "注销中…" : confirming ? "确认注销" : "注销账号" }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
}
.muted {
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.7;
}
.muted.small {
  font-size: 12px;
}
.info {
  color: #fbbf24;
  font-size: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
.btn-danger {
  background: #7f1d1d;
  border: 1px solid #ef4444;
  color: #fecaca;
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
.card.danger {
  border-color: #7f1d1d;
}
</style>
