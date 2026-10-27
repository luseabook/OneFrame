<script setup lang="ts">
import type {
  NovelChapterDto,
  NovelChapterOutlineDto,
  NovelChapterSummaryDto,
  NovelCharacterDto,
  NovelEpisodeDto,
  NovelEpisodeOutlineDto,
  NovelEpisodeSummaryDto,
  NovelSummaryDto,
  NovelWorldviewDto,
} from "~/types/api";

/**
 * 小说改编工作台（`/novel/:id`）。
 *
 * 布局按"链"组织（分章 → 分析 → 章纲 → 集纲 → 核心角色 → 剧本 → 编辑 Agent），
 * 与后端 `/v1/novel/:nt/*` 的子路径一一对应。每个 tab 都是"看当前产出 + 一个主动作"，
 * 不做自动串行生成 —— 竞品这条链每一步都是用户显式点的（`cmd/novel.md:38-57`
 * 每个中间产物一条触发命令），自动串联会让一次模型抖动连带毁掉后面五步。
 *
 * 三态：加载（Skeleton）/ 空（EmptyState + 下一步）/ 错误（红条 + 重试）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "改编工作台 · 一帧" });

const api = useApi();
const toast = useToast();
const route = useRoute();

const novelId = computed(() => String(route.params.id ?? ""));
const summary = ref<NovelSummaryDto | null>(null);
const loading = ref(true);
const error = ref("");
const busy = ref("");

type Tab = "chapters" | "analysis" | "chapter_outline" | "episode_outline" | "core_character" | "script" | "agent";
const tab = ref<Tab>("chapters");

const STEP_TO_TAB: Record<string, Tab> = {
  split: "chapters",
  content_analysis: "analysis",
  chapter_outline: "chapter_outline",
  episode_outline: "episode_outline",
  core_character: "core_character",
  script: "script",
  finalize: "script",
};

const base = computed(() => `/novel/${novelId.value}`);
const finalized = computed(() => summary.value?.finalized ?? false);

async function loadSummary(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    summary.value = await api.get<NovelSummaryDto>(`${base.value}/summary`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

// ══════════════ 章节 ══════════════
const chapters = ref<NovelChapterSummaryDto[]>([]);
const chapterDetail = ref<NovelChapterDto | null>(null);
const splitCountInput = ref("");

async function loadChapters(): Promise<void> {
  const data = await api.get<{ list: NovelChapterSummaryDto[]; total: number }>(`${base.value}/chapters`);
  chapters.value = data.list ?? [];
  if (chapters.value.length > 0 && !chapterDetail.value) {
    await openChapter(chapters.value[0]!.chapter_no);
  }
}

async function openChapter(no: number): Promise<void> {
  try {
    chapterDetail.value = await api.get<NovelChapterDto>(`${base.value}/chapters/${no}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "加载章节失败");
  }
}

async function resplit(): Promise<void> {
  busy.value = "split";
  try {
    const body: Record<string, unknown> = {};
    const wanted = Number(splitCountInput.value); if (Number.isInteger(wanted) && wanted > 0) body.chapter_count = wanted;
    const data = await api.post<{ count: number }>(`${base.value}/split`, body);
    toast.success(`已切分为 ${data.count} 章`);
    await Promise.all([loadSummary(), loadChapters()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "分章失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ 内容分析 ══════════════
const worldview = ref<NovelWorldviewDto | null>(null);
const characters = ref<NovelCharacterDto[]>([]);
const analysisForm = reactive({ era: "", geography: "", summary: "" });
const charCountInput = ref("6");

async function loadAnalysis(): Promise<void> {
  const data = await api.get<{ worldview: NovelWorldviewDto | null; characters: NovelCharacterDto[] }>(
    `${base.value}/content-analysis/detail`,
  );
  worldview.value = data.worldview;
  characters.value = data.characters ?? [];
  if (data.worldview) {
    analysisForm.era = data.worldview.era;
    analysisForm.geography = data.worldview.geography;
    analysisForm.summary = data.worldview.summary;
  }
}

async function runAnalysis(): Promise<void> {
  busy.value = "analyze";
  try {
    const data = await api.post<{ characters: NovelCharacterDto[] }>(`${base.value}/content-analysis`, {
      character_count: Math.max(1, Math.min(Number(charCountInput.value) || 6, 10)),
    });
    toast.success(`内容分析完成：角色卡 ${data.characters.length} 张`);
    await Promise.all([loadSummary(), loadAnalysis()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "内容分析失败");
  } finally {
    busy.value = "";
  }
}

async function saveWorldview(): Promise<void> {
  if (!worldview.value) return;
  busy.value = "worldview";
  try {
    await api.put<{ worldview: NovelWorldviewDto }>(`${base.value}/content-analysis/worldview`, {
      era: analysisForm.era,
      geography: analysisForm.geography,
      summary: analysisForm.summary,
      // 结构化部分（势力/规则/关系）不在这个简易表单里改，原样带回，避免覆盖丢失
      factions: worldview.value.factions,
      rules: worldview.value.rules,
      relations: worldview.value.relations,
    });
    toast.success("世界观已保存");
    await loadAnalysis();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = "";
  }
}

async function generateCharacters(): Promise<void> {
  busy.value = "characters";
  try {
    await api.post(`${base.value}/content-analysis/novel_character_cards/generate`, { count: Math.max(1, Math.min(Number(charCountInput.value) || 6, 10)) });
    toast.success("已重新生成角色卡（同名会合并，不产生重复卡）");
    await loadAnalysis();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "生成失败");
  } finally {
    busy.value = "";
  }
}

// 单张角色卡编辑
const editing = ref<NovelCharacterDto | null>(null);
const charForm = reactive({ name: "", role_type: 2, description: "", appearance: "", personality: "", prompt: "" });

function editCharacter(item: NovelCharacterDto): void {
  editing.value = item;
  charForm.name = item.name;
  charForm.role_type = item.role_type;
  charForm.description = item.description;
  charForm.appearance = item.appearance;
  charForm.personality = item.personality;
  charForm.prompt = item.prompt;
}

async function saveCharacter(): Promise<void> {
  if (!editing.value) return;
  busy.value = "character";
  try {
    await api.patch(`${base.value}/content-analysis/novel_character_cards/${editing.value.id}`, {
      name: charForm.name,
      role_type: charForm.role_type,
      description: charForm.description,
      appearance: charForm.appearance,
      personality: charForm.personality,
      prompt: charForm.prompt,
    });
    toast.success("角色卡已保存");
    editing.value = null;
    await loadAnalysis();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ 章节大纲 ══════════════
const chapterOutlines = ref<NovelChapterOutlineDto[]>([]);

async function loadChapterOutlines(): Promise<void> {
  const data = await api.get<{ list: NovelChapterOutlineDto[] }>(`${base.value}/chapter_outline/list`);
  chapterOutlines.value = data.list ?? [];
}

async function generateChapterOutlines(): Promise<void> {
  busy.value = "chapter_outline";
  try {
    const data = await api.post<{ count: number }>(`${base.value}/chapter_outline/generate`, {});
    toast.success(`已生成 ${data.count} 条章纲`);
    await Promise.all([loadSummary(), loadChapterOutlines()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "生成失败");
  } finally {
    busy.value = "";
  }
}

async function saveChapterOutline(item: NovelChapterOutlineDto): Promise<void> {
  busy.value = `nco-${item.id}`;
  try {
    await api.patch(`${base.value}/chapter_outline/${item.id}`, { title: item.title, synopsis: item.synopsis });
    toast.success(`第 ${item.chapter_no} 章纲已保存`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ 分集大纲 ══════════════
const episodeOutlines = ref<NovelEpisodeOutlineDto[]>([]);
const episodeCountInput = ref("");

async function loadEpisodeOutlines(): Promise<void> {
  const data = await api.get<{ list: NovelEpisodeOutlineDto[] }>(`${base.value}/episode_outline/list`);
  episodeOutlines.value = data.list ?? [];
}

async function generateEpisodeOutlines(): Promise<void> {
  busy.value = "episode_outline";
  try {
    const body: Record<string, unknown> = {};
    const wantedEpisodes = Number(episodeCountInput.value); if (Number.isInteger(wantedEpisodes) && wantedEpisodes > 0) body.episode_count = wantedEpisodes;
    const data = await api.post<{ count: number }>(`${base.value}/episode_outline/generate`, body);
    toast.success(`已生成 ${data.count} 集大纲`);
    await Promise.all([loadSummary(), loadEpisodeOutlines()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "生成失败");
  } finally {
    busy.value = "";
  }
}

async function saveEpisodeOutline(item: NovelEpisodeOutlineDto): Promise<void> {
  busy.value = `neo-${item.id}`;
  try {
    await api.patch(`${base.value}/episode_outline/${item.id}`, { title: item.title, synopsis: item.synopsis });
    toast.success(`第 ${item.episode_no} 集大纲已保存`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ 核心角色 ══════════════
const coreCharacters = ref<NovelCharacterDto[]>([]);

async function loadCoreCharacters(): Promise<void> {
  const data = await api.get<{ list: NovelCharacterDto[] }>(`${base.value}/core_character/list`);
  coreCharacters.value = data.list ?? [];
}

async function generateCoreCharacters(): Promise<void> {
  busy.value = "core_character";
  try {
    const data = await api.post<{ count: number }>(`${base.value}/core_character/generate`, { count: 3 });
    toast.success(`已标记 ${data.count} 个核心角色`);
    await Promise.all([loadSummary(), loadCoreCharacters(), loadAnalysis()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "生成失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ 分集剧本 ══════════════
const episodes = ref<NovelEpisodeSummaryDto[]>([]);
const episodeDetail = ref<NovelEpisodeDto | null>(null);
const episodeText = ref("");
const selectedNos = ref<number[]>([]);

async function loadEpisodes(): Promise<void> {
  const data = await api.get<{ list: NovelEpisodeSummaryDto[] }>(`${base.value}/episode/list`);
  episodes.value = data.list ?? [];
  if (episodes.value.length > 0 && !episodeDetail.value) {
    await openEpisode(episodes.value[0]!.id);
  }
}

async function openEpisode(id: string): Promise<void> {
  try {
    const data = await api.get<NovelEpisodeDto>(`${base.value}/episode/${id}`);
    episodeDetail.value = data;
    episodeText.value = data.script_text;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "加载剧本失败");
  }
}

async function generateScripts(): Promise<void> {
  busy.value = "script";
  try {
    const body: Record<string, unknown> = {};
    if (selectedNos.value.length > 0) body.episode_nos = selectedNos.value;
    const data = await api.post<{ count: number; missing: number[] }>(`${base.value}/script-generate`, body);
    toast.success(
      data.missing.length > 0
        ? `已生成 ${data.count} 集；还缺第 ${data.missing.join("、")} 集`
        : `已生成 ${data.count} 集剧本`,
    );
    await Promise.all([loadSummary(), loadEpisodes()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "生成失败");
  } finally {
    busy.value = "";
  }
}

async function saveEpisodeText(): Promise<void> {
  if (!episodeDetail.value) return;
  busy.value = "episode-save";
  try {
    const data = await api.patch<NovelEpisodeDto>(`${base.value}/episode/${episodeDetail.value.id}`, {
      script_text: episodeText.value,
    });
    episodeDetail.value = data;
    toast.success(`已保存（版本 v${data.version}）`);
    await loadEpisodes();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = "";
  }
}

async function confirmEpisode(): Promise<void> {
  if (!episodeDetail.value) return;
  busy.value = "episode-confirm";
  try {
    await api.post(`${base.value}/episode/${episodeDetail.value.id}/confirm`, {});
    toast.success("本集已确认");
    await loadEpisodes();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "确认失败");
  } finally {
    busy.value = "";
  }
}

function toggleSelect(no: number): void {
  selectedNos.value = selectedNos.value.includes(no)
    ? selectedNos.value.filter((row) => row !== no)
    : [...selectedNos.value, no];
}

// ══════════════ 定稿 ══════════════
async function finalize(): Promise<void> {
  busy.value = "finalize";
  try {
    const data = await api.post<{ status: number; replayed: boolean }>(`${base.value}/finalize`, {
      snapshot_episodes: true,
    });
    toast.success(data.replayed ? "本子已处于定稿状态" : "已定稿（status=16），可作为制片工坊的拆集来源");
    await loadSummary();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "定稿失败");
  } finally {
    busy.value = "";
  }
}

// ══════════════ tab 切换与懒加载 ══════════════
const loadedTabs = new Set<Tab>();

async function ensureTab(next: Tab): Promise<void> {
  tab.value = next;
  if (loadedTabs.has(next)) return;
  loadedTabs.add(next);
  try {
    if (next === "chapters") await loadChapters();
    if (next === "analysis") await loadAnalysis();
    if (next === "chapter_outline") await loadChapterOutlines();
    if (next === "episode_outline") await loadEpisodeOutlines();
    if (next === "core_character") await loadCoreCharacters();
    if (next === "script") await loadEpisodes();
  } catch (e) {
    loadedTabs.delete(next);
    toast.error(e instanceof Error ? e.message : "加载失败");
  }
}

function pickStep(key: string): void {
  const next = STEP_TO_TAB[key];
  if (next) void ensureTab(next);
}
/**
 * 章节标题：原文标题行里已带「第N章」时去掉前缀再展示，
 * 否则列表会显示成「第 1 章 第一章 雨夜来客」（分章保留了原文标题行，这是唯一需要去重的位置）。
 */
