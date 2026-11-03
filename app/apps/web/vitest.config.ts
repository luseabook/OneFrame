import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * web 的单测配置（此前 `test` 是恒真桩，没有配置）。
 *
 * 只做两件事：
 * 1. 把 Nuxt 的 `~` 别名指向包根 —— 否则 spec 加载任何 `import "~/..."` 的模块都会报
 *    `Failed to load url ~/...`（Nuxt 的别名只在 Nuxt 构建期存在）。
 * 2. 显式排除构建产物，避免把 `.output/` 里的 chunk 当测试文件收集。
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.spec.ts"],
    exclude: ["node_modules/**", ".nuxt/**", ".output/**", "dist/**"],
  },
});
