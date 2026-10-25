<script setup lang="ts">
// /login = 参照产品（竞品 ReelMate）的浅色居中弹窗（形态见 reference-alignment-spec §8）。
// 本文件是全站唯一的浅色界面：平台深色令牌不适用，浅色色板以局部 CSS 变量实现（§8.2 实测值），
// 不改动全局 tokens.css，也不污染其它页面。
definePageMeta({ ssr: false });

type LoginTab = "wechat" | "code" | "password";

const TAB_LIST: { key: LoginTab; label: string }[] = [
  { key: "wechat", label: "微信登录" },
  { key: "code", label: "验证码登录" },
  { key: "password", label: "密码登录" },
];

const auth = useAuth();
const route = useRoute();
const router = useRouter();

const activeTab = ref<LoginTab>("code");
const phone = ref("");
const code = ref("");
const inviteCode = ref("");
// 协议勾选框同时承担年龄确认语义（对应 useAuth().login 的第 4 个参数 ageConfirmed）
const agreement = ref(false);
const keepLogin = ref(true);
// error + errorSlot：把错误渲染到对应字段下方（接口错误落到按钮下方），不吞掉 raw 错误
const error = ref("");
const errorSlot = ref<"phone" | "code" | "form" | "">("");
const hint = ref("");
const countdown = ref(0);
const sending = ref(false);
const submitting = ref(false);
// 未勾选协议时点击「立即登录」→ 深色气泡提示（§8.2 / L9）
const showAgreeBubble = ref(false);

const canSend = computed(
  () => /^1\d{10}$/.test(phone.value) && countdown.value === 0 && !sending.value,
);

const noticeText = computed(() =>
  activeTab.value === "wechat"
    ? "微信登录即将开放，请使用验证码登录"
    : "密码登录即将开放，请使用验证码登录",
);

let timer: ReturnType<typeof setInterval> | undefined;
let bodyOverflow = "";

function setTab(tab: LoginTab): void {
  activeTab.value = tab;
  error.value = "";
  errorSlot.value = "";
  showAgreeBubble.value = false;
}

// L13：右上 ✕ 关闭。有历史则回上一页，无历史（直接打开 /login）回落首页。
function closeModal(): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
    return;
  }
  void navigateTo("/");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeModal();
}

async function sendCode(): Promise<void> {
  error.value = "";
  errorSlot.value = "";
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
    errorSlot.value = "phone";
  } finally {
    sending.value = false;
  }
}

async function login(): Promise<void> {
  error.value = "";
  errorSlot.value = "";
  // 协议优先：未勾选时只弹气泡（与参照产品一致），避免用户先看到手机号错误
  if (!agreement.value) {
    showAgreeBubble.value = true;
    return;
  }
  showAgreeBubble.value = false;
  if (!/^1\d{10}$/.test(phone.value)) {
    error.value = "请输入正确的手机号";
    errorSlot.value = "phone";
    return;
  }
  if (!/^\d{6}$/.test(code.value)) {
    error.value = "请输入 6 位验证码";
    errorSlot.value = "code";
    return;
  }
  submitting.value = true;
  try {
    await auth.login(phone.value, code.value, inviteCode.value || undefined, true);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/home";
    await navigateTo(redirect);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
    errorSlot.value = "form";
  } finally {
    submitting.value = false;
  }
}

watch(agreement, (checked) => {
  if (checked) showAgreeBubble.value = false;
});

