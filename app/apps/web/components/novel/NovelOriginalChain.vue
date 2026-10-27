<script setup lang="ts">
import type {
  NovelChapterOutlineDto,
  NovelEpisodeDto,
  NovelEpisodeOutlineDto,
  NovelEpisodeSummaryDto,
  NovelOriginalIdeaDto,
  NovelOriginalMaterialDto,
  NovelOriginalOutlineDto,
  NovelOriginalStateDto,
} from "~/types/api";

/**
 * 原创剧本链面板（`/v1/novel/:nt/original_script/*`）。
 *
 * 与改编链工作台的关系：**共用同一套壳**（步进器、卡片、按钮、三态），只换"链上有什么"。
 * 为什么不另写一个页面：原创与改编的差别在**上游来源**（一句话灵感 vs 一本小说），
 * 而下游（集纲 → 剧本 → 定稿）是同一套表、同一套版本机制，分成两个页面只会让
 * "定稿后怎么进去制片工坊"出现两套入口。
 *
 * 顺序闸门（与后端一致，前端只是提前禁用，不代替后端校验）：
 *   方案 → 选定 → 素材 → 总纲 → 分卡章纲 → 集纲 → 剧本 → 定稿
 * 竞品的 CLI 也是这个顺序，每个中间产物一条命令（`novel.md:84-683`）。
 */
const props = defineProps<{ novelId: string }>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const toast = useToast();

const base = computed(() => `/novel/${props.novelId}/original_script`);
const loading = ref(true);
const error = ref("");
const busy = ref("");

const state = ref<NovelOriginalStateDto | null>(null);
const ideas = ref<NovelOriginalIdeaDto[]>([]);
const selectedNiId = ref<string | null>(null);
const materials = ref<NovelOriginalMaterialDto[]>([]);
const outline = ref<NovelOriginalOutlineDto | null>(null);
const chapters = ref<NovelChapterOutlineDto[]>([]);
const episodeOutlines = ref<NovelEpisodeOutlineDto[]>([]);
const episodes = ref<NovelEpisodeSummaryDto[]>([]);
const activeEpisode = ref<NovelEpisodeDto | null>(null);
const episodeText = ref("");

const STEPS = [
  { key: "idea", label: "创意方案" },
  { key: "idea_selected", label: "选定方案" },
  { key: "materials", label: "剧本素材" },
  { key: "summary_outline", label: "总纲及设定" },
  { key: "chapters_outline", label: "分卡章纲" },
  { key: "episodes_outline", label: "集纲" },
  { key: "episodes", label: "分集剧本" },
  { key: "finalize", label: "定稿" },
];

const hasIdea = computed(() => selectedNiId.value !== null);
const hasOutline = computed(() => outline.value !== null);

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    state.value = await api.get<NovelOriginalStateDto>(`${base.value}/state`);
    const ideaList = await api.get<{ list: NovelOriginalIdeaDto[]; selected_ni_id: string | null }>(`${base.value}/idea`);
    ideas.value = ideaList.list ?? [];
    selectedNiId.value = ideaList.selected_ni_id;
    materials.value = (await api.get<{ list: NovelOriginalMaterialDto[] }>(`${base.value}/materials`)).list ?? [];
    outline.value = (await api.get<{ summary_outline: NovelOriginalOutlineDto | null }>(`${base.value}/summary_outline`))
      .summary_outline;
    chapters.value = (await api.get<{ list: NovelChapterOutlineDto[] }>(`${base.value}/chapters_outline`)).list ?? [];
    episodeOutlines.value =
      (await api.get<{ list: NovelEpisodeOutlineDto[] }>(`${base.value}/episodes_outline`)).list ?? [];
    episodes.value = (await api.get<{ list: NovelEpisodeSummaryDto[] }>(`/novel/${props.novelId}/episode/list`)).list ?? [];
    if (episodes.value.length > 0) await openEpisode(episodes.value[0]!.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载原创链失败";
  } finally {
    loading.value = false;
  }
}

async function refreshState(): Promise<void> {
  try {
    state.value = await api.get<NovelOriginalStateDto>(`${base.value}/state`);
    emit("changed");
  } catch {
    // 状态刷新失败不打扰用户，下一步动作会自己报错
  }
}

async function act(key: string, fn: () => Promise<void>): Promise<void> {
  busy.value = key;
  error.value = "";
  try {
    await fn();
    await refreshState();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = "";
  }
}

