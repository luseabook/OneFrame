<script setup lang="ts">
import type { ModelDto, ProjectAssetDto } from "~/types/api";

/**
 * 资产工作台（U5）—— 对照竞品 /asset（evidence/ui-compare/05-asset-library.png）。
 *
 * 竞品布局：内容区自上而下 = 三卡入口（AI 智能提取资产 大卡 + 白底最强 CTA + 免费徽标、
 * 生成…、导入…）→ kind 页签（角色/场景/道具/其他）→ 卡片网格。
 * 我方把「校验 → 批量生成」做成两段式（计划 §3.2 P1-6 / §5 U5），并补上批量选择、
 * 批量定稿、批量生成、进度、失败重试；资产卡可直接绑定当前镜头（PUT 整体替换 = 幂等）；
 * 配额读服务端模型目录 media_limits，不再静态拼 30/10/50。
 */

interface ProjectBrief {
  id: string;
  title: string;
}
interface EpisodeBrief {
  id: string;
  ep_no: number;
  title: string | null;
}
interface ShotBrief {
  id: string;
  shot_no: number;
  status: number;
  asset_ids?: string[];
}
interface ShotDetail {
  storyboard: { id: string; shot_no: number; asset_ids?: string[] };
}
interface GenerateAccepted {
  task_id: string;
}
interface ExtractResult {
  created: number;
  updated: number;
  skipped: number;
  truncated: boolean;
}
interface MediaLimits {
  image?: number;
  video?: number;
  audio?: number;
  total?: number;
}

type AssetKind = "character" | "scene" | "prop" | "other";
type Stage = "validate" | "generate";
type GenState = "queued" | "running" | "succeeded" | "failed";

interface GenRow {
  asset_id: string;
  name: string;
  kind: AssetKind;
  state: GenState;
  detail: string;
}

/** 单镜最多绑定资产数（服务端 storyboardAssetsPutSchema 上限 20） */
const MAX_BIND = 20;
/**
 * 抽取链路不计费：extraction.service / script.service#extractProjectAssets 全程没有
 * credits 冻结或结算，所以「免费」是真实口径；服务端没有「是否首次」计数，故不写「首次免费」。
 * 徽标只在 CTA 可用时出现 —— 禁用控件上不挂任何免费承诺。
 */
const EXTRACT_UNMETERED = true;

const api = useApi();
const { t } = useI18n();

const projects = ref<ProjectBrief[]>([]);
const projectId = ref("");
const episodes = ref<EpisodeBrief[]>([]);
const episodeId = ref("");
const shots = ref<ShotBrief[]>([]);
const shotId = ref("");
const shotAssetIds = ref<string[]>([]);

const assets = ref<ProjectAssetDto[]>([]);
const assetsLoading = ref(true);
const assetsError = ref("");
const booting = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");

const kind = ref<AssetKind>("character");
const selected = ref<string[]>([]);
const stage = ref<Stage>("validate");
const genRows = ref<GenRow[]>([]);
const generating = ref(false);
const binding = ref(false);
const extracting = ref(false);

const quotaModel = ref("");
const quotaLimits = ref<MediaLimits | null>(null);

const importOpen = ref(false);
const importError = ref("");
const importBusy = ref(false);
const importFile = ref<HTMLInputElement | null>(null);
const importFileName = ref("");
const importForm = reactive({
  name: "",
  kind: "scene" as "scene" | "prop" | "other",
  description: "",
  prompt: "",
});

function projectPath(): string {
  return "/projects/" + projectId.value;
}
function episodePath(): string {
  return projectPath() + "/episodes/" + episodeId.value;
}
function shotPath(sid: string): string {
  return episodePath() + "/storyboards/" + sid;
}

const KIND_TABS = computed<Array<{ value: AssetKind; label: string; count: number }>>(() => {
  const count = (value: AssetKind): number => assets.value.filter((item) => item.kind === value).length;
  const tabs: Array<{ value: AssetKind; label: string; count: number }> = [
    { value: "character", label: t("assets.workflow.kindCharacter"), count: count("character") },
    { value: "scene", label: t("assets.workflow.kindScene"), count: count("scene") },
    { value: "prop", label: t("assets.workflow.kindProp"), count: count("prop") },
  ];
  if (count("other") > 0) {
    tabs.push({ value: "other", label: t("assets.workflow.kindOther"), count: count("other") });
  }
  return tabs;
});

const visibleAssets = computed(() => assets.value.filter((item) => item.kind === kind.value));
const selectedAssets = computed(() => assets.value.filter((item) => selected.value.indexOf(item.id) >= 0));
const shotNo = computed(() => shots.value.find((item) => item.id === shotId.value)?.shot_no ?? 0);

