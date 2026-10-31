<script setup lang="ts">
// 工作台壳层：1:1 对齐竞品 ReelMate（home.png 实测）
// 深色 #000，侧栏 240px 分组导航，顶栏胶囊按钮组（铃铛/帮助/充值/积分/登录态）
const auth = useAuth();
const route = useRoute();
const router = useRouter();
// 壳层文案走 i18n（第 2 轮 i18n 基建）：侧栏/分组/品牌名按当前语言切换。
// 页面内文案由各页自己 t()，壳层只负责"全局导航"这一层，避免两处各翻译一份。
const { t } = useI18n();

/** `labelKey` 指向语言包 `sidebar.*`；模板里 t(item.labelKey) 渲染 */
type NavItem = { key: string; to: string; labelKey: string; icon: string; disabled?: boolean };
const mainNav: NavItem[] = [
  { key: "home", to: "/home", labelKey: "sidebar.home", icon: "home" },
  { key: "create", to: "/projects?create=1", labelKey: "sidebar.create", icon: "script" },
  // 2026-10-27：小说改编链（第 2 批）落地，入口开放
  { key: "novel", to: "/novel", labelKey: "sidebar.novel", icon: "script" },
  // 2026-10-27：创作 Agent（第 4 批）落地（对话页 + Skill 卡市场），置灰改为可进入
  { key: "agent", to: "/agent", labelKey: "sidebar.agent", icon: "wand" },
  // 2026-10-26：canvas 域后端已落地（27 路由 / 11 表），入口开放
  { key: "canvas", to: "/canvas", labelKey: "sidebar.canvas", icon: "folder" },
  { key: "projects", to: "/projects", labelKey: "sidebar.projects", icon: "folder" },
  // 2026-10-27：ReelFlow 剪辑台（出片之后的时间线编辑；对齐竞品 /reelflow/list）
  { key: "reelflow", to: "/reelflow/list", labelKey: "sidebar.reelflow", icon: "film" },
  { key: "tools", to: "/tools", labelKey: "sidebar.tools", icon: "wand" },
  // 2026-10-27（第 3 轮）：两种"项目模式"——广告剧与视频转绘。
  // 它们复用剧本项目的集/分镜/资产骨架，只是在前面多一段专属流程，故放在主分组末尾。
  { key: "ad-drama", to: "/ad-drama/create", labelKey: "sidebar.adDrama", icon: "script" },
  { key: "video-redraw", to: "/video-redraw/create", labelKey: "sidebar.videoRedraw", icon: "film" },
];
const teamNav: NavItem[] = [
  { key: "assets", to: "/assets", labelKey: "sidebar.assets", icon: "folder" },
  // 2026-10-26：cam 团队域已落地（后端 17 端点 + /team 页），置灰改为可进入
  { key: "team", to: "/team", labelKey: "sidebar.team", icon: "clock" },
  // 2026-10-27（第 2 轮 · 第 6 批）：剧本集市与团队知识库
  { key: "market", to: "/novel-market", labelKey: "sidebar.market", icon: "script" },
  { key: "knowledge", to: "/knowledge", labelKey: "sidebar.knowledge", icon: "folder" },
  // 2026-10-27（第 2 轮 · 第 6 批 A）：创作者中心与活动
  { key: "creator", to: "/creator-center", labelKey: "sidebar.creator", icon: "wand" },
  { key: "activities", to: "/activities", labelKey: "sidebar.activities", icon: "clock" },
];

const collapsed = ref(false);
const menuOpen = ref(false);
// 认证状态确定后再渲染登录态相关 UI：SSR 与客户端首帧都渲染同一占位，避免 hydration 不一致
const authReady = computed(() => auth.ready.value);

