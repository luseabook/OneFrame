// ⚠️ **构建期**常量：Nitro 把 routeRules 的 proxy 目标编译进 `.output/server`，
// 运行期再设 NUXT_API_PROXY 已经晚了 —— 产物里会沿用构建时的那一个。
// 3000 是 api 的默认端口（apps/api/src/config/env.ts），所以这里是通用默认值；
// 但本机 3000 被另一个项目占着，本地栈必须构建前注入 3002
// （_acceptance/start-wanxing-stack.ps1），生产由 Dockerfile 的 ARG 注入 http://api:3000。
// 踩过的坑：本地 .output 用默认值构建 → web:3003 的 /v1/** 全部代理到别人服务上，
// 后台 10 个面板渲染正常、数据全 404，typecheck/lint 全绿。
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
  // admin.css 只作用于 #admin-root，复用 tokens 的字体/动效变量；
  // 放在最后，保证后台统一视觉能覆盖各面板 scoped 样式里复制的旧口径。
  css: [
    "~/assets/css/tokens.css",
    "~/assets/css/canvas.css",
    "~/assets/css/canvas-agent.css",
    "~/assets/css/admin.css",
  ],
  runtimeConfig: {
    public: {
      // 空 = 同源 /v1（本地由 NUXT_API_PROXY 代理，生产由 nginx 反代）
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? "",
      // 备案信息（合规必需）。**刻意走 runtimeConfig 而不是写进语言包**：
      // 备案号是行政批件，下发时间晚于代码冻结，且换主体/换号必须全站一致。
      // 写进 5 个语言包的话，每次换号都要改 5 个 JSON 再重新构建，且极易漏改某个语种
      // （N-01 就是这么来的：号写在 landing.footerNote 里，一个句子混了免责声明和后缀）。
      // 放这里则只有一处：前端统一从 runtimeConfig 读，语言包只留"标签"文案。
      // 空串 = 未下发，页脚不渲染该段（上线前必须由 env 注入，见 docs/06 上线清单）。
      icpBeian: process.env.NUXT_PUBLIC_ICP_BEIAN ?? "",
      icpPolice: process.env.NUXT_PUBLIC_ICP_POLICE ?? "",
      // 短信登录开关（2026-11-04 决策：不接短信网关）。空串 = 跟随构建环境：
      // dev/验收构建显示验证码 tab，生产构建默认隐藏，只剩邮箱+密码与微信占位。
      // 与后端 AUTH_SMS_ENABLED 同口径（后端关闭时两个入口都回 400101）。
      smsEnabled: process.env.NUXT_PUBLIC_SMS_ENABLED ?? "",
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
    // 第 132 批：竞品 /project-members（项目×成员绑定页），首帧来自登录态与 cam 接口
    "/project-members": { ssr: false },
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
    "/auth": { ssr: false },
    "/auth/**": { ssr: false },
    "/pricing": { ssr: false },
    // 法律义务展示页（docs/03-frontend/conventions.md §8 的「必须服务端渲染」清单）：
    // 用户协议、隐私政策、举报/投诉必须能被爬虫与审计直接抓到正文与标题，
    // 关掉 SSR 时 sitemap 列着它们、实际抓到的却是 SPA 骨架，声明与内容不一致。
    // 这三页已确认无 `window`/`localStorage`/`onMounted`/鉴权依赖，服务端渲染无风险。
    "/report": { ssr: true },
    "/privacy": { ssr: true },
    "/terms": { ssr: true },
    // 单点工具页（/create/*）同理：这些页面此前只在 `definePageMeta` 里写了 ssr:false，
    // 而直接打开/刷新 URL 时仍会走服务端渲染 → 与服务端未登录首帧不一致 →
    // hydration 失败后整页空白（本轮 E2E 实测：直接访问 /create/text-to-video 时
    // `#__nuxt` 不存在、body 仅 356 字节）。工具页全是"登录后才可用"的参数面板，
    // 关掉 SSR 是唯一正确解，不需要给它们做一套登录态 SSR 首帧。
    "/create": { ssr: false },
    "/create/**": { ssr: false },
    // ReelFlow 剪辑台（列表 + 编辑器）同一类"登录后才可用"的纯客户端页面：
    // 时间线/分镜数据全部来自登录态接口，服务端首帧必然与客户端不一致。
    // 剧本创作（2026-11-02 U9）：竞品 /script-manage 的对应页，首屏全来自登录态接口
    "/script": { ssr: false },
    // 第 132 批：竞品 /script-view/:id 的只读正文页（正文/分集来自 /projects/:id）
    "/script-view": { ssr: false },
    "/script-view/**": { ssr: false },
    "/reelflow": { ssr: false },
    "/reelflow/**": { ssr: false },
    // 新增三个"登录后才可用"的整页应用（第 2/4/5 批）：小说改编链、创作 Agent、影视版。
    // 与 /canvas、/reelflow 同类——首帧全部依赖登录态与接口数据，服务端渲染只会产
    // 生"服务端未登录 / 客户端已登录"的 hydration mismatch。按既有约定三处齐关。
    "/novel": { ssr: false },
    "/novel/**": { ssr: false },
    // 第 132 批：竞品 /novel-to-script-agent/workbench 的承接别名（跳 /novel）
    "/novel-to-script-agent": { ssr: false },
    "/novel-to-script-agent/**": { ssr: false },
    "/agent": { ssr: false },
    // Agent 子页（editor / bigscreen）：与 /admin/**、/team/** 同理，子路径必须单独列
    "/agent/**": { ssr: false },
    "/film": { ssr: false },
    // 影视版新建（竞品 /film-creation 的对应页）：独立顶层路由，必须单独登记
    "/film-creation": { ssr: false },
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