function promptOf(asset: ProjectAssetDto): string {
  return String(asset.prompt ?? asset.description ?? "").trim();
}
function hasImage(asset: ProjectAssetDto): boolean {
  return Boolean(asset.portrait_url || asset.ref_image_uri);
}
function isFinalized(asset: ProjectAssetDto): boolean {
  return asset.status === 2;
}
/** 生成前逐条校验：返回不可生成原因（空串 = 可生成）。角色走定妆图链路，不在本批。 */
function genSkipReason(asset: ProjectAssetDto): string {
  if (asset.kind === "character") return t("assets.workflow.genCharacterReason");
  if (hasImage(asset)) return t("assets.workflow.genAlreadyReason");
  if (!promptOf(asset)) return t("assets.workflow.genNoPromptReason");
  return "";
}
const generatable = computed(() => selectedAssets.value.filter((item) => !genSkipReason(item)));
const draftSelected = computed(() => selectedAssets.value.filter((item) => !isFinalized(item)));

const aiReady = computed(() => Boolean(projectId.value) && !extracting.value);
/** 免费徽标只随可用 CTA 出现（禁用时绝不出现） */
const showFreeBadge = computed(() => EXTRACT_UNMETERED && aiReady.value);

const canNext = computed(() => generatable.value.length > 0);
const nextReason = computed(() => {
  if (selected.value.length === 0) return t("assets.workflow.nextNeedSelection");
  if (!canNext.value) return t("assets.workflow.nextNeedPrompt", { n: selected.value.length });
  return "";
});
const canConfirm = computed(() => draftSelected.value.length > 0 && !busy.value);
const confirmReason = computed(() => (canConfirm.value ? "" : t("assets.workflow.confirmNeedSelection")));
const canBind = computed(() => Boolean(shotId.value) && selected.value.length > 0 && !binding.value);
const bindReason = computed(() => {
  if (!shotId.value) return t("assets.workflow.bindNeedShot");
  if (selected.value.length === 0) return t("assets.workflow.bindNeedSelection");
  return "";
});
const genDone = computed(
  () => genRows.value.filter((row) => row.state === "succeeded" || row.state === "failed").length,
);
const genFailed = computed(() => genRows.value.filter((row) => row.state === "failed"));

const imageUsed = computed(() => assets.value.filter((item) => hasImage(item)).length);
const totalUsed = computed(() => assets.value.length);
const quotaText = computed(() => {
  const limits = quotaLimits.value;
  if (!limits) return "";
  return t("assets.workflow.quotaLine", {
    imgUsed: imageUsed.value,
    img: limits.image ?? "-",
    totalUsed: totalUsed.value,
    total: limits.total ?? "-",
  });
});

/** 集下拉：标题与「第 N 集」重复时不再重复拼接（数据里 title 常就是「第 1 集」） */
function episodeLabel(item: EpisodeBrief): string {
  const base = t("assets.workflow.episodeOption", { no: item.ep_no });
  const title = String(item.title ?? "").trim();
  if (!title || title === base) return base;
  return base + " · " + title;
}
function kindLabel(value: AssetKind): string {
  if (value === "character") return t("assets.workflow.kindCharacter");
  if (value === "scene") return t("assets.workflow.kindScene");
  if (value === "prop") return t("assets.workflow.kindProp");
  return t("assets.workflow.kindOther");
}
function genStateLabel(state: GenState): string {
  if (state === "queued") return t("assets.workflow.genQueued");
  if (state === "running") return t("assets.workflow.genRunning");
  if (state === "succeeded") return t("assets.workflow.genSucceeded");
  return t("assets.workflow.genFailedState");
}
function errorText(e: unknown, fallbackKey: string): string {
  return e instanceof Error && e.message ? e.message : t(fallbackKey);
}

// ── 读取 ───────────────────────────────────────────────────────────────
async function loadModels(): Promise<void> {
  try {
    const list = await api.get<ModelDto[]>("/models?capability=video&visible=true");
    for (const model of list) {
      const scene = model.scene_modes as Record<string, { media_limits?: MediaLimits }> | undefined;
      const limits = scene?.storyboard_reference_video?.media_limits;
      if (limits) {
        quotaModel.value = model.display_name || model.name;
        quotaLimits.value = limits;
        return;
      }
    }
    quotaLimits.value = null;
  } catch {
    quotaLimits.value = null;
  }
}

async function loadProjects(): Promise<void> {
  try {
    const data = await api.get<{ list: ProjectBrief[]; total: number }>("/projects?page=1&page_size=50");
    projects.value = data.list;
    if (data.list[0]) await selectProject(data.list[0].id);
  } catch (e) {
    error.value = errorText(e, "assets.workflow.loadFailed");
  } finally {
    booting.value = false;
  }
}

