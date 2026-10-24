<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const list = ref<ProjectDto[]>([]);
const total = ref(0);
const loading = ref(false);
const creating = ref(false);
const error = ref("");
const form = reactive({
  title: "",
  source_type: 1,
  ratio: "9:16",
  source_text: "",
});

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

async function create(): Promise<void> {
  error.value = "";
  if (!form.title.trim()) {
    error.value = "请输入项目名称";
    return;
  }
  creating.value = true;
  try {
    const project = await api.post<ProjectDto>("/projects", {
      title: form.title,
      source_type: form.source_type,
      ratio: form.ratio,
      source_text: form.source_text,
    });
    await navigateTo(`/projects/${project.id}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建失败";
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="page">
    <div class="head">
      <h1>剧本项目</h1>
      <span class="muted">共 {{ total }} 个</span>
    </div>

    <div class="layout">
      <section class="panel create">
        <h2>新建项目</h2>
        <label class="field">
          <span class="label">项目名称</span>
          <input v-model="form.title" class="input" maxlength="100" placeholder="例如：雨夜来信" />
        </label>
        <div class="grid">
          <label class="field">
            <span class="label">来源</span>
            <select v-model.number="form.source_type" class="input">
              <option :value="1">小说</option>
              <option :value="2">一句话想法</option>
              <option :value="3">导入剧本（拆集）</option>
            </select>
          </label>
          <label class="field">
            <span class="label">画幅</span>
            <select v-model="form.ratio" class="input">
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="label">素材 / 简介</span>
          <textarea
            v-model="form.source_text"
            class="input textarea"
            maxlength="50000"
            placeholder="粘贴小说章节、故事梗概或已有剧本"
          />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <Button :disabled="creating" @click="create">{{ creating ? "创建中…" : "创建并进入流水线" }}</Button>
      </section>

      <section class="panel">
        <h2>我的项目</h2>
        <p v-if="loading" class="muted">加载中…</p>
        <ul class="list">
          <li v-for="item in list" :key="item.id" class="item">
            <NuxtLink :to="`/projects/${item.id}`" class="item-main">
              <span class="title">{{ item.title }}</span>
              <span class="muted">
                {{ item.source_type === 1 ? "小说" : item.source_type === 2 ? "想法" : "剧本" }}
                · {{ item.ratio }} · {{ new Date(item.created_at).toLocaleDateString() }}
              </span>
            </NuxtLink>
          </li>
        </ul>
        <p v-if="!loading && list.length === 0" class="muted">还没有项目，先创建一个。</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.panel {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 20px;
}
h2 {
  margin: 0 0 12px;
  font-size: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.label {
  color: var(--text-2);
  font-size: 12px;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}
.textarea {
  min-height: 140px;
  resize: vertical;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 12px;
}
.item-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.title {
  font-size: 14px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
@media (max-width: 800px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
