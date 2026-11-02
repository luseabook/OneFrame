<script setup lang="ts">
// 运营后台独立登录壳层：无任何用户端元素（无用户导航/积分/协议页脚）
const envLabel = computed(() => {
  if (!import.meta.client) return "内部系统";
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "本地环境";
  return "生产环境";
});
</script>

<template>
  <div id="admin-root" class="admin-auth">
    <div class="auth-grid" aria-hidden="true"></div>
    <header class="auth-head">
      <span class="logo-mark" aria-hidden="true">一</span>
      <span class="brand-block">
        <span class="brand-text">一帧</span>
        <span class="brand-sub">ONEFRAME CONSOLE</span>
      </span>
      <span class="console-badge">ADMIN</span>
      <span class="env-chip"><i class="env-dot" aria-hidden="true"></i>{{ envLabel }}</span>
    </header>
    <main class="auth-main">
      <slot />
    </main>
    <footer class="auth-foot">内部系统 · 仅授权运营人员使用 · 登录与操作均留痕</footer>
  </div>
</template>

<style scoped>
.admin-auth {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(900px 480px at 50% -12%, rgba(155, 70, 255, 0.2), transparent 68%),
    radial-gradient(700px 420px at 100% 100%, rgba(79, 209, 197, 0.05), transparent 70%),
    #0b0c11;
  color: var(--text-1);
}

.auth-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(circle at 50% 28%, #000 0%, transparent 72%);
  -webkit-mask-image: radial-gradient(circle at 50% 28%, #000 0%, transparent 72%);
}

.auth-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 24px;
}

.auth-head .logo-mark {
  width: 34px;
  height: 34px;
  font-size: 15px;
}

.auth-head .env-chip {
  margin-left: auto;
}

.auth-main {
  position: relative;
  z-index: 1;
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.auth-foot {
  position: relative;
  z-index: 1;
  padding: 16px 24px 24px;
  text-align: center;
  color: var(--text-4);
  font-size: 11.5px;
  letter-spacing: 0.02em;
}
</style>
