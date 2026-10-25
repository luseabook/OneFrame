import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

/**
 * 根 ESLint 配置（2026-10-26 起 web 也纳入门禁，F0.3）
 *
 * 之前 `apps/web` 没有 lint/typecheck 脚本，43 个 .vue / 17k 行前端代码完全不进门禁，
 * 而它的 `test` 是 `echo ... && exit 0` 恒真占位——直接后果是"全仓测试通过"里
 * 混入了 0 条前端断言，前端回归只能靠人肉截图。
 *
 * 这里只用**推荐集**（不引入需要大面积改码的规则），先让 web 有门，再逐期收紧。
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/node_modules/**",
      "**/*.d.ts",
      // Nitro/Nuxt 生成的构建期文件
      "**/.turbo/**",
    ],
  },
  ...tseslint.configs.recommended,
  // .vue：解析 <template> + <script setup>
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".vue"],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 推荐集里对"存量代码"最吵的排版类规则先整体关闭（只保语义类规则）：
      // 现有 pages/components 命名与排版已定型，纳入门禁的目的是"防新增缺陷"，
      // 不是格式化存量 17k 行（那会制造一个巨大的、与功能无关的 diff）。
      "vue/multi-word-component-names": "off",
      "vue/attributes-order": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/attribute-hyphenation": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/require-default-prop": "off",
      "vue/require-explicit-emits": "off",
      "vue/no-v-html": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 存量既有的"未使用变量"是历史遗留（多为早期迭代留下的 UI 计算属性），
    // 不阻塞本次门禁落地：降级为 warn，新增代码仍会看到提示。
    // TODO(F1): 清理完后恢复为 error。
    files: ["**/*.vue"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
