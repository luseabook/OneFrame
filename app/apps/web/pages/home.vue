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
type HomeTool = {
  /** 稳定标识：模板 key / e2e 选择器 / 埋点都用它，不用会随语言变化的 label */
  key: string;
  label: string;
  desc: string;
  to: string | null;
  icon: string;
  enabled: boolean;
  modal: boolean;
  tag?: string;
  tagKind?: "soon" | "member";
  /** 连角标都没有的禁用卡：可见原因（不能只靠 hover title） */
  note?: string;
};
const tools = computed<HomeTool[]>(() => [
  { key: "script", label: t("home.tools.script.label"), desc: t("home.tools.script.desc"), to: "/projects", icon: "script", enabled: true, modal: true },
  { key: "plaza", label: t("home.tools.plaza.label"), desc: t("home.tools.plaza.desc"), to: null, icon: "plaza", enabled: false, modal: false, tag: t("home.tools.plaza.tag"), tagKind: "soon" },
  // U6：视频转绘的产品页已经落地（/video-redraw/create），旧值 to:null + 禁用 = 假死入口
  { key: "spark", label: t("home.tools.spark.label"), desc: t("home.tools.spark.desc"), to: "/video-redraw/create", icon: "spark", enabled: true, modal: false, tag: t("home.tools.spark.tag"), tagKind: "member" },
  { key: "lips", label: t("home.tools.lips.label"), desc: t("home.tools.lips.desc"), to: null, icon: "lips", enabled: false, modal: false, tag: t("home.tools.lips.tag"), tagKind: "soon" },
  { key: "t2v", label: t("home.tools.t2v.label"), desc: t("home.tools.t2v.desc"), to: null, icon: "t2v", enabled: false, modal: false, note: t("home.toolPendingNote") },
  { key: "i2v", label: t("home.tools.i2v.label"), desc: t("home.tools.i2v.desc"), to: null, icon: "i2v", enabled: false, modal: false, note: t("home.toolPendingNote") },
  { key: "hd", label: t("home.tools.hd.label"), desc: t("home.tools.hd.desc"), to: null, icon: "hd", enabled: false, modal: false, note: t("home.toolPendingNote") },
]);

// 新建项目弹窗（参照产品：短剧工作流 / 剧本创作 → 新建项目）
const showCreate = ref(false);
const router = useRouter();
const toast = useToast();
function openCreate(): void {
  showCreate.value = true;
}
function onProjectCreated(project: { id: string }): void {
  showCreate.value = false;
  void router.push(`/projects/${project.id}`);
}

/**
 * 工具矩阵点击：
 * - 可用的：弹「新建项目」或跳产品页（视频转绘 → /video-redraw/create）；
 * - 禁用的：**不是死点击** —— 每次点击都给出可读原因（顶部居中 toast），
 *   不依赖 hover title（旧值 `if (!tool.enabled) return;` 就是零反馈）。
 */
function onToolClick(tool: HomeTool): void {
  if (tool.enabled) {
    if (tool.modal) openCreate();
    else if (tool.to) void router.push(tool.to);
    return;
  }
  toast.info(t("home.toolUnavailable", { name: tool.label }));
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
/** 最近项目三态（loading / error / empty）：错误态必须可见且可重试，不能静默退成空态 */
const recentError = ref("");
async function loadRecent(): Promise<void> {
  recentLoading.value = true;
  recentError.value = "";
  try {
    const data = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=4");
    recentProjects.value = data.list.slice(0, 4);
  } catch {
    recentProjects.value = [];
    // 面向用户的固定文案：服务端 msg 可能是内部口径（如 Internal server error）
    recentError.value = t("home.recentError");
  } finally {
    recentLoading.value = false;
  }
}

// ── 运营位：公告 / 定价广告（可关闭，关闭状态本地记忆）──────────────────
// 后端 /home/config 目前只回 sections 的 visible/sort，没有公告与定价广告的字段；
// 文案先落在语言包里（前端默认值），关闭状态存 localStorage。接后台配置时要补的字段
// 记在 U6 报告 §5「未接线」。
const ANNOUNCE_KEY = "of_home_announce_v1";
const AD_KEY = "of_home_pricing_ad_v1";
const announceOpen = ref(true);
const adOpen = ref(true);
function flagSet(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function persistFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* 隐私模式写不了：本会话内已隐藏，刷新后会再出现 */
  }
}
function dismissAnnounce(): void {
  announceOpen.value = false;
  persistFlag(ANNOUNCE_KEY);
}
function dismissPricingAd(): void {
  adOpen.value = false;
  persistFlag(AD_KEY);
}