onMounted(() => {
  // 弹窗形态下锁住背景滚动（卸载时恢复，不污染全局）
  bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  document.body.style.overflow = bodyOverflow;
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="login-page" @click.self="closeModal">
    <section class="card" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <header class="brand-row">
        <div class="brand">
          <span class="brand-logo" aria-hidden="true">一</span>
          <span class="brand-name">一帧</span>
        </div>
        <button class="close" type="button" title="关闭" aria-label="关闭" @click="closeModal">
          ✕
        </button>
      </header>

      <h1 id="login-title" class="title">登录一帧</h1>

      <div class="tabs" role="tablist" aria-label="登录方式">
        <button
          v-for="tab in TAB_LIST"
          :key="tab.key"
          class="tab"
          :class="{ 'tab--active': activeTab === tab.key }"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          @click="setTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'code'" class="panel">
        <div class="field">
          <input
            v-model="phone"
            class="input"
            type="tel"
            inputmode="numeric"
            maxlength="11"
            autocomplete="tel"
            placeholder="请输入手机号码"
          />
        </div>
        <p v-if="errorSlot === 'phone'" class="field-error">{{ error }}</p>

        <div class="field field--code">
          <input
            v-model="code"
            class="input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            placeholder="请输入验证码"
          />
          <button class="send-code" type="button" :disabled="!canSend" @click="sendCode">
            {{ countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "发送验证码" }}
          </button>
        </div>
        <p v-if="errorSlot === 'code'" class="field-error">{{ error }}</p>
        <p v-if="hint" class="hint">{{ hint }}</p>

        <div class="field">
          <input
            v-model="inviteCode"
            class="input"
            type="text"
            maxlength="32"
            placeholder="请输入邀请码（选填）"
          />
        </div>

        <label class="keep">
          <input v-model="keepLogin" class="cb" type="checkbox" />
          <span>保持登录</span>
        </label>

        <button class="submit" type="button" :disabled="submitting" @click="login">
          {{ submitting ? "登录中…" : "立即登录" }}
        </button>
        <p v-if="errorSlot === 'form'" class="form-error">{{ error }}</p>
      </div>

      <div v-else class="tab-notice">
        <p class="notice-text">{{ noticeText }}</p>
        <button class="notice-switch" type="button" @click="setTab('code')">
          使用验证码登录
        </button>
      </div>

      <div class="divider"><span>使用其他方式登录</span></div>

      <div class="thirdparty">
        <button class="tp" type="button" disabled title="即将开放" aria-label="微信登录（即将开放）">
          <svg viewBox="3.3 2.7 17.7 17.7" aria-hidden="true">
            <path
              d="M9.6 4.2c-3.5 0-6.3 2.3-6.3 5.2 0 1.7 1 3.2 2.5 4.2l-.6 1.9 2.2-1.1c.7.2 1.4.3 2.2.3h.3c-.1-.4-.2-.8-.2-1.3 0-2.9 2.8-5.2 6.2-5.2h.5c-.6-2.3-3.2-4-6.8-4z"
              fill="#07C160"
            />
            <circle cx="7.6" cy="8.2" r=".95" fill="#fff" />
            <circle cx="11.6" cy="8.2" r=".95" fill="#fff" />
            <path
              d="M21 13.4c0-2.4-2.3-4.3-5.1-4.3s-5.1 1.9-5.1 4.3 2.3 4.3 5.1 4.3c.6 0 1.2-.1 1.8-.3l1.7 1-.5-1.7c1.3-.8 2.1-2 2.1-3.3z"
              fill="#07C160"
            />
            <circle cx="14.4" cy="12.7" r=".8" fill="#fff" />
            <circle cx="18" cy="12.7" r=".8" fill="#fff" />
          </svg>
        </button>
        <button class="tp" type="button" disabled title="即将开放" aria-label="QQ 登录（即将开放）">
          <svg viewBox="4.35 3.25 15.3 15.3" aria-hidden="true">
            <path
              d="M12 3.2c-3.3 0-5.4 2.6-5.4 6.1 0 1-.4 1.8-.9 2.6-.6.9-1.1 1.9-1.1 2.7 0 .6.3 1 .8 1 .4 0 .8-.3 1.1-.8.1 1.3.6 2.4 1.4 3.1-.5.2-.8.5-.8.9 0 .7 1.3 1.2 2.9 1.2.9 0 1.6-.2 2-.5.5.3 1.2.5 2 .5 1.6 0 2.9-.5 2.9-1.2 0-.4-.3-.7-.8-.9.8-.7 1.3-1.8 1.4-3.1.3.5.7.8 1.1.8.5 0 .8-.4.8-1 0-.8-.5-1.8-1.1-2.7-.5-.8-.9-1.6-.9-2.6 0-3.5-2.1-6.1-5.4-6.1z"
              fill="#12B7F5"
            />
            <circle cx="9.9" cy="9.3" r="1" fill="#fff" />
            <circle cx="14.1" cy="9.3" r="1" fill="#fff" />
          </svg>
        </button>
        <button class="tp" type="button" disabled title="即将开放" aria-label="Apple 登录（即将开放）">
          <svg viewBox="5.45 3.9 16 16" aria-hidden="true">
            <path
              d="M16.7 12.8c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.2.8-.7 0-1.7-.7-2.8-.7-1.5 0-2.8.8-3.6 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.1 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7c1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.1-2.3 1.2-2.4-.1 0-2.6-1-2.6-3.6z"
              fill="#111111"
            />
            <path
              d="M14.6 6.6c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.3z"
              fill="#111111"
            />
          </svg>
        </button>
        <button class="tp" type="button" disabled title="即将开放" aria-label="抖音登录（即将开放）">
          <svg viewBox="1 1 22 22" aria-hidden="true">
            <rect x="1" y="1" width="22" height="22" rx="6" fill="#111111" />
            <path
              d="M14.9 6.2h1.9c.2 1.1.9 2 1.9 2.4v1.9c-.8 0-1.5-.2-2.2-.6v4.8a3.6 3.6 0 0 1-3.6 3.6 3.6 3.6 0 0 1-3.6-3.6 3.6 3.6 0 0 1 3.6-3.6c.2 0 .4 0 .6.1v2c-.2-.1-.4-.1-.6-.1a1.6 1.6 0 1 0 1.6 1.6V6.2z"
              fill="#fff"
            />
          </svg>
        </button>
      </div>

      <div class="agree-block">
        <label class="agree-row">
          <input v-model="agreement" class="cb cb--sm" type="checkbox" />
          <span class="agree-text">我已阅读并同意<NuxtLink class="link" to="/terms" @click.stop>一帧 用户服务协议</NuxtLink> 和 <NuxtLink class="link" to="/privacy" @click.stop>隐私政策</NuxtLink>，未注册手机登录时会自动创建账号</span>
        </label>
        <p class="age-note">仅限 18 周岁以上用户使用</p>
        <div v-if="showAgreeBubble" class="bubble" role="alert">请先同意并勾选上述协议</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 浅色色板：局部变量，不覆盖全局深色令牌（§8.2 实测值） */
.login-page {
  --lm-bg: #ffffff;
  --lm-title: #1a1a1a;
  --lm-text: #262626;
  --lm-muted: #8c8c8c;
  --lm-line: #e5e5e5;
  --lm-placeholder: #bfbfbf;
  --lm-brand: #6d5bd0;
  --lm-brand-hover: #5c4bbd;
  --lm-disabled: #c0c0c0;
  --lm-danger: #d93025;

  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
  background: #000000b0;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: lm-fade var(--duration-base) var(--ease-out);
}

.card {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 400px;
  max-width: 100%;
  min-height: 617px;
  max-height: calc(100vh - 40px);
  margin: auto;
  overflow-y: auto;
  padding: 40px 40px 48px;
  border: 0;
  border-radius: 12px;
  background: var(--lm-bg);
  box-shadow: 0 24px 70px #00000059;
  color: var(--lm-text);
  animation: lm-pop var(--duration-base) var(--ease-out);
}

/* ── 品牌行 + 关闭 ── */
.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-logo {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: linear-gradient(135deg, #8a7bff, var(--lm-brand));
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}
.brand-name {
  color: var(--lm-title);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--lm-text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.close:hover {
  background: #f5f5f5;
}

/* ── 标题 ── */
.title {
  margin: 16px 0 0;
  color: var(--lm-title);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.32;
  letter-spacing: -0.01em;
}

/* ── 三种登录方式 tab ── */
.tabs {
  display: flex;
  gap: 24px;
  margin-top: 20px;
}
.tab {
  position: relative;
  padding: 0 1px 9px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--lm-muted);
  font-size: 15px;
  font-weight: 400;
  line-height: 22px;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}
.tab:hover {
  color: var(--lm-text);
}
.tab--active {
  border-bottom-color: var(--lm-brand);
  color: var(--lm-title);
  font-weight: 600;
}

/* ── 验证码表单：仅下边框的极简输入行 ── */
.panel {
  display: flex;
  flex-direction: column;
  margin-top: 22px;
}
.field {
  display: flex;
  align-items: center;
  height: 44px;
  border-bottom: 1px solid var(--lm-line);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.field:focus-within {
  border-bottom-color: var(--lm-brand);
}
.input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--lm-title);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}
.input::placeholder {
  color: var(--lm-placeholder);
}
.field--code .input {
  padding-right: 12px;
}
.send-code {
  flex: 0 0 auto;
  padding: 0 0 0 12px;
  border: 0;
  background: none;
  color: var(--lm-brand);
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.send-code:disabled {
  color: var(--lm-disabled);
  cursor: not-allowed;
}
.field-error {
  margin: 6px 0 0;
  color: var(--lm-danger);
  font-size: 12px;
  line-height: 1.4;
}
.hint {
  margin: 6px 0 0;
  color: var(--lm-brand);
  font-size: 12px;
  line-height: 1.4;
}
.form-error {
  margin: 10px 0 0;
  color: var(--lm-danger);
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

/* ── 复选框（紫底白勾）── */
.cb {
  position: relative;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--lm-placeholder);
  border-radius: 3px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--lm-bg);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}
.cb:checked {
  border-color: var(--lm-brand);
  background: var(--lm-brand);
}
.cb:checked::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 5px;
  width: 4px;
  height: 8px;
  border: solid #ffffff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.cb--sm {
  width: 14px;
  height: 14px;
}
.cb--sm:checked::after {
  top: 1px;
  left: 4px;
  width: 3px;
  height: 6px;
}

.keep {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  color: var(--lm-text);
  font-size: 14px;
  line-height: 1.5;
  user-select: none;
  cursor: pointer;
}

/* ── 主按钮 322×44 / 圆角 6 / #6D5BD0（400 宽 + 40 内边距 → 实际 320，与参照 553~872 一致）── */
.submit {
  width: 100%;
  height: 44px;
  margin-top: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: var(--lm-brand);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.submit:hover {
  background: var(--lm-brand-hover);
}
.submit:disabled {
  opacity: 0.66;
  cursor: not-allowed;
}

/* ── 微信/密码 tab：无后端能力，只说明不发假登录 ── */
.tab-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 32px;
  padding: 44px 0;
  text-align: center;
}
.notice-text {
  margin: 0;
  color: var(--lm-muted);
  font-size: 14px;
  line-height: 1.6;
}
.notice-switch {
  padding: 0;
  border: 0;
  background: none;
  color: var(--lm-brand);
  font-size: 14px;
  line-height: 1.5;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

/* ── 分割线 + 第三方圆形按钮 ── */
.divider {
  display: flex;
  align-items: center;
  margin-top: 24px;
}
.divider::before,
.divider::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: var(--lm-line);
}
.divider span {
  flex: 0 0 auto;
  padding: 0 12px;
  color: var(--lm-placeholder);
  font-size: 12px;
  line-height: 18px;
}
.thirdparty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
  margin-top: 18px;
}
.tp {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--lm-line);
  border-radius: 50%;
  background: var(--lm-bg);
  cursor: not-allowed;
}
.tp:disabled {
  opacity: 1;
}
.tp svg {
  display: block;
  width: 22px;
  height: 22px;
}

