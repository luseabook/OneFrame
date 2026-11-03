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
const bindings = ref<{ phone: string | null; providers: string[] }>({ phone: null, providers: [] });
const bindPhone = ref("");
const bindCode = ref("");
const bindBusy = ref("");
const bindCountdown = ref(0);
const oauthProviders = ref<Array<{ provider: string; label: string; configured: boolean }>>([]);

function providerLabel(provider: string): string {
  const labels: Record<string, () => string> = {
    wechat: () => t("auth.oauthWechat"),
    qq: () => t("auth.oauthQq"),
    apple: () => t("auth.oauthApple"),
    douyin: () => t("auth.oauthDouyin"),
  };
  return labels[provider]?.() ?? provider;
}

onMounted(async () => {
  try {
    const me = await api.get<{
      user: { nickname?: string | null };
      credits: { balance?: number; frozen?: number };
      bindings?: { phone: string | null; providers: string[] };
    }>("/me");
    user.value = me.user;
    credits.value = me.credits;
    bindings.value = me.bindings ?? { phone: null, providers: [] };
  } catch {
    // 未登录时由全局中间件跳转登录页
  }
  try {
    const data = await api.get<{ list: Array<{ provider: string; label: string; configured: boolean }> }>(
      "/auth/oauth/providers",
    );
    oauthProviders.value = data.list;
  } catch {
    oauthProviders.value = [];
  }
  if (String(useRoute().query.bound ?? "")) info.value = t("settings.bindingDone");
});

async function sendBindCode(): Promise<void> {
  if (!/^1\d{10}$/.test(bindPhone.value)) {
    error.value = t("settings.phoneInvalid");
    return;
  }
  bindBusy.value = "send";
  error.value = "";
  try {
    await api.post("/auth/sms-code", { phone: bindPhone.value });
    bindCountdown.value = 60;
    const timer = setInterval(() => {
      bindCountdown.value -= 1;
      if (bindCountdown.value <= 0) clearInterval(timer);
    }, 1000);
    info.value = t("settings.codeSent");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("settings.codeSendFailed");
  } finally {
    bindBusy.value = "";
  }
}

async function submitBindPhone(): Promise<void> {
  if (!/^1\d{10}$/.test(bindPhone.value) || !/^\d{6}$/.test(bindCode.value)) {
    error.value = t("settings.phoneInvalid");
    return;
  }
  bindBusy.value = "phone";
  error.value = "";
  try {
    const data = await api.post<{ phone: string; bindings: typeof bindings.value }>("/auth/bind/phone", {
      phone: bindPhone.value,
      code: bindCode.value,
    });
    bindings.value = data.bindings;
    bindPhone.value = "";
    bindCode.value = "";
    info.value = t("settings.phoneBoundOk");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("settings.bindFailed");
  } finally {
    bindBusy.value = "";
  }
}

async function startOAuthBind(provider: string): Promise<void> {
  bindBusy.value = `oauth:${provider}`;
  error.value = "";
  try {
    const data = await api.post<{ authorize_url: string }>(`/auth/bind/oauth/${provider}/url`, {});
    window.location.href = data.authorize_url;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("settings.bindFailed");
  } finally {
    bindBusy.value = "";
  }
}

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
    </div>

    <section class="card">
      <h2>{{ t("settings.accountTitle") }}</h2>
      <p class="muted">{{ t("settings.nickname", { name: user?.nickname ?? "-" }) }}</p>
      <p class="muted">
        {{ t("settings.creditsLine", { balance: credits?.balance ?? "-", frozen: credits?.frozen ?? "-" }) }}
      </p>
      <div class="account-links">
        <NuxtLink to="/user-update">{{ t("settings.editProfile") }}</NuxtLink>
        <NuxtLink to="/user-language">{{ t("settings.language") }}</NuxtLink>
        <NuxtLink to="/tutorial">{{ t("settings.guide") }}</NuxtLink>
      </div>
    </section>

    <section class="card">
      <h2>{{ t("settings.bindingTitle") }}</h2>
      <p class="muted">{{ t("settings.bindingDesc") }}</p>
      <p class="muted">
        {{ t("settings.phoneBinding", { phone: bindings.phone || t("settings.unbound") }) }}
      </p>
      <form class="bind-form" @submit.prevent="submitBindPhone">
        <input v-model="bindPhone" class="input" placeholder="13800138000" maxlength="11" />
        <input v-model="bindCode" class="input" placeholder="000000" maxlength="6" />
        <button class="btn-secondary" type="button" :disabled="bindBusy !== '' || bindCountdown > 0" @click="sendBindCode">
          {{ bindCountdown > 0 ? t("settings.resendIn", { seconds: bindCountdown }) : t("settings.sendCode") }}
        </button>
        <button class="btn-secondary" type="submit" :disabled="bindBusy !== ''">
          {{ bindBusy === "phone" ? t("settings.binding") : t("settings.bindPhone") }}
        </button>
      </form>
      <div class="provider-bindings">
        <div v-for="item in oauthProviders" :key="item.provider" class="provider-binding">
          <span>{{ item.label || providerLabel(item.provider) }}</span>
          <span v-if="bindings.providers.includes(item.provider)" class="bound">{{ t("settings.bound") }}</span>
          <button
            v-else
            class="btn-secondary"
            type="button"
            :disabled="!item.configured || bindBusy !== ''"
            @click="startOAuthBind(item.provider)"
          >
            {{ bindBusy === `oauth:${item.provider}` ? t("settings.binding") : t("settings.bindProvider") }}
          </button>
        </div>
      </div>
      <p class="muted small">{{ t("settings.bindingHint") }}</p>
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
  /* GL16：有 h1 的页面统一 26px/700 */
  font-size: 26px;
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
.bind-form {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) 110px auto auto;
  gap: 8px;
  margin-top: 12px;
}
.input {
  min-height: 36px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-raised);
  color: var(--text-1);
  padding: 0 10px;
  font-size: 13px;
}
.btn-secondary {
  min-height: 36px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-raised);
  color: var(--text-1);
  padding: 0 12px;
  font-size: 13px;
  cursor: pointer;
}
.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.provider-bindings {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.provider-binding {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 13px;
}
.bound {
  color: var(--success);
  font-size: 12px;
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
  .bind-form {
    grid-template-columns: 1fr;
  }
}
.account-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 10px;
}
.account-links a {
  color: var(--brand, #9b46ff);
  font-size: 13px;
  text-decoration: none;
}
</style>
