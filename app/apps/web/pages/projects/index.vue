<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "全部项目 · 一帧" });

const api = useApi();
const toast = useToast();
const router = useRouter();

const list = ref<ProjectDto[]>([]);
const total = ref(0);
// 初始为 true：SSR 与客户端首帧都渲染骨架屏，避免结构差异（与作品库一致）
const loading = ref(true);
const creating = ref(false);
const error = ref("");
const showCreate = ref(false);
const form = reactive({
  title: "",
  source_type: 1,
  ratio: "9:16",
  source_text: "",
});

const SOURCE_LABEL: Record<number, string> = { 1: "小说", 2: "一句话想法", 3: "导入剧本", 4: "裂变" };

// SelectField 以字符串 v-model 工作，这里与数字型 source_type 双向桥接
const sourceTypeStr = computed({
  get: () => String(form.source_type),
  set: (v: string) => {
    form.source_type = Number(v) || 1;
  },
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
    toast.success("项目已创建");
    await navigateTo(`/projects/${project.id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "创建失败";
    error.value = msg;
    toast.error(msg);
  } finally {
    creating.value = false;
  }
}

function resetAndClose(): void {
  showCreate.value = false;
  form.title = "";
  form.source_text = "";
  form.source_type = 1;
  form.ratio = "9:16";
  error.value = "";
}

onMounted(load);
</script>

<template>
  <div class="projects">
    <header class="head">
      <div>
        <h1>全部项目</h1>
        <p class="sub">
          <template v-if="!loading">共 {{ total }} 个项目 · </template>从一句话或一部小说开始
        </p>
      </div>
      <div class="actions">
        <Button variant="ghost" size="sm" @click="router.push('/works')">按作品查看</Button>
        <Button size="sm" @click="showCreate = true">+ 新建项目</Button>
      </div>
    </header>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="4" />

      <template v-else>
        <div v-if="list.length" class="grid">
          <NuxtLink v-for="item in list" :key="item.id" :to="`/projects/${item.id}`" class="proj-card">
            <div class="cover">
              <span class="ratio">{{ item.ratio }}</span>
            <Tag v-if="item.is_sample" class="sample-tag" tone="brand" size="sm">示例</Tag>
            <Tag v-else-if="item.archived_at" class="sample-tag" tone="neutral" size="sm">已归档</Tag>
          </div>
          <div class="body">
            <p class="title" :title="item.title">{{ item.title }}</p>
            <p class="meta">
              {{ SOURCE_LABEL[item.source_type] ?? "其他" }}
              <span class="sep">·</span>
              {{ new Date(item.created_at).toLocaleDateString("zh-CN") }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <EmptyState
        v-else
        icon="▤"
        title="还没有项目"
        description="粘贴一部小说或写一句话想法，AI 会拆成 3~6 集并生成分镜。"
      >
        <Button @click="showCreate = true">新建第一个项目</Button>
      </EmptyState>
    </template>

    <Modal :open="showCreate" title="新建项目" width="560px" @close="resetAndClose">
      <div class="form">
        <TextField v-model="form.title" label="项目名称" placeholder="例如：雨夜来信" :maxlength="100" required />
        <div class="row-2">
          <SelectField
            v-model="sourceTypeStr"
            label="来源"
            :options="[
              { value: '1', label: '小说' },
              { value: '2', label: '一句话想法' },
              { value: '3', label: '导入剧本（拆集）' },
            ]"
          />
          <SelectField
            v-model="form.ratio"
            label="画幅"
            :options="[
              { value: '9:16', label: '9:16 竖屏' },
              { value: '16:9', label: '16:9 横屏' },
            ]"
          />
        </div>
        <TextAreaField
          v-model="form.source_text"
          label="素材 / 简介"
          placeholder="粘贴小说章节、故事梗概或已有剧本（≤5 万字）"
          :maxlength="50000"
          :rows="6"
          hint="可留空，稍后在流水线中补充"
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="resetAndClose">取消</Button>
        <Button :disabled="creating" :loading="creating" @click="create">
          {{ creating ? "创建中" : "创建并进入流水线" }}
        </Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.projects {
  max-width: 1280px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.head h1 {
  font-size: var(--text-2xl);
  font-weight: 700;
}
.sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.err {
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
.proj-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.proj-card:hover {
  border-color: var(--border-3);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.cover {
  position: relative;
  aspect-ratio: 16 / 10;
  background: linear-gradient(135deg, var(--bg-sunken), var(--bg-hover));
  display: grid;
  place-items: center;
}
.ratio {
  color: var(--text-4);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.sample-tag {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
}
.body {
  padding: var(--space-3) var(--space-4) var(--space-4);
}
.title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-card:hover .title {
  color: var(--brand-600);
}
.meta {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.sep {
  color: var(--border-3);
  margin: 0 3px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
</style>