// ── 1. 创意方案 ─────────────────────────────────────────────
async function generateIdeas(): Promise<void> {
  await act("idea", async () => {
    const data = await api.post<{ list: NovelOriginalIdeaDto[]; total: number; reset_downstream: boolean }>(
      `${base.value}/idea`,
      { count: 3 },
    );
    ideas.value = data.list;
    selectedNiId.value = null;
    materials.value = [];
    outline.value = null;
    chapters.value = [];
    episodeOutlines.value = [];
    toast.success(`已生成 ${data.total} 个创意方案${data.reset_downstream ? "（下游已重置）" : ""}`);
  });
}

async function selectIdea(idea: NovelOriginalIdeaDto): Promise<void> {
  await act(`select-${idea.ni_id}`, async () => {
    await api.post(`${base.value}/idea/select-op`, { ni_id: idea.ni_id });
    selectedNiId.value = idea.ni_id;
    ideas.value = ideas.value.map((row) => ({ ...row, selected: row.ni_id === idea.ni_id }));
    toast.success(`已选定：${idea.title}`);
  });
}

// ── 2. 素材 ─────────────────────────────────────────────────
async function generateMaterials(): Promise<void> {
  await act("materials", async () => {
    const data = await api.post<{ list: NovelOriginalMaterialDto[]; total: number }>(
      `${base.value}/materials/generate`,
      { count: 3 },
    );
    materials.value = data.list;
    toast.success(`已生成 ${data.total} 条素材`);
  });
}

async function toggleMaterial(material: NovelOriginalMaterialDto): Promise<void> {
  await act(`material-${material.nm_id}`, async () => {
    const data = await api.post<{ selected_nm_ids: string[]; list: NovelOriginalMaterialDto[] }>(
      `${base.value}/materials/select-op`,
      { nm_id: material.nm_id },
    );
    materials.value = data.list;
  });
}

async function saveMaterial(material: NovelOriginalMaterialDto): Promise<void> {
  await act(`material-save-${material.nm_id}`, async () => {
    await api.patch(`${base.value}/materials/${material.nm_id}`, {
      title: material.title,
      content: material.content,
    });
    toast.success("素材已保存");
  });
}

// ── 3. 总纲 ─────────────────────────────────────────────────
async function generateOutline(): Promise<void> {
  await act("outline", async () => {
    const data = await api.post<{ summary_outline: NovelOriginalOutlineDto }>(`${base.value}/summary_outline`, {});
    outline.value = data.summary_outline;
    toast.success(`总纲已生成（${data.summary_outline.beats.length} 个节拍）`);
  });
}

async function saveOutline(): Promise<void> {
  if (!outline.value) return;
  await act("outline-save", async () => {
    const data = await api.patch<{ summary_outline: NovelOriginalOutlineDto }>(`${base.value}/summary_outline`, {
      title: outline.value!.title,
      logline: outline.value!.logline,
      theme: outline.value!.theme,
      structure: outline.value!.structure,
      beats: outline.value!.beats,
    });
    outline.value = data.summary_outline;
    toast.success("总纲已保存");
  });
}

// ── 4. 分卡章纲 ─────────────────────────────────────────────
async function generateChapters(): Promise<void> {
  await act("chapters", async () => {
    const data = await api.post<{ list: NovelChapterOutlineDto[]; count: number }>(
      `${base.value}/chapters_outline`,
      {},
    );
    chapters.value = data.list;
    toast.success(`已生成 ${data.count} 个分卡章纲`);
  });
}

async function saveChapter(item: NovelChapterOutlineDto): Promise<void> {
  await act(`chapter-${item.id}`, async () => {
    await api.patch(`${base.value}/chapters_outline/${item.id}`, { title: item.title, synopsis: item.synopsis });
    toast.success("章纲已保存");
  });
}

// ── 5. 集纲 / 剧本 ──────────────────────────────────────────
async function generateEpisodeOutlines(): Promise<void> {
  await act("episode-outline", async () => {
    const data = await api.post<{ list: NovelEpisodeOutlineDto[]; count: number }>(
      `${base.value}/episodes_outline`,
      { episode_count: 12 },
    );
    episodeOutlines.value = data.list;
    toast.success(`已生成 ${data.count} 集大纲`);
  });
}

