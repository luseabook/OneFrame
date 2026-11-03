<script setup lang="ts">

const { t } = useI18n();
useHead({ title: () => t("adminUi.loginMetaTitle") });
// 运营后台独立登录页：与用户端登录页完全分离（独立 URL / 独立壳层 / 独立 token）
definePageMeta({ ssr: false, layout: "admin-login" });

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

const router = useRouter();

/**
 * 底部提示只在非生产构建中出现（`SEC-03`）。
 *
 * 原先那行写着「非生产默认账号 / 默认口令」。问题不在页面是否渲染它，而在
 * **语言包是整包打进客户端的**：字符串留在 `i18n/locales/*.json` 里，
 * 生产产物的 JS 就能被 grep 到，等于公开告诉攻击者「这台后台有这么个账号」。
 * 所以做了两件事：① 五个语言包的文案改成不提任何默认凭据的中性版本（根治）；
 * ② 页面这一层只在 dev 显示（`import.meta.dev` 在生产构建里是静态 `false`，
 * 整段可被摇掉）。验收只认产物 grep，不认源码里的 if。
 */
const showFootnote = import.meta.dev;
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

onMounted(() => {
  // 已登录直接进控制台（避免重复登录）
  if (localStorage.getItem("admin_token")) void router.replace("/admin");
});

async function submit(): Promise<void> {
  error.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = t("adminUi.loginNeedCreds");
    return;
  }
  loading.value = true;
  try {
    const res = await $fetch<Envelope<{ token: string }>>("/v1/ops/admin/login", {
      method: "POST",
      body: { username: username.value.trim(), password: password.value },
    });
    if (!res || res.code !== 0 || !res.data?.token) {
      throw new Error(res?.msg || t("adminUi.loginFailedWith", { code: res?.code ?? "unknown" }));
    }
    localStorage.setItem("admin_token", res.data.token);
    await router.replace("/admin");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.loginFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="auth-card">
    <h1>{{ t("adminUi.loginTitle") }}</h1>
    <p class="sub">{{ t("adminUi.loginSub") }}</p>

    <label class="field">
      <span>{{ t("adminUi.loginUsername") }}</span>
      <input v-model="username" class="input" autocomplete="username" :placeholder="t('adminUi.loginUsernamePlaceholder')" />
    </label>
    <label class="field">
      <span>{{ t("adminUi.loginPassword") }}</span>
      <input
        v-model="password"
        class="input"
        type="password"
        autocomplete="current-password"
        :placeholder="t('adminUi.loginPasswordPlaceholder')"
        @keyup.enter="submit"
      />
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <button class="submit" type="button" :disabled="loading" @click="submit">
      {{ loading ? t("adminUi.loggingIn") : t("adminUi.loginBtn") }}
    </button>

    <p v-if="showFootnote" class="hint">
       {{ t("adminUi.loginFootnote") }}
    </p>
  </section>
</template>

<style scoped>
.auth-card {
  position: relative;
  width: min(440px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 34px 32px 30px;
  border-radius: 18px;
  background: linear-gradient(180deg, #171821 0%, #121319 100%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow:
    0 30px 80px -30px rgba(0, 0, 0, 0.9),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
}

.auth-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(155, 70, 255, 0.7), transparent);
}

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.02em;
}

.sub {
  margin: 0 0 10px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.65;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-3);
}

.input {
  height: 42px;
  padding: 0 13px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #0f1016;
  color: var(--text-1);
  font-size: 14px;
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.input:focus {
  border-color: rgba(155, 70, 255, 0.55);
  box-shadow: 0 0 0 3px rgba(155, 70, 255, 0.13);
}

.submit {
  margin-top: 8px;
  height: 44px;
  border-radius: 10px;
  border: 0;
  background: linear-gradient(180deg, #a45cff 0%, #8b35ea 100%);
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 10px 24px -12px rgba(155, 70, 255, 0.9);
  transition: filter var(--duration-fast), transform var(--duration-fast);
}

.submit:hover:not(:disabled) {
  filter: brightness(1.08);
}

.submit:active:not(:disabled) {
  transform: translateY(1px);
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  margin: 0;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid rgba(245, 103, 103, 0.3);
  background: rgba(245, 103, 103, 0.1);
  color: #ff9b9b;
  font-size: 12px;
}

.hint {
  margin: 4px 0 0;
  color: var(--text-4);
  font-size: 11px;
  line-height: 1.6;
}
</style>
