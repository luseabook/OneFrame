<script setup lang="ts">
/**
 * 创作手册（竞品 `/tutorial`，第 134 批）。
 *
 * 竞品该路由只知存在（`fullsite-page-routes-v2.md:33`，❓未取证），没有截图/响应体。
 * 按“产品已有主链路”做最合理实现：把「灵感/小说 → 大纲角色 → 分镜投递 → 成片」这条
 * 真实路径写成三步 + FAQ，每一步直接链到对应页面，不做假教程。
 *
 * 内容不写死在后端：手册是产品说明，随代码版本走；文案全部 i18n。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("tutorial.metaTitle") });

const steps = computed(() => [
  {
    no: "01",
    title: t("tutorial.step1Title"),
    desc: t("tutorial.step1Desc"),
    to: "/script",
    cta: t("tutorial.step1Cta"),
  },
  {
    no: "02",
    title: t("tutorial.step2Title"),
    desc: t("tutorial.step2Desc"),
    to: "/works",
    cta: t("tutorial.step2Cta"),
  },
  {
    no: "03",
    title: t("tutorial.step3Title"),
    desc: t("tutorial.step3Desc"),
    to: "/tasks",
    cta: t("tutorial.step3Cta"),
  },
]);

const faqs = computed(() => [
  { q: t("tutorial.faq1Q"), a: t("tutorial.faq1A") },
  { q: t("tutorial.faq2Q"), a: t("tutorial.faq2A") },
  { q: t("tutorial.faq3Q"), a: t("tutorial.faq3A") },
]);
</script>

<template>
  <div class="tu">
    <header class="tu-head">
      <p class="tu-eyebrow">{{ t("tutorial.eyebrow") }}</p>
      <h1 class="tu-title">{{ t("tutorial.title") }}</h1>
      <p class="tu-sub">{{ t("tutorial.sub") }}</p>
    </header>

    <section class="tu-steps">
      <article v-for="step in steps" :key="step.no" class="tu-step">
        <span class="tu-step__no">{{ step.no }}</span>
        <h2 class="tu-step__title">{{ step.title }}</h2>
        <p class="tu-step__desc">{{ step.desc }}</p>
        <NuxtLink class="tu-step__cta" :to="step.to">{{ step.cta }} →</NuxtLink>
      </article>
    </section>

    <section class="tu-faq">
      <h2 class="tu-h2">{{ t("tutorial.faqTitle") }}</h2>
      <details v-for="(item, index) in faqs" :key="index" class="tu-faq__item">
        <summary>{{ item.q }}</summary>
        <p>{{ item.a }}</p>
      </details>
    </section>

    <footer class="tu-foot">
      <NuxtLink class="tu-foot__primary" to="/script">{{ t("tutorial.startNow") }}</NuxtLink>
      <NuxtLink class="tu-foot__link" to="/cli">{{ t("tutorial.cliLink") }}</NuxtLink>
    </footer>
  </div>
</template>

<style scoped>
.tu {
  max-width: 1126px;
  margin: 0 auto;
  padding: 24px 24px 56px;
  color: var(--text-1);
}
.tu-head {
  text-align: center;
  margin-bottom: 28px;
}
.tu-eyebrow {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tu-title {
  margin: 0 0 10px;
  font-size: 30px;
  font-weight: 600;
  background: linear-gradient(92deg, #fff, #cbb6ff 55%, #9b46ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tu-sub {
  margin: 0 auto;
  max-width: 620px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.7;
}
.tu-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 36px;
}
.tu-step {
  padding: 20px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
}
.tu-step__no {
  color: var(--brand, #9b46ff);
  font-size: 12px;
  letter-spacing: 0.12em;
}
.tu-step__title {
  margin: 8px 0;
  font-size: 16px;
  font-weight: 600;
}
.tu-step__desc {
  margin: 0 0 14px;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.8;
}
.tu-step__cta {
  color: var(--brand, #9b46ff);
  font-size: 13px;
  text-decoration: none;
}
.tu-faq {
  margin-bottom: 32px;
}
.tu-h2 {
  margin: 0 0 14px;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
}
.tu-faq__item {
  border-bottom: 1px solid var(--panel-line);
  padding: 12px 4px;
}
.tu-faq__item summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--text-1);
}
.tu-faq__item p {
  margin: 10px 0 0;
  color: var(--text-3);
  font-size: 13px;
  line-height: 1.8;
}
.tu-foot {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
}
.tu-foot__primary {
  height: 40px;
  padding: 0 22px;
  border-radius: 999px;
  background: #fff;
  color: #1a1a1f;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
.tu-foot__link {
  color: var(--text-2);
  font-size: 13px;
  text-decoration: none;
}
@media (max-width: 900px) {
  .tu-steps {
    grid-template-columns: 1fr;
  }
}
</style>