const balance = computed(() => auth.state.value.credits?.balance ?? 0);
const frozen = computed(() => auth.state.value.credits?.frozen ?? 0);
const user = computed(() => auth.state.value.user);
const avatarChar = computed(() => (user.value?.nickname || "?").slice(0, 1).toUpperCase());

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
        <span v-if="!collapsed" class="logo-text">{{ t("landing.brandName") }}</span>
        <button class="collapse-btn" :title="collapsed ? t('shell.expand') : t('shell.collapse')" @click="collapsed = !collapsed">
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
              <template v-else-if="item.icon === 'film'">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="M7.5 5v14M16.5 5v14M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21" />
              </template>
              <template v-else>
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </template>
            </svg>
          </span>
          <span v-if="!collapsed">{{ t(item.labelKey) }}</span>
        </NuxtLink>

        <div class="divider" />
        <p v-if="!collapsed" class="group-label">{{ t("sidebar.group") }}</p>
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
          <span v-if="!collapsed">{{ t(item.labelKey) }}</span>
        </NuxtLink>
      </nav>

      <div class="foot">
        <!-- 2026-10-27：影视版（第 5 批）页面已落地；准入仍走 spaces.film_enabled
             （竞品是商务开通制），未开通时页面内提示「联系商务开通」，入口不置灰。 -->
        <NuxtLink to="/film" class="item" :title="t('shell.filmBeta')">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
              <path d="m10 9.5 5 2.5-5 2.5Z" />
            </svg>
          </span>
          <span v-if="!collapsed" class="foot-label">{{ t("sidebar.film") }}</span>
          <span v-if="!collapsed" class="tag-beta">{{ t("sidebar.beta") }}</span>
        </NuxtLink>
        <span class="item disabled" :title="t('shell.cliMcpHint')">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <path d="m7 9.5 2.5 2.5L7 14.5M12 14.5h4" />
            </svg>
          </span>
          <span v-if="!collapsed">MCP &amp; CLI</span>
        </span>
        <NuxtLink to="/activities" class="item" :title="t('sidebar.activities')">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4v2.5M12 17.5V20M4.5 12H7M17 12h2.5M7 7l1.8 1.8M15.2 15.2 17 17M17 7l-1.8 1.8M8.8 15.2 7 17" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          <span v-if="!collapsed">{{ t("sidebar.activities") }}</span>
        </NuxtLink>
        <NuxtLink to="/report" class="item assist">
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.5 13v-2a7.5 7.5 0 0 1 15 0v2" />
              <rect x="3" y="12.5" width="4" height="6" rx="1.5" />
              <rect x="17" y="12.5" width="4" height="6" rx="1.5" />
              <path d="M19.5 18.5c0 1.5-1.5 2.5-4 2.5" />
            </svg>
          </span>
          <span v-if="!collapsed">{{ t("shell.assistant") }}</span>
        </NuxtLink>
        <div v-if="!collapsed" class="legal">
          <NuxtLink to="/terms">{{ t("nav.terms") }}</NuxtLink>
          <NuxtLink to="/privacy">{{ t("nav.privacy") }}</NuxtLink>
          <NuxtLink to="/report">{{ t("nav.report") }}</NuxtLink>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb"><slot name="crumb" /></div>
        <div class="right">
            <span class="mini-pill disabled" :title="t('shell.manualSoon')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 4.5h9.5A1.5 1.5 0 0 1 16 6v14H6.5A1.5 1.5 0 0 1 5 18.5Z" />
                <path d="M9 8h4M9 11.5h4" />
              </svg>
              {{ t("shell.manual") }}
            </span>
            <span class="mini-pill disabled" :title="t('shell.bizSoon')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z" />
              </svg>
              {{ t("shell.biz") }}
            </span>
            <LangSwitcher class="lang-in-topbar" />
            <NuxtLink to="/tasks" class="icon-btn" :title="t('shell.tasks')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
                <path d="M10.3 19a2 2 0 0 0 3.4 0" />
              </svg>
            </NuxtLink>
            <NuxtLink to="/report" class="icon-btn" :title="t('shell.feedback')">
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
              <b>{{ t("shell.subscribe") }}</b>
              <i class="sep" />
              <span>{{ t("shell.lowPrice", { credits: 8 }) }}</span>
            </NuxtLink>
            <NuxtLink to="/credits" class="credits" :title="t('shell.creditsBalance')">
              <svg class="spark" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" />
              </svg>
              <b>{{ authReady ? balance : "—" }}</b>
              <span v-if="authReady && frozen" class="frozen">{{ t("shell.frozenAmount", { amount: frozen }) }}</span>
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
                  <NuxtLink to="/works" class="menu-item" @click="menuOpen = false">{{ t("shell.myWorks") }}</NuxtLink>
                  <NuxtLink to="/invite" class="menu-item" @click="menuOpen = false">{{ t("sidebar.invite") }}</NuxtLink>
                  <NuxtLink to="/tasks" class="menu-item" @click="menuOpen = false">{{ t("shell.tasks") }}</NuxtLink>
                  <NuxtLink to="/settings" class="menu-item" @click="menuOpen = false">{{ t("shell.personalSettings") }}</NuxtLink>
                  <button class="menu-item" @click="logout">{{ t("shell.logout") }}</button>
                </div>
              </div>
            </template>
            <NuxtLink v-else to="/login" class="login-btn">{{ t("shell.loginNow") }}</NuxtLink>

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
  /* GL1：壳层 = chrome #0B0B10（页面色）。侧栏 #101015 / 内容面板 #191A22 各自分开，
     三层必须不同色，否则整站塌成"一整块黑"（竞品 task.png 三点取样）。 */
  background: var(--bg-chrome);
  color: var(--text-1);
}