async function generateEpisodes(): Promise<void> {
  await act("episodes", async () => {
    const data = await api.post<{ count: number; missing: number[] }>(`${base.value}/episodes`, {});
    toast.success(
      data.missing.length > 0 ? `已生成 ${data.count} 集；还缺第 ${data.missing.join("、")} 集` : `已生成 ${data.count} 集剧本`,
    );
    episodes.value = (await api.get<{ list: NovelEpisodeSummaryDto[] }>(`/novel/${props.novelId}/episode/list`)).list;
    if (episodes.value.length > 0) await openEpisode(episodes.value[0]!.id);
  });
}

async function openEpisode(id: string): Promise<void> {
  activeEpisode.value = await api.get<NovelEpisodeDto>(`/novel/${props.novelId}/episode/${id}`);
  episodeText.value = activeEpisode.value.script_text;
}

async function saveEpisode(): Promise<void> {
  if (!activeEpisode.value) return;
  await act("episode-save", async () => {
    const data = await api.patch<NovelEpisodeDto>(`${base.value}/episodes/${activeEpisode.value!.id}`, {
      script_text: episodeText.value,
    });
    activeEpisode.value = data;
    toast.success(`已保存（版本 v${data.version}）`);
    episodes.value = (await api.get<{ list: NovelEpisodeSummaryDto[] }>(`/novel/${props.novelId}/episode/list`)).list;
  });
}

async function confirmEpisode(): Promise<void> {
  if (!activeEpisode.value) return;
  await act("episode-confirm", async () => {
    await api.post(`${base.value}/episodes/${activeEpisode.value!.id}/confirm`, {});
    toast.success("本集已确认");
    episodes.value = (await api.get<{ list: NovelEpisodeSummaryDto[] }>(`/novel/${props.novelId}/episode/list`)).list;
  });
}

// ── 6. 定稿 ─────────────────────────────────────────────────
async function finalize(): Promise<void> {
  await act("finalize", async () => {
    const data = await api.post<{ status: number; replayed: boolean }>(`${base.value}/finalize`, {
      snapshot_episodes: true,
    });
    toast.success(data.replayed ? "本子已处于定稿状态" : "已定稿（status=16），可进制片工坊拆集");
  });
}

onMounted(() => void loadAll());
defineExpose({ loadAll });
</script>

