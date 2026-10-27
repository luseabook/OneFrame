<script setup lang="ts">
// 落地页：对齐竞品 ReelMate 首页信息架构（导航 → Hero → 双工作流入口 → 能力矩阵 → 流水线展示 → 页脚）
definePageMeta({ layout: false });

// i18n（第 8 批）：本页是全站唯一 SSR 的营销页，文案全量走语言包；
// 首帧语言由 `plugins/i18n.ts` 在服务端按 `?lang=` → cookie → Accept-Language 解析，
// 与客户端同一套优先级，因此不会出现"先中文后英文"的 hydration 抖动。
const { t } = useI18n();
useHead({ title: () => t("landing.metaTitle") });
// 描述也随语言：`app.vue` 的全局 description 是中文常量（公共文件，不在本批范围），
// 页面级覆盖优先级更高，保证外语首帧的 meta 也是对应语言。
useSeoMeta({ description: () => t("landing.metaDescription") });

const auth = useAuth();
const isLogged = computed(() => !!auth.state.value.user);

// 本页不走公共壳层（app.vue 对 "/" 不套 layout），登录态需自行 bootstrap
onMounted(() => {
  if (!auth.state.value.accessToken && !auth.state.value.user) void auth.bootstrap();
});

const flows = computed(() => [
  {
    title: t("landing.flowStudioTitle"),
    desc: t("landing.flowStudioDesc"),
    cta: t("landing.flowStudioCta"),
    to: "/projects",
    variant: "primary" as const,
  },
  {
    title: t("landing.flowToolsTitle"),
    desc: t("landing.flowToolsDesc"),
    cta: t("landing.flowToolsCta"),
    to: "/tools",
    variant: "ghost" as const,
  },
]);

const capabilities = computed(() => [
  { icon: "◈", title: t("landing.capScriptTitle"), desc: t("landing.capScriptDesc") },
  { icon: "☺", title: t("landing.capCharacterTitle"), desc: t("landing.capCharacterDesc") },
  { icon: "◉", title: t("landing.capPriceTitle"), desc: t("landing.capPriceDesc") },
  { icon: "▤", title: t("landing.capBatchTitle"), desc: t("landing.capBatchDesc") },
  { icon: "◫", title: t("landing.capAssetsTitle"), desc: t("landing.capAssetsDesc") },
  { icon: "✧", title: t("landing.capAiTitle"), desc: t("landing.capAiDesc") },
]);

const pipeline = computed(() => [
  { n: "01", title: t("landing.pipe1Title"), desc: t("landing.pipe1Desc") },
  { n: "02", title: t("landing.pipe2Title"), desc: t("landing.pipe2Desc") },
  { n: "03", title: t("landing.pipe3Title"), desc: t("landing.pipe3Desc") },
  { n: "04", title: t("landing.pipe4Title"), desc: t("landing.pipe4Desc") },
  { n: "05", title: t("landing.pipe5Title"), desc: t("landing.pipe5Desc") },
  { n: "06", title: t("landing.pipe6Title"), desc: t("landing.pipe6Desc") },
]);
</script>