/* ── 侧边栏（竞品 240px，深色无边框底）── */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--sidebar-line);
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
  width: 32px;
  height: 32px;
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
  /* 竞品侧栏选中块左沿距侧栏 14px（loggedin.png x14–222），故 nav 左右内距 14 */
  padding: 8px 14px;
  overflow-y: auto;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  color: var(--text-2);
  font-size: 14px;
  /* GL14/GL15：项高 40 + 隙 8 = 节距 48（竞品图标中心 y99/147/195/243/291 等距 48） */
  font-weight: 500;
  margin-bottom: 8px;
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
/* GL14：竞品选中态是「白 6% → 0% 的水平渐隐 + 白字」，**不加重字重**
   （loggedin.png：x14 #1D1E25 → x148 #19191F → x176 #15151A → x210 #111115 → x222 收净）。
   旧值 #ffffff1a→#ffffff08 起点过亮、终点没收到 0，且 600 字重属风格越位。 */
.item.active {
  background: linear-gradient(90deg, #ffffff0f, #ffffff00);
  color: #ffffff;
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
  padding: 0 8px;
  color: var(--text-4);
  font-size: 12px;
}

.foot {
  padding: 8px 14px 14px;
}
/* 底部工具区节距 40（竞品 task.png y427/467/507/547），不跟随导航的 48 */
.foot .item {
  margin-bottom: 0;
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
  /* GL3：竞品顶栏底 = 页面色 #0B0B10，**不加半透明也不加 blur**
     （旧值 #000000cc + blur 实测渲染成 #020203，比竞品暗 9 个灰阶）。 */
  background: var(--bg-chrome);
}
.crumb {
  font-size: 13px;
  color: var(--text-3);
  /* 顶栏右侧控件簇是定宽的一整排（GL4：全部 40 高），左侧 crumb 必须可压缩，
     否则窄视口下控件会被 flex 挤到换行（1000px 实测「会员订阅」被压成竖排） */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px; /* GL4：竞品控件间距 7–8px */
  flex-shrink: 0;
}
.icon-btn {
  width: 42px;
  height: 40px; /* GL4：竞品图标按钮 42×40（task.png x1146–1187 / y11–52） */
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid #2c2c30;
  color: var(--text-2);
  background: #0a0a0e;
}
.mini-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px; /* GL4：顶栏所有胶囊 40 高（旧值 34） */
  padding: 0 14px;
  border-radius: 999px;
  /* GL5：竞品胶囊底 #0A0A0E + 描边白 14–16%；旧值 #191a21 底"发灰" */
  border: 1px solid #2c2c30;
  background: #0a0a0e;
  color: var(--text-2);
  font-size: 13px;
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
  height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  white-space: nowrap;
  flex-shrink: 0;
  /* GL5/GL19：竞品是**低饱和香槟金** #E1CEA6 的文字 + 深金底 + 金描边；
     旧值 #f5c451 是高饱和柠檬金，气质差一档。 */
  background: #1d1a12;
  border: 1px solid #e1cea633;
  color: var(--gold-text);
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
  background: #e1cea640;
}
.recharge span {
  font-size: 12px;
  color: #e1cea6cc;
}
.recharge:hover {
  background: #241f14;
}
.credits {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  flex-shrink: 0;
  height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  background: #0a0a0e;
  border: 1px solid #2c2c30;
  color: var(--text-1);
  font-size: 14px;
}
.credits .spark {
  width: 15px;
  height: 15px;
  color: var(--brand-500); /* GL5/T7：竞品积分星形图标是品牌紫 #9B46FF */
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
  width: 32px;
  height: 32px; /* GL4：竞品头像 32×32（task.png x1540–1571 / y16–47） */
  border-radius: var(--radius-full);
  border: none;
  background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.menu {
  position: absolute;
  right: 0;
  top: 40px;
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
  height: 40px; /* GL4：未登录「立即登录」胶囊 40 高（旧值 36） */
  padding: 0 20px;
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  transition: filter var(--duration-fast) var(--ease-out);
}
.login-btn:hover {
  background: var(--brand-hover);
}

.content {
  flex: 1;
  min-width: 0;
  /* GL1：无面板页的内容底 = 页面色（只有 /tasks 单独加面板，见 pages/tasks.vue） */
  background: var(--bg-content);
}

/* GL4 的配套：控件统一 40 高后整排比原来宽约 10px，因此把"隐藏顶部说明胶囊"的断点
   从 900 提到 1100（与 layouts/tool.vue 一致），否则 1000px 视口会出现横向滚动。 */
@media (max-width: 1100px) {
  .mini-pill {
    display: none;
  }
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