/* ── 协议 + 18+ 声明 + 深色气泡 ── */
.agree-block {
  position: relative;
  /* 微信/密码 tab 内容更短时，协议区仍贴在弹窗底部（验证码 tab 无剩余空间，auto 退化为 0） */
  margin-top: auto;
  padding-top: 22px;
}
.agree-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}
.agree-row .cb {
  margin-top: 2px;
}
.agree-text {
  color: var(--lm-muted);
  font-size: 12px;
  line-height: 1.5;
}
.link {
  color: var(--lm-brand);
}
.link:hover {
  text-decoration: underline;
}
.age-note {
  margin: 4px 0 0 22px;
  color: var(--lm-muted);
  font-size: 11px;
  line-height: 1.5;
}
.bubble {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 2;
  padding: 9px 12px;
  border-radius: 4px;
  background: #262626;
  color: #ffffff;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  animation: lm-fade var(--duration-fast) var(--ease-out);
}
.bubble::before {
  content: "";
  position: absolute;
  top: -5px;
  left: 14px;
  width: 0;
  height: 0;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #262626;
  border-left: 5px solid transparent;
}

/* 浅色弹窗内统一焦点样式（覆盖全局深色品牌色） */
.card :focus-visible {
  outline: 2px solid var(--lm-brand);
  outline-offset: 2px;
}
.input:focus-visible {
  outline: none;
}

@keyframes lm-fade {
  from {
    opacity: 0;
  }
}
@keyframes lm-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
</style>
