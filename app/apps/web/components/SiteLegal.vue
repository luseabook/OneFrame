<script setup lang="ts">
/**
 * 页脚合规信息（ICP 备案 + 公安联网备案）。
 *
 * 为什么是独立组件而不是在两个页脚里各写一遍：
 * 全站有两套页脚——`layouts/default.vue`（营销页壳）与 `pages/index.vue`（落地页自带页脚），
 * 合规信息必须两处都在，任何一处漏掉就是「部分页面无备案号」，监管口径上等同于未备案。
 * 抽成一个组件后，改口径只改一处，也不会再出现「只改了首页、忘了条款页」。
 *
 * 取值来源：`runtimeConfig.public.icpBeian / icpPolice`（见 nuxt.config.ts 注释）。
 * 空串时**整段不渲染**，不显示「未配置」之类的占位文案——占位文案上线就是缺陷。
 *
 * 号段本身是专有名词（`京ICP备2024000000号-1`），5 个语种都原样显示；
 * 只把「标签」交给语言包，避免把号码抄进 5 份 JSON 后漂移。
 */
const { t } = useI18n();
const config = useRuntimeConfig();

/**
 * 去掉**所有**空白，不只是首尾：运维从备案系统复制出来的是 `京 ICP 备 2024000000 号-1`，
 * 中间带空格。守卫侧已归一化（`icp-guard.ts`），页脚也要同一口径 ——
 * 否则页面上会显示带空格的样子，和别的渠道（公众号、发票）对不上，看着像填错了。
 */
const normalize = (value: unknown): string => String(value ?? "").replace(/\s+/g, "");
const icpBeian = computed(() => normalize(config.public.icpBeian));
const icpPolice = computed(() => normalize(config.public.icpPolice));
const hasAny = computed(() => icpBeian.value.length > 0 || icpPolice.value.length > 0);
</script>

<template>
  <div v-if="hasAny" class="site-legal">
    <a
      v-if="icpBeian"
      class="site-legal-link"
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t("shell.icpLabel") }} {{ icpBeian }}
    </a>
    <a
      v-if="icpPolice"
      class="site-legal-link"
      href="https://beian.mps.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t("shell.icpPoliceLabel") }} {{ icpPolice }}
    </a>
  </div>
</template>

<style scoped>
/* 只消费层二令牌（tokens.css），不自造色值与字号档位 */
.site-legal {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: var(--text-xs);
  line-height: var(--text-xs-lh);
  color: var(--text-3);
}
.site-legal-link {
  color: var(--text-3);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out);
}
.site-legal-link:hover {
  color: var(--text-2);
}
</style>