function chapterTitle(item: NovelChapterSummaryDto): string {
  const stripped = item.title.replace(/^第[0-9一二三四五六七八九十百千零〇两]{1,10}[章节回卷]\s*/, "").trim();
  return stripped || item.title;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "chapters", label: "章节" },
  { key: "analysis", label: "内容分析" },
  { key: "chapter_outline", label: "章节大纲" },
  { key: "episode_outline", label: "分集大纲" },
  { key: "core_character", label: "核心角色" },
  { key: "script", label: "分集剧本" },
  { key: "agent", label: "编辑 Agent" },
];

const ROLE_LABEL: Record<number, string> = { 1: "主角", 2: "配角", 3: "反派" };

onMounted(async () => {
  await loadSummary();
  if (!error.value) await ensureTab("chapters");
});
</script>

<template>
  <div class="wb">
    <header class="wb__top">
      <NuxtLink to="/novel" class="back">← 剧本工厂</NuxtLink>
      <div class="wb__title">
        <h1 :title="summary?.novel.title">{{ summary?.novel.title ?? "加载中…" }}</h1>
        <span v-if="summary" class="badge" :class="{ done: finalized }">
          {{ finalized ? "已定稿 · status=16" : "草稿 · status=1" }}
        </span>
        <span v-if="summary" class="ratio">{{ summary.novel.ratio }}</span>
        <span v-if="summary" class="mode">{{ summary.llm_mode === "mock" ? "mock 模式（无 Key，确定性输出）" : "真实模型" }}</span>
      </div>
      <div class="wb__actions">
        <Button
          data-testid="novel-finalize"
          :disabled="finalized || loading"
          :loading="busy === 'finalize'"
          @click="finalize"
        >
          {{ finalized ? "已定稿" : "定稿完成改编" }}
        </Button>
      </div>
    </header>

    <NovelStepper
      v-if="summary"
      :steps="summary.steps"
      :active="tab === 'agent' ? 'finalize' : tab"
      @pick="pickStep"
    />

    <p v-if="error" class="err">
      {{ error }}
      <button type="button" class="err__retry" @click="loadSummary">重试</button>
    </p>

    <div class="wb__tabs">
      <button v-for="item in TABS" :key="item.key" type="button" :class="{ on: tab === item.key }" @click="ensureTab(item.key)">
        {{ item.label }}
      </button>
    </div>

    <main class="wb__body">
      <Skeleton v-if="loading" :rows="6" />

      <!-- 章节 -->
      <section v-else-if="tab === 'chapters'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">共 {{ chapters.length }} 章 · 分章是纯规则任务（按「第N章」标题切）</span>
          <div class="pane__ops">
            <TextField v-model="splitCountInput" class="count-input" placeholder="章数（可选）" />
            <Button size="sm" variant="secondary" :loading="busy === 'split'" :disabled="chapters.length === 0" @click="resplit">
              重新分章
            </Button>
          </div>
        </div>
        <div v-if="chapters.length === 0" class="pane__empty">
          <EmptyState icon="⌘" title="还没有章节" description="在剧本工厂新建时粘贴小说正文即可自动分章；已有本子可以回到列表页重新创建。" />
        </div>
        <div v-else class="split">
          <ul class="chapter-list">
            <li v-for="item in chapters" :key="item.id">
              <button
                type="button"
                class="chapter"
                :class="{ on: chapterDetail?.chapter_no === item.chapter_no }"
                @click="openChapter(item.chapter_no)"
              >
                <span class="chapter__no">第 {{ item.chapter_no }} 章</span>
                <span class="chapter__title">{{ chapterTitle(item) }}</span>
                <span class="chapter__words">{{ item.word_count }} 字</span>
              </button>
            </li>
          </ul>
          <article class="chapter-view">
            <template v-if="chapterDetail">
              <h2>{{ chapterDetail.title }}</h2>
              <pre class="chapter-view__text">{{ chapterDetail.content }}</pre>
            </template>
            <p v-else class="pane__hint">选择左侧章节查看正文</p>
          </article>
        </div>
      </section>

      <!-- 内容分析 -->
      <section v-else-if="tab === 'analysis'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">世界观 + 角色卡（同名重复生成会合并，不产生重复卡）</span>
          <div class="pane__ops">
            <label class="inline">角色卡 <input v-model="charCountInput" class="num" type="number" min="1" max="10" /></label>
            <Button size="sm" :loading="busy === 'analyze'" @click="runAnalysis">内容分析</Button>
            <Button size="sm" variant="secondary" :loading="busy === 'characters'" @click="generateCharacters">重新生成角色卡</Button>
          </div>
        </div>

        <div class="analysis">
          <section class="card">
            <h3>世界观</h3>
            <template v-if="worldview">
              <TextField v-model="analysisForm.era" label="时代背景" :maxlength="500" />
              <TextField v-model="analysisForm.geography" label="地理/场景基调" :maxlength="1000" />
              <TextAreaField v-model="analysisForm.summary" label="总述" :rows="5" :maxlength="2000" />
              <div class="chips">
                <span v-for="faction in worldview.factions" :key="faction.name" class="chip">{{ faction.name }}</span>
                <span v-for="rule in worldview.rules" :key="rule" class="chip chip--rule">{{ rule }}</span>
              </div>
              <p v-if="worldview.relations.length" class="relations">
                关系：<span v-for="rel in worldview.relations" :key="`${rel.from}-${rel.to}`" class="rel">
                  {{ rel.from }} → {{ rel.to }}（{{ rel.kind }}）
                </span>
              </p>
              <Button size="sm" :loading="busy === 'worldview'" @click="saveWorldview">保存世界观</Button>
            </template>
            <p v-else class="pane__hint">还没有世界观。点右上「内容分析」一次性生成世界观与角色卡。</p>
          </section>

          <section class="card">
            <h3>角色卡（{{ characters.length }}）</h3>
            <ul v-if="characters.length" class="chars">
              <li v-for="item in characters" :key="item.id" class="char">
                <div class="char__head">
                  <strong>{{ item.name }}</strong>
                  <span class="tag">{{ ROLE_LABEL[item.role_type] }}</span>
                  <span v-if="item.is_core" class="tag tag--core">核心</span>
                  <button type="button" class="link" @click="editCharacter(item)">编辑</button>
                </div>
                <p class="char__desc">{{ item.description }}</p>
                <p class="char__meta">{{ item.appearance }}</p>
              </li>
            </ul>
            <p v-else class="pane__hint">还没有角色卡。</p>
          </section>
        </div>
      </section>

      <!-- 章节大纲 -->
      <section v-else-if="tab === 'chapter_outline'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">{{ chapterOutlines.length }} 条章纲（可直接编辑后逐条保存）</span>
          <Button size="sm" :loading="busy === 'chapter_outline'" @click="generateChapterOutlines">生成章节大纲</Button>
        </div>
        <p v-if="chapterOutlines.length === 0" class="pane__hint">还没有章纲。点右上生成；生成后每条都可以改标题与梗概。</p>
        <ul v-else class="outlines">
          <li v-for="item in chapterOutlines" :key="item.id" class="outline">
            <TextField v-model="item.title" :maxlength="200" class="outline__title" />
            <TextAreaField v-model="item.synopsis" :rows="2" :maxlength="1000" />
            <Button size="sm" variant="secondary" :loading="busy === `nco-${item.id}`" @click="saveChapterOutline(item)">保存</Button>
          </li>
        </ul>
      </section>

      <!-- 分集大纲 -->
      <section v-else-if="tab === 'episode_outline'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">{{ episodeOutlines.length }} 集大纲</span>
          <div class="pane__ops">
            <label class="inline">集数 <input v-model="episodeCountInput" class="num" type="number" min="1" max="100" /></label>
            <Button size="sm" :loading="busy === 'episode_outline'" @click="generateEpisodeOutlines">生成分集大纲</Button>
          </div>
        </div>
        <p v-if="episodeOutlines.length === 0" class="pane__hint">还没有分集大纲。先生成章节大纲效果更好（没章纲时会按原文推）。</p>
        <ul v-else class="outlines">
          <li v-for="item in episodeOutlines" :key="item.id" class="outline">
            <TextField v-model="item.title" :maxlength="200" class="outline__title" />
            <TextAreaField v-model="item.synopsis" :rows="2" :maxlength="1000" />
            <Button size="sm" variant="secondary" :loading="busy === `neo-${item.id}`" @click="saveEpisodeOutline(item)">保存</Button>
          </li>
        </ul>
      </section>

      <!-- 核心角色 -->
      <section v-else-if="tab === 'core_character'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">核心角色 = 用于资产一致性（同一角色跨镜同 face）的那几张卡</span>
          <Button size="sm" :loading="busy === 'core_character'" @click="generateCoreCharacters">生成核心角色</Button>
        </div>
        <ul v-if="coreCharacters.length" class="chars">
          <li v-for="item in coreCharacters" :key="item.id" class="char">
            <div class="char__head">
              <strong>{{ item.name }}</strong>
              <span class="tag">{{ ROLE_LABEL[item.role_type] }}</span>
              <span class="tag tag--core">核心</span>
            </div>
            <p class="char__desc">{{ item.description }}</p>
            <p class="char__meta">{{ item.prompt }}</p>
          </li>
        </ul>
        <p v-else class="pane__hint">还没有核心角色。生成时会优先从已有角色卡里挑，不够才补生成。</p>
      </section>

      <!-- 分集剧本 -->
      <section v-else-if="tab === 'script'" class="pane">
        <div class="pane__bar">
          <span class="pane__hint">{{ episodes.length }} 集剧本<template v-if="selectedNos.length"> · 已选 {{ selectedNos.length }} 集</template></span>
          <div class="pane__ops">
            <Button size="sm" :loading="busy === 'script'" @click="generateScripts">
              {{ selectedNos.length ? "生成选中集" : "生成全部集" }}
            </Button>
          </div>
        </div>
        <div v-if="episodes.length === 0" class="pane__empty">
          <EmptyState icon="▤" title="还没有分集剧本" description="先生成分集大纲，再回这里生成剧本；生成后可用「编辑 Agent」逐集改。" />
        </div>
        <div v-else class="script">
          <ul class="episode-list">
            <li v-for="item in episodes" :key="item.id">
              <div class="episode" :class="{ on: episodeDetail?.id === item.id }">
                <input
                  type="checkbox"
                  :checked="selectedNos.includes(item.episode_no)"
                  :aria-label="`选择第 ${item.episode_no} 集`"
                  @change="toggleSelect(item.episode_no)"
                />
                <button type="button" class="episode__main" @click="openEpisode(item.id)">
                  <span class="episode__no">第 {{ item.episode_no }} 集</span>
                  <span class="episode__title">{{ item.title }}</span>
                  <span class="episode__meta">{{ item.chars }} 字 · v{{ item.version }}</span>
                  <span class="tag" :class="{ 'tag--core': item.status === 2 }">{{ item.status === 2 ? "已确认" : "草稿" }}</span>
                </button>
              </div>
            </li>
          </ul>
          <article class="script-view">
            <template v-if="episodeDetail">
              <TextAreaField v-model="episodeText" :rows="18" :maxlength="100000" label="剧本正文（保存会产生新版本）" />
              <div class="script-view__ops">
                <Button size="sm" :loading="busy === 'episode-save'" @click="saveEpisodeText">保存正文</Button>
                <Button size="sm" variant="secondary" :loading="busy === 'episode-confirm'" @click="confirmEpisode">确认这集</Button>
              </div>
            </template>
            <p v-else class="pane__hint">选择左侧剧集查看与编辑正文</p>
          </article>
        </div>
      </section>

      <!-- 编辑 Agent -->
      <section v-else class="pane pane--agent">
        <NovelAgentChat
          :novel-id="novelId"
          :locked="finalized"
          @applied="loadSummary"
          @changed="loadSummary"
        />
      </section>
    </main>

    <!-- 角色卡编辑弹窗 -->
    <Modal :open="!!editing" title="编辑角色卡" width="560px" @close="editing = null">
      <div class="form">
        <TextField v-model="charForm.name" label="姓名" :maxlength="50" />
        <div class="form__row">
          <label class="inline">类型
            <select v-model.number="charForm.role_type" class="select">
              <option :value="1">主角</option>
              <option :value="2">配角</option>
              <option :value="3">反派</option>
            </select>
          </label>
        </div>
        <TextAreaField v-model="charForm.description" label="描述" :rows="2" :maxlength="500" />
        <TextAreaField v-model="charForm.appearance" label="外貌" :rows="2" :maxlength="1000" />
        <TextAreaField v-model="charForm.personality" label="性格" :rows="2" :maxlength="500" />
        <TextAreaField v-model="charForm.prompt" label="生图提示词" :rows="3" :maxlength="1000" />
      </div>
      <template #footer>
        <Button variant="ghost" @click="editing = null">取消</Button>
        <Button :loading="busy === 'character'" @click="saveCharacter">保存</Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.wb {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--bg-app);
}
.wb__top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px 12px;
}
.back {
  color: var(--text-3);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.back:hover {
  color: var(--text-1);
}
.wb__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.wb__title h1 {
  margin: 0;
  font-size: 18px;
  color: var(--text-1);
  max-width: 42vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-1);
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.badge.done {
  background: var(--success-bg);
  color: var(--success);
  border-color: #1d5c3c;
}
.ratio,
.mode {
  color: var(--text-4);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.wb__actions {
  margin-left: auto;
}
.err {
  margin: 8px 20px 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-sm);
  display: flex;
  gap: 10px;
  align-items: center;
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
.wb__tabs {
  display: flex;
  gap: 4px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border-1);
}
.wb__tabs button {
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.wb__tabs button.on {
  background: var(--bg-raised);
  color: var(--text-1);
}
.wb__body {
  flex: 1;
  min-height: 0;
  padding: 14px 20px 32px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pane--agent {
  height: calc(100dvh - 220px);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  overflow: hidden;
}
.pane__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.pane__hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.pane__ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pane__empty {
  padding: 20px;
  border-radius: var(--radius-xl);
  border: 1px dashed var(--border-1);
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.num,
.select,
.count-input {
  width: 88px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-2);
  background: var(--bg-sunken);
  color: var(--text-1);
  font-size: var(--text-xs);
}
.select {
  width: 120px;
}
.split,
.script {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 980px) {
  .split,
  .script {
    grid-template-columns: 1fr;
  }
}
.chapter-list,
.episode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 62vh;
  overflow-y: auto;
}
.chapter {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: baseline;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg-sunken);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}
.chapter.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.chapter__no {
  font-size: var(--text-xs);
  color: var(--text-4);
  white-space: nowrap;
}
.chapter__title {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chapter__words {
  font-size: var(--text-xs);
  color: var(--text-5);
}
.chapter-view,
.script-view {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  padding: 14px;
  min-height: 320px;
}
.chapter-view h2 {
  margin: 0 0 10px;
  font-size: var(--text-base);
  color: var(--text-1);
}
.chapter-view__text {
  margin: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 64vh;
  overflow-y: auto;
}
.analysis {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1080px) {
  .analysis {
    grid-template-columns: 1fr;
  }
}
.card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card h3 {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-1);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  color: var(--text-3);
  font-size: var(--text-xs);
}
.chip--rule {
  color: var(--text-4);
}
.relations {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.8;
}
.rel {
  margin-right: 8px;
}
.chars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
}
.char {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: 10px;
}
.char__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.char__head strong {
  color: var(--text-1);
  font-size: var(--text-sm);
}
.tag {
  padding: 0 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-1);
  color: var(--text-4);
  font-size: 10px;
}
.tag--core {
  border-color: var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-300);
}
.link {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--brand-300);
  font-size: var(--text-xs);
  cursor: pointer;
}
.char__desc {
  margin: 6px 0 0;
  color: var(--text-2);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.char__meta {
  margin: 4px 0 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.outlines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.outline {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}
@media (max-width: 900px) {
  .outline {
    grid-template-columns: 1fr;
  }
}
.episode {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg-sunken);
}
.episode.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.episode__main {
  flex: 1;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 8px;
  align-items: baseline;
  border: 0;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  padding: 6px 2px;
}
.episode__no {
  font-size: var(--text-xs);
  color: var(--text-4);
  white-space: nowrap;
}
.episode__title {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.episode__meta {
  font-size: var(--text-xs);
  color: var(--text-5);
  white-space: nowrap;
}
.script-view__ops {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form__row {
  display: flex;
  gap: 12px;
}
</style>


