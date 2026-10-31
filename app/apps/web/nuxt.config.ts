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
  // canvas-agent.css 同理（Agent 面板的 .cv-agent* 前缀类），必须排在 canvas.css 之后：
  // 它复用了 canvas.css 里的 --cv-* 令牌，反过来顺序会让变量拿到空值而静默失色。
  css: ["~/assets/css/tokens.css", "~/assets/css/canvas.css", "~/assets/css/canvas-agent.css"],
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
    // 子路径（/admin/login）不在 "/admin" 规则内，实测会 hydration mismatch，必须补 **
    "/admin/**": { ssr: false },
    // 画布族（列表 + 编辑器）同样纯客户端渲染：数据来自登录态与 API，
    // 且 definePageMeta({ssr:false}) 对直接 URL 访问不足以保证首帧一致
    // （docs/03-frontend/conventions.md §1 已实测会 hydration mismatch），
    // 所以必须在 routeRules 里也关掉 SSR。
    "/canvas": { ssr: false },
    "/canvas/**": { ssr: false },
    // 其余"登录后才可用"的页面同样必须在 routeRules 里关 SSR：
    // `definePageMeta({ssr:false})` 对直接访问不足以保证首帧一致（/team 实测会 hydration mismatch）。
    // 这里按"页面 meta 已声明 ssr:false"的清单补齐，避免同类问题一处一处冒。
    "/team": { ssr: false },
    // 第 105 批 QA 实测：只写 "/team" **不覆盖子路径** —— 未登录直接访问
    // /team/dashboard 时，SSR 先渲染了团队页、客户端再跳登录页，于是报
    // "Hydration completed but contains mismatches."。与上面 /admin/** 完全同因，
    // 教训相同：凡是有子路由的前缀，`**` 必须单独列一行。
    "/team/**": { ssr: false },
    "/login": { ssr: false },
    "/pricing": { ssr: false },
    "/report": { ssr: false },
    "/privacy": { ssr: false },
    "/terms": { ssr: false },
    // 单点工具页（/create/*）同理：这些页面此前只在 `definePageMeta` 里写了 ssr:false，
    // 而直接打开/刷新 URL 时仍会走服务端渲染 → 与服务端未登录首帧不一致 →
    // hydration 失败后整页空白（本轮 E2E 实测：直接访问 /create/text-to-video 时
    // `#__nuxt` 不存在、body 仅 356 字节）。工具页全是"登录后才可用"的参数面板，
    // 关掉 SSR 是唯一正确解，不需要给它们做一套登录态 SSR 首帧。
    "/create": { ssr: false },
    "/create/**": { ssr: false },
    // ReelFlow 剪辑台（列表 + 编辑器）同一类"登录后才可用"的纯客户端页面：
    // 时间线/分镜数据全部来自登录态接口，服务端首帧必然与客户端不一致。
    "/reelflow": { ssr: false },
    "/reelflow/**": { ssr: false },
    // 新增三个"登录后才可用"的整页应用（第 2/4/5 批）：小说改编链、创作 Agent、影视版。
    // 与 /canvas、/reelflow 同类——首帧全部依赖登录态与接口数据，服务端渲染只会产
    // 生"服务端未登录 / 客户端已登录"的 hydration mismatch。按既有约定三处齐关。
    "/novel": { ssr: false },
    "/novel/**": { ssr: false },
    "/agent": { ssr: false },
    "/film": { ssr: false },
    "/film/**": { ssr: false },
    // 第 2 轮新增（第 6 批生态 + 收尾批次）：同样是"登录后整页应用"。
    // /activities 与 /novel-market 允许游客浏览列表（但下单/报名要登录），
    // 仍统一关 SSR：列表首屏依赖分页与登录态，服务端首帧与客户端必然不一致。
    "/creator-center": { ssr: false },
    "/creator-center/**": { ssr: false },
    "/activities": { ssr: false },
    "/invite": { ssr: false },
    "/novel-market": { ssr: false },
    "/novel-market/**": { ssr: false },
    "/knowledge": { ssr: false },
    "/knowledge/**": { ssr: false },
    // 第 3 轮新增：广告剧 / 视频转绘（登录后整页应用）与公开播放页（首屏数据来自接口）。
    "/ad-drama": { ssr: false },
    "/ad-drama/**": { ssr: false },
    "/video-redraw": { ssr: false },
    "/video-redraw/**": { ssr: false },
    "/watch": { ssr: false },
    "/watch/**": { ssr: false },
    // 分享页（补 P1-14）：`pages/share/[token].vue` 的 `definePageMeta({ssr:false})` 只影响该页的
    // **组件**渲染，不改变服务端首帧；而分享链接是最容易被**匿名直开**的入口（预览/举报），
    // 首帧与服务端结果不一致时整页空白。与第 105 批 `/team/**` 是同一类缺陷。
    // 守卫：`apps/api/test/web-route-rules.spec.ts`（每个 pages/ 顶层路由都必须在 routeRules 里）。
    "/share": { ssr: false },
    "/share/**": { ssr: false },
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
