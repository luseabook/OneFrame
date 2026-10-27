<script setup lang="ts">
import type { HomeAbDto, HomeConfigDto, HomeUnreadDto, ProjectDto } from "~/types/api";
// 工作台首页：1:1 对齐竞品 ReelMate App 首页（home.png）
// 结构：居中大标题 → 双工作流入口卡 → 工具矩阵 → 活动轮播 → 案例墙
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t, locale } = useI18n();
useHead({ title: () => t("home.metaTitle") });

/**
 * 工具矩阵：**文案走 i18n**，行为（to/enabled/modal/icon）留在代码里。
 *
 * 用 `computed` 而不是常量：常量在 setup 期只算一次，切语言后卡片标题不会变
 * （这是本批最容易漏的一处——页面数据数组里混着文案与行为）。
 */
const tools = computed(() => [
  { label: t("home.tools.script.label"), desc: t("home.tools.script.desc"), to: "/projects", icon: "script", enabled: true, modal: true },
  { label: t("home.tools.plaza.label"), desc: t("home.tools.plaza.desc"), to: null, icon: "plaza", enabled: false, modal: false, tag: t("home.tools.plaza.tag"), tagKind: "soon" },
  { label: t("home.tools.spark.label"), desc: t("home.tools.spark.desc"), to: null, icon: "spark", enabled: false, modal: false, tag: t("home.tools.spark.tag"), tagKind: "member" },
  { label: t("home.tools.lips.label"), desc: t("home.tools.lips.desc"), to: null, icon: "lips", enabled: false, modal: false, tag: t("home.tools.lips.tag"), tagKind: "soon" },
  { label: t("home.tools.t2v.label"), desc: t("home.tools.t2v.desc"), to: null, icon: "t2v", enabled: false, modal: false },
  { label: t("home.tools.i2v.label"), desc: t("home.tools.i2v.desc"), to: null, icon: "i2v", enabled: false, modal: false },
  { label: t("home.tools.hd.label"), desc: t("home.tools.hd.desc"), to: null, icon: "hd", enabled: false, modal: false },
]);

// 新建项目弹窗（参照产品：短剧工作流 / 剧本创作 → 新建项目）
const showCreate = ref(false);
const router = useRouter();
const toast = useToast();
function openCreate(): void {
  showCreate.value = true;
}
function comingSoon(name: string): void {
  toast.info(t("home.comingSoon", { name }));
}
function onProjectCreated(project: { id: string }): void {
  showCreate.value = false;
  void router.push(`/projects/${project.id}`);
}

function onToolClick(tool: { enabled: boolean; modal: boolean; to: string | null }): void {
  if (!tool.enabled) return;
  if (tool.modal) openCreate();
  else if (tool.to) void router.push(tool.to);
}

// 轮播：颜色是设计值（留在代码里），文案走 i18n
const banners = computed(() => [
  { title: t("home.banners.pipelines.title"), sub: t("home.banners.pipelines.sub"), from: "#3b2f6e", via: "#1f1f2e" },
  { title: t("home.banners.consistency.title"), sub: t("home.banners.consistency.sub"), from: "#5a3a1e", via: "#241a12" },
  { title: t("home.banners.pricing.title"), sub: t("home.banners.pricing.sub"), from: "#1e4a3a", via: "#12241c" },
]);
const bannerIndex = ref(0);
let bannerTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  bannerTimer = setInterval(() => {
    bannerIndex.value = (bannerIndex.value + 1) % banners.value.length;
  }, 5000);
});
onUnmounted(() => {
  if (bannerTimer) clearInterval(bannerTimer);
});

// 最近项目（替代参照产品的「爆款案例」静态位；展示真实数据）
const api = useApi();
const recentProjects = ref<ProjectDto[]>([]);
const recentLoading = ref(true);
const DRAMA_KEYS: Record<number, string> = { 1: "domestic", 2: "overseas", 3: "anime" };
const dramaLabel = (type: number): string =>
  DRAMA_KEYS[type] ? t(`home.dramaType.${DRAMA_KEYS[type]}`) : t("home.dramaFallback");
