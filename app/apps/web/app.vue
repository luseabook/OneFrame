<script setup lang="ts">
const auth = useAuth();
const route = useRoute();

onMounted(async () => {
  await auth.bootstrap();
  if (auth.state.value.accessToken) await auth.me().catch(() => undefined);
});

const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const frozen = computed(() => auth.state.value.credits?.frozen ?? 0);
const user = computed(() => auth.state.value.user);
const isWorkspace = computed(() => route.path.startsWith("/create") || route.path.startsWith("/tasks"));

async function logout(): Promise<void> {
  await auth.logout();
  await navigateTo("/");
}
</script>

<template>
  <div class="app">
    <header class="header">
      <NuxtLink to="/" class="logo">AI 漫剧工作台</NuxtLink>
      <nav class="nav">
        <NuxtLink to="/projects" class="nav-link">项目</NuxtLink>
        <NuxtLink to="/create/text-to-video" class="nav-link" :class="{ active: isWorkspace }">文生视频</NuxtLink>
        <NuxtLink to="/create/image-to-video" class="nav-link">图生视频</NuxtLink>
        <NuxtLink to="/assets" class="nav-link">资产</NuxtLink>
        <NuxtLink to="/tasks" class="nav-link">任务</NuxtLink>
        <NuxtLink to="/credits" class="nav-link">积分</NuxtLink>
        <NuxtLink to="/pricing" class="nav-link">定价</NuxtLink>
        <ClientOnly>
          <template v-if="user">
            <span class="balance" title="可用 / 冻结">积分 {{ balance }}<span v-if="frozen">（冻 {{ frozen }}）</span></span>
            <span class="nickname">{{ user.nickname }}</span>
            <NuxtLink to="/settings" class="link-btn">设置</NuxtLink>
            <button class="link-btn" @click="logout">退出</button>
          </template>
          <NuxtLink v-else to="/login" class="login-btn">登录 / 注册</NuxtLink>
        </ClientOnly>
      </nav>
    </header>
    <NuxtPage />
    <footer class="footer">
      <span>内容由 AI 生成，请仔细甄别</span>
      <span class="sep">·</span>
      <NuxtLink to="/report" class="report-link">举报 / 投诉</NuxtLink>
      <span class="sep">·</span>
      <NuxtLink to="/terms" class="report-link">用户协议</NuxtLink>
      <span class="sep">·</span>
      <NuxtLink to="/privacy" class="report-link">隐私政策</NuxtLink>
      <span class="sep">·</span>
      <span>ICP 备案号占位（上线前替换，docs/06-security-compliance/compliance.md A3）</span>
      <span class="sep">·</span>
      <a class="report-link" href="mailto:report@example.com?subject=%E5%86%85%E5%AE%B9%E4%B8%BE%E6%8A%A5">举报邮箱</a>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: rgba(11, 11, 16, 0.9);
  backdrop-filter: blur(8px);
  z-index: 10;
}
.logo {
  font-size: 16px;
  font-weight: 600;
}
.nav {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}
.nav-link {
  color: var(--text-2);
}
.nav-link.active,
.nav-link:hover {
  color: var(--text-1);
}
.balance {
  color: var(--text-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 4px 10px;
}
.nickname {
  color: var(--text-2);
}
.link-btn {
  background: none;
  border: 0;
  color: var(--text-3);
  cursor: pointer;
  font-size: 13px;
}
.login-btn {
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-m);
  padding: 8px 16px;
}
.footer {
  margin-top: auto;
  padding: 20px 32px;
  color: var(--text-3);
  font-size: 12px;
  display: flex;
  gap: 8px;
}
.sep {
  color: var(--color-border);
}
.report-link {
  color: var(--text-2);
  text-decoration: underline;
}
</style>
