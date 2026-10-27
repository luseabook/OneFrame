<script setup lang="ts">
import type {
  ExtractionDraftDto,
  ExtractionDraftListDto,
  ExtractionTaskDto,
  MatchEntryDto,
  MatchResultDto,
  SupplementMissingDto,
} from "~/types/api";

/**
 * 抽取 + 资产×分镜匹配面板（项目维度）—— 对照 `cmd/resource.md:536-727` 与
 * `cmd/episode.md:261-388`。
 *
 * 三个不可省的状态提示（竞品踩过坑，界面上必须显式说清）：
 * 1. `match-resources` 受理成功 ≠ 匹配成功：结果以 `match-result.status` 为准；
 * 2. `match-reset` 是破坏性动作：先 dry-run 预演，再确认；
 * 3. 缺失资产（status=3）默认**保持现状**（不选就继续走分镜确认）。
 */
const api = useApi();

interface ProjectBrief {
  id: string;
  title: string;
}
interface EpisodeBrief {
  id: string;
  ep_no: number;
  title: string | null;
}

const projects = ref<ProjectBrief[]>([]);
const projectId = ref("");
const episodes = ref<EpisodeBrief[]>([]);
const episodeId = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");

// ── 抽取 ─────────────────────────────────────────────────────────────
const TASK_TYPES = [
  { value: 1, label: "1 清单提取（只出名单）" },
  { value: 2, label: "2 角色提示词" },
  { value: 3, label: "3 场景提示词" },
  { value: 4, label: "4 道具提示词" },
  { value: 5, label: "5 三合一提示词" },
] as const;
const taskType = ref<number>(1);
const task = ref<ExtractionTaskDto | null>(null);
const drafts = ref<ExtractionDraftDto[]>([]);
const TASK_STATUS: Record<string, { text: string; cls: string }> = {
  running: { text: "进行中", cls: "running" },
  succeeded: { text: "成功", cls: "ok" },
  failed: { text: "失败", cls: "failed" },
  invalid: { text: "失效", cls: "invalid" },
  unknown: { text: "未知", cls: "unknown" },
};

async function loadProjects(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await api.get<{ list: ProjectBrief[]; total: number }>("/projects?page=1&page_size=50");
    projects.value = data.list;
    if (!projectId.value && data.list[0]) projectId.value = data.list[0].id;
    await loadEpisodes();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载项目失败";
  } finally {
    loading.value = false;
  }
}

async function loadEpisodes(): Promise<void> {
  if (!projectId.value) return;
  try {
    const data = await api.get<{ episodes: EpisodeBrief[] }>(`/projects/${projectId.value}`);
    episodes.value = data.episodes;
    episodeId.value = data.episodes[0]?.id ?? "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载分集失败";
  }
}

