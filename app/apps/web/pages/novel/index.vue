<script setup lang="ts">
import type { NovelDto, NovelListDto } from "~/types/api";

/**
 * 小说改编链 · 本子列表（`/novel`）。
 *
 * 对照竞品 `/novel-to-script-agent/workbench` + `/script-manage` 的"剧本库"入口
 * （`rea-reelmate/routes.txt:62-66`、`docs/01-product/reelmate-feature-map.md:261`）：
 * 竞品的改编入口是"上传小说 → 建本子 → 进工作台"，本子本身在剧本库里按状态分 tab。
 *
 * 三态齐备（brief §4 硬要求）：
 * - 加载：Skeleton（不是空白屏）
 * - 空态：EmptyState + 明确下一步（粘贴小说 / 上传文件）
 * - 错误：红色条 + 重试按钮（不是"点了没反应"）
 *
 * 粘贴与上传走的是同一条路：都得到一份纯文本 `source_text`，
 * 交给 `POST /novel` 在服务端"上传即分章"（对齐竞品 analyze 入口的任务语义）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "剧本工厂 · 一帧" });

const api = useApi();
const toast = useToast();
const router = useRouter();

type Tab = "all" | "draft" | "finalized" | "archived";
const tab = ref<Tab>("all");
const list = ref<NovelDto[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref("");

const STATUS_LABEL: Record<number, string> = { 1: "草稿", 16: "已定稿" };
const SOURCE_LABEL: Record<number, string> = {
  1: "小说改编",
  2: "想法起稿",
  3: "导入剧本",
  4: "创意裂变",
  5: "海外改编",
};

function queryOf(next: Tab): string {
  const params = new URLSearchParams({ page: "1", page_size: "48" });
  if (next === "draft") params.set("status", "1");
  if (next === "finalized") params.set("status", "16");
  if (next === "archived") params.set("archived", "1");
  return params.toString();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.get<NovelListDto>(`/novel/list?${queryOf(tab.value)}`);
    list.value = data.list ?? [];
    total.value = data.total ?? 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(tab, () => void load());

// ── 新建本子 ─────────────────────────────────────────────────
const showCreate = ref(false);
const creating = ref(false);
const form = reactive({ title: "", ratio: "9:16" as "9:16" | "16:9", source_text: "" });
const fileName = ref("");
const parsing = ref(false);

const canCreate = computed(() => form.title.trim().length > 0 && form.source_text.trim().length > 0 && !creating.value);

function openCreate(): void {
  form.title = "";
  form.ratio = "9:16";
  form.source_text = "";
  fileName.value = "";
  showCreate.value = true;
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  parsing.value = true;
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    // 复用已有的解析端点（txt/md/docx/xlsx），不在前端重写一份解析器
    const parsed = await api.post<{ text: string; chars: number; truncated: boolean; warnings: string[] }>(
      "/projects/parse-script",
      { file_name: file.name, file_base64: base64 },
    );
    form.source_text = parsed.text;
    fileName.value = file.name;
    if (!form.title.trim()) form.title = file.name.replace(/\.[^.]+$/, "").slice(0, 200);
    if (parsed.truncated) toast.info(`文本超过上限，已截断到 ${parsed.chars} 字`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "文件解析失败");
  } finally {
    parsing.value = false;
    input.value = "";
  }
}

async function create(): Promise<void> {
  if (!canCreate.value) return;
  creating.value = true;
  try {
    const novel = await api.post<NovelDto>("/novel", {
      title: form.title.trim(),
      ratio: form.ratio,
      source_text: form.source_text,
      source_file_name: fileName.value || undefined,
    });
    toast.success(`已创建并解析 ${novel.chapter_count ?? 0} 章`);
    showCreate.value = false;
    await router.push(`/novel/${novel.id}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "创建失败");
  } finally {
    creating.value = false;
  }
}

function open(item: NovelDto): void {
  void router.push(`/novel/${item.id}`);
}

function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(() => void load());
</script>

<template>
  <div class="novel-list">
    <header class="head">
      <div class="head__text">
        <h1>剧本工厂</h1>
        <p>粘贴或上传小说 → 分章 → 内容分析 → 大纲 → 剧本 → 编辑 Agent 逐集定稿</p>
      </div>
      <Button data-testid="novel-create" @click="openCreate">新建剧本</Button>
    </header>

    <nav class="tabs">
      <button type="button" :class="{ on: tab === 'all' }" @click="tab = 'all'">全部 ({{ tab === "all" ? total : "·" }})</button>
      <button type="button" :class="{ on: tab === 'draft' }" @click="tab = 'draft'">草稿</button>
      <button type="button" :class="{ on: tab === 'finalized' }" @click="tab = 'finalized'">已定稿</button>
      <button type="button" :class="{ on: tab === 'archived' }" @click="tab = 'archived'">已归档</button>
    </nav>

    <p v-if="error" class="err">
      {{ error }}
      <button type="button" class="err__retry" @click="load">重试</button>
    </p>

    <div class="body">
      <Skeleton v-if="loading" :rows="4" />

      <div v-else-if="list.length" class="grid">
        <article
          v-for="item in list"
          :key="item.id"
          class="card"
          :data-novel-id="item.id"
          role="button"
          tabindex="0"
          @click="open(item)"
          @keydown.enter="open(item)"
        >
          <div class="card__top">
            <span class="badge" :class="{ done: item.status === 16 }">
              {{ STATUS_LABEL[item.status] ?? `状态${item.status}` }}
            </span>
            <span class="card__source">{{ SOURCE_LABEL[item.source_type] ?? "改编" }}</span>
            <span class="card__ratio">{{ item.ratio }}</span>
          </div>
          <p class="card__title" :title="item.title">{{ item.title }}</p>
          <p class="card__meta">
            <span>{{ item.episode_count }} 集</span>
            <span class="dot">·</span>
            <span>{{ fmtDate(item.updated_at) }}</span>
          </p>
          <p v-if="item.archived_at" class="card__archived">已归档 · {{ fmtDate(item.archived_at) }}</p>
        </article>
      </div>

      <EmptyState
        v-else
        icon="✎"
        title="还没有剧本项目"
        description="粘贴一段小说正文（或上传 txt / docx），系统会自动按「第N章」切分，然后逐步生成世界观、角色卡、章节大纲与分集剧本。"
      >
        <Button @click="openCreate">新建第一个剧本</Button>
      </EmptyState>
    </div>

    <!-- 新建弹窗：粘贴 / 上传同一条路（都得到纯文本，服务端做分章） -->
    <Modal :open="showCreate" title="新建剧本" width="620px" @close="showCreate = false">
      <div class="form">
        <TextField v-model="form.title" label="剧本名称" placeholder="例如：雨夜当票" :maxlength="200" />
        <div class="form__row">
          <label class="form__label">画面比例</label>
          <div class="segmented">
            <button type="button" :class="{ on: form.ratio === '9:16' }" @click="form.ratio = '9:16'">9:16 竖屏</button>
            <button type="button" :class="{ on: form.ratio === '16:9' }" @click="form.ratio = '16:9'">16:9 横屏</button>
          </div>
        </div>
        <div class="form__upload">
          <label class="upload">
            <input type="file" accept=".txt,.md,.docx,.xlsx" :disabled="parsing" @change="onFile" />
            <span>{{ parsing ? "解析中…" : "上传小说文件（txt / md / docx）" }}</span>
          </label>
          <span v-if="fileName" class="form__file">{{ fileName }}</span>
        </div>
        <TextAreaField
          v-model="form.source_text"
          label="小说正文"
          :rows="10"
          :maxlength="50000"
          placeholder="把小说正文粘贴到这里（上限 5 万字）。含「第N章」标题会自动按章切分。"
          hint="创建时会立刻完成分章；之后可以随时在详情页重新分章。"
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="showCreate = false">取消</Button>
        <Button :disabled="!canCreate" :loading="creating" @click="create">创建并分章</Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.novel-list {
  min-height: 100dvh;
  background: var(--bg-app);
  padding: 20px 28px 60px;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.head__text h1 {
  margin: 0 0 6px;
  color: var(--text-1);
  font-size: 20px;
}
.head__text p {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-1);
  margin-bottom: 16px;
}
.tabs button {
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.tabs button.on {
  background: var(--bg-raised);
  color: var(--text-1);
}
.err {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-sm);
  display: flex;
  align-items: center;
  gap: 10px;
}
.err__retry {
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  font-size: var(--text-xs);
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.card {
  padding: 14px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-1);
  background: var(--bg-surface);
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    transform var(--duration-fast);
}
.card:hover {
  border-color: var(--brand-border);
  transform: translateY(-2px);
}
.card__top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.badge {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: var(--text-xs);
}
.badge.done {
  background: var(--success-bg);
  color: var(--success);
  border-color: #1d5c3c;
}
.card__source {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.card__ratio {
  margin-left: auto;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.card__title {
  margin: 0 0 6px;
  color: var(--text-1);
  font-size: var(--text-base);
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card__meta {
  margin: 0;
  display: flex;
  gap: 6px;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.dot {
  color: var(--border-3);
}
.card__archived {
  margin: 6px 0 0;
  color: var(--warning);
  font-size: var(--text-xs);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form__row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.form__label {
  color: var(--text-2);
  font-size: var(--text-sm);
}
.segmented {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
}
.segmented button {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  font-size: var(--text-xs);
  cursor: pointer;
}
.segmented button.on {
  background: var(--brand-soft);
  color: var(--text-1);
}
.form__upload {
  display: flex;
  align-items: center;
  gap: 10px;
}
.upload {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-2);
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
}
.upload input {
  display: none;
}
.form__file {
  color: var(--text-4);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>