async function loadAssets(): Promise<void> {
  if (!projectId.value) {
    assets.value = [];
    assetsLoading.value = false;
    return;
  }
  assetsLoading.value = true;
  assetsError.value = "";
  try {
    const data = await api.get<{ list: ProjectAssetDto[] }>(projectPath() + "/assets");
    assets.value = data.list;
    selected.value = selected.value.filter((id) => data.list.some((item) => item.id === id));
  } catch (e) {
    assetsError.value = errorText(e, "assets.workflow.loadFailed");
  } finally {
    assetsLoading.value = false;
  }
}

async function selectProject(id: string): Promise<void> {
  projectId.value = id;
  selected.value = [];
  stage.value = "validate";
  genRows.value = [];
  try {
    const data = await api.get<{ episodes: EpisodeBrief[] }>(projectPath());
    episodes.value = data.episodes;
  } catch {
    episodes.value = [];
  }
  shotId.value = "";
  shots.value = [];
  shotAssetIds.value = [];
  await loadAssets();
  if (episodes.value[0]) await selectEpisode(episodes.value[0].id);
}

async function selectEpisode(id: string): Promise<void> {
  episodeId.value = id;
  shotId.value = "";
  shots.value = [];
  shotAssetIds.value = [];
  if (!id) return;
  try {
    const data = await api.get<{ storyboards: ShotBrief[] }>(episodePath());
    shots.value = data.storyboards;
  } catch {
    shots.value = [];
  }
  if (shots.value[0]) await selectShot(shots.value[0].id);
}

async function selectShot(id: string): Promise<void> {
  shotId.value = id;
  shotAssetIds.value = [];
  if (!id) return;
  try {
    const data = await api.get<ShotDetail>(shotPath(id));
    shotAssetIds.value = data.storyboard.asset_ids ?? [];
  } catch {
    shotAssetIds.value = [];
  }
}

onMounted(async () => {
  await Promise.all([loadModels(), loadProjects()]);
});

// ── 选择 ───────────────────────────────────────────────────────────────
function isSelected(id: string): boolean {
  return selected.value.indexOf(id) >= 0;
}
function toggleSelect(id: string): void {
  selected.value = isSelected(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id];
}
function selectAllVisible(): void {
  selected.value = Array.from(new Set([...selected.value, ...visibleAssets.value.map((item) => item.id)]));
}
function clearSelection(): void {
  selected.value = [];
}
function selectKind(value: AssetKind): void {
  kind.value = value;
}

// ── 校验 → 批量生成 ────────────────────────────────────────────────────
async function confirmSelected(): Promise<void> {
  if (!canConfirm.value) return;
  busy.value = true;
  error.value = "";
  try {
    const ids = draftSelected.value.map((item) => item.id);
    await api.post(projectPath() + "/assets/batch-confirm", { asset_ids: ids });
    notice.value = t("assets.workflow.confirmDone", { n: ids.length });
    await loadAssets();
  } catch (e) {
    error.value = errorText(e, "assets.workflow.confirmFailed");
  } finally {
    busy.value = false;
  }
}

async function submitGenerate(ids: string[]): Promise<void> {
  if (generating.value || ids.length === 0) return;
  generating.value = true;
  try {
    for (const row of genRows.value) {
      if (ids.indexOf(row.asset_id) < 0) continue;
      row.state = "running";
      row.detail = "";
      try {
        const accepted = await api.post<GenerateAccepted>(
          projectPath() + "/assets/" + row.asset_id + "/generate-image",
          { count: 1 },
        );
        row.state = "succeeded";
        row.detail = t("assets.workflow.genSubmitted", { taskId: accepted.task_id });
      } catch (e) {
        row.state = "failed";
        row.detail = errorText(e, "assets.workflow.genFailed");
      }
    }
  } finally {
    generating.value = false;
  }
}

function startGenerate(): void {
  if (!canNext.value) return;
  error.value = "";
  notice.value = "";
  genRows.value = generatable.value.map((asset) => ({
    asset_id: asset.id,
    name: asset.name,
    kind: asset.kind as AssetKind,
    state: "queued" as GenState,
    detail: "",
  }));
  stage.value = "generate";
  void submitGenerate(genRows.value.map((row) => row.asset_id));
}

function retryFailed(): void {
  const ids = genFailed.value.map((row) => row.asset_id);
  if (ids.length === 0) return;
  for (const row of genRows.value) {
    if (ids.indexOf(row.asset_id) >= 0) {
      row.state = "queued";
      row.detail = "";
    }
  }
  void submitGenerate(ids);
}

