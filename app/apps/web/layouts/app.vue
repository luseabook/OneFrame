<script setup lang="ts">
// 工作台壳层：1:1 对齐竞品 ReelMate（home.png 实测）
// 深色 #000，侧栏 240px 分组导航，顶栏胶囊按钮组（铃铛/帮助/充值/积分/登录态）
const auth = useAuth();
const route = useRoute();
const router = useRouter();

type NavItem = { key: string; to: string; label: string; icon: string; disabled?: boolean };
const mainNav: NavItem[] = [
  { key: "home", to: "/home", label: "首页", icon: "home" },
  { key: "create", to: "/projects?create=1", label: "剧本创作", icon: "script" },
  { key: "agent", to: "", label: "创作 Agent", icon: "wand", disabled: true },
  { key: "projects", to: "/projects", label: "全部项目", icon: "folder" },
  { key: "tools", to: "/tools", label: "工具箱", icon: "wand" },
];
const teamNav: NavItem[] = [
  { key: "assets", to: "/assets", label: "资产库", icon: "folder" },
  // 2026-10-26：cam 团队域已落地（后端 17 端点 + /team 页），置灰改为可进入
  { key: "team", to: "/team", label: "团队管理", icon: "clock" },
];

const collapsed = ref(false);
const menuOpen = ref(false);
// 认证状态确定后再渲染登录态相关 UI：SSR 与客户端首帧都渲染同一占位，避免 hydration 不一致
const authReady = computed(() => auth.ready.value);

const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const frozen = computed(() => auth.state.value.credits?.frozen ?? 0);
const user = computed(() => auth.state.value.user);
const avatarChar = computed(() => (user.value?.nickname || "用").slice(0, 1).toUpperCase());

function isActive(to: string, key?: string): boolean {
  if (!to) return false;
  if (key === "create") return route.path === "/projects" && String(route.query.create ?? "") === "1";
  if (key === "projects") return route.path === "/projects" && String(route.query.create ?? "") !== "1";
  return route.path === to || route.path.startsWith(`${to.split("?")[0]}/`);
}

function onNavClick(item: { disabled?: boolean }, event: Event): void {
  if (item.disabled) event.preventDefault();
}

async function logout(): Promise<void> {
  menuOpen.value = false;
  await auth.logout();
  await router.push("/login");
}

function onDocClick(e: MouseEvent): void {
  if (!(e.target instanceof Element) || !e.target.closest(".avatar-wrap")) menuOpen.value = false;
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="shell" :class="{ collapsed }">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo-mark" aria-hidden="true">一</span>
        <span v-if="!collapsed" class="logo-text">一帧</span>
        <button class="collapse-btn" :title="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9.5 4v16" />
          </svg>
        </button>
      </div>

      <nav class="nav">
        <NuxtLink
          v-for="item in mainNav"
          :key="item.key"
          :to="item.disabled ? route.fullPath : item.to"
          class="item"
          :class="{ active: isActive(item.to, item.key), disabled: item.disabled }"
          @click="onNavClick(item, $event)"
        >
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="item.icon === 'home'">
                <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />
                <path d="M9.5 20.5v-6h5v6" />
              </template>
              <template v-else-if="item.icon === 'script'">
                <path d="M6 3.5h10.5A1.5 1.5 0 0 1 18 5v15.5H7.5A1.5 1.5 0 0 1 6 19Z" />
                <path d="M9 7.5h6M9 11h6M9 14.5h3.5" />
              </template>
              <template v-else-if="item.icon === 'folder'">
                <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h4l2 2.5h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z" />
              </template>
              <template v-else-if="item.icon === 'wand'">
                <path d="m5 19 9.5-9.5M16.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" />
                <path d="M12.8 6.8 5 14.6a2 2 0 0 0 0 2.8l1.6 1.6a2 2 0 0 0 2.8 0l7.8-7.8" />
              </template>
              <template v-else>
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </template>
            </svg>
          </span>
          <span v-if="!collapsed">{{ item.label }}</span>
        </NuxtLink>

        <div class="divider" />
        <p v-if="!collapsed" class="group-label">团队</p>
        <NuxtLink
          v-for="item in teamNav"
          :key="item.key"
          :to="item.disabled ? route.fullPath : item.to"
          class="item"
          :class="{ active: isActive(item.to, item.key), disabled: item.disabled }"
          @click="onNavClick(item, $event)"
        >
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="item.icon === 'folder'">
                <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h4l2 2.5h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z" />
              </template>
              <template v-else>
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </template>
            </svg>
          </span>
          <span v-if="!collapsed">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="foot">
        <span class="item disabled" title="影视版（申请内测）">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
              <path d="m10 9.5 5 2.5-5 2.5Z" />
            </svg>
          </span>
          <span v-if="!collapsed" class="foot-label">影视版</span>
          <span v-if="!collapsed" class="tag-beta">申请内测</span>
        </span>
        <span class="item disabled">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <path d="m7 9.5 2.5 2.5L7 14.5M12 14.5h4" />
            </svg>
          </span>
          <span v-if="!collapsed">MCP &amp; CLI</span>
        </span>
        <span class="item disabled">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4v2.5M12 17.5V20M4.5 12H7M17 12h2.5M7 7l1.8 1.8M15.2 15.2 17 17M17 7l-1.8 1.8M8.8 15.2 7 17" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          <span v-if="!collapsed">活动</span>
        </span>
        <NuxtLink to="/report" class="item assist">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.5 13v-2a7.5 7.5 0 0 1 15 0v2" />
              <rect x="3" y="12.5" width="4" height="6" rx="1.5" />
              <rect x="17" y="12.5" width="4" height="6" rx="1.5" />
              <path d="M19.5 18.5c0 1.5-1.5 2.5-4 2.5" />
            </svg>
          </span>
          <span v-if="!collapsed">添加专属运营助手</span>
        </NuxtLink>
        <div v-if="!collapsed" class="legal">
          <NuxtLink to="/terms">用户协议</NuxtLink>
          <NuxtLink to="/privacy">隐私政策</NuxtLink>
          <NuxtLink to="/report">举报投诉</NuxtLink>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb"><slot name="crumb" /></div>
        <div class="right">
            <span class="mini-pill disabled" title="创作手册即将上线">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 4.5h9.5A1.5 1.5 0 0 1 16 6v14H6.5A1.5 1.5 0 0 1 5 18.5Z" />
                <path d="M9 8h4M9 11.5h4" />
              </svg>
              创作手册
            </span>
            <span class="mini-pill disabled" title="商务合作即将上线">
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
              <svg class="spark" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" />
              </svg>
              <b>{{ authReady ? balance : "—" }}</b>
              <span v-if="authReady && frozen" class="frozen">冻 {{ frozen }}</span>
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
                  <NuxtLink to="/works" class="menu-item" @click="menuOpen = false">我的作品</NuxtLink>
                  <NuxtLink to="/tasks" class="menu-item" @click="menuOpen = false">任务中心</NuxtLink>
                  <NuxtLink to="/settings" class="menu-item" @click="menuOpen = false">个人设置</NuxtLink>
                  <button class="menu-item" @click="logout">退出登录</button>
                </div>
              </div>
            </template>
            <NuxtLink v-else to="/login" class="login-btn">立即登录</NuxtLink>

        </div>
      </header>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
}

