<template>
  <main class="page">
    <section class="hero">
      <h1>30 分钟，产出一集漫剧</h1>
      <p class="sub">
        粘贴小说，AI 生成分集大纲、角色定妆图、分镜与视频——角色全程一致，价格全程透明。
      </p>
      <div class="cta">
        <NuxtLink to="/login?redirect=/projects" class="cta-btn primary">开始创作</NuxtLink>
        <NuxtLink to="/login?redirect=/pricing" class="cta-btn ghost">查看定价</NuxtLink>
      </div>
    </section>

    <section class="features">
      <article class="card">
        <h3>剧本流水线</h3>
        <p>小说 → 分集大纲 → 角色 → 分镜表 → 批量生成，每一步可编辑可重跑，预算上限一键控制。</p>
      </article>
      <article class="card">
        <h3>角色一致性</h3>
        <p>角色定妆图绑定后自动注入每一镜的参考，跨镜头、跨剧集，人物不再变脸。</p>
      </article>
      <article class="card">
        <h3>价格透明</h3>
        <p>各模型直连价与积分换算官网公示，生成前实时报价，失败与取消不扣积分。</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 32px;
}
.hero {
  position: relative;
  text-align: center;
  padding: 96px 0 64px;
}
.hero::before {
  content: "";
  position: absolute;
  left: 50%;
  top: -40px;
  width: 720px;
  height: 360px;
  transform: translateX(-50%);
  background: radial-gradient(50% 60% at 50% 40%, #7e70ff2b 0%, transparent 70%);
  pointer-events: none;
}
.hero h1 {
  position: relative;
  font-size: 44px;
  line-height: 1.25;
  margin: 0 0 16px;
  background: linear-gradient(120deg, #ffffff 30%, #b8afff 80%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero .sub {
  position: relative;
}
.sub {
  color: var(--text-2);
  font-size: 16px;
  max-width: 560px;
  margin: 0 auto 32px;
}
.cta {
  position: relative;
  display: flex;
  gap: 12px;
  justify-content: center;
}
.cta-btn {
  border-radius: var(--radius-full);
  height: 42px;
  display: inline-flex;
  align-items: center;
  padding: 0 24px;
  font-size: 14px;
  font-weight: 600;
}
.cta-btn.primary {
  background: var(--brand-500);
  color: #fff;
}
.cta-btn.ghost {
  border: 1px solid var(--border-1);
  color: var(--text-1);
}
.features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-bottom: 96px;
}
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 24px;
}
.card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.card p {
  margin: 0;
  color: var(--text-2);
  font-size: 13px;
}
@media (max-width: 720px) {
  .features {
    grid-template-columns: 1fr;
  }
  .hero h1 {
    font-size: 28px;
  }
}
</style>
