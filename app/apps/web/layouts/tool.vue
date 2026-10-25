<script setup lang="ts">
// 工具布局：独立双栏页（无侧栏），顶部保留全局操作区（对齐参照产品「视频生成」页）
const route = useRoute();
const title = computed(() => (route.meta.toolTitle as string) || "视频生成");
const auth = useAuth();
const authReady = computed(() => auth.ready.value);
const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const user = computed(() => auth.state.value.user);
const avatarChar = computed(() => (user.value?.nickname || "用").slice(0, 1).toUpperCase());
</script>

<template>
  <div class="tool-page">
    <header class="head">
      <div class="left">
        <button class="back" aria-label="返回" @click="$router.back()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
          </svg>
        </button>
        <h1>{{ title }}</h1>
      </div>
      <div class="actions">
        <span class="mini-pill disabled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4.5h9.5A1.5 1.5 0 0 1 16 6v14H6.5A1.5 1.5 0 0 1 5 18.5Z" />
            <path d="M9 8h4M9 11.5h4" />
          </svg>
          创作手册
        </span>
        <span class="mini-pill disabled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z" />
          </svg>
          商务合作
        </span>
        <NuxtLink to="/tasks" class="icon-btn" title="任务中心">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
            <path d="M10.3 19a2 2 0 0 0 3.4 0" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/report" class="icon-btn" title="帮助与反馈">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9.6 9.3A2.5 2.5 0 0 1 14.5 10c0 1.6-2.4 2-2.4 3.4" />
            <circle cx="12" cy="16.6" r="0.4" fill="currentColor" />
          </svg>
        </NuxtLink>
        <NuxtLink to="/pricing" class="recharge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.5 4.5h2l2.4 11h10.4l2.2-8H7" />
            <circle cx="9.5" cy="19" r="1.4" />
            <circle cx="16.5" cy="19" r="1.4" />
          </svg>
          <b>会员订阅</b>
          <i class="sep" />
          <span>视频低至 8 积分/条</span>
        </NuxtLink>
        <NuxtLink to="/credits" class="credits" title="积分余额">
          <span class="spark">✦</span>
          <b>{{ authReady ? balance : "—" }}</b>
        </NuxtLink>
        <template v-if="!authReady">
          <span class="avatar">…</span>
        </template>
        <NuxtLink v-else-if="user" to="/settings" class="avatar" :title="user.nickname">{{ avatarChar }}</NuxtLink>
        <NuxtLink v-else to="/login" class="login-btn">立即登录</NuxtLink>
      </div>
    </header>
    <main class="body">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.tool-page {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px;
  min-height: 62px;
}
.left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.back {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.back svg {
  width: 20px;
  height: 20px;
}
.back:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mini-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.mini-pill svg {
  width: 15px;
  height: 15px;
}
.mini-pill.disabled {
  opacity: 0.75;
  cursor: default;
}
.icon-btn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  color: var(--text-2);
}
.icon-btn svg {
  width: 17px;
  height: 17px;
}
.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.recharge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #ffffff24;
  background: #141414;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
.recharge svg {
  width: 16px;
  height: 16px;
}
.recharge b {
  color: var(--text-1);
  font-weight: 600;
}
.recharge .sep {
  width: 1px;
  height: 12px;
  background: var(--border-2);
}
.recharge span {
  color: var(--text-3);
}
.credits {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: 13px;
}
.credits b {
  color: var(--text-1);
}
.spark {
  color: var(--brand-400);
}
.avatar {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
}
.login-btn {
  height: 34px;
  display: inline-flex;
  align-items: center;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
}
.body {
  flex: 1;
  min-width: 0;
}
@media (max-width: 1100px) {
  .mini-pill {
    display: none;
  }
}
</style>
