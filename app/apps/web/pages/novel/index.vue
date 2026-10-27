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
const { t, locale } = useI18n();
useHead({ title: () => t("novel.metaTitle") });

const api = useApi();
const toast = useToast();
const router = useRouter();

type Tab = "all" | "draft" | "finalized" | "archived";
const tab = ref<Tab>("all");
const list = ref<NovelDto[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref("");

// 状态/来源文案走 i18n（函数而不是常量：语言切换后要跟着变）
const statusLabel = (status: number): string =>
  status === 1 ? t("novel.statusDraft") : status === 16 ? t("novel.statusFinalized") : t("novel.statusUnknown", { status });
const SOURCE_KEYS: Record<number, string> = {
  1: "adapt",
  2: "idea",
  3: "script",
  4: "fission",
  5: "overseas",
};
const sourceLabel = (sourceType: number): string =>
  SOURCE_KEYS[sourceType] ? t(`novel.sources.${SOURCE_KEYS[sourceType]}`) : t("novel.sources.adapt");

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
    error.value = e instanceof Error ? e.message : t("novel.loadFailed");
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
/** 两种入口：改编（1，粘贴/上传小说）与原创（2，一句创作灵感）。 */
type CreateMode = "adapt" | "original";
const mode = ref<CreateMode>("adapt");
const form = reactive({ title: "", ratio: "9:16" as "9:16" | "16:9", source_text: "" });
const fileName = ref("");
const parsing = ref(false);

const canCreate = computed(() => form.title.trim().length > 0 && form.source_text.trim().length > 0 && !creating.value);

function openCreate(next: CreateMode = "adapt"): void {
  mode.value = next;
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
      reader.onerror = () => reject(new Error(t("novel.readFileFailed")));
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
    if (parsed.truncated) toast.info(t("novel.parseTruncated", { chars: parsed.chars }));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t("novel.parseFailed"));
  } finally {
    parsing.value = false;
    input.value = "";
  }
}