<template>
  <div class="landing">
    <!-- 顶部导航 -->
    <header class="nav-bar">
      <div class="nav-inner">
        <NuxtLink to="/" class="brand">
          <span class="logo-mark">一</span>
          <span class="logo-text">{{ t("landing.brandName") }}</span>
        </NuxtLink>
        <nav class="links">
          <a href="#capabilities">{{ t("nav.capabilities") }}</a>
          <a href="#pipeline">{{ t("nav.process") }}</a>
          <NuxtLink to="/pricing">{{ t("nav.pricing") }}</NuxtLink>
        </nav>
        <div class="nav-right">
          <LangSwitcher />
          <NuxtLink v-if="isLogged" to="/home" class="cta-sm">{{ t("nav.enterWorkspace") }}</NuxtLink>
          <template v-else>
            <NuxtLink to="/login" class="ghost-sm">{{ t("nav.login") }}</NuxtLink>
            <NuxtLink to="/login?redirect=/projects" class="cta-sm">{{ t("nav.startFree") }}</NuxtLink>
          </template>
        </div>
      </div>
    </header>

    <!-- Hero -->
    <section class="hero">
      <div class="glow" aria-hidden="true" />
      <p class="eyebrow">{{ t("landing.heroEyebrow") }}</p>
      <h1>{{ t("landing.heroTitle") }}</h1>
      <p class="lead">
        {{ t("landing.heroLead1") }}<br />
        {{ t("landing.heroLead2") }}
      </p>
      <div class="hero-cta">
        <NuxtLink :to="isLogged ? '/projects' : '/login?redirect=/projects'" class="btn-lg primary">
          {{ t("landing.heroCtaStart") }}
        </NuxtLink>
        <a href="#pipeline" class="btn-lg ghost">{{ t("landing.heroCtaHow") }}</a>
      </div>
      <p class="hint-sm">{{ t("landing.heroHint") }}</p>
    </section>

    <!-- 双工作流入口（对齐竞品） -->
    <section class="flows">
      <NuxtLink v-for="f in flows" :key="f.title" :to="isLogged ? f.to : `/login?redirect=${f.to}`" class="flow-card">
        <div class="flow-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
            <path d="M7 5v14M17 5v14M2.5 9.5h4.5M2.5 14.5h4.5M17 9.5h4.5M17 14.5h4.5" />
          </svg>
        </div>
        <div class="flow-body">
          <h3>{{ f.title }}</h3>
          <p>{{ f.desc }}</p>
        </div>
        <span class="flow-cta">{{ f.cta }} →</span>
      </NuxtLink>
    </section>

    <!-- 能力矩阵 -->
    <section id="capabilities" class="section">
      <div class="sec-head">
        <h2>{{ t("landing.capSectionTitle") }}</h2>
        <p>{{ t("landing.capSectionDesc") }}</p>
      </div>
      <div class="cap-grid">
        <article v-for="c in capabilities" :key="c.title" class="cap">
          <span class="cap-icon" aria-hidden="true">{{ c.icon }}</span>
          <h3>{{ c.title }}</h3>
          <p>{{ c.desc }}</p>
        </article>
      </div>
    </section>

    <!-- 流水线六步 -->
    <section id="pipeline" class="section alt">
      <div class="sec-head">
        <h2>{{ t("landing.pipeSectionTitle") }}</h2>
        <p>{{ t("landing.pipeSectionDesc") }}</p>
      </div>
      <ol class="pipe">
        <li v-for="s in pipeline" :key="s.n">
          <span class="num">{{ s.n }}</span>
          <b>{{ s.title }}</b>
          <em>{{ s.desc }}</em>
        </li>
      </ol>
    </section>

    <!-- 底部 CTA -->
    <section class="final-cta">
      <h2>{{ t("landing.finalTitle") }}</h2>
      <p>{{ t("landing.finalDesc") }}</p>
      <NuxtLink :to="isLogged ? '/projects' : '/login?redirect=/projects'" class="btn-lg primary">
        {{ t("landing.finalCta") }}
      </NuxtLink>
    </section>

    <!-- 页脚 -->
    <footer class="foot">
      <div class="foot-inner">
        <div class="foot-brand">
          <span class="logo-mark sm">一</span>
          <span>{{ t("landing.footerBrand") }}</span>
        </div>
        <nav class="foot-links">
          <NuxtLink to="/terms">{{ t("nav.terms") }}</NuxtLink>
          <NuxtLink to="/privacy">{{ t("nav.privacy") }}</NuxtLink>
          <NuxtLink to="/report">{{ t("nav.report") }}</NuxtLink>
          <NuxtLink to="/pricing">{{ t("nav.pricing") }}</NuxtLink>
        </nav>
      </div>
      <p class="foot-note">
        {{ t("landing.footerNote") }}
      </p>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-2);
}

