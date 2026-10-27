<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

// i18n（第 8 批）：本页所有用户可见文案走语言包，中文原文与改造前逐字一致
const { t } = useI18n();
useHead({ title: () => t("settings.metaTitle") });

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
    info.value = t("settings.dangerConfirmHint");
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await api.post("/me/delete", {});
    await auth.logout();
    await navigateTo("/");
    info.value = t("settings.deleted");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("settings.deleteFailed");
  } finally {
    busy.value = false;
    confirming.value = false;
  }
}
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h1>{{ t("settings.title") }}</h1>
      <LangSwitcher />
    </div>

    <section class="card">
      <h2>{{ t("settings.accountTitle") }}</h2>
      <p class="muted">{{ t("settings.nickname", { name: user?.nickname ?? "-" }) }}</p>
      <p class="muted">
        {{ t("settings.creditsLine", { balance: credits?.balance ?? "-", frozen: credits?.frozen ?? "-" }) }}
      </p>
    </section>

    <section class="card">
      <h2>{{ t("settings.agreementsTitle") }}</h2>
      <p class="muted">
        <NuxtLink to="/terms">{{ t("settings.terms") }}</NuxtLink> ·
        <NuxtLink to="/privacy">{{ t("settings.privacy") }}</NuxtLink> ·
        <NuxtLink to="/report">{{ t("settings.report") }}</NuxtLink>
      </p>
      <p class="muted small">{{ t("settings.ageNote") }}</p>
    </section>

    <section class="card danger">
      <h2>{{ t("settings.dangerTitle") }}</h2>
      <p class="muted">
        {{ t("settings.dangerDesc") }}
      </p>
      <p v-if="info" class="info">{{ info }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn-danger" :disabled="busy" @click="deleteAccount">
        {{ busy ? t("settings.deleting") : confirming ? t("settings.confirmDelete") : t("settings.deleteAccount") }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 72px 80px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h1 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-1);
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: 20px 24px;
}
.muted {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.7;
}
.muted + .muted {
  margin-top: 4px;
}
.muted :deep(a) {
  color: var(--brand-300);
}
.muted :deep(a:hover) {
  color: var(--text-1);
}
.muted.small {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-4);
}
.info {
  margin: 12px 0 0;
  color: var(--warning);
  font-size: 12px;
}
.error {
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 12px;
}
.btn-danger {
  margin-top: 12px;
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.btn-danger:hover:not(:disabled) {
  background: #3d1a1a;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.card.danger {
  border-color: #6b2626;
}
@media (max-width: 1024px) {
  .page {
    padding: 24px 24px 64px;
  }
}
@media (max-width: 768px) {
  .page {
    padding: 16px 16px 48px;
  }
}
</style>