const DRAMA_GRADIENT: Record<number, string> = {
  1: "linear-gradient(150deg, #3a2030, #12101c)",
  2: "linear-gradient(150deg, #14303e, #0e161c)",
  3: "linear-gradient(150deg, #2f1a44, #15101f)",
};
async function loadRecent(): Promise<void> {
  try {
    const data = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=4");
    recentProjects.value = data.list.slice(0, 4);
  } catch {
    recentProjects.value = [];
  } finally {
    recentLoading.value = false;
  }
}
onMounted(() => {
  void loadRecent();
});

// 新手引导（PRD 增补 §3.2）：服务端记录是否已关闭，避免反复打扰
const auth = useAuth();
const showOnboarding = computed(() => auth.state.value.onboarded === false);
async function dismissOnboarding(): Promise<void> {
  await auth.dismissOnboarding();
}

// ── 首页配置驱动 / 未读长轮询 / AB 位（模块 #1 收尾）────────────────────
//
// 三件事都由服务端说了算（`GET /home/config`、`/home/unread`、`/home/ab`）：
// 1. 板块**显隐与顺序**来自 config；拿不到配置就用内置默认（首页不能白屏）。
// 2. 未读走**长轮询**：服务端最多挂 25s，有增量立即返回；返回即续挂。
//    不用 WebSocket 的理由见 apps/api/src/modules/home/home.service.ts 的方法注释
//    （红点只要一个比特，长轮询可随客户端断开即时释放，且不引入第二套推送语义）。
// 3. AB 位按 config 声明的 `ab_slots[].experiment` 取变体；一人一变体由服务端保证。
const DEFAULT_SECTION_ORDER: Record<string, number> = {
  hero: 10,
  workflow: 20,
  canvas: 30,
  tools: 40,
  banner: 50,
  recent: 60,
};
const homeConfig = ref<HomeConfigDto | null>(null);
const configLoaded = ref(false);
const unreadCount = ref(0);
const abVariant = ref<string | null>(null);
let unreadTimer: ReturnType<typeof setTimeout> | undefined;
let unreadDisposed = false;

const sectionMap = computed(() => {
  const map = new Map<string, { visible: boolean; sort: number }>();
  for (const section of homeConfig.value?.sections ?? []) {
    map.set(section.key, { visible: section.visible, sort: section.sort });
  }
  return map;
});

/** 未配置时默认可见（配置是"覆盖"，不是"白名单"） */
function sectionVisible(key: string): boolean {
  const section = sectionMap.value.get(key);
  return section ? section.visible : true;
}

function sectionOrder(key: string): number {
  return sectionMap.value.get(key)?.sort ?? DEFAULT_SECTION_ORDER[key] ?? 999;
}

/** 只有在拿到真实运营配置时才启用 flex 排序，避免默认布局行为被改变 */
function sectionStyle(key: string): Record<string, number> {
  return { order: sectionOrder(key) };
}

async function loadHomeConfig(): Promise<void> {
  try {
    homeConfig.value = await api.get<HomeConfigDto>("/home/config");
  } catch {
    // 配置不可用不是致命错误：退回内置默认，保证首页可用
    homeConfig.value = null;
  } finally {
    configLoaded.value = homeConfig.value !== null && homeConfig.value.sections.length > 0;
  }
}

async function loadAbAssignment(): Promise<void> {
  const slot = homeConfig.value?.ab_slots?.[0];
  if (!slot) return;
  try {
    const result = await api.get<HomeAbDto>(`/home/ab?key=${encodeURIComponent(slot.experiment)}`);
    abVariant.value = result.active ? result.variant : null;
  } catch {
    abVariant.value = null;
  }
}

/** AB 位只换文案：变体由服务端分配，前端不猜 */
const abCtaLabel = computed(() =>
  abVariant.value === "variant_b" ? t("home.abCtaVariantB") : t("home.abCta"),
);