async function startExtraction(): Promise<void> {
  if (!projectId.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const created = await api.post<ExtractionTaskDto>("/extraction/tasks", {
      project_id: projectId.value,
      ...(episodeId.value ? { episode_id: episodeId.value } : {}),
      task_type: taskType.value,
    });
    task.value = created;
    notice.value = created.deduped ? "已有进行中的同类型任务，已复用" : "抽取任务已创建";
    await loadDrafts(created.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建抽取任务失败";
  } finally {
    busy.value = false;
  }
}

async function loadDrafts(taskId: string): Promise<void> {
  try {
    const data = await api.get<ExtractionDraftListDto>(`/extraction/drafts?task_id=${taskId}&page_size=200`);
    drafts.value = data.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载草稿失败";
  }
}

async function redoTask(): Promise<void> {
  if (!task.value) return;
  busy.value = true;
  try {
    task.value = await api.post<ExtractionTaskDto>("/extraction/tasks/redo", { task_id: task.value.id });
    notice.value = "已重做（仅失败/失效任务可重做）";
    await loadDrafts(task.value.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "重做失败";
  } finally {
    busy.value = false;
  }
}

async function promoteDrafts(): Promise<void> {
  if (!projectId.value || drafts.value.length === 0) return;
  busy.value = true;
  try {
    const result = await api.post<{ items: Array<{ eed_id: string; asset_id: string; created: boolean }> }>(
      "/extraction/drafts/promote",
      { project_id: projectId.value, eed_ids: drafts.value.map((draft) => draft.eed_id) },
    );
    notice.value = `已把 ${result.items.length} 条草稿落为项目资产（草稿态，需再定稿）`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "落资产失败";
  } finally {
    busy.value = false;
  }
}

// ── 匹配 ─────────────────────────────────────────────────────────────
const match = ref<MatchResultDto | null>(null);
const supplement = ref<SupplementMissingDto | null>(null);
const MATCH_STATUS: Record<string, { text: string; cls: string }> = {
  none: { text: "未匹配", cls: "unknown" },
  partial: { text: "部分未定稿", cls: "reviewing" },
  matched: { text: "全部已匹配", cls: "ok" },
  missing: { text: "存在缺失资产", cls: "failed" },
};
const ENTRY_STATUS: Record<string, { text: string; cls: string }> = {
  matched: { text: "已匹配", cls: "ok" },
  unfinalized: { text: "未定稿", cls: "reviewing" },
  missing: { text: "缺失", cls: "failed" },
};

async function loadMatch(): Promise<void> {
  if (!projectId.value || !episodeId.value) return;
  try {
    match.value = await api.get<MatchResultDto>(
      `/projects/${projectId.value}/episodes/${episodeId.value}/match-result`,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载匹配结果失败";
  }
}

async function runMatch(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    await api.post(`/projects/${projectId.value}/episodes/${episodeId.value}/match-resources`, {});
    notice.value = "资产匹配已执行；结果以 match-result.status 为准（受理成功≠匹配成功）";
    await loadMatch();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "资产匹配失败";
  } finally {
    busy.value = false;
  }
}

async function resetMatch(): Promise<void> {
  busy.value = true;
  try {
    const preview = await api.post<{ would_remove: number; shot_count: number }>(
      `/projects/${projectId.value}/episodes/${episodeId.value}/match-reset`,
      { dry_run: true },
    );
    if (
      !confirm(
        `重置会清空本集 ${preview.shot_count} 个分镜上的 ${preview.would_remove} 条资产绑定（破坏性，一次选择只重跑一次）。继续？`,
      )
    ) {
      return;
    }
    const done = await api.post<{ removed: number }>(
      `/projects/${projectId.value}/episodes/${episodeId.value}/match-reset`,
      {},
    );
    notice.value = `已清空 ${done.removed} 条绑定`;
    await loadMatch();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "重置失败";
  } finally {
    busy.value = false;
  }
}

async function supplementMissing(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    supplement.value = await api.post<SupplementMissingDto>(
      `/projects/${projectId.value}/episodes/${episodeId.value}/supplement-missing`,
      {},
    );
    const pending = supplement.value.pending_image.length;
    notice.value =
      pending > 0
        ? `提示词已补全 ${supplement.value.completed.length + supplement.value.reused.length} 项；还有 ${pending} 项需要生图（生图会单独报价，不在本步扣费）`
        : "没有需要智能补充的缺失资产";
    await loadMatch();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "智能补充失败";
  } finally {
    busy.value = false;
  }
}

/** 以当前匹配清单为快照整体保存（三类数组必须一起提交，空类别显式 []） */
async function saveSnapshot(): Promise<void> {
  if (!match.value) return;
  busy.value = true;
  try {
    const toIds = (rows: MatchEntryDto[]) => rows.map((row) => ({ resource_id: row.resource_id }));
    await api.post(`/projects/${projectId.value}/episodes/${episodeId.value}/save-resource-matches`, {
      resources: {
        characters: toIds(match.value.characters),
        scenes: toIds(match.value.scenes),
        props: toIds(match.value.props),
      },
    });
    notice.value = "已按当前清单保存匹配关系（完整快照语义）";
    await loadMatch();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存匹配失败";
  } finally {
    busy.value = false;
  }
}

watch(projectId, async () => {
  task.value = null;
  drafts.value = [];
  match.value = null;
  supplement.value = null;
  await loadEpisodes();
  await loadMatch();
});
watch(episodeId, loadMatch);
onMounted(async () => {
  await loadProjects();
  await loadMatch();
});
</script>

<template>
  <div class="quality-panel">
    <div class="filters">
      <select v-model="projectId" class="mini-select">
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
      </select>
      <select v-model="episodeId" class="mini-select">
        <option v-for="episode in episodes" :key="episode.id" :value="episode.id">
          第 {{ episode.ep_no }} 集 {{ episode.title ?? "" }}
        </option>
      </select>
      <Button size="sm" variant="ghost" :disabled="loading" @click="loadProjects">刷新项目</Button>
      <span v-if="!projects.length && !loading" class="hint">还没有项目：先到「作品库」新建或从示例复制</span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="notice" class="ok">{{ notice }}</p>

    <section class="block">
      <header class="block-head">
        <h2>抽取流水线</h2>
        <span class="hint">草稿不会污染主体库/资产库；落资产后仍是草稿态，需再定稿</span>
      </header>
      <div class="filters">
        <select v-model.number="taskType" class="mini-select">
          <option v-for="type in TASK_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option>
        </select>
        <Button size="sm" :disabled="busy || !projectId" @click="startExtraction">开始抽取</Button>
        <Button
          v-if="task && task.retryable"
          size="sm"
          variant="ghost"
          :disabled="busy"
          @click="redoTask"
        >
          重做（仅失败/失效）
        </Button>
        <Button
          v-if="drafts.length"
          size="sm"
          variant="ghost"
          :disabled="busy"
          @click="promoteDrafts"
        >
          草稿落为项目资产（{{ drafts.length }}）
        </Button>
        <span v-if="task" class="badge" :class="TASK_STATUS[task.status_name]?.cls">
          任务 {{ TASK_STATUS[task.status_name]?.text ?? task.status_name }} · 主形态 {{ task.draft_count }} / 子形态
          {{ task.sub_draft_count }}
        </span>
      </div>
      <p v-if="task?.error" class="err">失败原因：{{ task.error.message ?? task.error.code }}</p>
      <ul v-if="drafts.length" class="draft-list">
        <li v-for="draft in drafts" :key="draft.eed_id" class="draft-row">
          <span class="draft-kind">{{ draft.kind_name }}</span>
          <span class="draft-name">{{ draft.name }}</span>
          <span class="draft-prompt">{{ draft.payload.prompt ? "有提示词" : "无提示词（需补全）" }}</span>
        </li>
      </ul>
      <p v-else-if="task" class="hint">该任务没有主形态草稿</p>
    </section>

    <section class="block">
      <header class="block-head">
        <h2>资产 × 分镜匹配</h2>
        <span v-if="match" class="badge" :class="MATCH_STATUS[match.status_name]?.cls">
          {{ MATCH_STATUS[match.status_name]?.text ?? match.status_name }}
        </span>
      </header>
      <div class="filters">
        <Button size="sm" :disabled="busy || !episodeId" @click="runMatch">执行资产匹配</Button>
        <Button size="sm" variant="ghost" :disabled="busy || !match" @click="saveSnapshot">
          保存当前清单为快照
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="busy || !match || match.supplement.target_count === 0"
          @click="supplementMissing"
        >
          智能补充缺失（{{ match?.supplement.target_count ?? 0 }}）
        </Button>
        <Button size="sm" variant="danger" :disabled="busy || !episodeId" @click="resetMatch">重置匹配</Button>
      </div>

      <template v-if="match">
        <div class="counts">
          <span>角色 {{ match.counts.characters.matched }}/{{ match.counts.characters.total }}</span>
          <span>场景 {{ match.counts.scenes.matched }}/{{ match.counts.scenes.total }}</span>
          <span>道具 {{ match.counts.props.matched }}/{{ match.counts.props.total }}</span>
          <span class="hint">
            已匹配 {{ match.totals.matched }} · 未定稿 {{ match.totals.unfinalized }} · 缺失
            {{ match.totals.missing }}
          </span>
        </div>
        <div class="cols">
          <div v-for="group in ['characters', 'scenes', 'props'] as const" :key="group" class="col">
            <h3>{{ group === "characters" ? "角色" : group === "scenes" ? "场景" : "道具" }}</h3>
            <p v-if="match[group].length === 0" class="hint">无</p>
            <div v-for="row in match[group]" :key="row.resource_id" class="entry">
              <img v-if="row.ref_image_url" :src="row.ref_image_url" :alt="row.name" loading="lazy" />
              <span v-else class="entry-noimg">无图</span>
              <span class="entry-name">{{ row.name }}</span>
              <span class="badge" :class="ENTRY_STATUS[row.status_name]?.cls">
                {{ ENTRY_STATUS[row.status_name]?.text ?? row.status_name }}
              </span>
            </div>
          </div>
        </div>
        <p class="hint">
          缺失资产默认「保持现状」（不阻塞进入分镜确认）；智能补充只给提示词，生图需在资产面板单独确认报价。
        </p>
      </template>
      <p v-else class="hint">选中项目与分集后可查看/执行匹配</p>

      <ul v-if="supplement && supplement.pending_image.length" class="draft-list">
        <li v-for="item in supplement.pending_image" :key="item.resource_id" class="draft-row">
          <span class="draft-kind">{{ item.kind }}</span>
          <span class="draft-name">{{ item.name }}</span>
          <span class="draft-prompt">待生图（提示词已补全）</span>
        </li>
      </ul>
      <ul v-if="supplement && supplement.failed.length" class="draft-list">
        <li v-for="item in supplement.failed" :key="item.resource_id" class="draft-row failed">
          <span class="draft-name">{{ item.name }}</span>
          <span class="draft-prompt">失败：{{ item.reason }}（保持未匹配，不自动重试）</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.quality-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.mini-select {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.mini-select:focus {
  border-color: var(--brand-500);
}
.block {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.block-head h2 {
  margin: 0;
  font-size: var(--text-md);
  color: var(--text-1);
}
.badge {
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  line-height: 20px;
  border: 1px solid var(--border-2);
  background: var(--bg-sunken);
  color: var(--text-2);
}
.badge.ok {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.badge.failed {
  background: var(--danger-bg);
  color: var(--danger);
  border-color: var(--danger);
}
.badge.running {
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}
.badge.invalid,
.badge.unknown {
  color: var(--text-4);
}
.err {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.ok {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}
.hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.draft-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow: auto;
}
.draft-row {
  display: grid;
  grid-template-columns: 70px 1fr auto;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-xs);
  color: var(--text-2);
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-1);
}
.draft-row.failed {
  color: var(--danger);
}
.draft-kind {
  color: var(--text-4);
}
.draft-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-prompt {
  color: var(--text-4);
}
.counts {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  font-size: var(--text-sm);
  color: var(--text-2);
}
.cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}
.col h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-3);
}
.entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: var(--text-xs);
  color: var(--text-2);
}
.entry img {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-2);
}
.entry-noimg {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border-2);
  color: var(--text-4);
  font-size: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 768px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
