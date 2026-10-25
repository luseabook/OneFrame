<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

// 项目页（对齐参照产品：顶部「项目 / 已导出」+ 空状态 + 底部悬浮「创建项目」）
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "项目 · 一帧" });

const api = useApi();
const router = useRouter();
const route = useRoute();

const list = ref<ProjectDto[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref("");
const showCreate = ref(false);
const tab = ref<"projects" | "exports">("projects");

const DRAMA_LABEL: Record<number, string> = {
  1: "国内仿真人剧",
  2: "海外仿真人剧",
  3: "2D/3D动漫",
};
// 封面按剧目类型给不同色相，保证卡片可区分
const DRAMA_COVER: Record<number, string> = {
  1: "linear-gradient(135deg, #3a2030, #16121c)",
  2: "linear-gradient(135deg, #14303e, #0e161c)",
  3: "linear-gradient(135deg, #2f1a44, #15101f)",
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=50");
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  showCreate.value = true;
}

function onCreated(project: ProjectDto): void {
  showCreate.value = false;
  void router.push(`/projects/${project.id}`);
}

onMounted(async () => {
  await load();
  // 侧栏「剧本创作」/首页入口：/projects?create=1 直接打开新建项目弹窗
  if (String(route.query.create ?? "") === "1") {
    showCreate.value = true;
    void router.replace("/projects");
  }
});
</script>

<template>
  <div class="projects-page">
    <nav class="tabs">
      <button type="button" class="tab" :class="{ active: tab === 'projects' }" @click="tab = 'projects'">
        项目
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'exports' }" @click="tab = 'exports'">
        已导出
      </button>
    </nav>

    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="tab === 'projects'">
      <Skeleton v-if="loading" :rows="4" />

      <div v-else-if="list.length" class="grid">
        <NuxtLink v-for="item in list" :key="item.id" :to="`/projects/${item.id}`" class="proj-card">
          <div class="cover" :style="{ background: DRAMA_COVER[item.drama_type] ?? DRAMA_COVER[1] }">
            <span class="ratio-chip">{{ item.ratio }}</span>
            <span v-if="item.is_sample" class="flag">示例</span>
            <span v-else-if="item.archived_at" class="flag muted">已归档</span>
            <span class="cover-title">{{ item.title }}</span>
          </div>
          <div class="body">
            <p class="title" :title="item.title">{{ item.title }}</p>
            <p class="meta">
              {{ DRAMA_LABEL[item.drama_type] ?? "短剧" }}
              <span class="sep">·</span>
              {{ new Date(item.created_at).toLocaleDateString("zh-CN") }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <div v-else class="empty">
        <span class="empty-art" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z" />
            <path d="M12 9.5v5.5M9.5 12H14.5" opacity="0.7" />
          </svg>
        </span>
        <p class="empty-text">点击下方创建一个新项目</p>
        <p v-if="total === 0" class="empty-hint">上传剧本或粘贴文本，AI 帮你拆集、定妆、出分镜</p>
      </div>
    </template>

    <div v-else class="empty exports">
      <span class="empty-art small" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5" />
          <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
        </svg>
      </span>
      <p class="empty-text">暂无导出记录</p>
      <p class="empty-hint">在项目流水线内完成分镜并导出后，成片记录会出现在这里</p>
    </div>

    <div class="fab-wrap">
      <button type="button" class="fab" @click="openCreate">
        <span class="fab-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        创建项目
      </button>
    </div>

    <CreateProjectModal v-model:open="showCreate" @created="onCreated" />
  </div>
</template>

<style scoped>
.projects-page {
  position: relative;
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 0 120px;
  min-height: calc(100vh - 160px);
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  gap: 28px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: 24px;
}

.tab {
  position: relative;
  padding: 10px 2px 12px;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.tab.active {
  color: var(--text-1);
}

.tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand-500);
}

.err {
  padding: 10px 14px;
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

.proj-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.15s, transform 0.15s;
}

.proj-card:hover {
  border-color: var(--border-3);
  transform: translateY(-2px);
}

.cover {
  position: relative;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: flex-end;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(#ffffff14 1px, transparent 1px);
  background-size: 12px 12px;
  -webkit-mask-image: linear-gradient(160deg, transparent 30%, #000);
  mask-image: linear-gradient(160deg, transparent 30%, #000);
}

.cover-title {
  position: relative;
  z-index: 1;
  color: #ffffffd0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ratio-chip {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: #00000066;
  color: #ffffffb0;
  font-size: 11px;
}

.flag {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--brand-500);
  color: #fff;
  font-size: 11px;
}

.flag.muted {
  background: #ffffff24;
  color: #ffffffc0;
}

.body {
  padding: 10px 14px 14px;
}

.title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
}

.sep {
  color: var(--border-3);
  margin: 0 4px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 420px;
  text-align: center;
}

.empty-art {
  width: 92px;
  height: 92px;
  color: #ffffff8a;
  filter: drop-shadow(0 10px 30px #7e70ff33);
}

.empty-art.small {
  width: 64px;
  height: 64px;
}

.empty-art svg {
  width: 100%;
  height: 100%;
}

.empty-text {
  margin: 6px 0 0;
  color: var(--text-2);
  font-size: 14px;
}

.empty-hint {
  margin: 0;
  color: var(--text-4);
  font-size: 12px;
}

.fab-wrap {
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 20;
}

.fab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 26px;
  border-radius: 999px;
  border: 1px solid #ffffff24;
  background: linear-gradient(180deg, #24242c, #19191f);
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 18px 40px #00000080;
}

.fab:hover {
  border-color: var(--brand-500);
}

.fab-icon {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  color: var(--brand-300);
}

.fab-icon svg {
  width: 100%;
  height: 100%;
}
</style>
