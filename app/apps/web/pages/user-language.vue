<script setup lang="ts">
/**
 * 语言设置（竞品 `/user-language`，第 134 批）。
 *
 * 竞品证据（2026-11-04 实时逆向）：`/user-language` 组件 `Bnyyx2yK.js` 是 `UserLanguageMobile`
 * （隐藏 header、列表项 + 确认图标、切换后 fallback 到 UserSettings），是**移动端语言页**。
 * 我方做成桌面独立页（5 语言 + cookie 即时切换），属于**扩展**，不宣称与竞品同形。
 *
 * 与账号语言的关系：竞品的语言偏好是账号级；我方当前落在 cookie（服务端不存语言），
 * 所以这里文案写“本设备生效”，不谎称已同步到账号。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t, locale, setLocale, languages } = useI18n();
useHead({ title: () => t("userLanguage.metaTitle") });

const toast = useToast();
function choose(code: string): void {
  const next = setLocale(code);
  if (next) toast.success(t("userLanguage.saved", { name: languages.find((l) => l.code === next)?.nativeName ?? next }));
}
</script>

<template>
  <div class="ul">
    <header class="ul-head">
      <h1 class="ul-title">{{ t("userLanguage.title") }}</h1>
      <p class="ul-sub">{{ t("userLanguage.sub") }}</p>
    </header>

    <section class="ul-list">
      <button
        v-for="lang in languages"
        :key="lang.code"
        type="button"
        class="ul-item"
        :class="{ 'ul-item--active': lang.code === locale }"
        @click="choose(lang.code)"
      >
        <span class="ul-item__name">{{ lang.nativeName }}</span>
        <span class="ul-item__code">{{ lang.code }}</span>
        <span v-if="lang.code === locale" class="ul-item__current">{{ t("userLanguage.current") }}</span>
      </button>
    </section>

    <p class="ul-note">{{ t("userLanguage.note") }}</p>
  </div>
</template>

<style scoped>
.ul {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 24px 56px;
  color: var(--text-1);
}
.ul-head {
  margin-bottom: 20px;
}
.ul-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
}
.ul-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.ul-list {
  display: grid;
  gap: 8px;
}
.ul-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-control);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
}
.ul-item:hover {
  border-color: var(--brand, #9b46ff);
}
.ul-item--active {
  border-color: var(--brand, #9b46ff);
}
.ul-item__name {
  flex: 1;
  font-size: 14px;
}
.ul-item__code {
  color: var(--text-4);
  font-size: 12px;
}
.ul-item__current {
  color: var(--brand, #9b46ff);
  font-size: 12px;
}
.ul-note {
  margin: 16px 0 0;
  color: var(--text-4);
  font-size: 12px;
  line-height: 1.7;
}
</style>