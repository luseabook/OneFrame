<script setup lang="ts">
// 公共布局：深色营销页（与竞品一致 #000），带页头与合规页脚
const auth = useAuth();
const route = useRoute();
const user = computed(() => auth.state.value.user);
const isLoginPage = computed(() => route.path === "/login");
</script>

<template>
  <div class="marketing">
    <header class="site-head">
      <NuxtLink to="/" class="brand">
        <span class="logo-mark" aria-hidden="true">万</span>
        <span class="logo-text">万帧</span>
      </NuxtLink>
      <nav class="nav">
        <!-- 登录态客户端渲染，避免 hydration 前后结构不一致 -->
        <ClientOnly>
          <NuxtLink to="/pricing" class="nav-link">定价</NuxtLink>
          <template v-if="user">
            <NuxtLink to="/home" class="cta">进入工作台</NuxtLink>
          </template>
          <template v-else-if="!isLoginPage">
            <NuxtLink to="/login" class="nav-link">登录</NuxtLink>
            <NuxtLink to="/login?redirect=/home" class="cta">立即登录</NuxtLink>
          </template>
        </ClientOnly>
      </nav>
    </header>

    <main class="body">
      <slot />
    </main>

    <footer class="site-foot">
      <div class="foot-links">
        <NuxtLink to="/terms">用户协议</NuxtLink>
        <NuxtLink to="/privacy">隐私政策</NuxtLink>
        <NuxtLink to="/report">举报投诉</NuxtLink>
      </div>
      <p class="copy">内容由 AI 生成，请仔细甄别 · © 2026 万帧 WanFrame</p>
    </footer>
  </div>
</template>

<style scoped>
.marketing {
  min-height: 100vh;
  background: var(--dark-base);
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