// ── 绑定到当前镜头（整体替换 = 幂等；无变更不提交）────────────────────
async function bindAssets(ids: string[]): Promise<void> {
  if (!projectId.value || !episodeId.value || !shotId.value || binding.value || ids.length === 0) return;
  binding.value = true;
  error.value = "";
  try {
    const detail = await api.get<ShotDetail>(shotPath(shotId.value));
    const current = detail.storyboard.asset_ids ?? [];
    const merged: string[] = [];
    for (const id of [...current, ...ids]) {
      if (merged.indexOf(id) < 0) merged.push(id);
    }
    if (merged.length === current.length) {
      notice.value = t("assets.workflow.bindNoop", { no: shotNo.value });
      return;
    }
    if (merged.length > MAX_BIND) {
      error.value = t("assets.workflow.bindFull", { max: MAX_BIND });
      return;
    }
    const res = await api.put<{ asset_ids: string[] }>(shotPath(shotId.value) + "/assets", {
      asset_ids: merged,
    });
    shotAssetIds.value = res.asset_ids ?? merged;
    notice.value = t("assets.workflow.bindDone", { n: merged.length - current.length, no: shotNo.value });
    if (selectedAssets.value.some((item) => !isFinalized(item) || !hasImage(item))) {
      notice.value += " " + t("assets.workflow.bindWarning");
    }
    await loadAssets();
  } catch (e) {
    error.value = errorText(e, "assets.workflow.bindFailed");
  } finally {
    binding.value = false;
  }
}
function bindSelected(): void {
  void bindAssets(selected.value);
}
function bindOne(asset: ProjectAssetDto): void {
  void bindAssets([asset.id]);
}

// ── AI 提取 ───────────────────────────────────────────────────────────
async function runExtract(): Promise<void> {
  if (!aiReady.value || !projectId.value) return;
  extracting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const body: { episode_id?: string; include_characters: boolean; overwrite: boolean } = {
      include_characters: kind.value === "character",
      overwrite: false,
    };
    if (episodeId.value) body.episode_id = episodeId.value;
    const res = await api.post<ExtractResult>(projectPath() + "/assets/extract", body);
    let text = t("assets.workflow.aiResult", {
      created: res.created,
      updated: res.updated,
      skipped: res.skipped,
    });
    if (res.truncated) text += " " + t("assets.workflow.aiTruncated");
    notice.value = text;
    await loadAssets();
  } catch (e) {
    error.value = errorText(e, "assets.workflow.aiFailed");
  } finally {
    extracting.value = false;
  }
}

// ── 导入 ──────────────────────────────────────────────────────────────
function openImport(): void {
  importError.value = "";
  importForm.name = "";
  importForm.kind = kind.value === "character" ? "scene" : (kind.value as "scene" | "prop" | "other");
  importForm.description = "";
  importForm.prompt = "";
  importFileName.value = "";
  importOpen.value = true;
}
function closeImport(): void {
  if (importBusy.value) return;
  importOpen.value = false;
}
function onImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    importError.value = t("assets.workflow.impImageTooLarge");
    input.value = "";
    return;
  }
  importFileName.value = file.name;
  importError.value = "";
}
async function fileToBase64(file: File): Promise<{ data_base64: string; content_type: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("assets.workflow.impFailed")));
    reader.readAsDataURL(file);
  });
  const parts = dataUrl.split(",");
  const contentType = (parts[0] ?? "").replace("data:", "").replace(";base64", "");
  return { data_base64: parts[1] ?? "", content_type: contentType || "image/png" };
}
async function submitImport(): Promise<void> {
  if (!projectId.value || importBusy.value) return;
  if (!importForm.name.trim()) {
    importError.value = t("assets.workflow.impNameRequired");
    return;
  }
  importBusy.value = true;
  importError.value = "";
  try {
    let refUri: string | undefined;
    const file = importFile.value?.files?.[0];
    if (file) {
      const payload = await fileToBase64(file);
      const uploaded = await api.post<{ uri: string }>("/assets/upload", {
        filename: file.name.slice(0, 200),
        content_type: payload.content_type,
        data_base64: payload.data_base64,
      });
      refUri = uploaded.uri;
    }
    const body: { kind: string; name: string; description?: string; prompt?: string; ref_image_uri?: string } = {
      kind: importForm.kind,
      name: importForm.name.trim(),
    };
    if (importForm.description.trim()) body.description = importForm.description.trim();
    if (importForm.prompt.trim()) body.prompt = importForm.prompt.trim();
    if (refUri) body.ref_image_uri = refUri;
    await api.post(projectPath() + "/assets", body);
    notice.value = t("assets.workflow.impCreated", { name: importForm.name.trim() });
    importOpen.value = false;
    await loadAssets();
  } catch (e) {
    importError.value = errorText(e, "assets.workflow.impFailed");
  } finally {
    importBusy.value = false;
  }
}
</script>

