<script setup lang="ts">
// 工具箱：1:1 对齐竞品 ReelMate 工具箱页（tools.png）
// 结构：标题 + 分类 Tab + 工具卡片网格（4 列）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "工具箱 · 一帧" });

type Tool = {
  label: string;
  desc: string;
  to?: string;
  cat: "video" | "image" | "audio";
  enabled?: boolean;
};

const tools: Tool[] = [
  { label: "文生视频", desc: "主流高质量模型，风格、动作轻松拿捏", to: "/create/text-to-video", cat: "video", enabled: true },
  { label: "图生视频", desc: "一键让静态图动出电影感", to: "/create/image-to-video", cat: "video", enabled: true },
  { label: "剧本创作", desc: "小说到分镜流水线，角色全程一致", to: "/projects", cat: "video", enabled: true },
  { label: "视频对口型", desc: "视频对口型一键搞定，唇形贴合超自然", cat: "video" },
  { label: "参考生视频", desc: "多图参考，让画面自然动起来", cat: "video" },
  { label: "灵感成片", desc: "Agent 智能规划，从创意到完整短片", cat: "video" },
  { label: "视频超清", desc: "AI 重建高清细节，影视工业级画质", cat: "video" },
  { label: "视频续写", desc: "AI 延续创作灵感，让故事无限精彩", cat: "video" },
];

const tabs = [
  { key: "all", label: "全部" },
  { key: "video", label: "AI视频" },
  { key: "image", label: "AI图片" },
  { key: "audio", label: "AI音频" },
] as const;
const active = ref<(typeof tabs)[number]["key"]>("all");
const shown = computed(() => (active.value === "all" ? tools : tools.filter((t) => t.cat === active.value)));
</script>

<template>
  <main class="page">
    <h1>工具箱</h1>
    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ on: active === t.key }"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <div v-if="shown.length" class="grid">
      <component
        :is="t.enabled ? 'NuxtLink' : 'div'"
        v-for="t in shown"
        :key="t.label"
        :to="t.to"
        class="tool-card"
        :class="{ disabled: !t.enabled }"
      >
        <span v-if="!t.enabled" class="soon">即将上线</span>
        <h3>{{ t.label }}</h3>
        <p>{{ t.desc }}</p>
      </component>
    </div>
    <EmptyState v-else title="该分类暂无工具" description="图片与音频工具正在开发中，敬请期待" style="margin-top: 80px" />
  </main>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px 32px 64px;
}
h1 {
  margin: 8px 0 20px;
  font-size: 24px;
  font-weight: 700;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 28px;
}
.tab {
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
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
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
.tool-card {
  position: relative;
  min-height: 104px;
  padding: 22px 24px;
  border-radius: var(--radius-xl);
  background: var(--bg-sunken);
  border: 1px solid transparent;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
.tool-card:not(.disabled):hover {
  border-color: #7e70ff59;
  transform: translateY(-2px);
}
.tool-card.disabled {
  opacity: 0.8;
}
.soon {
  position: absolute;
  top: 12px;
  right: 14px;
  font-size: 11px;
  color: var(--text-4);
}
h3 {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
}
p {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1080px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
