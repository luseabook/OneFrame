<script setup lang="ts">
// 公共布局：深色营销页（与竞品一致 #000），带页头与合规页脚
const { t } = useI18n();
const auth = useAuth();
const route = useRoute();
const user = computed(() => auth.state.value.user);
const isLoginPage = computed(() => route.path === "/login");

// 公共页整页刷新时也要恢复登录态，否则已登录用户在 /terms /privacy 等页会看到「登录/立即登录」
onMounted(() => {
  if (!auth.state.value.accessToken) void auth.bootstrap();
});
</script>

<template>
  <div class="marketing">
    <header class="site-head">
      <NuxtLink to="/" class="brand">
        <span class="logo-mark" aria-hidden="true">一</span>
        <span class="logo-text">{{ t("landing.brandName") }}</span>
      </NuxtLink>
      <nav class="nav">
        <!-- 登录态客户端渲染，避免 hydration 前后结构不一致 -->
        <ClientOnly>
          <NuxtLink to="/pricing" class="nav-link">{{ t("nav.pricing") }}</NuxtLink>
          <template v-if="user">
            <NuxtLink to="/home" class="cta">{{ t("nav.enterWorkspace") }}</NuxtLink>
          </template>
          <template v-else-if="!isLoginPage">
            <NuxtLink to="/login" class="nav-link">{{ t("nav.login") }}</NuxtLink>
            <NuxtLink to="/login?redirect=/home" class="cta">{{ t("shell.loginNow") }}</NuxtLink>
          </template>
        </ClientOnly>
      </nav>
    </header>

    <main class="body">
      <slot />
    </main>

    <footer class="site-foot">
      <div class="foot-links">
        <NuxtLink to="/terms">{{ t("nav.terms") }}</NuxtLink>
        <NuxtLink to="/privacy">{{ t("nav.privacy") }}</NuxtLink>
        <NuxtLink to="/report">{{ t("nav.report") }}</NuxtLink>
      </div>
      <p class="copy">{{ t("shell.aiDisclaimer") }}</p>
      <SiteLegal />
    </footer>
  </div>
</template>

<style scoped>
.marketing {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
  display: flex;
  flex-direction: column;
}
.marketing :deep(a) {
  color: inherit;
}
.site-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 32px;
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  background: #000000cc;
  backdrop-filter: blur(8px);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}
.logo-text {
  font-size: 16px;
  font-weight: 700;
}
.nav {
  display: flex;
  align-items: center;
  gap: 18px;
}
.nav-link {
  color: var(--text-2);
  font-size: 14px;
}
.nav-link:hover {
  color: var(--text-1);
}
.cta {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 18px;
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.cta:hover {
  filter: brightness(1.1);
}
.body {
  flex: 1;
  min-width: 0;
}
.site-foot {
  padding: 28px 32px 36px;
  border-top: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.foot-links {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--text-3);
}
.foot-links a:hover {
  color: var(--text-1);
}
.copy {
  margin: 0;
  font-size: 12px;
  color: var(--text-4);
}
</style>
