const apiProxyTarget = process.env.NUXT_API_PROXY ?? "http://127.0.0.1:3000";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  ssr: true,
  devtools: { enabled: false },
  typescript: { strict: true },
  css: ["~/assets/css/tokens.css"],
  runtimeConfig: {
    public: {
      // 空 = 同源 /v1（本地由 NUXT_API_PROXY 代理，生产由 nginx 反代）
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
    },
  },
  routeRules: {
    "/v1/**": { proxy: `${apiProxyTarget}/v1/**` },
  },
  app: {
    head: {
      htmlAttrs: { lang: "zh-CN" },
      title: "AI 漫剧工作台 — 30 分钟产出一集短剧",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "粘贴小说，一键生成分镜与视频：剧本流水线、角色一致性、价格透明。AI 漫剧/短剧一站式生产平台。",
        },
      ],
    },
  },
  components: [{ path: "~/components", pathPrefix: false }],
});
