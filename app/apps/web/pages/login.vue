<script setup lang="ts">
definePageMeta({ ssr: false });

const auth = useAuth();
const route = useRoute();
const phone = ref("");
const code = ref("");
const inviteCode = ref("");
const error = ref("");
const hint = ref("");
const countdown = ref(0);
const sending = ref(false);
const submitting = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const canSend = computed(() => /^1\d{10}$/.test(phone.value) && countdown.value === 0 && !sending.value);

async function sendCode(): Promise<void> {
  error.value = "";
  hint.value = "";
  sending.value = true;
  try {
    const config = useRuntimeConfig();
    const base = (config.public.apiBase as string) || "";
    const res = await $fetch<{ code: number; msg: string; data: { debug_code?: string } }>(
      `${base}/v1/auth/sms-code`,
      { method: "POST", body: { phone: phone.value }, credentials: "include" },
    );
    if (res.code !== 0) throw new Error(res.msg || "发送失败");
    hint.value = res.data?.debug_code ? `开发环境验证码：${res.data.debug_code}` : "验证码已发送";
    countdown.value = 60;
    timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0 && timer) clearInterval(timer);
    }, 1000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "发送失败";
  } finally {
    sending.value = false;
  }
}

async function login(): Promise<void> {
  error.value = "";
  if (!/^1\d{10}$/.test(phone.value)) {
    error.value = "请输入正确的手机号";
    return;
  }
  if (!/^\d{6}$/.test(code.value)) {
    error.value = "请输入 6 位验证码";
    return;
  }
  submitting.value = true;
  try {
    await auth.login(phone.value, code.value, inviteCode.value || undefined);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/create/text-to-video";
    await navigateTo(redirect);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
  } finally {
    submitting.value = false;
  }
}

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>登录 / 注册</h1>
      <p class="sub">手机验证码登录，未注册手机号将自动创建账号并赠送 80 积分。</p>

      <div class="form">
        <TextField v-model="phone" label="手机号" placeholder="请输入 11 位手机号" :maxlength="11" />
        <div class="code-row">
          <TextField v-model="code" label="验证码" placeholder="6 位数字" :maxlength="6" />
          <Button variant="ghost" :disabled="!canSend" @click="sendCode">
            {{ countdown > 0 ? `${countdown}s` : "获取验证码" }}
          </Button>
        </div>
        <TextField v-model="inviteCode" label="邀请码（Alpha 期需要）" placeholder="可选" />
        <p v-if="hint" class="hint">{{ hint }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <Button :disabled="submitting" @click="login">{{ submitting ? "登录中…" : "登录" }}</Button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  display: flex;
  justify-content: center;
  padding: 64px 24px;
}
.card {
  width: min(420px, 100%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 32px;
}
h1 {
  margin: 0 0 8px;
  font-size: 24px;
}
.sub {
  color: var(--text-2);
  font-size: 13px;
  margin: 0 0 24px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.code-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.code-row :deep(.field) {
  flex: 1;
}
.hint {
  margin: 0;
  color: var(--text-2);
  font-size: 12px;
}
.error {
  margin: 0;
  color: #ff6b6b;
  font-size: 13px;
}
</style>
