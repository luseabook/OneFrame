<script setup lang="ts">
/**
 * 工作流页账户组（对齐竞品工作台顶栏右侧的「会员订阅 / 积分 / 头像」）。
 *
 * 为什么独立成组件：/projects/:id 与 /reelflow/edit/:id 使用 `layout: "blank"`（沉浸式，
 * 无全站侧栏与全局顶栏），因此账户入口必须由页面自己的顶栏承载；两页共用一份实现，
 * 避免在页面里复制 avatar 菜单 / 积分读取逻辑。
 *
 * 与 layouts/app.vue 的 .topbar 右侧组保持同源（同一套 useAuth 状态与 i18n key）。
 */
const auth = useAuth();
const { t } = useI18n();
const router = useRouter();
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const authReady = computed(() => auth.ready.value);
const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const frozen = computed(() => auth.state.value.credits?.frozen ?? 0);
const user = computed(() => auth.state.value.user);
const avatarChar = computed(() => (user.value?.nickname || "?").slice(0, 1).toUpperCase());

const menuOpen = ref(false);
function onDocClick(e: MouseEvent): void {
  if (!(e.target instanceof Element) || !e.target.closest(".avatar-wrap")) menuOpen.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

async function logout(): Promise<void> {
  menuOpen.value = false;
  await auth.logout();
  await router.push("/login");
}
</script>

<template>
  <div class="account-group">
    <NuxtLink v-if="!props.compact" to="/pricing" class="recharge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 4.5h2l2.4 11h10.4l2.2-8H7" />
        <circle cx="9.5" cy="19" r="1.4" />
        <circle cx="16.5" cy="19" r="1.4" />
      </svg>
      <b>{{ t("shell.subscribe") }}</b>
      <i class="sep" />
      <span>{{ t("shell.lowPrice", { credits: 8 }) }}</span>
    </NuxtLink>

    <NuxtLink to="/credits" class="credits" :title="t('shell.creditsBalance')">
      <svg class="spark" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" />
      </svg>
      <b>{{ authReady ? balance : "—" }}</b>
      <span v-if="authReady && frozen" class="frozen">{{ t("shell.frozenAmount", { amount: frozen }) }}</span>
    </NuxtLink>

    <template v-if="!authReady">
      <span class="login-btn" aria-hidden="true">…</span>
    </template>
    <template v-else-if="user">
      <div class="avatar-wrap">
        <button class="avatar" :title="user.nickname" @click="menuOpen = !menuOpen">
          {{ avatarChar }}
        </button>
        <div v-if="menuOpen" class="menu">
          <p class="menu-name">{{ user.nickname }}</p>
          <NuxtLink to="/works" class="menu-item" @click="menuOpen = false">{{ t("shell.myWorks") }}</NuxtLink>
          <NuxtLink to="/invite" class="menu-item" @click="menuOpen = false">{{ t("sidebar.invite") }}</NuxtLink>
          <NuxtLink to="/tasks" class="menu-item" @click="menuOpen = false">{{ t("shell.tasks") }}</NuxtLink>
          <NuxtLink to="/settings" class="menu-item" @click="menuOpen = false">{{ t("shell.personalSettings") }}</NuxtLink>
          <button class="menu-item" @click="logout">{{ t("shell.logout") }}</button>
        </div>
      </div>
    </template>
    <NuxtLink v-else to="/login" class="login-btn">{{ t("shell.loginNow") }}</NuxtLink>
  </div>
</template>

<style scoped>
.account-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.recharge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: #292115;
  border: 1px solid #f5c45133;
  color: #f5c451;
  font-size: 13px;
  white-space: nowrap;
}
.recharge svg {
  width: 15px;
  height: 15px;
}
.recharge b {
  font-weight: 600;
}
.recharge .sep {
  width: 1px;
  height: 12px;
  background: #f5c45140;
}
.recharge span {
  font-size: 12px;
  color: #f5c451cc;
}
.recharge:hover {
  background: #33291a;
}
.credits {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  color: var(--text-1);
  font-size: 14px;
}
.credits .spark {
  width: 15px;
  height: 15px;
  color: var(--brand-400);
}
.credits:hover {
  border-color: var(--border-3);
}
.frozen {
  color: var(--text-4);
  font-size: 11px;
}
.avatar-wrap {
  position: relative;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  border: none;
  background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.menu {
  position: absolute;
  right: 0;
  top: 44px;
  min-width: 160px;
  background: var(--bg-raised);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  z-index: var(--z-dropdown);
}
.menu-name {
  margin: 0;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-2);
  border-bottom: 1px solid var(--border-1);
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: none;
  background: none;
  border-radius: var(--radius-md);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.login-btn {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 20px;
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.login-btn:hover {
  filter: brightness(1.1);
}
</style>
