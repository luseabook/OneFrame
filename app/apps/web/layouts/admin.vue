<script setup lang="ts">
// 运营后台专用壳层：独立登录态 / 独立菜单 / 独立页脚。
// 与用户端（layouts/app.vue）完全分离：不展示用户菜单、积分充值、用户协议/隐私/举报。
const menu = useAdminMenu();
const tab = useAdminTab();
const route = useRoute();
const router = useRouter();

const envLabel = computed(() => {
  if (!import.meta.client) return "内部系统";
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "本地环境";
  return "生产环境";
});

const currentMenu = computed(() => menu.find((item) => item.key === tab.value) ?? menu[0]!);

function isActive(key: string): boolean {
  return route.path === "/admin" && tab.value === key;
}

function logout(): void {
  localStorage.removeItem("admin_token");
  void router.push("/admin/login");
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-side">
      <div class="brand">
        <span class="logo-mark" aria-hidden="true">一</span>
        <span class="brand-text">一帧</span>
        <span class="console-badge">运营后台</span>
      </div>

      <nav class="admin-nav" aria-label="运营后台菜单">
        <NuxtLink
          v-for="item in menu"
          :key="item.key"
          :to="{ path: '/admin', query: item.key === 'dashboard' ? {} : { tab: item.key } }"
          class="nav-item"
          :class="{ active: isActive(item.key) }"
        >
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-hint">{{ item.hint }}</span>
        </NuxtLink>
      </nav>

      <div class="side-foot">
        <div class="who">
          <span class="who-name">管理员</span>
          <span class="who-hint">internal ops</span>
        </div>
        <button class="logout-btn" type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <div class="admin-body">
      <header class="admin-topbar">
        <div class="title-wrap">
          <span class="page-title">{{ currentMenu.label }}</span>
          <span class="page-hint">{{ currentMenu.hint }}</span>
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
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  display: flex;
  background: var(--bg-app);
  color: var(--text-1);
}

/* ── 左侧独立菜单 ── */
.admin-side {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  width: 236px;
  flex: 0 0 236px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 12px;
  box-sizing: border-box;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-1, #ffffff14);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 12px;
  border-bottom: 1px solid var(--border-1, #ffffff14);
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
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--brand-500);
  color: var(--brand-300);
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
}

.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text-2);
  border: 1px solid transparent;
}

.nav-item:hover {
  background: var(--bg-hover);
}

.nav-item.active {
  background: var(--bg-active);
  border-color: #ffffff1f;
  color: var(--text-1);
}

.nav-label {
  font-size: 13px;
  font-weight: 600;
}

.nav-hint {
  font-size: 11px;
  color: var(--text-4);
}

.nav-item.active .nav-hint {
  color: var(--text-3);
}

.side-foot {
  padding-top: 12px;
  border-top: 1px solid var(--border-1, #ffffff14);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.who {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 4px;
}

.who-name {
  font-size: 12px;
  color: var(--text-2);
}

.who-hint {
  font-size: 10px;
  color: var(--text-4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.logout-btn {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid #ffffff1f;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}

.logout-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

/* ── 右侧内容区 ── */
.admin-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.admin-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-1, #ffffff14);
}

.title-wrap {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.page-title {
  font-weight: 700;
  font-size: 15px;
}

.page-hint {
  color: var(--text-4);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  padding: 12px 24px;
  border-top: 1px solid var(--border-1, #ffffff14);
  color: var(--text-4);
  font-size: 12px;
}

@media (max-width: 900px) {
  .admin-shell {
    flex-direction: column;
  }
  .admin-side {
    position: static;
    width: 100%;
    flex: none;
    height: auto;
    flex-direction: column;
  }
  .admin-nav {
    flex-direction: row;
    flex-wrap: wrap;
    overflow: visible;
  }
  .admin-nav .nav-hint {
    display: none;
  }
  .side-foot {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .logout-btn {
    width: auto;
  }
  .admin-main {
    padding: 16px 14px 32px;
  }
  .hint {
    display: none;
  }
}
</style>
