<script setup lang="ts">
// 运营后台专用壳层：与用户端（layouts/app.vue）完全分离。
// 运营端不展示用户菜单（首页/作品/工具箱/资产库/任务中心）、不展示积分充值、
// 不展示用户协议/隐私/举报页脚——避免两套产品在同一套导航里互相污染。
const envLabel = computed(() => {
  if (!import.meta.client) return "内部系统";
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "本地环境";
  return "生产环境";
});
</script>

<template>
  <div class="admin-shell">
    <header class="admin-topbar">
      <div class="brand">
        <span class="logo-mark" aria-hidden="true">一</span>
        <span class="brand-text">一帧</span>
        <span class="console-badge">运营后台</span>
      </div>
      <div class="right">
        <span class="env-chip">{{ envLabel }}</span>
        <span class="hint">内部系统 · 仅授权运营人员使用</span>
      </div>
    </header>

    <main class="admin-main">
      <slot />
    </main>

    <footer class="admin-footer">
      <span>OneFrame Admin Console</span>
      <span>所有操作留痕（管理员 / 时间 / 处置结论）</span>
    </footer>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text-1);
}

.admin-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-1, #ffffff14);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
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
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--brand-500);
  color: var(--brand-300);
  font-size: 12px;
  line-height: 18px;
}

.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.env-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-raised);
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
}

.hint {
  color: var(--text-4);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.admin-main {
  flex: 1;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px 24px 40px;
  box-sizing: border-box;
}

.admin-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-1, #ffffff14);
  color: var(--text-4);
  font-size: 12px;
}

@media (max-width: 720px) {
  .hint {
    display: none;
  }
  .admin-main {
    padding: 16px 14px 32px;
  }
}
</style>