/* ── 导航 ── */
.nav-bar {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-1);
}
.nav-inner {
  max-width: 1120px;
  margin: 0 auto;
  height: 56px;
  padding: 0 var(--space-6);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
}
.logo-mark {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  background: var(--brand-500);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
}
.logo-mark.sm {
  width: 18px;
  height: 18px;
  font-size: 11px;
  border-radius: var(--radius-sm);
}
.logo-text {
  font-size: var(--text-base);
}
.links {
  display: flex;
  gap: var(--space-6);
  font-size: var(--text-sm);
  color: var(--text-2);
}
.links a:hover {
  color: var(--text-1);
}
.nav-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.cta-sm {
  height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
.cta-sm:hover {
  background: var(--brand-600);
}
.ghost-sm {
  color: var(--text-2);
  font-size: var(--text-sm);
}
.ghost-sm:hover {
  color: var(--text-1);
}

/* ── Hero ── */
.hero {
  position: relative;
  text-align: center;
  padding: 104px var(--space-6) 72px;
  overflow: hidden;
}
.glow {
  position: absolute;
  left: 50%;
  top: -120px;
  width: 900px;
  height: 480px;
  transform: translateX(-50%);
  background: radial-gradient(50% 55% at 50% 45%, #7e70ff3d 0%, #af5fff1a 40%, transparent 72%);
  pointer-events: none;
}
.eyebrow {
  position: relative;
  display: inline-block;
  margin: 0 0 var(--space-4);
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--brand-500);
  background: #7e70ff1a;
  color: #b8afff;
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
}
.hero h1 {
  position: relative;
  margin: 0 0 var(--space-4);
  font-size: clamp(30px, 5vw, 52px);
  line-height: 1.18;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(120deg, #ffffff 28%, #b8afff 78%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lead {
  position: relative;
  margin: 0 auto var(--space-8);
  max-width: 620px;
  color: var(--text-2);
  font-size: var(--text-lg);
  line-height: 1.7;
}
.hero-cta {
  position: relative;
  display: flex;
  gap: var(--space-3);
  justify-content: center;
  flex-wrap: wrap;
}
.btn-lg {
  height: 46px;
  padding: 0 var(--space-8);
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  font-size: var(--text-base);
  font-weight: 600;
  transition:
    background var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
.btn-lg:hover {
  transform: translateY(-1px);
}
.btn-lg.primary {
  background: var(--brand-500);
  color: #fff;
  box-shadow: 0 8px 24px -10px #7e70ffcc;
}
.btn-lg.primary:hover {
  background: var(--brand-600);
}
.btn-lg.ghost {
  border: 1px solid var(--border-2);
  color: var(--text-1);
}
.btn-lg.ghost:hover {
  background: #ffffff0f;
}
.hint-sm {
  position: relative;
  margin: var(--space-5) 0 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}

/* ── 双工作流 ── */
.flows {
  max-width: 980px;
  margin: 0 auto;
  padding: 0 var(--space-6) var(--space-16);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.flow-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border-1);
  background: linear-gradient(140deg, var(--bg-raised), #0c0c10);
  transition:
    border-color var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.flow-card:hover {
  border-color: var(--brand-500);
  transform: translateY(-2px);
}
.flow-icon {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--radius-xl);
  background: #7e70ff26;
  color: #b8afff;
  display: grid;
  place-items: center;
}
.flow-icon svg {
  width: 22px;
  height: 22px;
}
.flow-body {
  flex: 1;
  min-width: 0;
}
.flow-body h3 {
  margin: 0 0 4px;
  font-size: var(--text-base);
  color: var(--text-1);
}
.flow-body p {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.flow-cta {
  color: #b8afff;
  font-size: var(--text-sm);
  white-space: nowrap;
}

/* ── 区块 ── */
.section {
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--space-16) var(--space-6);
}
.section.alt {
  border-top: 1px solid var(--border-1);
}
.sec-head {
  text-align: center;
  margin-bottom: var(--space-10);
}
.sec-head h2 {
  margin: 0 0 var(--space-3);
  font-size: clamp(22px, 3vw, 32px);
  font-weight: 700;
  color: var(--text-1);
}
.sec-head p {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-base);
}

/* 能力 */
.cap-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
.cap {
  padding: var(--space-5);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  transition: border-color var(--duration-base) var(--ease-out);
}
.cap:hover {
  border-color: #7e70ff66;
}
.cap-icon {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: var(--space-3);
  border-radius: var(--radius-lg);
  background: #7e70ff1f;
  color: #b8afff;
  font-size: 16px;
}
.cap h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-base);
  color: var(--text-1);
}
.cap p {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.7;
}

/* 流程 */
.pipe {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.pipe li {
  position: relative;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
}
.pipe li:not(:last-child)::after {
  content: "→";
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  font-size: 12px;
}
.num {
  display: block;
  margin-bottom: var(--space-2);
  color: #b8afff;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
}
.pipe b {
  display: block;
  margin-bottom: 4px;
  font-size: var(--text-sm);
  color: var(--text-1);
}
.pipe em {
  font-style: normal;
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.6;
}

/* 底部 CTA */
.final-cta {
  text-align: center;
  padding: var(--space-20) var(--space-6);
  border-top: 1px solid var(--border-1);
  background: radial-gradient(60% 80% at 50% 0%, #7e70ff1f, transparent 70%);
}
.final-cta h2 {
  margin: 0 0 var(--space-3);
  font-size: clamp(22px, 3vw, 30px);
  color: var(--text-1);
}
.final-cta p {
  margin: 0 0 var(--space-6);
  color: var(--text-3);
}

/* 页脚 */
.foot {
  border-top: 1px solid var(--border-1);
  padding: var(--space-8) var(--space-6) var(--space-10);
}
.foot-inner {
  max-width: 1120px;
  margin: 0 auto var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.foot-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-2);
  font-size: var(--text-sm);
}
.foot-links {
  display: flex;
  gap: var(--space-5);
  font-size: var(--text-sm);
}
.foot-links a {
  color: var(--text-3);
}
.foot-links a:hover {
  color: var(--text-1);
}
.foot-note {
  max-width: 1120px;
  margin: 0 auto;
  color: var(--text-3);
  font-size: var(--text-xs);
  text-align: center;
}

/* ── 响应式 ── */
@media (max-width: 960px) {
  .cap-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .pipe {
    grid-template-columns: repeat(3, 1fr);
  }
  .pipe li:not(:last-child)::after {
    display: none;
  }
}
@media (max-width: 720px) {
  .links {
    display: none;
  }
  .flows {
    grid-template-columns: 1fr;
  }
  .cap-grid {
    grid-template-columns: 1fr;
  }
  .pipe {
    grid-template-columns: 1fr 1fr;
  }
  .hero {
    padding: 64px var(--space-4) 48px;
  }
  .lead {
    font-size: var(--text-base);
  }
  .flow-card {
    padding: var(--space-4);
  }
}
</style>
