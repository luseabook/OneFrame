<script setup lang="ts">
/**
 * 语言切换器（壳层 `app.vue` 顶栏 + 落地页/登录页各一处）。
 *
 * 为什么用原生 `<select>` 而不是自绘下拉：它是唯一"键盘可达 + 移动端原生弹层 + 无额外 JS"
 * 的形态，且 E2E 里 `selectOption` 稳定命中（自绘下拉要维护 open/focus/outside-click 三态）。
 *
 * 语言名用**各自语言的写法**（`nativeName`，见 `i18n/index.ts`）：用户找自己的语言时
 * 认的是「日本語」而不是当前界面语言下的译名。
 *
 * 前缀策略（第 8 批补完）：canonical URL **不带**语言前缀（`/pricing`），所以正常切换只改
 * 本地状态 + cookie，不跳转（少一跳、不丢滚动位置）。但若当前 URL 真的带前缀
 * （`/en/pricing`，例如外链/爬虫入口在中间件跳转前完成渲染），切换时**替换前缀**
 * （→ `/ja/pricing`），绝不叠加成 `/ja/en/pricing`——`localizedPath()` 已保证幂等。
 */
import { localizedPath, parseLocalePrefix } from "~/i18n";

const { t, locale, setLocale, languages } = useI18n();
const route = useRoute();

/**
 * `tone="light"`：登录页是全站唯一的浅色界面（局部色板 `--lm-*`，见 login.vue 顶部注释），
 * 深色令牌的下拉在那里对比度不足，因此给一个浅色变体，而不是给登录页另写一个切换器。
 */
const props = withDefaults(defineProps<{ tone?: "dark" | "light" }>(), { tone: "dark" });

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  // 切换语言不刷新页面：setLocale 写 useState + cookie，所有 t() 立即重算
  const next = setLocale(value);
  if (!next) return;
  // 只有"当前 URL 带前缀"时才导航（替换前缀）；canonical 路径保持不动
  const { locale: prefixed } = parseLocalePrefix(route.path);
  if (!prefixed) return;
  const target = localizedPath(route.path, next);
  if (target !== route.path) void navigateTo(target, { replace: true });
}
</script>

<template>
  <label class="lang-switcher" :class="`lang-switcher--${props.tone}`" :aria-label="t('lang.switch')">
    <!-- 线性地球图标（GL11/D1）：深色界面里 🌐 是整条顶栏唯一的彩色噪点，
         改成与壳层其它图标同参数的 stroke=currentColor 线性图标（16px / 1.6）。 -->
    <span class="lang-switcher__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17" />
        <path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5Z" />
      </svg>
    </span>
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
  display: inline-flex;
  color: var(--text-3);
}
.lang-switcher__icon svg {
  width: 15px;
  height: 15px;
}
/* GL4/GL11：与顶栏其余控件同一档（40 高 / 圆角 10 / 底 #0A0A0E / 描边 #2C2C30 / 13px）。
   旧值 30 高 + r8 + var(--bg-raised) #1f1f2a，比顶栏胶囊明显偏紫亮且矮 10px。 */
.lang-switcher__select {
  height: 40px;
  padding: 0 26px 0 10px;
  border-radius: var(--radius-control);
  border: 1px solid #2c2c30;
  background: #0a0a0e;
  color: var(--text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  /* chevron 垂直居中：40 高时基线在 18–19px（旧值 13px 是按 30 高调的） */
  background-position:
    calc(100% - 13px) 19px,
    calc(100% - 9px) 19px;
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
.lang-switcher--light .lang-switcher__icon {
  color: #767676;
}
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
