<script setup lang="ts">
// 运营后台独立登录页：与用户端登录页完全分离（独立 URL / 独立壳层 / 独立 token）
definePageMeta({ ssr: false, layout: "admin-login" });

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

const router = useRouter();
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
    error.value = "请输入用户名与密码";
    return;
  }
  loading.value = true;
  try {
    const res = await $fetch<Envelope<{ token: string }>>("/v1/ops/admin/login", {
      method: "POST",
      body: { username: username.value.trim(), password: password.value },
    });
    if (!res || res.code !== 0 || !res.data?.token) {
      throw new Error(res?.msg || `登录失败(${res?.code ?? "unknown"})`);
    }
    localStorage.setItem("admin_token", res.data.token);
    await router.replace("/admin");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="auth-card">
    <h1>运营后台登录</h1>
    <p class="sub">仅限授权运营人员；账号与用户端账号体系相互独立。</p>

    <label class="field">
      <span>用户名</span>
      <input v-model="username" class="input" autocomplete="username" placeholder="运营账号" />
    </label>
    <label class="field">
      <span>密码</span>
      <input
        v-model="password"
        class="input"
        type="password"
        autocomplete="current-password"
        placeholder="密码"
        @keyup.enter="submit"
      />
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <button class="submit" type="button" :disabled="loading" @click="submit">
      {{ loading ? "登录中…" : "登录运营后台" }}
    </button>

    <p class="hint">
      非生产环境默认 admin / admin12345；生产必须通过 ADMIN_USERNAME / ADMIN_PASSWORD 配置。
    </p>
  </section>
</template>

<style scoped>
.auth-card {
  width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 28px;
  border-radius: 14px;
  background: var(--bg-surface);
  border: 1px solid #ffffff17;
  box-shadow: 0 20px 60px #00000066;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.sub {
  margin: 0 0 6px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
}

.input {
  height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #ffffff1f;
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 14px;
  outline: none;
}

.input:focus {
  border-color: var(--brand-500);
}

.submit {
  margin-top: 6px;
  height: 40px;
  border-radius: 9px;
  border: 0;
  background: var(--brand-500);
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
}

.hint {
  margin: 4px 0 0;
  color: var(--text-4);
  font-size: 11px;
  line-height: 1.6;
}
</style>
