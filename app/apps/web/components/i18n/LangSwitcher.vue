<script setup lang="ts">
/**
 * 语言切换器（被本批 6 个页面直接引用）。
 *
 * 为什么用原生 `<select>` 而不是自绘下拉：它是唯一"键盘可达 + 移动端原生弹层 + 无额外 JS"
 * 的形态，且 E2E 里 `selectOption` 稳定命中（自绘下拉要维护 open/focus/outside-click 三态）。
 *
 * 语言名用**各自语言的写法**（`nativeName`，见 `i18n/index.ts`）：用户找自己的语言时
 * 认的是「日本語」而不是当前界面语言下的译名。
 */
const { t, locale, setLocale, languages } = useI18n();

/**
 * `tone="light"`：登录页是全站唯一的浅色界面（局部色板 `--lm-*`，见 login.vue 顶部注释），
 * 深色令牌的下拉在那里对比度不足，因此给一个浅色变体，而不是给登录页另写一个切换器。
 */
const props = withDefaults(defineProps<{ tone?: "dark" | "light" }>(), { tone: "dark" });

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  // 切换语言不刷新页面：setLocale 写 useState + cookie，所有 t() 立即重算
  setLocale(value);
}
</script>

<template>
  <label class="lang-switcher" :class="`lang-switcher--${props.tone}`" :aria-label="t('lang.switch')">
    <span class="lang-switcher__icon" aria-hidden="true">🌐</span>
    <select class="lang-switcher__select" :value="locale" @change="onChange">
      <option v-for="item in languages" :key="item.code" :value="item.code">
        {{ item.nativeName }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.lang-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.lang-switcher__icon {
  font-size: 13px;
  opacity: 0.75;
}
.lang-switcher__select {
  height: 30px;
  padding: 0 26px 0 8px;
  border-radius: 8px;
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position:
    calc(100% - 13px) 13px,
    calc(100% - 9px) 13px;
  background-size: 4px 4px, 4px 4px;
  background-repeat: no-repeat;
}
.lang-switcher__select:hover {
  border-color: var(--brand-border);
}
.lang-switcher__select:focus-visible {
  outline: 1px solid var(--brand-border);
  outline-offset: 1px;
}
/* 浅色变体：登录页的局部浅色色板（login.vue 的 --lm-* 不外泄，这里用等价中性色） */
.lang-switcher--light .lang-switcher__select {
  background: #ffffff;
  border-color: #e5e5e5;
  color: #262626;
}
.lang-switcher--light .lang-switcher__select:hover {
  border-color: #6d5bd0;
}
.lang-switcher--light .lang-switcher__select:focus-visible {
  outline-color: #6d5bd0;
}
</style>