// 新手引导（PRD 增补 §3.2）：服务端记录是否已关闭，避免反复打扰
const auth = useAuth();
const showOnboarding = computed(() => auth.state.value.onboarded === false);
async function dismissOnboarding(): Promise<void> {
  await auth.dismissOnboarding();
}

// 「继续创作」入口：最近项目的第一条（模板里不写非空断言，靠 computed 收口）
const latestProject = computed(() => recentProjects.value[0] ?? null);
const resumeTo = computed(() => (latestProject.value ? `/projects/${latestProject.value.id}` : ""));
const resumeTitle = computed(() => latestProject.value?.title ?? "");

// 3 步 coach-mark：首次访问自动出现；标题旁「重看引导」调 start()
const guide = ref<{ start: () => void } | null>(null);
function replayGuide(): void {
  guide.value?.start();
}

onMounted(() => {
  announceOpen.value = !flagSet(ANNOUNCE_KEY);
  adOpen.value = !flagSet(AD_KEY);
  void loadRecent();
});

// ── 首页配置驱动 / 未读长轮询 / AB 位（模块 #1 收尾）────────────────────
//
// 三件事都由服务端说了算（`GET /home/config`、`/home/unread`、`/home/ab`）：
// 1. 板块**显隐与顺序**来自 config；拿不到配置就用内置默认（首页不能白屏）。
// 2. 未读走**长轮询**：服务端最多挂 25s，有增量立即返回；返回即续挂。
//    不用 WebSocket 的理由见 apps/api/src/modules/home/home.service.ts 的方法注释
//    （红点只要一个比特，长轮询可随客户端断开即时释放，且不引入第二套推送语义）。
// 3. AB 位按 config 声明的 `ab_slots[].experiment` 取变体；一人一变体由服务端保证。
const DEFAULT_SECTION_ORDER: Record<string, number> = {
  // 运营位（U6 新增）：公告最顶，定价广告在轮播之后、案例墙之前
  announcement: 5,
  hero: 10,
  workflow: 20,
  canvas: 30,
  tools: 40,
  banner: 50,
  pricingAd: 55,
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

    <!-- 公告位（可关闭；后端 /home/config 暂无该字段，默认文案在语言包里） -->
    <section
      v-if="sectionVisible('announcement') && announceOpen"
      class="announce"
      :style="sectionStyle('announcement')"
      data-testid="home-announcement"
    >
      <span class="announce-ico" aria-hidden="true">✦</span>
      <p class="announce-text">
        <b>{{ t("home.announce.title") }}</b>
        <em>{{ t("home.announce.desc") }}</em>
      </p>
      <NuxtLink to="/projects" class="announce-cta">{{ t("home.announce.cta") }}</NuxtLink>
      <button type="button" class="announce-close" :aria-label="t('home.announce.close')" @click="dismissAnnounce">
        ✕
      </button>
    </section>

    <h1 v-if="sectionVisible('hero')" class="hero-title" :style="sectionStyle('hero')">
      {{ t("home.heroTitle") }}
      <button v-if="unreadCount > 0" type="button" class="unread-badge" @click="openUnread">
        {{ t("home.unread", { count: unreadCount }) }}
      </button>
      <!-- 可重看入口：首次访问的 coach-mark 被跳过/完成后，还能从这里重放 -->
      <button type="button" class="guide-replay" data-testid="guide-replay" @click="replayGuide">
        {{ t("guide.replay") }}
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
      data-guide-target="workflow"
      data-testid="home-hero-cards"
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
      <button
        v-if="sectionVisible('canvas')"
        type="button"
        class="canvas-card"
        data-testid="home-canvas-card"
        @click="router.push('/canvas')"
      >
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

    <section v-if="sectionVisible('tools')" class="tool-row" :style="sectionStyle('tools')" data-guide-target="tools">
      <div v-for="tool in tools" :key="tool.key" class="tool-cell">
        <button
          type="button"
          class="tool-card"
          :class="{ disabled: !tool.enabled }"
          :data-tool-key="tool.key"
          :data-unavailable="tool.enabled ? undefined : 'true'"
          :title="tool.enabled ? tool.label : t('home.toolUnavailable', { name: tool.label })"
          :aria-label="tool.enabled ? tool.label : t('home.toolUnavailable', { name: tool.label })"
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
        <!-- 可见的禁用原因：角标之外的三张卡不再"只有 hover title" -->
        <p v-if="tool.note" class="tool-note">{{ tool.note }}</p>
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

    <!-- 定价广告位（可关闭；同上，后台配置暂未接线） -->
    <section
      v-if="sectionVisible('pricingAd') && adOpen"
      class="price-ad"
      :style="sectionStyle('pricingAd')"
      data-testid="home-pricing-ad"
    >
      <div class="price-ad-text">
        <b>{{ t("home.pricingAd.title") }}</b>
        <p>{{ t("home.pricingAd.desc") }}</p>
      </div>
      <NuxtLink to="/pricing" class="price-ad-cta">{{ t("home.pricingAd.cta") }}</NuxtLink>
      <button type="button" class="price-ad-close" :aria-label="t('home.pricingAd.close')" @click="dismissPricingAd">
        ✕
      </button>
    </section>

    <section v-if="sectionVisible('recent')" class="cases" :style="sectionStyle('recent')" data-guide-target="recent">
      <div class="cases-head">
        <h3>{{ t("home.recentTitle") }}</h3>
        <div class="cases-actions">
          <!-- 继续创作：最近项目存在时，1 击回到上次的工作台（与「新建」同为首屏双入口） -->
          <NuxtLink v-if="latestProject" :to="resumeTo" class="resume" data-testid="home-resume">
            {{ t("home.resume", { title: resumeTitle }) }}
          </NuxtLink>
          <NuxtLink to="/projects" class="more">{{ t("home.viewAll") }}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </NuxtLink>
        </div>
      </div>

      <div v-if="recentLoading" class="recent-skeleton" role="status" :aria-label="t('home.loading')" data-testid="home-recent-loading">
        <div v-for="i in 4" :key="i" class="sk" />
      </div>

      <div v-else-if="recentError" class="recent-error" role="alert" data-testid="home-recent-error">
        <p>{{ recentError }}</p>
        <button type="button" class="recent-retry" @click="loadRecent">{{ t("common.retry") }}</button>
      </div>

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
  <!-- 3 步 coach-mark：首访自动出现，跳过/完成后可从「重看引导」重放 -->
  <GuideCoachmark ref="guide" />
</template>

<style scoped>
.page {
  position: relative;
  /* HM1：竞品首页内容带宽 1328（loggedin.png x280–1607，视口 1664 / 侧栏 240 / 左右内距 48）→
     内距 48 与 max-width 1480 是它的等比落地。旧值 max-width:1200 + padding 72 只得到 1056，
     比竞品窄 272px，导致案例墙掉到 3 列。 */
  max-width: 1480px;
  margin: 0 auto;
  padding: 40px 48px 80px;
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
/* 公告位：一条 40 高的深色条，可关闭（关闭状态存 localStorage） */
.announce {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
  padding: 8px 10px 8px 14px;
  border-radius: 12px;
  border: 1px solid #ffffff14;
  background: #191a22;
  font-size: 12px;
  color: var(--text-2);
}
.announce-ico {
  color: var(--brand-400);
  font-size: 13px;
}
.announce-text {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 10px;
  margin: 0;
  align-items: baseline;
}
.announce-text b {
  color: var(--text-1);
  font-weight: 600;
  white-space: nowrap;
}
.announce-text em {
  font-style: normal;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.announce-cta {
  color: var(--brand-400);
  white-space: nowrap;
}
.announce-close,
.price-ad-close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-4);
  font-size: 12px;
  cursor: pointer;
}
.announce-close:hover,
.price-ad-close:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
/* 重看引导：h1 内的小胶囊，沿用 unread-badge 的"标题内联"处理，不额外占一行 */
.guide-replay {
  margin-left: 10px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  font-weight: 400;
  vertical-align: middle;
  cursor: pointer;
}
.guide-replay:hover {
  border-color: var(--border-3);
  color: var(--text-1);
}
.hero-title {
  margin: 24px 0 36px;
  text-align: center;
  /* GL16：有 h1 的页面统一 26px/700（竞品墨迹高 21px ≈ 26px/700，loggedin.png y94–114） */
  font-size: 26px;
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
  /* HM2：竞品所有实心 CTA 都是单一 #9B46FF（--brand-01normal，pricing-full.png 实测 64.4% 面积），
     旧值 linear-gradient(120deg,#5d4ff0,#8a7dff) 是体系外的第二支紫渐变。 */
  border: 1px solid transparent;
  background: var(--brand-500);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.ab-btn:hover {
  background: var(--brand-hover);
}
.hero-cards.single {
  grid-template-columns: minmax(0, 640px);
}

/* ── 双工作流入口卡 ── */
.hero-cards {
  display: grid;
  grid-template-columns: minmax(0, 640px) minmax(0, 480px);
  justify-content: center;
  /* HM1：竞品双卡间距 12（loggedin.png 卡1 640 + 隙 12 + 卡2 480 = 1132 居中） */
  gap: 12px;
}
.flow-card,
.canvas-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 160px;
  padding: 40px 48px;
  /* HM3：竞品圆角阶梯上限 24，常用 12/16；旧值 32px 超出体系，显"圆过头" */
  border-radius: 16px;
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
/* 禁用原因（可见）：只给没有角标的禁用卡，11px 灰字，不抢标签层级 */
.tool-note {
  margin: 4px 0 0;
  text-align: center;
  color: var(--text-4);
  font-size: 11px;
  line-height: 1.4;
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

/* 定价广告位：一条横向促销卡（可关闭），比轮播轻、比文字链重 */
.price-ad {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
  padding: 14px 14px 14px 18px;
  border-radius: 16px;
  border: 1px solid #ffffff14;
  background:
    radial-gradient(120% 200% at 0% 50%, #7e70ff26, transparent 62%),
    #16161c;
}
.price-ad-text {
  flex: 1;
  min-width: 0;
}
.price-ad-text b {
  display: block;
  font-size: 15px;
  color: var(--text-1);
}
.price-ad-text p {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: 12px;
}
.price-ad-cta {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.price-ad-cta:hover {
  background: var(--brand-hover);
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
  /* HM1：竞品案例墙 4 列（loggedin.png 卡 x280–602 / 615–937 / 950–1272 / 1285–1607，列距 12–13）。
     旧值 auto-fill 322px 在 1056 容器里只放得下 3 列 → 密度差 33%。
     改成显式 4 等分而不是固定 322px：1600 视口下内宽是 1264，固定 322 仍只放 3 列；
     竞品自己也是"4 等分"，故按列数对齐、宽度自适应。 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
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
  /* HM2：同 .ab-btn —— 竞品实心 CTA 只有一支 #9B46FF */
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.recent-create:hover {
  background: var(--brand-hover);
}
/* 三态之一：加载态用 4 块骨架而不是一行"加载中…"（同尺寸占位，加载完不跳动） */
.recent-skeleton {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.sk {
  height: 170px;
  border-radius: 16px;
  background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-raised) 37%, var(--bg-surface) 63%);
  background-size: 400% 100%;
  animation: home-shimmer 1.4s ease infinite;
}
@keyframes home-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
/* 三态之二：错误态可读 + 可重试（旧值 catch 里静默退成空态，用户看到"还没有项目"） */
.recent-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 170px;
  border-radius: var(--radius-xl);
  border: 1px dashed #6b2b2b;
  color: var(--text-3);
  font-size: 13px;
}
.recent-error p {
  margin: 0;
}
.recent-retry {
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
}
.recent-retry:hover {
  background: var(--bg-hover);
}
.cases-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
/* 继续创作：首屏除了「新建」以外的第二个入口，1 击回到上次工作台 */
.resume {
  display: inline-flex;
  align-items: center;
  height: 28px;
  max-width: 320px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #7769ff55;
  background: #7769ff1f;
  color: #cfc8ff;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.resume:hover {
  background: #7769ff33;
}

@media (max-width: 1080px) {
  .hero-cards {
    grid-template-columns: 1fr;
  }
  .recent-skeleton {
    grid-template-columns: repeat(2, 1fr);
  }
  .announce-text em {
    display: none;
  }
  .price-ad {
    flex-wrap: wrap;
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