async function create(): Promise<void> {
  if (!canCreate.value) return;
  creating.value = true;
  try {
    const isOriginal = mode.value === "original";
    const novel = await api.post<NovelDto>("/novel", {
      title: form.title.trim(),
      ratio: form.ratio,
      // 原创本子的 source_type=2：source_text 存的是"创作灵感"，服务端不会把它切成章节
      source_type: isOriginal ? 2 : 1,
      source_text: form.source_text,
      source_file_name: isOriginal ? undefined : fileName.value || undefined,
    });
    toast.success(
      isOriginal
        ? t("novel.createdOriginal")
        : t("novel.createdAdapt", { count: novel.chapter_count ?? 0 }),
    );
    showCreate.value = false;
    await router.push(`/novel/${novel.id}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t("novel.createFailed"));
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
  return date.toLocaleString(locale.value, {
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
        <h1>{{ t("novel.title") }}</h1>
        <p>{{ t("novel.sub") }}</p>
      </div>
      <div class="head__actions">
        <Button data-testid="novel-create" variant="secondary" @click="openCreate('adapt')">{{ t("novel.createAdapt") }}</Button>
        <Button data-testid="novel-create-original" @click="openCreate('original')">{{ t("novel.createOriginal") }}</Button>
      </div>
    </header>

    <nav class="tabs">
      <button type="button" :class="{ on: tab === 'all' }" @click="tab = 'all'">{{ t("novel.tabAll", { total: tab === "all" ? total : "·" }) }}</button>
      <button type="button" :class="{ on: tab === 'draft' }" @click="tab = 'draft'">{{ t("novel.tabDraft") }}</button>
      <button type="button" :class="{ on: tab === 'finalized' }" @click="tab = 'finalized'">{{ t("novel.tabFinalized") }}</button>
      <button type="button" :class="{ on: tab === 'archived' }" @click="tab = 'archived'">{{ t("novel.tabArchived") }}</button>
    </nav>

    <p v-if="error" class="err">
      {{ error }}
      <button type="button" class="err__retry" @click="load">{{ t("common.retry") }}</button>
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
              {{ statusLabel(item.status) }}
            </span>
            <span class="card__source">{{ sourceLabel(item.source_type) }}</span>
            <span class="card__ratio">{{ item.ratio }}</span>
          </div>
          <p class="card__title" :title="item.title">{{ item.title }}</p>
          <p class="card__meta">
            <span>{{ t("novel.episodeCount", { count: item.episode_count }) }}</span>
            <span class="dot">·</span>
            <span>{{ fmtDate(item.updated_at) }}</span>
          </p>
          <p v-if="item.archived_at" class="card__archived">{{ t("novel.archivedAt", { time: fmtDate(item.archived_at) }) }}</p>
        </article>
      </div>

      <EmptyState
        v-else
        icon="✎"
        :title="t('novel.emptyTitle')"
        :description="t('novel.emptyDesc')"
      >
        <div class="head__actions">
          <Button variant="secondary" @click="openCreate('adapt')">{{ t("novel.pasteAdapt") }}</Button>
          <Button @click="openCreate('original')">{{ t("novel.fromIdea") }}</Button>
        </div>
      </EmptyState>
    </div>

    <!-- 新建弹窗：改编（粘贴/上传小说）与原创（一句灵感）共用同一张表单，只切换模式 -->
    <Modal :open="showCreate" :title="mode === 'original' ? t('novel.modalOriginal') : t('novel.modalAdapt')" width="620px" @close="showCreate = false">
      <div class="form">
        <div class="segmented segmented--mode">
          <button type="button" :class="{ on: mode === 'adapt' }" @click="mode = 'adapt'">{{ t("novel.modeAdapt") }}</button>
          <button type="button" :class="{ on: mode === 'original' }" @click="mode = 'original'">{{ t("novel.modeOriginal") }}</button>
        </div>
        <TextField
          v-model="form.title"
          :label="t('novel.nameLabel')"
          :placeholder="mode === 'original' ? t('novel.namePlaceholderOriginal') : t('novel.namePlaceholderAdapt')"
          :maxlength="200"
        />
        <div class="form__row">
          <label class="form__label">{{ t("novel.ratioLabel") }}</label>
          <div class="segmented">
            <button type="button" :class="{ on: form.ratio === '9:16' }" @click="form.ratio = '9:16'">{{ t("novel.ratioPortrait") }}</button>
            <button type="button" :class="{ on: form.ratio === '16:9' }" @click="form.ratio = '16:9'">{{ t("novel.ratioLandscape") }}</button>
          </div>
        </div>
        <div v-if="mode === 'adapt'" class="form__upload">
          <label class="upload">
            <input type="file" accept=".txt,.md,.docx,.xlsx" :disabled="parsing" @change="onFile" />
            <span>{{ parsing ? t("novel.parsing") : t("novel.uploadHint") }}</span>
          </label>
          <span v-if="fileName" class="form__file">{{ fileName }}</span>
        </div>
        <TextAreaField
          v-model="form.source_text"
          :label="mode === 'original' ? t('novel.textLabelOriginal') : t('novel.textLabelAdapt')"
          :rows="mode === 'original' ? 4 : 10"
          :maxlength="mode === 'original' ? 5000 : 50000"
          :placeholder="
            mode === 'original'
              ? t('novel.textPlaceholderOriginal')
              : t('novel.textPlaceholderAdapt')
          "
          :hint="
            mode === 'original'
              ? t('novel.textHintOriginal')
              : t('novel.textHintAdapt')
          "
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="showCreate = false">{{ t("common.cancel") }}</Button>
        <Button :disabled="!canCreate" :loading="creating" @click="create">
          {{ mode === 'original' ? t("novel.submitOriginal") : t("novel.submitAdapt") }}
        </Button>
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
.head__actions {
  display: flex;
  gap: 8px;
}
.segmented--mode {
  align-self: flex-start;
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


