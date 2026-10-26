<script setup lang="ts">
// 工具箱：对齐参照产品工具箱页（tools.png）
// 标题 + 分类 Tab + 右上「工具箱创作资产」入口 + 4 列工具卡片（两行均分竖向空间）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "工具箱 · 一帧" });

type Tool = {
  label: string;
  desc: string;
  to?: string;
  cat: "video" | "image" | "audio";
};

/**
 * 工具箱卡片集
 *
 * 口径：照着参照站工具箱的卡片集来（`tools.png` + `routes.txt` 的 17 条 `/create/*`，
 * 外加「灵感成片」这条没有独立路由的 Agent 工具）。
 * 卡片数量先对齐，能点进哪一张由 `to` 决定——**不做空壳页面**：
 * 没有落地页的卡片是静默态，点了只提示"开发中"（参照站同类入口也是置灰）。
 */
const tools: Tool[] = [
  // AI 视频
  { label: "文生视频", desc: "主流高质量模型，风格、动作轻松…", to: "/create/text-to-video", cat: "video" },
  { label: "图生视频", desc: "一键让静态图动出电影感", to: "/create/image-to-video", cat: "video" },
  { label: "视频对口型", desc: "视频对口型一键搞定，唇形贴合超…", cat: "video" },
  { label: "参考生视频", desc: "多图参考，让画面自然动起来", to: "/create/reference-to-video", cat: "video" },
  { label: "视频参考", desc: "照着参考视频的运镜与节奏再创作", cat: "video" },
  { label: "灵感成片", desc: "Agent 智能规划，从创意到完整短片", cat: "video" },
  { label: "视频超清", desc: "AI 重建高清细节，影视工业级画质…", cat: "video" },
  { label: "视频续写", desc: "AI 延续创作灵感，让故事无限精彩…", cat: "video" },
  { label: "视频编辑", desc: "多模态智能编辑，自由修改视频内容", cat: "video" },
  { label: "视频特效", desc: "一键套用电影级特效与转场", cat: "video" },
  // AI 图片
  { label: "文生图", desc: "一句话出图，风格与画质随心控制", to: "/create/text-to-image", cat: "image" },
  { label: "图生图", desc: "参考图打底，重绘出新的画面", to: "/create/image-to-image", cat: "image" },
  { label: "涂抹重绘", desc: "圈出要改的地方，局部重绘", cat: "image" },
  { label: "文字重绘", desc: "保留画面结构，替换其中的文字", cat: "image" },
  // AI 音频
  { label: "文生语音", desc: "多音色配音，情绪与语速可控", cat: "audio" },
  { label: "文生音乐", desc: "按描述生成配乐，风格与时长可选", cat: "audio" },
  { label: "文生音效", desc: "环境声、动作声一键生成", cat: "audio" },
  { label: "自动配乐", desc: "成片自动匹配 BGM 与节奏点", cat: "audio" },
];

const tabs = [
  { key: "all", label: "全部" },
  { key: "video", label: "AI视频" },
  { key: "image", label: "AI图片" },
  { key: "audio", label: "AI音频" },
] as const;
const active = ref<(typeof tabs)[number]["key"]>("all");
const shown = computed(() => (active.value === "all" ? tools : tools.filter((t) => t.cat === active.value)));

const showTip = ref(true);
const router = useRouter();
const toast = useToast();

function openTool(t: Tool): void {
  if (t.to) void router.push(t.to);
  else toast.info(`${t.label}正在开发中，敬请期待`);
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>工具箱</h1>
      <div class="head-right">
        <div v-if="showTip" class="tip">
          <button class="tip-close" type="button" aria-label="关闭提示" @click="showTip = false">✕</button>
          <p class="tip-title">工具箱创作资产</p>
          <p class="tip-text">使用工具箱功能生成的所有历史资源，都可以在这里查看。</p>
        </div>
        <NuxtLink to="/assets" class="asset-btn">工具箱创作资产</NuxtLink>
      </div>
    </header>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ on: active === t.key }"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <div v-if="shown.length" class="grid">
      <button
        v-for="t in shown"
        :key="t.label"
        type="button"
        class="tool-card"
        :class="{ muted: !t.to }"
        @click="openTool(t)"
      >
        <h3>{{ t.label }}</h3>
        <p>{{ t.desc }}</p>
      </button>
    </div>
    <EmptyState v-else title="该分类暂无工具" description="该分类暂未开放工具，敬请期待" style="margin-top: 80px" />
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 64px);
  padding: 28px 32px 40px;
  box-sizing: border-box;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.head-right {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.tip {
  position: relative;
  max-width: 280px;
  padding: 10px 30px 10px 14px;
  border-radius: 8px;
  background: #2c1d63;
  color: #d9d2ff;
}

.tip-close {
  position: absolute;
  top: 6px;
  right: 8px;
  border: 0;
  background: transparent;
  color: #b9aeff;
  font-size: 11px;
  cursor: pointer;
}

.tip-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: #b9aeff;
}

.tip-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.85;
}

.asset-btn {
  flex: 0 0 auto;
  height: 34px;
  display: inline-flex;
  align-items: center;
  padding: 0 18px;
  border-radius: 8px;
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.asset-btn:hover {
  background: var(--brand-600);
}

.tabs {
  display: flex;
  gap: 6px;
  margin: 22px 0 0;
}

.tab {
  height: 34px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text-1);
}

.tab.on {
  background: var(--bg-raised);
  color: var(--text-1);
  font-weight: 600;
}

.grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  gap: 24px 32px;
  padding: 24px 0 0;
}

.tool-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: 84px;
  padding: 16px 22px;
  border-radius: 16px;
  border: 0;
  background: linear-gradient(180deg, #060608, #020203);
  text-align: left;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.tool-card:hover {
  background: linear-gradient(180deg, #0d0d12, #050507);
  transform: translateY(-1px);
}

h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
}

.tool-card p {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card.muted {
  cursor: default;
  opacity: 0.72;
}

.tool-card.muted:hover {
  background: linear-gradient(180deg, #060608, #020203);
  transform: none;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
  }
  .head {
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .page {
    padding: 18px 16px 32px;
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .head-right {
    flex-direction: column;
  }
}
</style>
