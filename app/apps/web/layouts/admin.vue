<script setup lang="ts">
// 运营后台专用壳层：独立登录态 / 分组菜单 / 独立页脚。
// 与用户端（layouts/app.vue）完全分离：不展示用户菜单、积分充值、用户协议/隐私/举报。
import type { AdminMenuEntry } from "~/composables/useAdminMenu";

const menu = useAdminMenu();
const tab = useAdminTab();
const route = useRoute();
const router = useRouter();

const menuQuery = ref("");
const searchRef = ref<HTMLInputElement | null>(null);
const mobileNavOpen = ref(false);

const envLabel = computed(() => {
  if (!import.meta.client) return "内部系统";
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return "本地环境";
  return "生产环境";
});

const currentMenu = computed(() => menu.find((item) => item.key === tab.value) ?? menu[0]!);

/** 搜索时仍按分组输出，避免结果变成一条无法定位的长列表 */
const visibleGroups = computed(() => {
  const q = menuQuery.value.trim().toLowerCase();
  const groups: Array<{ name: string; items: AdminMenuEntry[] }> = [];
  for (const item of menu) {
    const haystack = `${item.label} ${item.hint} ${item.group}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    let group = groups.find((entry) => entry.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

function isActive(key: string): boolean {
  return route.path === "/admin" && tab.value === key;
}

watch(tab, () => {
  mobileNavOpen.value = false;
});

function logout(): void {
  localStorage.removeItem("admin_token");
  void router.push("/admin/login");
}

function focusSearch(): void {
  searchRef.value?.focus();
  searchRef.value?.select();
}

function onGlobalKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing =
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.tagName === "SELECT" ||
    target?.isContentEditable === true;

  if (event.key === "/" && !typing) {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (event.key === "Escape" && menuQuery.value) {
    menuQuery.value = "";
    searchRef.value?.blur();
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKey));
</script>

<template>
  <div id="admin-root" class="admin-shell" :class="{ 'nav-open': mobileNavOpen }">
    <aside class="admin-side">
      <div class="brand">
        <span class="logo-mark" aria-hidden="true">一</span>
        <span class="brand-block">
          <span class="brand-text">一帧</span>
          <span class="brand-sub">ONEFRAME CONSOLE</span>
        </span>
        <span class="console-badge">ADMIN</span>
      </div>

      <label class="side-search">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M16 16l4.2 4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input
          ref="searchRef"
          v-model="menuQuery"
          type="search"
          placeholder="搜索功能"
          aria-label="搜索后台功能"
        />
        <kbd v-if="!menuQuery">/</kbd>
        <button v-else class="search-clear" type="button" aria-label="清空搜索" @click="menuQuery = ''">×</button>
      </label>

      <nav class="admin-nav" aria-label="运营后台菜单">
        <div v-for="group in visibleGroups" :key="group.name" class="nav-group">
          <div class="nav-group-title">{{ group.name }}</div>
          <NuxtLink
            v-for="item in group.items"
            :key="item.key"
            :to="{ path: '/admin', query: item.key === 'dashboard' ? {} : { tab: item.key } }"
            class="nav-item"
            :class="{ active: isActive(item.key) }"
          >
            <span class="nav-indicator" aria-hidden="true"></span>
            <span class="nav-text">
              <span class="nav-label">{{ item.label }}</span>
              <span class="nav-hint">{{ item.hint }}</span>
            </span>
          </NuxtLink>
        </div>
        <p v-if="visibleGroups.length === 0" class="nav-empty">没有匹配的功能</p>
      </nav>

      <div class="side-foot">
        <div class="who">
          <span class="who-avatar" aria-hidden="true">管</span>
          <span class="who-text">
            <span class="who-name">管理员</span>
            <span class="who-hint">internal ops</span>
          </span>
        </div>
        <button class="logout-btn" type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <div class="admin-body">
      <header class="admin-topbar">
        <div class="title-wrap">
          <button
            class="nav-toggle"
            type="button"
            :aria-expanded="mobileNavOpen"
            aria-label="展开或收起后台菜单"
            @click="mobileNavOpen = !mobileNavOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            <span>菜单</span>
          </button>
          <span class="crumb">运营后台</span>
          <span class="crumb-sep">/</span>
          <span class="page-title">{{ currentMenu.label }}</span>
          <span class="page-hint">{{ currentMenu.hint }}</span>
        </div>
        <div class="right">
          <span class="env-chip"><i class="env-dot" aria-hidden="true"></i>{{ envLabel }}</span>
          <span class="hint">仅授权运营人员使用</span>
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
/* 结构尺寸放在这里；视觉统一由 assets/css/admin.css 负责（#admin-root 作用域）。 */
.admin-shell {
  min-height: 100vh;
  display: flex;
  background: var(--bg-app);
  color: var(--text-1);
}

.admin-side {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  width: 260px;
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 12px;
  box-sizing: border-box;
}

.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 2px 8px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-toggle {
  display: none;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--admin-line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--admin-text-2);
  font-size: 12px;
  cursor: pointer;
}

.nav-toggle svg {
  width: 15px;
  height: 15px;
}

.admin-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.right {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.admin-main {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 28px 32px 48px;
  box-sizing: border-box;
}

.admin-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 32px;
}

@media (max-width: 980px) {
  .admin-shell {
    flex-direction: column;
  }
  .admin-side {
    position: static;
    width: 100%;
    flex: none;
    height: auto;
    padding: 12px 14px;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .brand {
    flex: 1 1 auto;
    padding: 0;
    border-bottom: 0;
    order: 1;
  }
  .admin-nav {
    display: none;
    width: 100%;
    max-height: 58vh;
    overflow-y: auto;
    gap: 10px;
    padding-top: 6px;
    border-top: 1px solid var(--admin-line);
    order: 4;
  }
  .nav-open .admin-nav {
    display: flex;
  }
  .nav-group {
    flex-direction: column;
  }
  .side-search {
    width: 100%;
    order: 3;
  }
  .side-foot,
  .who {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .side-foot {
    order: 2;
  }
  .nav-toggle {
    display: inline-flex;
  }
  .crumb,
  .crumb-sep {
    display: none;
  }
  .admin-main {
    padding: 18px 16px 32px;
  }
  .hint,
  .page-hint {
    display: none;
  }
  .admin-footer {
    padding: 12px 16px;
  }
}
</style>