/* ── 侧边栏（竞品 240px，深色无边框底）── */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--bg-app);
  border-right: 1px solid var(--border-1);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}
.collapsed .sidebar {
  width: 64px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  min-height: 64px;
}
.logo-mark {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}
.logo-text {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.02em;
  flex: 1;
}
.collapse-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-3);
  cursor: pointer;
}
.collapse-btn svg {
  width: 16px;
  height: 16px;
}
.collapse-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.nav {
  flex: 1;
  padding: 8px 12px;
  overflow-y: auto;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--radius-lg);
  color: var(--text-2);
  font-size: 14px;
  margin-bottom: 2px;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.item.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.item.disabled:hover {
  background: transparent;
  color: var(--text-2);
}
.item.disabled:hover .ico {
  color: var(--text-3);
}
.item.active {
  background: linear-gradient(90deg, #ffffff1a, #ffffff08);
  color: var(--text-1);
  font-weight: 600;
}
.ico {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--text-3);
}
.ico svg {
  width: 20px;
  height: 20px;
}
.item.active .ico,
.item:hover .ico {
  color: var(--text-1);
}
.divider {
  height: 1px;
  background: var(--border-1);
  margin: 10px 4px;
}
.group-label {
  margin: 0 0 6px;
  padding: 0 10px;
  color: var(--text-4);
  font-size: 12px;
}

.foot {
  padding: 8px 12px 14px;
}
.tag-beta {
  margin-left: auto;
  font-size: 11px;
  color: var(--brand-400);
  background: #7e70ff1f;
  border-radius: var(--radius-full);
  padding: 1px 8px;
}
.assist,
.assist .ico {
  color: var(--brand-400);
}
.assist:hover {
  color: var(--brand-300);
}
.legal {
  display: flex;
  gap: 10px;
  padding: 10px 10px 0;
  font-size: 11px;
  color: var(--text-4);
}
.legal a:hover {
  color: var(--text-2);
}

/* ── 主区 ── */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  background: #000000cc;
  backdrop-filter: blur(8px);
}
.crumb {
  font-size: 13px;
  color: var(--text-3);
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon-btn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  color: var(--text-2);
  background: transparent;
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
  padding: 0 14px;
  border-radius: var(--radius-full);
  background: #292115;
  border: 1px solid #f5c45133;
  color: #f5c451;
  font-size: 13px;
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
  padding: 0 14px;
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
  transition: filter var(--duration-fast) var(--ease-out);
}
.login-btn:hover {
  filter: brightness(1.1);
}

.content {
  flex: 1;
  min-width: 0;
}

@media (max-width: 900px) {
  .sidebar {
    width: 64px;
  }
  .logo-text,
  .group-label,
  .item span:not(.ico),
  .tag-beta,
  .legal,
  .recharge span,
  .recharge .sep,
  .recharge b {
    display: none;
  }
  .item {
    justify-content: center;
    padding: 0;
  }
  .recharge {
    padding: 0 10px;
  }
}
</style>