<template>
  <section class="aw" :aria-busy="booting ? 'true' : 'false'">
    <header class="aw-head">
      <div class="aw-head-main">
        <h2 class="aw-title">{{ t("assets.workflow.title") }}</h2>
        <p class="aw-sub">{{ t("assets.workflow.sub") }}</p>
      </div>
      <div class="aw-ctx">
        <label class="aw-field">
          <span>{{ t("assets.workflow.ctxProject") }}</span>
          <select
            v-model="projectId"
            class="aw-select"
            data-ctx="project"
            :disabled="booting || projects.length === 0"
            @change="selectProject(projectId)"
          >
            <option v-if="!projects.length" value="">{{ t("assets.workflow.noProject") }}</option>
            <option v-for="item in projects" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.ctxEpisode") }}</span>
          <select
            v-model="episodeId"
            class="aw-select"
            data-ctx="episode"
            :disabled="episodes.length === 0"
            @change="selectEpisode(episodeId)"
          >
            <option v-if="!episodes.length" value="">{{ t("assets.workflow.noEpisode") }}</option>
            <option v-for="item in episodes" :key="item.id" :value="item.id">
              {{ episodeLabel(item) }}
            </option>
          </select>
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.ctxShot") }}</span>
          <select
            v-model="shotId"
            class="aw-select"
            data-ctx="shot"
            :disabled="shots.length === 0"
            @change="selectShot(shotId)"
          >
            <option v-if="!shots.length" value="">{{ t("assets.workflow.noShot") }}</option>
            <option v-for="item in shots" :key="item.id" :value="item.id">
              {{ t("assets.workflow.shotOption", { no: item.shot_no }) }}
            </option>
          </select>
        </label>
      </div>
    </header>

    <p v-if="error" class="aw-err" role="alert" data-alert="error">{{ error }}</p>
    <p v-if="notice" class="aw-ok" role="status" data-alert="notice">{{ notice }}</p>

    <!-- 三卡入口：AI 提取（白色最强 CTA）/ 生成 / 导入 -->
    <div class="aw-entries">
      <article class="aw-card aw-card--ai" data-entry="ai">
        <div class="aw-card-head">
          <h3 class="aw-card-title">{{ t("assets.workflow.aiTitle") }}</h3>
          <span v-if="showFreeBadge" class="aw-badge" data-badge="free">
            {{ t("assets.workflow.aiBadge") }}
          </span>
        </div>
        <p class="aw-desc">{{ t("assets.workflow.aiDesc") }}</p>
        <button
          type="button"
          class="aw-cta-white"
          data-cta="ai"
          :disabled="!aiReady"
          :aria-describedby="aiReady ? undefined : 'aw-why-ai'"
          @click="runExtract"
        >
          <span aria-hidden="true">✦</span>
          <span>{{ extracting ? t("assets.workflow.aiRunning") : t("assets.workflow.aiCta") }}</span>
        </button>
        <p v-if="!aiReady" id="aw-why-ai" class="aw-why" data-why="ai">
          {{ t("assets.workflow.aiNeedProject") }}
        </p>
      </article>

      <div class="aw-two">
        <article class="aw-card" data-entry="generate">
          <div class="aw-card-head">
            <h3 class="aw-card-title">{{ t("assets.workflow.genTitle") }}</h3>
          </div>
          <p class="aw-desc">{{ t("assets.workflow.genDesc") }}</p>
          <button
            type="button"
            class="aw-cta-ghost"
            data-cta="generate"
            :disabled="!canNext"
            :aria-describedby="canNext ? undefined : 'aw-why-generate'"
            @click="startGenerate"
          >
            <span aria-hidden="true">✦</span>
            <span>{{ t("assets.workflow.genCta") }}</span>
          </button>
          <p v-if="!canNext" id="aw-why-generate" class="aw-why" data-why="generate">
            {{ nextReason }}
          </p>
        </article>

        <article class="aw-card" data-entry="import">
          <div class="aw-card-head">
            <h3 class="aw-card-title">{{ t("assets.workflow.impTitle") }}</h3>
          </div>
          <p class="aw-desc">{{ t("assets.workflow.impDesc") }}</p>
          <button
            type="button"
            class="aw-cta-ghost"
            data-cta="import"
            :disabled="!projectId"
            :aria-describedby="projectId ? undefined : 'aw-why-import'"
            @click="openImport"
          >
            <span aria-hidden="true">↓</span>
            <span>{{ t("assets.workflow.impCta") }}</span>
          </button>
          <p v-if="!projectId" id="aw-why-import" class="aw-why" data-why="import">
            {{ t("assets.workflow.aiNeedProject") }}
          </p>
        </article>
      </div>
    </div>

    <!-- kind 页签：角色 / 场景 / 道具（存在 other 时多一页签） -->
    <nav class="aw-kinds" role="tablist" :aria-label="t('assets.workflow.title')">
      <button
        v-for="item in KIND_TABS"
        :key="item.value"
        type="button"
        class="aw-kind"
        :class="{ on: kind === item.value }"
        role="tab"
        :aria-selected="kind === item.value"
        :data-kind="item.value"
        @click="selectKind(item.value)"
      >
        {{ item.label }}
        <span class="aw-kind-count">{{ item.count }}</span>
      </button>
    </nav>

    <ol class="aw-steps">
      <li class="aw-step" :class="{ on: stage === 'validate' }" data-step="validate">
        {{ t("assets.workflow.stepValidate") }}
      </li>
      <li class="aw-step" :class="{ on: stage === 'generate' }" data-step="generate">
        {{ t("assets.workflow.stepGenerate") }}
      </li>
    </ol>

    <!-- 第 1 段：校验 -->
    <div v-if="stage === 'validate'" class="aw-body" data-stage="validate">
      <div class="aw-toolbar">
        <button type="button" class="aw-link" data-action="select-all" @click="selectAllVisible">
          {{ t("assets.workflow.selectAll") }}
        </button>
        <button
          type="button"
          class="aw-link"
          data-action="clear-selection"
          :disabled="selected.length === 0"
          @click="clearSelection"
        >
          {{ t("assets.workflow.clearSelection") }}
        </button>
        <span class="aw-sel" data-selected>{{ t("assets.workflow.selectedCount", { n: selected.length }) }}</span>
        <span class="spacer" />
        <button
          type="button"
          class="aw-cta-ghost aw-cta-ghost--sm"
          data-action="confirm"
          :disabled="!canConfirm"
          :aria-describedby="canConfirm ? undefined : 'aw-why-confirm'"
          @click="confirmSelected"
        >
          {{ t("assets.workflow.confirmSelected", { n: draftSelected.length }) }}
        </button>
        <span v-if="!canConfirm" id="aw-why-confirm" class="aw-why" data-why="confirm">
          {{ confirmReason }}
        </span>
      </div>

      <p
        v-if="quotaLimits"
        class="aw-quota"
        data-quota
        :title="t('assets.workflow.quotaSource', { model: quotaModel })"
      >
        {{ quotaText }} · {{ t("assets.workflow.quotaUnlinked") }}
      </p>
      <p v-else class="aw-quota" data-quota="missing">{{ t("assets.workflow.quotaMissing") }}</p>

      <p class="aw-hint">{{ t("assets.workflow.validateHint") }}</p>

      <Skeleton v-if="booting || assetsLoading" :rows="3" />
      <p v-else-if="assetsError" class="aw-err" role="alert">{{ assetsError }}</p>
      <div v-else-if="visibleAssets.length" class="aw-grid" data-grid>
        <article
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="aw-asset"
          :class="{ sel: isSelected(asset.id) }"
          :data-asset-id="asset.id"
          :data-kind="asset.kind"
          :data-status="asset.status"
        >
          <label class="aw-check">
            <input
              type="checkbox"
              :checked="isSelected(asset.id)"
              :aria-label="asset.name"
              @change="toggleSelect(asset.id)"
            />
          </label>
          <div class="aw-thumb">
            <img v-if="asset.portrait_url" :src="asset.portrait_url" :alt="asset.name" loading="lazy" />
            <span v-else class="aw-thumb-empty">{{ t("assets.workflow.noImage") }}</span>
          </div>
          <div class="aw-meta">
            <p class="aw-name" :title="asset.name">{{ asset.name }}</p>
            <div class="aw-tags">
              <span class="aw-tag">{{ kindLabel(asset.kind as AssetKind) }}</span>
              <span class="aw-tag" :class="{ ok: isFinalized(asset) }">
                {{ isFinalized(asset) ? t("assets.workflow.statusFinalized") : t("assets.workflow.statusDraft") }}
              </span>
              <span class="aw-tag" :class="hasImage(asset) ? 'ok' : 'warn'">
                {{ hasImage(asset) ? t("assets.workflow.hasImage") : t("assets.workflow.noImage") }}
              </span>
              <span class="aw-tag">
                {{ t("assets.workflow.boundShots", { n: asset.bound_shot_count ?? 0 }) }}
              </span>
            </div>
            <p v-if="genSkipReason(asset)" class="aw-why aw-why--sm" data-skip>
              {{ genSkipReason(asset) }}
            </p>
          </div>
          <div class="aw-asset-ops">
            <button
              type="button"
              class="aw-link"
              data-action="bind"
              :data-bind-asset="asset.id"
              :disabled="!shotId || binding"
              :aria-describedby="shotId ? undefined : 'aw-why-bind-card'"
              @click="bindOne(asset)"
            >
              {{ t("assets.workflow.bindCta") }}
            </button>
            <span v-if="!shotId" id="aw-why-bind-card" class="aw-why aw-why--sm">
              {{ t("assets.workflow.bindNeedShot") }}
            </span>
          </div>
        </article>
      </div>
      <p v-else class="aw-empty" data-empty>
        {{ t("assets.workflow.emptyKind", { kind: kindLabel(kind) }) }}
      </p>

      <div class="aw-foot">
        <button
          type="button"
          class="aw-cta-white"
          data-action="next-generate"
          :disabled="!canNext"
          :aria-describedby="canNext ? undefined : 'aw-why-next'"
          @click="startGenerate"
        >
          {{ t("assets.workflow.nextGenerate", { n: generatable.length }) }}
        </button>
        <span v-if="!canNext" id="aw-why-next" class="aw-why" data-why="next">{{ nextReason }}</span>
        <span class="spacer" />
        <button
          type="button"
          class="aw-cta-white"
          data-action="bind-selected"
          :disabled="!canBind"
          :aria-describedby="canBind ? undefined : 'aw-why-bind'"
          @click="bindSelected"
        >
          {{ t("assets.workflow.bindSelected", { no: shotNo }) }}
        </button>
        <span v-if="!canBind" id="aw-why-bind" class="aw-why" data-why="bind">{{ bindReason }}</span>
      </div>
    </div>

    <!-- 第 2 段：批量生成 -->
    <div v-else class="aw-body" data-stage="generate">
      <div class="aw-toolbar">
        <Progress :value="genDone" :max="genRows.length" :tone="genFailed.length ? 'warning' : 'brand'">
          <span data-progress>{{ t("assets.workflow.progress", { done: genDone, total: genRows.length }) }}</span>
        </Progress>
        <button
          type="button"
          class="aw-cta-ghost aw-cta-ghost--sm"
          data-action="retry-failed"
          :disabled="genFailed.length === 0 || generating"
          @click="retryFailed"
        >
          {{ t("assets.workflow.retryFailed", { n: genFailed.length }) }}
        </button>
        <span v-if="genFailed.length === 0" class="aw-why" data-why="retry">
          {{ t("assets.workflow.retryNone") }}
        </span>
        <span class="spacer" />
        <button type="button" class="aw-link" data-action="back-validate" @click="stage = 'validate'">
          {{ t("assets.workflow.backToValidate") }}
        </button>
      </div>

      <ul class="aw-queue" data-queue>
        <li
          v-for="row in genRows"
          :key="row.asset_id"
          class="aw-gen"
          :data-asset-id="row.asset_id"
          :data-state="row.state"
        >
          <span class="aw-gen-state" :class="row.state">{{ genStateLabel(row.state) }}</span>
          <span class="aw-gen-name">{{ row.name }}</span>
          <span class="aw-gen-detail">{{ row.detail }}</span>
        </li>
      </ul>
    </div>

    <Modal v-if="importOpen" :title="t('assets.workflow.impTitle')" width="520px" @close="closeImport">
      <div class="aw-imp">
        <label class="aw-field">
          <span>{{ t("assets.workflow.impName") }}</span>
          <input v-model="importForm.name" class="aw-input" maxlength="50" data-imp="name" />
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.impKind") }}</span>
          <select v-model="importForm.kind" class="aw-select" data-imp="kind">
            <option value="scene">{{ t("assets.workflow.kindScene") }}</option>
            <option value="prop">{{ t("assets.workflow.kindProp") }}</option>
            <option value="other">{{ t("assets.workflow.kindOther") }}</option>
          </select>
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.impDescField") }}</span>
          <input v-model="importForm.description" class="aw-input" maxlength="200" data-imp="description" />
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.impPrompt") }}</span>
          <input v-model="importForm.prompt" class="aw-input" maxlength="500" data-imp="prompt" />
        </label>
        <label class="aw-field">
          <span>{{ t("assets.workflow.impImage") }}</span>
          <input
            ref="importFile"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="aw-file"
            data-imp="file"
            @change="onImportFile"
          />
          <span v-if="importFileName" class="aw-hint">{{ importFileName }}</span>
        </label>
        <p v-if="importError" class="aw-err" role="alert">{{ importError }}</p>
      </div>
      <template #footer>
        <Button variant="ghost" size="sm" :disabled="importBusy" @click="closeImport">
          {{ t("assets.workflow.impCancel") }}
        </Button>
        <Button
          size="sm"
          :disabled="importBusy || !importForm.name.trim()"
          data-imp="submit"
          @click="submitImport"
        >
          {{ t("assets.workflow.impSubmit") }}
        </Button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.aw {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 1000px;
  margin: 0 auto;
  padding-bottom: var(--space-8);
}
.aw-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.aw-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
}
.aw-sub {
  margin: var(--space-1) 0 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.aw-ctx {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.aw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-3);
}
.aw-select,
.aw-input {
  height: 32px;
  min-width: 132px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-control);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  outline: none;
}
.aw-select:focus,
.aw-input:focus {
  border-color: var(--brand-500);
}
.aw-select:disabled,
.aw-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 三卡入口：大卡（AI 提取：暖深底 #1F1A19 + 白 CTA）+ 两张并排卡 */
.aw-entries {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.aw-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
}
.aw-card--ai {
  background: #1f1a19;
  border-color: #322b28;
}
.aw-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.aw-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.aw-card-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-1);
}
.aw-desc {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-sm);
  line-height: 1.5;
}
.aw-badge {
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  background: var(--brand-soft-strong);
  color: var(--brand-on-soft);
  font-size: 11px;
  line-height: 20px;
}
.aw-cta-white {
  height: var(--control-h-md);
  padding: 0 var(--space-4);
  border: 1px solid #ffffff;
  border-radius: var(--radius-control);
  background: #ffffff;
  color: #14141c;
  font-size: var(--text-sm);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.aw-cta-white:hover:not(:disabled) {
  background: #ece9ff;
}
.aw-cta-white:disabled {
  opacity: 1;
  background: #ffffff33;
  border-color: transparent;
  color: #ffffff99;
  cursor: not-allowed;
}
.aw-cta-ghost {
  height: var(--control-h-md);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-control);
  background: var(--bg-hover);
  color: var(--text-1);
  font-size: var(--text-sm);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}
