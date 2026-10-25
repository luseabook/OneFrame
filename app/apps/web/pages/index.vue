<script setup lang="ts">
// 落地页：对齐竞品 ReelMate 首页信息架构（导航 → Hero → 双工作流入口 → 能力矩阵 → 流水线展示 → 页脚）
definePageMeta({ layout: false });
useHead({ title: "一帧 · AI 漫剧工作台 — 30 分钟产出一集短剧" });

const auth = useAuth();
const isLogged = computed(() => !!auth.state.value.user);

// 本页不走公共壳层（app.vue 对 "/" 不套 layout），登录态需自行 bootstrap
onMounted(() => {
  if (!auth.state.value.accessToken && !auth.state.value.user) void auth.bootstrap();
});

const flows = [
  {
    title: "短剧工作流",
    desc: "从剧本到成片，一站式创作爆款短剧",
    cta: "创建项目",
    to: "/projects",
    variant: "primary" as const,
  },
  {
    title: "工具箱",
    desc: "文生视频 / 图生视频，单点快速出片",
    cta: "打开工具箱",
    to: "/tools",
    variant: "ghost" as const,
  },
];

const capabilities = [
  {
    icon: "◈",
    title: "剧本流水线",
    desc: "小说或一句话 → 分集大纲 → 角色定妆 → 分镜表 → 批量出片，每一步可编辑可重跑。",
  },
  {
    icon: "☺",
    title: "角色一致性",
    desc: "定妆图绑定后自动注入每一镜参考，跨镜头、跨剧集人物不变脸。",
  },
  {
    icon: "◉",
    title: "价格透明",
    desc: "模型直连价与积分换算公示，生成前实时报价，失败与取消不扣积分。",
  },
  {
    icon: "▤",
    title: "批量与预算",
    desc: "选集或选镜批量投递，预算上限一键控制；触顶镜头部分成功，续投可预填。",
  },
  {
    icon: "◫",
    title: "资产复用",
    desc: "结果转存资产库，角色定妆图打标签跨项目复用，作品可续做下一集。",
  },
  {
    icon: "✧",
    title: "AI 双标识",
    desc: "成片画面水印 + 文件元数据双重标识，符合生成内容标识要求。",
  },
];

const pipeline = [
  { n: "01", title: "建项目", desc: "粘贴小说或写一句话想法，选画幅" },
  { n: "02", title: "生成大纲", desc: "AI 拆成 3~6 集，逐条可改，自动保存" },
  { n: "03", title: "角色定妆", desc: "抽取角色卡，生成定妆图并定稿绑定" },
  { n: "04", title: "写分镜", desc: "按集生成 4~30 镜，镜号/画面/提示词" },
  { n: "05", title: "批量出片", desc: "选模型与预算，一键投递全部镜头" },
  { n: "06", title: "导出成片", desc: "逐镜下载或整集 zip，含 manifest" },
];
</script>

<template>
  <div class="landing">
    <!-- 顶部导航 -->
    <header class="nav-bar">
      <div class="nav-inner">
        <NuxtLink to="/" class="brand">
          <span class="logo-mark">一</span>
          <span class="logo-text">一帧</span>
        </NuxtLink>
        <nav class="links">
          <a href="#capabilities">能力</a>
          <a href="#pipeline">流程</a>
          <NuxtLink to="/pricing">定价</NuxtLink>
        </nav>
        <div class="nav-right">
          <NuxtLink v-if="isLogged" to="/home" class="cta-sm">进入工作台</NuxtLink>
          <template v-else>
            <NuxtLink to="/login" class="ghost-sm">登录</NuxtLink>
            <NuxtLink to="/login?redirect=/projects" class="cta-sm">免费开始</NuxtLink>
          </template>
        </div>
      </div>
    </header>

    <!-- Hero -->
    <section class="hero">
      <div class="glow" aria-hidden="true" />
      <p class="eyebrow">AI 漫剧 · 短剧生产流水线</p>
      <h1>你的专属 AI 漫剧工作室</h1>
      <p class="lead">
        粘贴小说或写一句话，AI 生成分集大纲、角色定妆、分镜与视频——<br />
        角色全程一致，价格全程透明。
      </p>
      <div class="hero-cta">
        <NuxtLink :to="isLogged ? '/projects' : '/login?redirect=/projects'" class="btn-lg primary">
          开始创作
        </NuxtLink>
        <a href="#pipeline" class="btn-lg ghost">看它怎么工作</a>
      </div>
      <p class="hint-sm">Alpha 期邀请制 · 注册赠送 80 积分 · 无需绑定支付</p>
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
        <h2>不是又一个文生视频站</h2>
        <p>单点生成是模型厂商的主场。我们做的是「小说进、成片出」的生产线。</p>
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
        <h2>六步，从想法到成片</h2>
        <p>人工操作约 30 分钟；含生成排队的端到端时长 ≤2 小时。</p>
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
      <h2>现在就把第一部剧做出来</h2>
      <p>Alpha 期邀请制，注册即赠 80 积分，够跑通一整集。</p>
      <NuxtLink :to="isLogged ? '/projects' : '/login?redirect=/projects'" class="btn-lg primary">
        免费开始创作
      </NuxtLink>
    </section>

    <!-- 页脚 -->
    <footer class="foot">
      <div class="foot-inner">
        <div class="foot-brand">
          <span class="logo-mark sm">一</span>
          <span>一帧 · AI 漫剧工作台</span>
        </div>
        <nav class="foot-links">
          <NuxtLink to="/terms">用户协议</NuxtLink>
          <NuxtLink to="/privacy">隐私政策</NuxtLink>
          <NuxtLink to="/report">举报 / 投诉</NuxtLink>
          <NuxtLink to="/pricing">定价</NuxtLink>
        </nav>
      </div>
      <p class="foot-note">
        内容由 AI 生成，请仔细甄别 · 京 ICP 备 00000000 号（上线前替换）
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
