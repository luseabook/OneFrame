const apiProxyTarget = process.env.NUXT_API_PROXY ?? "http://127.0.0.1:3000";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-01",
  ssr: true,
  devtools: { enabled: false },
  typescript: { strict: true },
  // canvas.css 必须显式 import：它不是被任何组件 <style> 引用的，只是纯类名表，
  // 不注册进全局 css 的话 .canvas-view/.cv-* 运行时全部不存在，画布组件会裸样式，
  // 而 typecheck/lint 都发现不了（它们不检查"类名有没有被定义"）。
  // 顺序放在 tokens.css 之后：canvas.css 里的 --cv-* 用 var() 引用了 tokens 的层二令牌。
  css: ["~/assets/css/tokens.css", "~/assets/css/canvas.css"],
  runtimeConfig: {
    public: {
      // 空 = 同源 /v1（本地由 NUXT_API_PROXY 代理，生产由 nginx 反代）
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
    },
  },
  routeRules: {
    // /v1 由 Nuxt 代理到 api（保持单一入口与同源 Cookie）。
    // 代理时透传真实客户端 IP：否则 api 侧只能看到代理节点 IP，
    // 全站用户会共用同一个发码/举报频控桶。
    "/v1/**": {
      proxy: `${apiProxyTarget}/v1/**`,
      headers: {
        "x-forwarded-for": "{clientIp}",
        "x-real-ip": "{clientIp}",
      },
    },
    // 工作台页面完全依赖客户端数据（登录态 / 分页 / 轮询），
    // 关闭 SSR 以消除服务端与客户端首帧数据不一致导致的 hydration 警告。
    "/home": { ssr: false },
    "/projects": { ssr: false },
    "/projects/**": { ssr: false },
    "/works": { ssr: false },
    "/tasks": { ssr: false },
    "/assets": { ssr: false },
    "/credits": { ssr: false },
    "/settings": { ssr: false },
    "/tools": { ssr: false },
    "/admin": { ssr: false },
    // 画布族（列表 + 编辑器）同样纯客户端渲染：数据来自登录态与 API，
    // 且 definePageMeta({ssr:false}) 对直接 URL 访问不足以保证首帧一致
    // （docs/03-frontend/conventions.md §1 已实测会 hydration mismatch），
    // 所以必须在 routeRules 里也关掉 SSR。
    "/canvas": { ssr: false },
    "/canvas/**": { ssr: false },
  },
  app: {
    head: {
      htmlAttrs: { lang: "zh-CN" },
      title: "一帧 OneFrame · AI 漫剧工作台 — 30 分钟产出一集短剧",
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
