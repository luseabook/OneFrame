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
  <div class="admin-auth">
    <header class="auth-head">
      <span class="logo-mark" aria-hidden="true">一</span>
      <span class="brand-text">一帧</span>
      <span class="console-badge">运营后台</span>
      <span class="env-chip">{{ envLabel }}</span>
    </header>
    <main class="auth-main">
      <slot />
    </main>
    <footer class="auth-foot">内部系统 · 仅授权运营人员使用 · 登录与操作均留痕</footer>
  </div>
</template>

<style scoped>
.admin-auth {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1100px 520px at 50% -10%, #33288f55, transparent 70%),
    var(--bg-app);
  color: var(--text-1);
}

.auth-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 24px;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--brand-500);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}

.brand-text {
  font-weight: 700;
  letter-spacing: 0.04em;
}

.console-badge {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--brand-500);
  color: var(--brand-300);
  font-size: 12px;
  line-height: 18px;
}

.env-chip {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-raised);
  color: var(--text-3);
  font-size: 12px;
}

.auth-main {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.auth-foot {
  padding: 16px 24px 22px;
  text-align: center;
  color: var(--text-4);
  font-size: 12px;
}
</style>
