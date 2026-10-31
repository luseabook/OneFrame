<script setup lang="ts">
import type { ToolCardDto } from "~/types/api";

/**
 * 工具箱封面卡（TB1）。
 *
 * 为什么是**程序化渐变封面**而不是封面图：
 * 1. `ToolCardDto` 目前没有 `cover_url` 字段（`types/api.ts` 只有 key/title/desc/category/route…），
 *    要凑 20 张卡就得新增 20 张摄影级素材；竞品封面是真人/实拍剧照，无授权不可复制。
 * 2. 实拍高光图在 `#0A0A0E` 底上会"打洞"，竞品靠极重的底部渐变压住才成立；渐变封面没有这个问题。
 * 3. 零体积、可确定性生成、随 i18n 与后端增删卡自动增减。
 *
 * 色阶全部取自竞品调色板（紫/青/橙/绿/品红），不引入体系外色相。
 * 后端补 `cover_url` 后，只要把 `.card-cover` 换成 `background-image:url(...)`，DOM 结构不用动。
 */
const props = defineProps<{ card: ToolCardDto }>();

type Accent = { from: string; to: string };
const ACCENTS: readonly Accent[] = [
  { from: "#9b46ff", to: "#6b5cff" }, // iris
  { from: "#22b8cf", to: "#1c7ed6" }, // ice-blue
  { from: "#ff922b", to: "#f76707" }, // sunset-orange
  { from: "#12b886", to: "#0ca678" }, // polar-green
  { from: "#f06595", to: "#cc5de8" }, // magenta
];

/**
 * 用稳定的 `card.key` 做散列（31 进制 + murmur 末混淆），**绝不用数组下标**：
 * 下标会让"后端新增一张卡"把后面所有卡的颜色全部换掉，用户会以为进错了页面。
 * 末混淆不能省：`h*31+c` 的低位对"相邻 key"几乎不变化，直接 `% 5` 会让
 * 相邻的卡（"文生视频/图生视频"）落在同一个色相上，出现整片同色。
 */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

const accent = computed<Accent>(() => ACCENTS[hashKey(props.card.key) % ACCENTS.length] ?? ACCENTS[0]!);

/**
 * 封面三层叠色（顺序 = 绘制顺序：第一层在最上）：
 * 1. 极淡的斜向高光——让平面渐变读作"被光打过的封面"，而不是纯色卡；
 * 2. 左上角品牌色光斑；
 * 3. 底色渐变。
 * 高光必须在 scrim 之下（scrim 是后面的兄弟节点），否则会冲淡底部文字对比度。
 */
const coverStyle = computed(() => ({
  backgroundImage: [
    "linear-gradient(115deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 42%)",
    `radial-gradient(120% 90% at 12% 0%, ${accent.value.from}59 0%, transparent 62%)`,
    `linear-gradient(30deg, ${accent.value.from} 0%, ${accent.value.to} 100%)`,
  ].join(", "),
}));

/** 图标按分类给（video/image/audio），是服务端数据驱动的，前端不写死卡清单 */
const iconKind = computed<"video" | "image" | "audio">(() => props.card.category);
</script>

<template>
  <NuxtLink :to="card.route" class="tool-card">
    <span class="card-cover" :style="coverStyle" aria-hidden="true" />
    <span class="card-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <template v-if="iconKind === 'video'">
          <rect x="3" y="5" width="13" height="14" rx="2.5" />
          <path d="m9.5 9 4 3-4 3ZM19 8.5v7M21.5 10v4" />
        </template>
        <template v-else-if="iconKind === 'image'">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m5 17 4.5-4 3 2.5L16 12l3 5" />
        </template>
        <template v-else-if="iconKind === 'audio'">
          <path d="M4 10v4M8 6v12M12 8v8M16 5.5v13M20 10v4" />
        </template>
        <template v-else>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </template>      </svg>
    </span>
    <span class="card-scrim" aria-hidden="true" />
    <span class="card-text">
      <span class="card-title">{{ card.title }}</span>
      <span class="card-desc">{{ card.desc }}</span>
    </span>
  </NuxtLink>
</template>

<style scoped>
/* TB1：竞品卡是 212×212 正方形（tools-recheck.png 列 x266–477 / 407–618 …，行高 212），
   圆角 12、无描边、封面铺满 + 底部渐变压字。 */
.tool-card {
  position: relative;
  display: block;
  aspect-ratio: 1 / 1;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid transparent;
  text-decoration: none;
  color: inherit;
  /* 竞品默认过渡时长/曲线（--default-transition-duration .15s / cubic-bezier(.4,0,.2,1)） */
  transition:
    transform 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
/* 内阴影 vignette：四周压暗 42%，把"色卡"变成"封面"（照片四角天然衰减）；
   不遮文字——它在 .card-cover 自身上，文字层是后面的兄弟节点。 */
.card-cover {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 90px rgba(6, 6, 8, 0.42);
}
.card-icon {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 44px;
  height: 44px;
  color: #ffffff;
  opacity: 0.9;
  /* 让线条从渐变上"浮"起来，贴近竞品封面里的白色主体 */
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
}
.card-icon svg {
  width: 44px;
  height: 44px;
}
/* 底部渐变压字层：不压暗的话浅色渐变上的白字对比度不够。
   起点 34%、最深端 .92——保证 12px 描述在任一色相（含亮橙）上都过 4.5:1。 */
.card-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 34%, rgba(6, 6, 8, 0.92) 100%);
}
.card-text {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.card-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  color: #ffffff;
}
.card-desc {
  font-size: 12px;
  line-height: 1.4;
  color: #f5f8ff99;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
.tool-card:hover {
  transform: translateY(-2px);
  border-color: #ffffff1f;
}
@media (prefers-reduced-motion: reduce) {
  .tool-card {
    transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .tool-card:hover {
    transform: none;
  }
}
</style>