<template>
  <div class="oc">
    <p v-if="error" class="oc__err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="6" />

    <template v-else>
      <NovelStepper
        v-if="state"
        :steps="state.steps"
        :items="STEPS"
        :active="
          state.steps.episodes?.done ? 'finalize' : state.steps.episodes_outline?.done ? 'episodes' : state.steps.chapters_outline?.done ? 'episodes_outline' : state.steps.summary_outline?.done ? 'chapters_outline' : state.steps.materials?.done ? 'summary_outline' : state.selected_ni_id ? 'materials' : state.steps.idea?.done ? 'idea_selected' : 'idea'
        "
        @pick="() => {}"
      />

      <div class="oc__body">
        <!-- 创作灵感 -->
        <section class="card">
          <h3>创作灵感（user_input）</h3>
          <p class="card__hint">{{ state?.user_input || "（空）" }}</p>
          <p class="card__meta">原创链不依赖任何源小说：这一句灵感就是整条链的全部上下文。</p>
        </section>

        <!-- 创意方案 -->
        <section class="card">
          <div class="card__head">
            <h3>① 创意方案（{{ ideas.length }}）</h3>
            <Button size="sm" :loading="busy === 'idea'" @click="generateIdeas">
              {{ ideas.length ? "重新生成方案" : "生成创意方案" }}
            </Button>
          </div>
          <p v-if="ideas.length === 0" class="card__hint">还没有方案。生成后选一个，后面的素材/总纲都围绕它展开。</p>
          <ul v-else class="ideas">
            <li v-for="idea in ideas" :key="idea.ni_id" class="idea" :class="{ on: idea.ni_id === selectedNiId }">
              <div class="idea__main">
                <strong>{{ idea.title }}</strong>
                <span class="tag">{{ idea.genre }} · {{ idea.tone }}</span>
              </div>
              <p class="idea__line">{{ idea.logline }}</p>
              <Button
                size="sm"
                :variant="idea.ni_id === selectedNiId ? 'secondary' : 'primary'"
                :disabled="idea.ni_id === selectedNiId"
                :loading="busy === `select-${idea.ni_id}`"
                @click="selectIdea(idea)"
              >
                {{ idea.ni_id === selectedNiId ? "已选定" : "选定这个" }}
              </Button>
            </li>
          </ul>
        </section>

        <!-- 素材 -->
        <section class="card">
          <div class="card__head">
            <h3>② 剧本素材（{{ materials.length }}）</h3>
            <Button size="sm" :disabled="!hasIdea" :loading="busy === 'materials'" @click="generateMaterials">
              生成素材
            </Button>
          </div>
          <p v-if="!hasIdea" class="card__hint">先选定一个创意方案。</p>
          <p v-else-if="materials.length === 0" class="card__hint">还没有素材。生成后可勾选（勾选是加法，不会取消其它）。</p>
          <ul v-else class="materials">
            <li v-for="item in materials" :key="item.nm_id" class="material" :class="{ on: item.selected }">
              <label class="material__pick">
                <input type="checkbox" :checked="item.selected" @change="toggleMaterial(item)" />
                <span>{{ item.title }}</span>
              </label>
              <TextAreaField v-model="item.content" :rows="2" :maxlength="500" />
              <Button size="sm" variant="secondary" :loading="busy === `material-save-${item.nm_id}`" @click="saveMaterial(item)">
                保存
              </Button>
            </li>
          </ul>
        </section>

        <!-- 总纲 -->
        <section class="card">
          <div class="card__head">
            <h3>③ 总纲及设定</h3>
            <div class="card__ops">
              <Button v-if="outline" size="sm" variant="secondary" :loading="busy === 'outline-save'" @click="saveOutline">
                保存总纲
              </Button>
              <Button size="sm" :disabled="!hasIdea" :loading="busy === 'outline'" @click="generateOutline">
                {{ outline ? "重新生成总纲" : "生成总纲" }}
              </Button>
            </div>
          </div>
          <p v-if="!hasIdea" class="card__hint">先选定一个创意方案。</p>
          <p v-else-if="!outline" class="card__hint">还没有总纲。生成后可改主题/结构/节拍。</p>
          <div v-else class="outline">
            <TextField v-model="outline.title" label="总纲标题" :maxlength="200" />
            <TextField v-model="outline.logline" label="一句话卖点" :maxlength="300" />
            <div class="outline__row">
              <TextField v-model="outline.theme" label="主题" :maxlength="50" />
              <TextField v-model="outline.structure" label="结构" :maxlength="100" />
            </div>
            <ul class="beats">
              <li v-for="beat in outline.beats" :key="beat.no" class="beat">
                <span class="beat__no">{{ beat.no }}</span>
                <TextField v-model="beat.beat" :maxlength="50" />
                <TextAreaField v-model="beat.summary" :rows="2" :maxlength="500" />
              </li>
            </ul>
          </div>
        </section>

        <!-- 分卡章纲 -->
        <section class="card">
          <div class="card__head">
            <h3>④ 分卡章纲（{{ chapters.length }}）</h3>
            <Button size="sm" :disabled="!hasOutline" :loading="busy === 'chapters'" @click="generateChapters">
              生成分卡章纲
            </Button>
          </div>
          <p v-if="!hasOutline" class="card__hint">先生成总纲：分卡章纲是从总纲节拍派生的（保证两者永远一致）。</p>
          <p v-else-if="chapters.length === 0" class="card__hint">还没有章纲。</p>
          <ul v-else class="outlines">
            <li v-for="item in chapters" :key="item.id" class="outline-item">
              <TextField v-model="item.title" :maxlength="200" />
              <TextAreaField v-model="item.synopsis" :rows="2" :maxlength="1000" />
              <Button size="sm" variant="secondary" :loading="busy === `chapter-${item.id}`" @click="saveChapter(item)">
                保存
              </Button>
            </li>
          </ul>
        </section>

        <!-- 集纲 -->
        <section class="card">
          <div class="card__head">
            <h3>⑤ 集纲（{{ episodeOutlines.length }}）</h3>
            <Button
              size="sm"
              :disabled="!hasOutline"
              :loading="busy === 'episode-outline'"
              @click="generateEpisodeOutlines"
            >
              生成集纲
            </Button>
          </div>
          <p v-if="episodeOutlines.length === 0" class="card__hint">还没有集纲。</p>
          <ul v-else class="compact">
            <li v-for="item in episodeOutlines" :key="item.id">
              <strong>第 {{ item.episode_no }} 集</strong> {{ item.title }}
              <span class="compact__line">{{ item.synopsis }}</span>
            </li>
          </ul>
        </section>

        <!-- 分集剧本 -->
        <section class="card">
          <div class="card__head">
            <h3>⑥ 分集剧本（{{ episodes.length }}）</h3>
            <Button size="sm" :disabled="episodeOutlines.length === 0" :loading="busy === 'episodes'" @click="generateEpisodes">
              生成分集剧本
            </Button>
          </div>
          <p v-if="episodes.length === 0" class="card__hint">还没有剧本。先生成集纲，再生成剧本。</p>
          <div v-else class="script">
            <ul class="episode-list">
              <li v-for="item in episodes" :key="item.id">
                <button
                  type="button"
                  class="episode"
                  :class="{ on: activeEpisode?.id === item.id }"
                  @click="openEpisode(item.id)"
                >
                  <span>第 {{ item.episode_no }} 集</span>
                  <span class="episode__title">{{ item.title }}</span>
                  <span class="tag" :class="{ 'tag--done': item.status === 2 }">{{ item.status === 2 ? "已确认" : "草稿" }}</span>
                </button>
              </li>
            </ul>
            <div v-if="activeEpisode" class="script__edit">
              <TextAreaField v-model="episodeText" :rows="14" :maxlength="100000" label="剧本正文（保存产生新版本）" />
              <div class="script__ops">
                <Button size="sm" :loading="busy === 'episode-save'" @click="saveEpisode">保存正文</Button>
                <Button size="sm" variant="secondary" :loading="busy === 'episode-confirm'" @click="confirmEpisode">
                  确认这集
                </Button>
              </div>
            </div>
          </div>
        </section>

        <!-- 定稿 -->
        <section class="card">
          <div class="card__head">
            <h3>⑦ 定稿（status=16）</h3>
            <Button
              size="sm"
              :disabled="episodes.length === 0 || state?.novel.status === 16"
              :loading="busy === 'finalize'"
              @click="finalize"
            >
              {{ state?.novel.status === 16 ? "已定稿" : "定稿完成原创剧本" }}
            </Button>
          </div>
          <p class="card__meta">
            定稿后本子可作为制片工坊的拆集来源；要改稿需在「改编链 → 定稿」处撤回定稿
            （已被拆集引用时会被拒绝并回显项目）。
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.oc {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.oc__err {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-xs);
}
.oc__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.card__ops {
  display: flex;
  gap: 8px;
}
.card h3 {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-1);
}
.card__hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.card__meta {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.ideas,
.materials,
.outlines,
.compact,
.beats,
.episode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.idea {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.idea.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.idea__main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.idea__main strong {
  color: var(--text-1);
  font-size: var(--text-sm);
}
.idea__line {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.tag {
  padding: 0 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-1);
  color: var(--text-4);
  font-size: 10px;
}
.tag--done {
  border-color: #1d5c3c;
  background: var(--success-bg);
  color: var(--success);
}
.material {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: 10px;
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}
@media (max-width: 900px) {
  .material {
    grid-template-columns: 1fr;
  }
}
.material.on {
  border-color: var(--brand-border);
}
.material__pick {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: var(--text-xs);
}
.outline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.outline__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.beat {
  display: grid;
  grid-template-columns: 24px minmax(0, 160px) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}
@media (max-width: 900px) {
  .beat {
    grid-template-columns: 1fr;
  }
}
.beat__no {
  color: var(--text-4);
  font-size: var(--text-xs);
  padding-top: 8px;
}
.outline-item {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: 10px;
}
@media (max-width: 900px) {
  .outline-item {
    grid-template-columns: 1fr;
  }
}
.compact li {
  border-bottom: 1px solid var(--border-1);
  padding-bottom: 6px;
  color: var(--text-2);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.compact__line {
  display: block;
  color: var(--text-4);
}
.script {
  display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 980px) {
  .script {
    grid-template-columns: 1fr;
  }
}
.episode {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg-sunken);
  color: var(--text-2);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}
.episode.on {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.episode__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.script__edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.script__ops {
  display: flex;
  gap: 8px;
}
</style>