async function pollUnread(since?: string): Promise<void> {
  if (unreadDisposed) return;
  try {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const data = await api.get<HomeUnreadDto>(`/home/unread${query}`);
    if (data.items.length > 0) unreadCount.value += data.items.length;
    scheduleUnread(data.cursor);
  } catch {
    // 失败退避 5s：断网时不打忙轮询
    scheduleUnread(since, 5000);
  }
}

function scheduleUnread(cursor?: string, delayMs = 0): void {
  if (unreadDisposed) return;
  if (unreadTimer) clearTimeout(unreadTimer);
  unreadTimer = setTimeout(() => void pollUnread(cursor), delayMs);
}

function openUnread(): void {
  unreadCount.value = 0;
  void router.push("/tasks");
}

onMounted(async () => {
  await loadHomeConfig();
  await loadAbAssignment();
  scheduleUnread();
});

onUnmounted(() => {
  unreadDisposed = true;
  if (unreadTimer) clearTimeout(unreadTimer);
});
</script>

<template>
  <main class="page" :class="{ 'config-flex': configLoaded }">
    <!-- 新手引导条：仅未关闭时展示（PRD 增补 §3.2）；ClientOnly 避免 SSR/客户端分支不一致 -->
    <ClientOnly>
      <OnboardingBar v-if="showOnboarding" @dismiss="dismissOnboarding" />
    </ClientOnly>

    <h1 v-if="sectionVisible('hero')" class="hero-title" :style="sectionStyle('hero')">
      {{ t("home.heroTitle") }}
      <button v-if="unreadCount > 0" type="button" class="unread-badge" @click="openUnread">
        {{ t("home.unread", { count: unreadCount }) }}
      </button>
    </h1>

    <p v-if="abVariant" class="ab-cta" :data-variant="abVariant">
      <button type="button" class="ab-btn" @click="openCreate">{{ abCtaLabel }}</button>
    </p>

    <section
      v-if="sectionVisible('workflow') || sectionVisible('canvas')"
      class="hero-cards"
      :class="{ single: !(sectionVisible('workflow') && sectionVisible('canvas')) }"
      :style="sectionStyle(sectionVisible('workflow') ? 'workflow' : 'canvas')"
    >
      <button v-if="sectionVisible('workflow')" type="button" class="flow-card" @click="openCreate">
        <div class="flow-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="m14.5 4.5 5 5L8 21H3v-5Z" />
            <path d="M17 2.5 21.5 7M12.5 4l3.5-1.5L19 6l-1.5 3.5" />
          </svg>
        </div>
        <div class="flow-text">
          <h2>{{ t("home.workflowTitle") }}</h2>
          <p>{{ t("home.workflowDesc") }}</p>
        </div>
        <span class="plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </span>
      </button>
      <button v-if="sectionVisible('canvas')" type="button" class="canvas-card" @click="comingSoon(t('home.canvasTitle'))">
        <div class="flow-icon flat" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 4v16M16 4v16M4 8h16M4 16h16" />
            <path d="m15.5 12.5 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
          </svg>
        </div>
        <div class="flow-text">
          <h2>{{ t("home.canvasTitle") }}</h2>
          <p>{{ t("home.canvasDesc") }}</p>
        </div>
        <span class="plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </span>
      </button>
    </section>

    <section v-if="sectionVisible('tools')" class="tool-row" :style="sectionStyle('tools')">
      <div v-for="tool in tools" :key="tool.label" class="tool-cell">
        <button
          type="button"
          class="tool-card"
          :class="{ disabled: !tool.enabled }"
          @click="onToolClick(tool)"
        >
          <span v-if="tool.tag" class="corner-tag" :data-kind="tool.tagKind">{{ tool.tag }}</span>
          <span class="tool-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="tool.icon === 'script'">
                <path d="M6 3.5h10.5A1.5 1.5 0 0 1 18 5v15.5H7.5A1.5 1.5 0 0 1 6 19Z" />
                <path d="M9 7.5h6M9 11h6M9 14.5h3.5" />
              </template>
              <template v-else-if="tool.icon === 't2v'">
                <rect x="3" y="5" width="13" height="14" rx="2.5" />
                <path d="m9.5 9 4 3-4 3ZM19 8.5v7M21.5 10v4" />
              </template>
              <template v-else-if="tool.icon === 'i2v'">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="m5 17 4.5-4 3 2.5L16 12l3 5" />
              </template>
              <template v-else-if="tool.icon === 'plaza'">
                <path d="M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v9a1.5 1.5 0 0 1-1.5 1.5h-4l3 3M7 19.5l3-3h-4" />
                <path d="M8 8h8M8 11h5" />
              </template>
              <template v-else-if="tool.icon === 'lips'">
                <path d="M4 12c2.5-1 3.5-3.5 8-3.5S17.5 11 20 12c-2.5 3-5 4.5-8 4.5S6.5 15 4 12Z" />
                <path d="M4 12h16" />
              </template>
              <template v-else-if="tool.icon === 'spark'">
                <path d="M12 3.5c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6Z" />
                <path d="M18.5 15.5c.3 1.9 1 2.6 3 3-2 .4-2.7 1.1-3 3-.3-1.9-1-2.6-3-3 2-.4 2.7-1.1 3-3Z" />
              </template>
              <template v-else>
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="M3 12h18M8 5v14M16 5v14" />
              </template>
            </svg>
          </span>
        </button>
        <p class="tool-label" :class="{ dim: !tool.enabled }">{{ tool.label }}</p>
      </div>
    </section>

    <section v-if="sectionVisible('banner')" class="carousel" :style="sectionStyle('banner')">
      <button class="arrow" :aria-label="t('home.prevBanner')" @click="bannerIndex = (bannerIndex + banners.length - 1) % banners.length">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 6-6 6 6 6" /></svg>
      </button>
      <div class="banner-clip">
        <div
          v-for="(b, i) in banners"
          :key="b.title"
          class="banner"
          :class="{ on: i === bannerIndex }"
          :style="{ background: `linear-gradient(120deg, ${b.from}, ${b.via} 70%)` }"
        >
          <div class="banner-text">
            <h3>{{ b.title }}</h3>
            <p>{{ b.sub }}</p>
          </div>
          <div class="banner-deco" aria-hidden="true" />
        </div>
      </div>
      <button class="arrow" :aria-label="t('home.nextBanner')" @click="bannerIndex = (bannerIndex + 1) % banners.length">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 6 6 6-6 6" /></svg>
      </button>
    </section>
    <div class="dots">
      <button
        v-for="(b, i) in banners"
        :key="i"
        class="dot"
        :class="{ on: i === bannerIndex }"
        :aria-label="t('home.bannerIndex', { index: i + 1 })"
        @click="bannerIndex = i"
      />
    </div>

    <section v-if="sectionVisible('recent')" class="cases" :style="sectionStyle('recent')">
      <div class="cases-head">
        <h3>{{ t("home.recentTitle") }}</h3>
        <NuxtLink to="/projects" class="more">{{ t("home.viewAll") }}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
        </NuxtLink>
      </div>

      <div v-if="recentLoading" class="recent-skeleton">{{ t("home.loading") }}</div>

      <div v-else-if="recentProjects.length" class="case-grid">
        <NuxtLink
          v-for="p in recentProjects"
          :key="p.id"
          :to="`/projects/${p.id}`"
          class="case-card recent-card"
          :style="{ background: DRAMA_GRADIENT[p.drama_type] ?? DRAMA_GRADIENT[1] }"
        >
          <span class="case-tag">{{ dramaLabel(p.drama_type) }}</span>
          <div class="recent-info">
            <p class="case-title">{{ p.title }}</p>
            <p class="case-meta">{{ p.ratio }} · {{ new Date(p.created_at).toLocaleDateString(locale) }}</p>
          </div>
        </NuxtLink>
      </div>

      <div v-else class="recent-empty">
        <p>{{ t("home.emptyRecent") }}</p>
        <button type="button" class="recent-create" @click="openCreate">{{ t("home.createProject") }}</button>
      </div>
    </section>
  </main>

  <CreateProjectModal v-model:open="showCreate" @created="onProjectCreated" />
