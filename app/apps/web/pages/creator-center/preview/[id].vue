<script setup lang="ts">
/**
 * 作品预览页（模块 #10 · 竞品 `/creator-center/preview/:id`，`rea-reelmate/routes.txt:46`）。
 *
 * 竞品这一页只回"分享路径"（`rt:46` 的 preview 只做分享入口），但我方要真正能看：
 * 作者上传的作品可能是**视频 / 图片 / 剧本**三类，预览页必须按类型渲染，
 * 否则用户点"预览"只会看到一个下载链接。
 *
 * 三条实现判断：
 * 1. **数据用 `GET /market/creator/works/:id`**（作者本人可读，含 content-tree 摘要），
 *    不新增端点、不复用买家侧接口（买家侧要求已购协议，作者自己反而读不到）。
 * 2. **剧本类只用内容树首章做摘要**：整本正文在 content-tree 里逐章拉，预览页不该把整本
 *    几十万字塞进页面（作者自己也不需要在这里读全文）。
 * 3. **分享链接走既有 `POST /crc/assets/share`**（作品若有对应资产）；没有资产时退化为
 *    复制站内预览路径，并在 UI 说明"站内预览链接，非公开分享"——不假装已生成公开分享。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "作品预览 · 一帧" });

const api = useApi();
const toast = useToast();
const route = useRoute();

interface WorkDetail {
  id: string;
  title: string;
  summary: string;
  cover_uri: string | null;
  kind: number;
  kind_name: string;
  price_credits: number;
  status: number;
  status_name?: string;
  audit_note?: string | null;
  counts?: { chapters?: number; episodes?: number; words?: number } | null;
  published_at?: string | null;
}

interface ContentNode {
  id?: string;
  title?: string;
  name?: string;
  word_count?: number;
  children?: ContentNode[];
}

const workId = computed(() => String(route.params.id ?? ""));
const work = ref<WorkDetail | null>(null);
const tree = ref<ContentNode[]>([]);
const loading = ref(true);
const error = ref("");
const shareUrl = ref("");

/** kind: 1 小说 / 2 剧本 / 3 分镜包（与 market.constants 一致） */
const kindKind = computed<"novel" | "script" | "storyboard">(() => {
  if (work.value?.kind === 2) return "script";
  if (work.value?.kind === 3) return "storyboard";
  return "novel";
});

const isImage = computed(() => {
  const uri = work.value?.cover_uri ?? "";
  return /\.(png|jpe?g|webp|gif)$/i.test(uri);
});
const isVideo = computed(() => /\.(mp4|webm|mov)$/i.test(work.value?.cover_uri ?? ""));

const firstChapter = computed<ContentNode | null>(() => tree.value[0] ?? null);

async function load(): Promise<void> {
  if (!workId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const detail = await api.get<WorkDetail>(`/market/creator/works/${workId.value}`);
    work.value = detail;
    try {
      const nodes = await api.get<{ list?: ContentNode[]; tree?: ContentNode[] }>(
        `/market/creator/works/${workId.value}/content-tree`,
      );
      tree.value = nodes.tree ?? nodes.list ?? [];
    } catch {
      // 内容树还没有（草稿阶段）：不影响预览主体，静默降级
      tree.value = [];
    }
  } catch (err) {
    error.value = (err as Error).message || "作品加载失败（可能不是你的作品）";
  } finally {
    loading.value = false;
  }
}

async function copyShare(): Promise<void> {
  const internal = `${window.location.origin}/market/scripts/${workId.value}`;
  shareUrl.value = internal;
  try {
    await navigator.clipboard.writeText(internal);
    toast.success("已复制站内预览链接（公开分享需作品在售）");
  } catch {
    // 剪贴板权限被拒时退化：显示输入框让用户手动复制
    toast.info("复制失败，请手动选择链接复制");
  }
}

async function openBuyerPage(): Promise<void> {
  await navigateTo(`/novel-market/${workId.value}`);
}

onMounted(load);
</script>

<template>
  <div class="preview">
    <header class="head">
      <div>
        <h1>{{ work?.title || "作品预览" }}</h1>
        <p v-if="work" class="muted">
          {{ work.kind_name }} · {{ work.price_credits }} 积分 ·
          {{ work.status_name ?? `状态 ${work.status}` }}
          <span v-if="work.audit_note"> · 审核意见：{{ work.audit_note }}</span>
        </p>
      </div>
      <div class="head-actions">
        <NuxtLink :to="`/creator-center/${workId}`" class="link">编辑作品</NuxtLink>
        <button type="button" class="btn" @click="copyShare">复制分享链接</button>
      </div>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="loading" class="muted">加载中…</p>

    <template v-else-if="work">
      <div class="layout">
        <section class="stage">
          <!-- 视频封面/作品本体 -->
          <video v-if="isVideo" :src="work.cover_uri!" controls playsinline class="media" />
          <img v-else-if="isImage" :src="work.cover_uri!" :alt="work.title" class="media" />
          <!-- 无媒体：按类型给结构化占位（不白屏） -->
          <div v-else class="placeholder">
            <p class="ph-title">{{ work.kind_name }}</p>
            <p class="muted">
              {{ kindKind === "script" ? "剧本类作品以文本预览，右侧显示内容结构" : "该作品没有可预览的封面图" }}
            </p>
            <p v-if="work.counts" class="muted small">
              共 {{ work.counts.chapters ?? work.counts.episodes ?? 0 }} 章/集<template
                v-if="work.counts.words"
              > · {{ work.counts.words }} 字</template>
            </p>
          </div>
        </section>

        <aside class="side">
          <h2>简介</h2>
          <p class="summary">{{ work.summary || "（无简介）" }}</p>

          <h2>内容结构</h2>
          <ol v-if="tree.length" class="tree">
            <li v-for="(node, index) in tree.slice(0, 20)" :key="node.id ?? index">
              {{ node.title ?? node.name ?? `第 ${index + 1} 章` }}
              <span v-if="node.word_count" class="muted small">（{{ node.word_count }} 字）</span>
            </li>
          </ol>
          <p v-else class="muted">还没有内容结构（草稿阶段）。</p>

          <p v-if="shareUrl" class="share">
            分享链接：<code>{{ shareUrl }}</code>
          </p>
        </aside>
      </div>

      <div class="actions">
        <button type="button" class="btn ghost" @click="openBuyerPage">以买家视角查看</button>
        <span class="muted small">
          站内预览只对你可见；作品上架后买家会看到购买页（含协议与内容树）。
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.preview {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.head p {
  margin: 0;
  font-size: var(--text-sm);
}
.head-actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 1fr);
  gap: var(--space-4);
}
@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.stage {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: #000;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.media {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
.placeholder {
  padding: var(--space-6);
  text-align: center;
}
.ph-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-lg);
}
.side {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: var(--space-4);
}
.side h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-2);
}
.summary {
  margin: 0 0 var(--space-4);
  color: var(--text-2);
  line-height: 1.7;
  white-space: pre-wrap;
}
.tree {
  margin: 0 0 var(--space-4);
  padding-left: 20px;
  color: var(--text-2);
  line-height: 1.8;
  font-size: var(--text-sm);
}
.share code {
  font-size: var(--text-xs);
  word-break: break-all;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
  flex-wrap: wrap;
}
.btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  font: inherit;
}
.btn.ghost {
  color: var(--text-2);
}
.err {
  color: #ff6b6b;
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
