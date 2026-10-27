<script setup lang="ts">
// 根布局：全站深色（与竞品 ReelMate 一致），按路由切换壳层
// default = 公共页（落地/登录/协议），app = 工作台壳，tool = 生成工具（独立双栏，无侧栏）
// admin = 运营后台专用壳层（与用户端菜单/积分/页脚完全隔离）
// blank = 裸壳（画布族：列表 + 编辑器，全屏无侧栏无顶栏）
const route = useRoute();

const workspacePaths = [
  "/home",
  "/works",
  "/projects",
  "/tools",
  "/assets",
  "/tasks",
  "/credits",
  "/settings",
  "/pricing",
  // 2026-10-27：以下四页都是「登录后的工作台类页面」，必须走 app 壳。
  // 之前它们不在这份白名单里 → 落在 default 营销壳（顶栏「定价/进入工作台」+ 页脚），
  // 功能是全通的，只有壳不对（/team 自 v2.6 起就是这个问题，本轮 film 验收时发现）。
  // 约定：新增整页工作台时，**页面文件 + nuxt.config routeRules + 本白名单** 三处一起加，
  // 少一处就会出现「能点开但套错壳」或「直接打开白屏」。
  "/team",
  "/novel",
  "/agent",
  "/film",
  // 2026-10-27（第 2 轮）：第 6 批生态页
  "/novel-market",
  "/knowledge",
  // 第 6 批 A：创作者中心 / 活动 / 邀请返利（都是登录后工作台类页面）
  "/creator-center",
  "/activities",
  "/invite",
  // 第 3 轮：广告剧 / 视频转绘（登录后整页工作台）
  "/ad-drama",
  "/video-redraw",
];
const adminPaths = ["/admin"];
const adminLoginPaths = ["/admin/login"];
const toolPaths = ["/create"];
// 画布族走裸壳：/canvas 列表与 /canvas/:id 编辑器都是全屏界面。
// 不能并进 workspacePaths——那会套上 app 壳的 240px 侧栏 + 64px 顶栏，
// 编辑器 100dvh 的世界坐标与框选范围会被挤变形（参照站 /canvas 同样无侧栏）。
// ReelFlow 剪辑台同理：三区布局（左栏 290 + 播放器 + 底部时间线 150）是固定视口高，
// 套上 240 侧栏 + 64 顶栏后播放区只剩不到 500px 宽，与竞品实测（1424 视口铺满）差太远。
const blankPaths = ["/canvas", "/reelflow"];
// 落地页自带独立导航与页脚（含法务入口与 ICP），不再套公共壳层，避免出现两层顶栏/两层页脚
const barePaths = ["/"];

function matchAny(paths: string[]): boolean {
  return paths.some((p) => route.path === p || route.path.startsWith(`${p}/`));
}

const layoutName = computed(() => {
  if (matchAny(barePaths)) return "";
  // 画布族必须在 workspacePaths 之前判定：虽然目前 /canvas 不在 workspacePaths 里，
  // 但后续若有人把画布入口并进工作台菜单，提前命中能保证编辑器不会被套上侧栏。
  if (matchAny(blankPaths)) return "blank";
  if (matchAny(adminLoginPaths)) return "admin-login";
  if (matchAny(adminPaths)) return "admin";
  if (matchAny(toolPaths)) return "tool";
  if (matchAny(workspacePaths)) return "app";
  return "default";
});
</script>

<template>
  <div class="theme-dark">
    <NuxtLayout v-if="layoutName" :name="layoutName">
      <NuxtPage />
    </NuxtLayout>
    <NuxtPage v-else />
    <ToastHost />
  </div>
</template>

<style>
html,
body {
  background: var(--bg-app);
}
.theme-dark,
.theme-dark body {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-1);
}
</style>