</template>

<style scoped>
.page {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 72px 80px;
}
/* 参照产品：左上紫色光晕 + 底部渐隐 */
.page::before {
  content: "";
  position: absolute;
  top: -120px;
  left: -80px;
  width: 520px;
  height: 420px;
  background: radial-gradient(50% 50% at 50% 50%, #7769ff2e, transparent 70%);
  pointer-events: none;
  z-index: 0;
}
.page > * {
  position: relative;
  z-index: 1;
}
.hero-title {
  margin: 24px 0 36px;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* 只有在拿到运营配置时才启用 flex 排序（order 仅对 flex/grid 子项生效）；
   默认不启用，保证"没有配置"时布局与以前完全一致。 */
.page.config-flex {
  display: flex;
  flex-direction: column;
}

/* 未读红点：长轮询增量计数，点击清零并去任务中心 */
.unread-badge {
  margin-left: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #7769ff55;
  background: #7769ff1f;
  color: #cfc8ff;
  font-size: 12px;
  font-weight: 500;
  vertical-align: middle;
  cursor: pointer;
}
.unread-badge:hover {
  background: #7769ff33;
}

/* AB 位：只换文案，变体名放在 data-variant 上便于核对（不向用户展示内部实验名） */
.ab-cta {
  margin: -20px 0 28px;
  text-align: center;
}
.ab-btn {
  padding: 10px 22px;
  border-radius: 999px;
  border: 1px solid #7769ff66;
  background: linear-gradient(120deg, #5d4ff0, #8a7dff);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.ab-btn:hover {
  filter: brightness(1.08);
}
.hero-cards.single {
  grid-template-columns: minmax(0, 640px);
}

/* ── 双工作流入口卡 ── */
.hero-cards {
  display: grid;
  grid-template-columns: minmax(0, 640px) minmax(0, 480px);
  justify-content: center;
  gap: 24px;
}
.flow-card,
.canvas-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 160px;
  padding: 40px 48px;
  border-radius: 32px;
  overflow: hidden;
}
.flow-card {
  background:
    radial-gradient(120% 160% at 8% 110%, #7e70ff2e 0%, transparent 46%),
    linear-gradient(#191922, #16161c) padding-box,
    linear-gradient(135deg, #9185ff59, #ffffff0f 42%, #ffffff14 70%) border-box;
  border: 1px solid transparent;
}
.flow-card::before {
  content: "";
  position: absolute;
  right: 90px;
  top: 18px;
  bottom: 18px;
  width: 42%;
  background-image: radial-gradient(#ffffff1a 1px, transparent 1px);
  background-size: 14px 14px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 30%);
  mask-image: linear-gradient(90deg, transparent, #000 30%);
  pointer-events: none;
}
.canvas-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
}
.flow-card:hover,
.canvas-card:hover {
  border-color: var(--border-3);
}
.flow-icon {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  background: #ffffff0d;
  border: 1px solid var(--border-1);
  color: var(--text-1);
}
.flow-icon svg {
  width: 26px;
  height: 26px;
}
.flow-text h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
}
.flow-text p {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.plus {
  margin-left: auto;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-3);
  background: var(--bg-hover);
  color: var(--text-1);
  transition: transform var(--duration-fast) var(--ease-out);
}
.plus svg {
  width: 16px;
  height: 16px;
}
.flow-card:hover .plus,
.canvas-card:hover .plus {
  transform: rotate(90deg);
}

/* ── 工具矩阵 ── */
.tool-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 32px;
  margin-top: 40px;
}
.tool-card {
  position: relative;
  display: grid;
  place-items: center;
  height: 96px;
  border-radius: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  color: var(--text-1);
  transition:
    background var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
.tool-card:hover {
  background: var(--bg-raised);
  transform: translateY(-2px);
}
.tool-card.disabled {
  cursor: default;
  opacity: 0.75;
}
.tool-card.disabled:hover {
  transform: none;
  background: var(--bg-surface);
}
.tool-icon svg {
  width: 28px;
  height: 28px;
}
.corner-tag {
  position: absolute;
  top: -8px;
  right: -6px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 10px;
  line-height: 1.6;
  white-space: nowrap;
}
.corner-tag[data-kind="soon"] {
  background: #d3f36b;
  color: #1c2405;
  font-weight: 600;
}
.corner-tag[data-kind="member"] {
  background: linear-gradient(90deg, #ff7a45, #ff4d6a);
  color: #fff;
  font-weight: 600;
}
.tool-label {
  margin: 12px 0 0;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
}
.tool-label.dim {
  color: var(--text-3);
  font-weight: 400;
}

/* ── 活动轮播 ── */
.carousel {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 56px;
}
.arrow {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.arrow svg {
  width: 16px;
  height: 16px;
}
.arrow:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.banner-clip {
  position: relative;
  flex: 1;
  height: 190px;
  border-radius: var(--radius-2xl);
  overflow: hidden;
}
.banner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 56px;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-in-out);
}
.banner.on {
  opacity: 1;
}
.banner-text h3 {
  margin: 0 0 10px;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.banner-text p {
  margin: 0;
  color: #ffffffb8;
  font-size: 14px;
}
.banner-deco {
  position: absolute;
  right: 48px;
  top: 24px;
  bottom: 24px;
  width: 260px;
  background-image: radial-gradient(#ffffff26 1px, transparent 1px);
  background-size: 16px 16px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 40%);
  mask-image: linear-gradient(90deg, transparent, #000 40%);
}
.dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.dot {
  width: 16px;
  height: 4px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--dark-elevated);
  cursor: pointer;
  padding: 0;
}
.dot.on {
  background: var(--text-1);
}

/* ── 案例墙 ── */
.cases {
  margin-top: 56px;
}
.cases-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.cases-head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
.more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-3);
  font-size: 13px;
}
.more svg {
  width: 14px;
  height: 14px;
}
.more:hover {
  color: var(--text-1);
}
.case-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 322px);
  gap: 13px;
}
.case-card {
  position: relative;
  height: 170px;
  border-radius: 16px;
  border: 1px solid var(--border-1);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 16px;
  transition: transform var(--duration-fast) var(--ease-out);
}
.case-card:hover {
  transform: translateY(-2px);
}
.case-tag {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 9px;
  border-radius: var(--radius-full);
  background: #000000a6;
  color: #fff;
  font-size: 11px;
}
.case-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #ffffffd9;
}
.recent-card {
  text-decoration: none;
  color: inherit;
}
.recent-info {
  min-width: 0;
}
.case-meta {
  margin: 4px 0 0;
  color: #ffffff8f;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.recent-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 170px;
  border-radius: var(--radius-xl);
  border: 1px dashed var(--border-2);
  color: var(--text-4);
  font-size: 13px;
}
.recent-empty p {
  margin: 0;
}
.recent-create {
  height: 36px;
  padding: 0 18px;
  border-radius: 999px;
  border: 0;
  background: linear-gradient(90deg, #7e70ff, #a45fff);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.recent-skeleton {
  height: 170px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-1);
  color: var(--text-4);
  font-size: 13px;
}

@media (max-width: 1080px) {
  .hero-cards {
    grid-template-columns: 1fr;
  }
  .tool-row {
    grid-template-columns: repeat(4, 1fr);
    row-gap: 24px;
  }
  .case-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .tool-row {
    grid-template-columns: repeat(3, 1fr);
  }
  .case-grid {
    grid-template-columns: 1fr;
  }
}

/* 卡片作为可点击元素（button）时的样式复位 */
button.flow-card,
button.canvas-card,
button.tool-card {
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
</style>
