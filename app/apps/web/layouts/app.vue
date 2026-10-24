<script setup lang="ts">
const auth = useAuth();
const route = useRoute();
const router = useRouter();

const navGroups = [
  {
    label: "创作",
    items: [
      { to: "/projects", label: "短剧工作流", icon: "▤" },
      { to: "/create/text-to-video", label: "文生视频", icon: "✦" },
      { to: "/create/image-to-video", label: "图生视频", icon: "◐" },
    ],
  },
  {
    label: "资源",
    items: [
      { to: "/assets", label: "资产库", icon: "◫" },
      { to: "/tasks", label: "任务中心", icon: "◷" },
    ],
  },
  {
    label: "账户",
    items: [
      { to: "/credits", label: "积分", icon: "◉" },
      { to: "/pricing", label: "定价", icon: "◇" },
      { to: "/settings", label: "设置", icon: "⚙" },
    ],
  },
];

const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const frozen = computed(() => auth.state.value.credits?.frozen ?? 0);
const user = computed(() => auth.state.value.user);

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`);
}

async function logout(): Promise<void> {
  await auth.logout();
  await router.push("/login");
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <NuxtLink to="/projects" class="brand">
        <span class="logo">万帧</span>
        <span class="brand-sub">AI 漫剧工作台</span>
      </NuxtLink>

      <nav class="nav">
        <div v-for="group in navGroups" :key="group.label" class="group">
          <p class="group-label">{{ group.label }}</p>
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="item"
            :class="{ active: isActive(item.to) }"
          >
            <span class="ico" aria-hidden="true">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </NuxtLink>
        </div>
      </nav>
      <div class="foot">
        <NuxtLink to="/report" class="foot-link">举报 / 投诉</NuxtLink>
        <NuxtLink to="/terms" class="foot-link">用户协议</NuxtLink>
        <NuxtLink to="/privacy" class="foot-link">隐私政策</NuxtLink>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <slot name="crumb" />
        </div>
        <div class="right">
          <!-- 登录态相关内容在客户端确定后渲染，避免 hydrate 前后结构不同 -->
          <ClientOnly>
            <template v-if="user">
              <NuxtLink to="/credits" class="credits" title="可用 / 冻结">
                <span class="coin" aria-hidden="true">◉</span>
                <b>{{ balance }}</b>
                <span v-if="frozen" class="frozen">冻 {{ frozen }}</span>
              </NuxtLink>
              <span class="user">{{ user.nickname }}</span>
              <NuxtLink to="/settings" class="ghost-btn">设置</NuxtLink>
              <button class="ghost-btn" @click="logout">退出</button>
            </template>
          </ClientOnly>
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
}

/* ── 侧边栏 ── */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-1);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-1);
}
.logo {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--brand-600);
  letter-spacing: 0.02em;
}
.brand-sub {
  font-size: var(--text-xs);
  color: var(--text-4);
}
.nav {
  flex: 1;
  padding: var(--space-4) var(--space-3);
  overflow-y: auto;
}
.group + .group {
  margin-top: var(--space-5);
}
.group-label {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-3);
  color: var(--text-4);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 34px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-2);
  font-size: var(--text-sm);
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.item.active {
  background: var(--brand-50);
  color: var(--brand-700);
  font-weight: 600;
}
.ico {
  width: 16px;
  text-align: center;
  color: var(--text-4);
  font-size: 13px;
}
.item.active .ico {
  color: var(--brand-500);
}
.foot {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-1);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.foot-link {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.foot-link:hover {
  color: var(--brand-600);
}

/* ── 主区 ── */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: var(--header-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-1);
  position: sticky;
  top: 0;
  z-index: var(--z-header);
}
.crumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-3);
}
.right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.credits {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  background: var(--brand-50);
  color: var(--brand-700);
  font-size: var(--text-sm);
  border: 1px solid var(--brand-200);
}
.coin {
  color: var(--brand-500);
}
.frozen {
  color: var(--text-3);
  font-size: var(--text-xs);
}
.user {
  color: var(--text-2);
  font-size: var(--text-sm);
}
.ghost-btn {
  background: none;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  height: 28px;
  padding: 0 10px;
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.ghost-btn:hover {
  color: var(--text-1);
  border-color: var(--border-3);
}
.content {
  flex: 1;
  min-width: 0;
  padding: var(--space-6);
}

@media (max-width: 900px) {
  .sidebar {
    width: 64px;
  }
  .brand-sub,
  .group-label,
  .item span:not(.ico) {
    display: none;
  }
  .item {
    justify-content: center;
  }
  .content {
    padding: var(--space-4);
  }
}
</style>