.aw-cta-ghost--sm {
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
}
.aw-cta-ghost:hover:not(:disabled) {
  border-color: var(--border-3);
  background: var(--bg-surface);
}
.aw-cta-ghost:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.aw-why {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.aw-why--sm {
  font-size: 11px;
}
.aw-link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--brand-300);
  font-size: var(--text-xs);
  cursor: pointer;
}
.aw-link:disabled {
  color: var(--text-4);
  cursor: not-allowed;
}

.aw-kinds {
  display: flex;
  gap: var(--space-5);
  border-bottom: 1px solid var(--border-1);
}
.aw-kind {
  position: relative;
  padding: 8px 0 10px;
  border: none;
  background: none;
  color: var(--text-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.aw-kind.on {
  color: var(--text-1);
}
.aw-kind.on::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--tab-line, #ffffff);
  border-radius: var(--radius-full);
}
.aw-kind-count {
  margin-left: 4px;
  color: var(--text-4);
  font-size: 11px;
}

.aw-steps {
  display: flex;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.aw-step.on {
  color: var(--text-1);
}

.aw-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.aw-sel {
  color: var(--text-2);
  font-size: var(--text-xs);
}
.aw-quota {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.aw-hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
.aw-err {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: var(--text-sm);
}
.aw-ok {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  font-size: var(--text-sm);
}
.aw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}
.aw-asset {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.aw-asset.sel {
  border-color: var(--brand-500);
}
.aw-check {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  z-index: 1;
}
.aw-thumb {
  height: 120px;
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.aw-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.aw-thumb-empty {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.aw-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.aw-name {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aw-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.aw-tag {
  padding: 0 6px;
  height: 20px;
  line-height: 20px;
  border-radius: var(--radius-full);
  background: var(--bg-hover);
  color: var(--text-2);
  font-size: 11px;
}
.aw-tag.ok {
  background: var(--brand-soft);
  color: var(--brand-on-soft);
}
.aw-tag.warn {
  background: #3a2f14;
  color: #f0b95b;
}
.aw-asset-ops {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.aw-empty {
  margin: 0;
  padding: var(--space-8) 0;
  text-align: center;
  color: var(--text-3);
  font-size: var(--text-sm);
}
.aw-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-1);
}
.aw-queue {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.aw-gen {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  font-size: var(--text-sm);
}
.aw-gen-state {
  min-width: 64px;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.aw-gen-state.running {
  color: var(--brand-300);
}
.aw-gen-state.succeeded {
  color: #4ade80;
}
.aw-gen-state.failed {
  color: var(--danger);
}
.aw-gen-name {
  color: var(--text-1);
}
.aw-gen-detail {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.aw-imp {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.aw-file {
  font-size: var(--text-xs);
  color: var(--text-2);
}

@media (max-width: 900px) {
  .aw-two {
    grid-template-columns: 1fr;
  }
  .aw-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
