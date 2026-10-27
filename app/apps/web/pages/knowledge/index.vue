<script setup lang="ts">
import type {
  KnowledgeAssetDto,
  KnowledgeAssetListDto,
  KnowledgeBaseDto,
  KnowledgeDirNodeDto,
  KnowledgeDirTreeDto,
  KnowledgeInfoDto,
  KnowledgeTagDto,
} from "~/types/api";

/**
 * 团队知识库（`/knowledge`）—— 对照竞品 `/team/knowledge-base`（`routes.txt:92`）
 * 与 `df/user_knowledge/*` 29 端点（`routes.txt:737-765`）。
 *
 * 页面结构对应后端三层：**目录树 → 资产 → 标签**。
 *
 * 两个必须让用户看见的规则：
 * 1. **删目录是级联软删**（子树 + 子树内资产一起打删除标记，行保留可恢复），
 *    所以确认框里必须给出"将影响 N 个子目录 / M 条资产"——数字来自后端返回，
 *    前端不自己猜（它拿不到整棵子树的资产计数）。
 * 2. **标签是先建后用的共享词表**：给资产打标签时只能选已存在的标签，
 *    未知标签后端会 400101；所以页面上有独立的"标签管理"，不做"输入即新建"。
 *
 * 第 59 批补的**知识库实体**（页头）：对应竞品 `create`/`update`/`info/update`/`delete`
 * 四条无 id 参数的端点 —— 一个空间只有**一个**库，所以这四个动作不需要目标 id。
 * 名称走 `POST /knowledge/base/update`（页头就地改名），简介/封面/说明走
 * `POST /knowledge/base/info/update`（传了才改，避免改名时误清简介）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const { t } = useI18n();
useHead({ title: () => t("knowledge.metaTitle") });

const api = useApi();
const toast = useToast();

const loading = ref(true);
const errorMsg = ref("");
const tree = ref<KnowledgeDirNodeDto[]>([]);
const flatDirs = ref<KnowledgeDirNodeDto[]>([]);
const tags = ref<KnowledgeTagDto[]>([]);
const info = ref<KnowledgeInfoDto | null>(null);
const base = ref<KnowledgeBaseDto | null>(null);
const assets = ref<KnowledgeAssetDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;

/** 页头实体编辑态：分开存两份，因为改名与改概览是两个端点 */
const editingBase = ref(false);
const baseForm = reactive({ name: "", description: "", cover_uri: "", note: "" });
const savingBase = ref(false);

const selectedDirId = ref("");
const includeChildren = ref(true);
const keyword = ref("");
const filterTag = ref("");

const newDirName = ref("");
const newSubDirName = ref("");
const newTagName = ref("");
const renamingDirId = ref("");
const renamingDirName = ref("");

const assetForm = reactive({ title: "", content: "", tagIds: [] as string[] });
const importAssetId = ref("");
const importDirId = ref("");
const selectedIds = ref<string[]>([]);
const movingDirId = ref("");

async function loadDirs() {
  const res = await api.get<KnowledgeDirTreeDto>("/knowledge/dirs");
  tree.value = res.tree;
  flatDirs.value = res.list;
}

async function loadTags() {
  const res = await api.get<{ list: KnowledgeTagDto[] }>("/knowledge/tags");
  tags.value = res.list;
}

async function loadInfo() {
  info.value = await api.get<KnowledgeInfoDto>("/knowledge/info");
  // 第 59 批：实体块随 info 一起下发，省一次请求
  base.value = info.value.base ?? null;
}

async function loadAssets() {
  const params = new URLSearchParams();
  params.set("page", String(page.value));
  params.set("page_size", String(pageSize));
  if (selectedDirId.value) {
    params.set("dir_id", selectedDirId.value);
    if (includeChildren.value) params.set("include_children", "true");
  }
  if (filterTag.value) params.set("tags", filterTag.value);

  // 有关键词就走搜索端点（跨目录），否则走目录列表端点 —— 与竞品两个端点同口径
  const path = keyword.value.trim()
    ? `/knowledge/assets/search?${params.toString()}&keyword=${encodeURIComponent(keyword.value.trim())}`
    : `/knowledge/assets?${params.toString()}`;
  const res = await api.get<KnowledgeAssetListDto>(path);
  assets.value = res.list;
  total.value = res.total;
}

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    await Promise.all([loadDirs(), loadTags(), loadInfo()]);
    await loadAssets();
  } catch (e) {
    errorMsg.value = (e as Error).message || t("knowledge.loadFailed");
  } finally {
    loading.value = false;
  }
}

function tagNamesOf(ids: string[]): string[] {
  return ids
    .map((id) => tags.value.find((t) => t.id === id)?.name)
    .filter((n): n is string => Boolean(n));
}

// ── 知识库实体（页头）────────────────────────────────────
/**
 * 一个 space 只有一个库（竞品那 4 条实体端点都没有目标 id），
 * 所以这里没有"切换库"，只有"改这个库的名字/简介/封面"。
 *
 * 懒初始化在服务端：老空间第一次 GET `/knowledge/base` 会补一行默认库，
 * 前端不做"没有就显示新建表单"的分支 —— 否则老空间会看到一个空壳页头。
 */
function startEditBase() {
  if (!base.value) return;
  baseForm.name = base.value.name;
  baseForm.description = base.value.description;
  baseForm.cover_uri = base.value.cover_uri;
  baseForm.note = base.value.note;
  editingBase.value = true;
}

function cancelEditBase() {
  editingBase.value = false;
  savingBase.value = false;
}

async function saveBase() {
  const name = baseForm.name.trim();
  if (!name) {
    toast.error(t("knowledge.baseNameRequired"));
    return;
  }
  savingBase.value = true;
  try {
    // 先改名、再改概览：两个端点分开，任一失败都只回滚自己的字段
    const renamed = await api.post<{ base: KnowledgeBaseDto }>("/knowledge/base/update", { name });
    const patched = await api.post<{ base: KnowledgeBaseDto }>("/knowledge/base/info/update", {
      description: baseForm.description.trim(),
      cover_uri: baseForm.cover_uri.trim(),
      note: baseForm.note.trim(),
    });
    base.value = patched.base ?? renamed.base;
    editingBase.value = false;
    toast.success(t("knowledge.baseSaved"));
    await loadInfo();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.baseSaveFailed"));
  } finally {
    savingBase.value = false;
  }
}

async function deleteBase(purge: boolean) {
  const dirs = info.value?.dir_count ?? 0;
  const assetCount = info.value?.asset_count ?? 0;
  const prompt = purge
    ? t("knowledge.basePurgeConfirm", { dirs, assets: assetCount })
    : t("knowledge.baseDeleteConfirm");
  if (!window.confirm(prompt)) return;
  try {
    await api.post("/knowledge/base/delete", purge ? { purge: true } : {});
    toast.success(purge ? t("knowledge.basePurged") : t("knowledge.baseDeleted"));
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.baseDeleteFailed"));
  }
}

// ── 目录 ────────────────────────────────────────────────
async function createDir() {
  const name = newDirName.value.trim();
  if (!name) {
    toast.error(t("knowledge.dirNameRequired"));
    return;
  }
  try {
    await api.post("/knowledge/dirs", { name, ...(selectedDirId.value ? { parent_id: selectedDirId.value } : {}) });
    toast.success(t("knowledge.dirCreated"));
    newDirName.value = "";
    newSubDirName.value = "";
    await loadDirs();
    await loadInfo();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.dirCreateFailed"));
  }
}

async function renameDir(dir: KnowledgeDirNodeDto) {
  const name = renamingDirName.value.trim();
  if (!name) {
    toast.error(t("knowledge.renameRequired"));
    return;
  }
  try {
    await api.patch(`/knowledge/dirs/${dir.id}`, { name });
    toast.success(t("knowledge.renamed"));
    renamingDirId.value = "";
    renamingDirName.value = "";
    await loadDirs();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.renameFailed"));
  }
}

async function deleteDir(dir: KnowledgeDirNodeDto) {
  if (!window.confirm(t("knowledge.deleteDirConfirm", { name: dir.name }))) return;
  try {
    const res = await api.delete<{ dirs: number; assets: number }>(`/knowledge/dirs/${dir.id}`);
    toast.success(t("knowledge.dirDeleted", { dirs: res.dirs, assets: res.assets }));
    if (selectedDirId.value === dir.id) selectedDirId.value = "";
    await loadDirs();
    await loadInfo();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.deleteFailed"));
  }
}

function selectDir(id: string) {
  selectedDirId.value = id;
  page.value = 1;
  void loadAssets();
}

// ── 标签 ────────────────────────────────────────────────
async function createTag() {
  const name = newTagName.value.trim();
  if (!name) {
    toast.error(t("knowledge.tagNameRequired"));
    return;
  }
  try {
    await api.post("/knowledge/tags", { name });
    toast.success(t("knowledge.tagCreated"));
    newTagName.value = "";
    await loadTags();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.tagCreateFailed"));
  }
}

async function deleteTag(tag: KnowledgeTagDto) {
  if (!window.confirm(t("knowledge.deleteTagConfirm", { name: tag.name, count: tag.asset_count }))) return;
  try {
    await api.delete(`/knowledge/tags/${tag.id}`);
    toast.success(t("knowledge.tagDeleted"));
    if (filterTag.value === tag.name) filterTag.value = "";
    await loadTags();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.tagDeleteFailed"));
  }
}

// ── 资产 ────────────────────────────────────────────────
async function createAsset() {
  const title = assetForm.title.trim();
  if (!title) {
    toast.error(t("knowledge.titleRequired"));
    return;
  }
  try {
    await api.post("/knowledge/assets", {
      title,
      ...(assetForm.content.trim() ? { content: assetForm.content.trim() } : {}),
      ...(selectedDirId.value ? { dir_id: selectedDirId.value } : {}),
      ...(assetForm.tagIds.length > 0 ? { tags: tagNamesOf(assetForm.tagIds) } : {}),
    });
    toast.success(t("knowledge.assetCreated"));
    assetForm.title = "";
    assetForm.content = "";
    assetForm.tagIds = [];
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.assetCreateFailed"));
  }
}

/** 从资产库导入：后端会校验同 space，跨团队素材直接 403 */
async function importFromAsset() {
  const assetId = importAssetId.value.trim();
  if (!assetId) {
    toast.error(t("knowledge.importIdRequired"));
    return;
  }
  try {
    await api.post("/knowledge/assets/import-from-asset", {
      asset_id: assetId,
      ...(importDirId.value ? { dir_id: importDirId.value } : {}),
    });
    toast.success(t("knowledge.imported"));
    importAssetId.value = "";
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.importFailed"));
  }
}

async function toggleAssetTag(asset: KnowledgeAssetDto, tag: KnowledgeTagDto) {
  const names = asset.tags.includes(tag.name)
    ? asset.tags.filter((n) => n !== tag.name)
    : [...asset.tags, tag.name];
  try {
    await api.patch(`/knowledge/assets/${asset.id}/tags`, { tags: names });
    asset.tags = names;
    await loadTags();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.updateTagFailed"));
  }
}

async function deleteAsset(asset: KnowledgeAssetDto) {
  if (!window.confirm(t("knowledge.deleteAssetConfirm", { title: asset.title }))) return;
  try {
    await api.delete(`/knowledge/assets/${asset.id}`);
    toast.success(t("knowledge.deleted"));
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.deleteFailed"));
  }
}

async function exportToAsset(asset: KnowledgeAssetDto) {
  try {
    const res = await api.post<{ asset: { id: string } }>(`/knowledge/assets/${asset.id}/to-asset`);
    toast.success(t("knowledge.exported", { id: res.asset.id }));
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.exportFailed"));
  }
}

// ── 批量 ────────────────────────────────────────────────
async function batchMove() {
  if (selectedIds.value.length === 0) {
    toast.error(t("knowledge.selectFirst"));
    return;
  }
  try {
    await api.post("/knowledge/assets/batch-move", {
      ids: selectedIds.value,
      dir_id: movingDirId.value || null,
    });
    toast.success(t("knowledge.moved"));
    selectedIds.value = [];
    await loadAssets();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.batchMoveFailed"));
  }
}

async function batchDelete() {
  if (selectedIds.value.length === 0) {
    toast.error(t("knowledge.selectFirst"));
    return;
  }
  if (!window.confirm(t("knowledge.batchDeleteConfirm", { count: selectedIds.value.length }))) return;
  try {
    await api.post("/knowledge/assets/batch-delete", { ids: selectedIds.value });
    toast.success(t("knowledge.deleted"));
    selectedIds.value = [];
    await loadAssets();
    await loadInfo();
  } catch (e) {
    toast.error((e as Error).message || t("knowledge.batchDeleteFailed"));
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function changePage(next: number) {
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  void loadAssets();
}

onMounted(load);
</script>

<template>
  <div class="kb-page">
    <!-- 第 59 批：页头改为知识库实体（名称 / 简介 / 封面）—— 一个 space 一个库 -->
    <header class="kb-head">
      <div class="kb-head-main">
        <div v-if="!editingBase" class="kb-head-title-row">
          <h1 class="kb-title">{{ base?.name || t("knowledge.title") }}</h1>
          <button type="button" class="kb-btn kb-btn-sm" @click="startEditBase">
            {{ t("knowledge.baseEdit") }}
          </button>
        </div>
        <div v-else class="kb-base-form">
          <label class="kb-field">
            <span class="kb-field-label">{{ t("knowledge.baseName") }}</span>
            <input v-model="baseForm.name" class="kb-input" :placeholder="t('knowledge.baseNamePlaceholder')" maxlength="60">
          </label>
          <label class="kb-field">
            <span class="kb-field-label">{{ t("knowledge.baseDescription") }}</span>
            <input v-model="baseForm.description" class="kb-input" :placeholder="t('knowledge.baseDescriptionPlaceholder')" maxlength="2000">
          </label>
          <label class="kb-field">
            <span class="kb-field-label">{{ t("knowledge.baseCover") }}</span>
            <input v-model="baseForm.cover_uri" class="kb-input" :placeholder="t('knowledge.baseCoverPlaceholder')" maxlength="500">
          </label>
          <label class="kb-field">
            <span class="kb-field-label">{{ t("knowledge.baseNote") }}</span>
            <input v-model="baseForm.note" class="kb-input" :placeholder="t('knowledge.baseNotePlaceholder')" maxlength="2000">
          </label>
          <div class="kb-base-form-actions">
            <button type="button" class="kb-btn kb-btn-sm" :disabled="savingBase" @click="saveBase">
              {{ t("knowledge.save") }}
            </button>
            <button type="button" class="kb-btn kb-btn-sm" :disabled="savingBase" @click="cancelEditBase">
              {{ t("knowledge.baseCancel") }}
            </button>
            <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="deleteBase(false)">
              {{ t("knowledge.baseDelete") }}
            </button>
            <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="deleteBase(true)">
              {{ t("knowledge.basePurge") }}
            </button>
          </div>
        </div>
        <img v-if="base?.cover_uri" class="kb-cover" :src="base.cover_uri" :alt="base.name">
        <p v-if="base?.description" class="kb-base-desc">{{ base.description }}</p>
        <p class="kb-sub">
          {{ t("knowledge.stats", { dirs: info?.dir_count ?? 0, assets: info?.asset_count ?? 0, tags: info?.tag_count ?? 0, depth: info?.max_dir_depth ?? 5 }) }}
        </p>
        <p v-if="base?.note" class="kb-base-note">{{ base.note }}</p>
      </div>
      <div class="kb-head-actions">
        <button type="button" class="kb-btn" :disabled="loading" @click="load">{{ t("knowledge.refresh") }}</button>
      </div>
    </header>

    <p v-if="loading" class="kb-state">{{ t("knowledge.loading") }}</p>
    <div v-else-if="errorMsg" class="kb-state kb-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="kb-btn" @click="load">{{ t("knowledge.retry") }}</button>
    </div>

    <div v-else class="kb-body">
      <!-- 左：目录树 -->
      <aside class="kb-side">
        <div class="kb-side-head">
          <h2 class="kb-h2">{{ t("knowledge.dirsTitle") }}</h2>
          <button type="button" class="kb-btn kb-btn-sm" @click="selectDir('')">{{ t("knowledge.all") }}</button>
        </div>
        <ul class="kb-tree">
          <li v-for="root in tree" :key="root.id" class="kb-tree-item">
            <button
              type="button"
              class="kb-node"
              :class="{ 'kb-node-active': selectedDirId === root.id }"
              @click="selectDir(root.id)"
            >
              <span class="kb-node-name">{{ root.name }}</span>
              <span class="kb-node-count">{{ root.asset_count ?? 0 }}</span>
            </button>
            <ul v-if="(root.children ?? []).length > 0" class="kb-tree-child">
              <li v-for="child in root.children ?? []" :key="child.id">
                <button
                  type="button"
                  class="kb-node kb-node-child"
                  :class="{ 'kb-node-active': selectedDirId === child.id }"
                  @click="selectDir(child.id)"
                >
                  <span class="kb-node-name">{{ child.name }}</span>
                  <span class="kb-node-count">{{ child.asset_count ?? 0 }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <p v-if="tree.length === 0" class="kb-note">{{ t("knowledge.noDirs") }}</p>

        <div class="kb-side-block">
          <input
            v-model="newDirName"
            class="kb-input"
            :placeholder="selectedDirId ? t('knowledge.dirPlaceholderChild') : t('knowledge.dirPlaceholderRoot')"
            @keyup.enter="createDir"
          >
          <button type="button" class="kb-btn kb-btn-sm" @click="createDir">{{ t("knowledge.create") }}</button>
        </div>

        <div v-if="selectedDirId" class="kb-side-block kb-side-block-col">
          <button
            type="button"
            class="kb-btn kb-btn-sm"
            @click="renamingDirId = selectedDirId; renamingDirName = flatDirs.find((d) => d.id === selectedDirId)?.name ?? ''"
          >
            {{ t("knowledge.renameSelected") }}
          </button>
          <button
            type="button"
            class="kb-btn kb-btn-sm kb-btn-danger"
            @click="
              (() => {
                const d = flatDirs.find((x) => x.id === selectedDirId);
                if (d) deleteDir(d);
              })()
            "
          >
            {{ t("knowledge.deleteSelected") }}
          </button>
          <div v-if="renamingDirId" class="kb-side-block">
            <input v-model="renamingDirName" class="kb-input" :placeholder="t('knowledge.renamePlaceholder')">
            <button
              type="button"
              class="kb-btn kb-btn-sm"
              @click="
                (() => {
                  const d = flatDirs.find((x) => x.id === renamingDirId);
                  if (d) renameDir(d);
                })()
              "
            >
              {{ t("knowledge.save") }}
            </button>
          </div>
        </div>
      </aside>

      <!-- 右：资产 -->
      <main class="kb-main">
        <section class="kb-toolbar">
          <input
            v-model="keyword"
            class="kb-input kb-input-wide"
            type="search"
            :placeholder="t('knowledge.searchPlaceholder')"
            @keyup.enter="page = 1; loadAssets()"
          >
          <button type="button" class="kb-btn" @click="page = 1; loadAssets()">{{ t("knowledge.search") }}</button>
          <label class="kb-check">
            <input v-model="includeChildren" type="checkbox" @change="loadAssets()">
            {{ t("knowledge.includeSubdirs") }}
          </label>
          <select v-model="filterTag" class="kb-input" @change="page = 1; loadAssets()">
            <option value="">{{ t("knowledge.allTags") }}</option>
            <option v-for="tag in tags" :key="tag.id" :value="tag.name">{{ t.name }}</option>
          </select>
        </section>

        <section class="kb-panel">
          <h2 class="kb-h2">{{ t("knowledge.createAssetTitle") }}</h2>
          <div class="kb-form">
            <input v-model="assetForm.title" class="kb-input" :placeholder="t('knowledge.assetTitlePlaceholder')">
            <textarea v-model="assetForm.content" class="kb-input kb-textarea" rows="3" :placeholder="t('knowledge.assetContentPlaceholder')" />
            <div class="kb-tags">
              <button
                v-for="tag in tags"
                :key="tag.id"
                type="button"
                class="kb-tag"
                :class="{ 'kb-tag-active': assetForm.tagIds.includes(tag.id) }"
                @click="
                  assetForm.tagIds.includes(tag.id)
                    ? assetForm.tagIds.splice(assetForm.tagIds.indexOf(tag.id), 1)
                    : assetForm.tagIds.push(tag.id)
                "
              >
                {{ tag.name }}
              </button>
            </div>
            <div class="kb-form-actions">
              <button type="button" class="kb-btn kb-btn-primary" @click="createAsset">{{ t("knowledge.createAsset") }}</button>
              <span class="kb-note">{{ t("knowledge.tagsHint") }}</span>
            </div>
          </div>
        </section>

        <section class="kb-panel">
          <h2 class="kb-h2">{{ t("knowledge.importTitle") }}</h2>
          <div class="kb-form-actions">
            <input v-model="importAssetId" class="kb-input" :placeholder="t('knowledge.importPlaceholder')">
            <select v-model="importDirId" class="kb-input">
              <option value="">{{ t("knowledge.noDir") }}</option>
              <option v-for="d in flatDirs" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <button type="button" class="kb-btn" @click="importFromAsset">{{ t("knowledge.import") }}</button>
            <span class="kb-note">{{ t("knowledge.importHint") }}</span>
          </div>
        </section>

        <section class="kb-panel">
          <div class="kb-list-head">
            <h2 class="kb-h2">{{ t("knowledge.assetsTitle", { total }) }}</h2>
            <div class="kb-batch">
              <select v-model="movingDirId" class="kb-input">
                <option value="">{{ t("knowledge.moveTo") }}</option>
                <option v-for="d in flatDirs" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
              <button type="button" class="kb-btn kb-btn-sm" @click="batchMove">{{ t("knowledge.batchMove") }}</button>
              <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="batchDelete">{{ t("knowledge.batchDelete") }}</button>
            </div>
          </div>

          <p v-if="assets.length === 0" class="kb-state">
            {{ t("knowledge.assetsEmpty") }}
          </p>
          <ul v-else class="kb-assets">
            <li v-for="asset in assets" :key="asset.id" class="kb-asset">
              <label class="kb-asset-check">
                <input v-model="selectedIds" type="checkbox" :value="asset.id">
              </label>
              <div class="kb-asset-body">
                <div class="kb-asset-head">
                  <strong class="kb-asset-title">{{ asset.title }}</strong>
                  <span class="kb-asset-type">{{ asset.source_type_name }}</span>
                  <span class="kb-asset-dir">{{ asset.dir_name || t("knowledge.uncategorized") }}</span>
                </div>
                <p v-if="asset.content" class="kb-asset-content">{{ asset.content }}</p>
                <p v-if="asset.resource" class="kb-asset-resource">
                  {{ t("knowledge.resourceRef", { name: asset.resource.name || asset.resource.id, kind: asset.resource.kind }) }}
                </p>
                <div class="kb-asset-tags">
                  <button
                    v-for="tag in tags"
                    :key="tag.id"
                    type="button"
                    class="kb-tag kb-tag-sm"
                    :class="{ 'kb-tag-active': asset.tags.includes(tag.name) }"
                    @click="toggleAssetTag(asset, tag)"
                  >
                    {{ tag.name }}
                  </button>
                </div>
              </div>
              <div class="kb-asset-ops">
                <button
                  v-if="asset.source_type === 2"
                  type="button"
                  class="kb-btn kb-btn-sm"
                  @click="exportToAsset(asset)"
                >
                  {{ t("knowledge.exportToAssets") }}
                </button>
                <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="deleteAsset(asset)">{{ t("knowledge.delete") }}</button>
              </div>
            </li>
          </ul>

          <footer v-if="total > pageSize" class="kb-pager">
            <button type="button" class="kb-btn kb-btn-sm" :disabled="page <= 1" @click="changePage(page - 1)">
              {{ t("knowledge.prev") }}
            </button>
            <span class="kb-note">{{ page }} / {{ totalPages }}</span>
            <button
              type="button"
              class="kb-btn kb-btn-sm"
              :disabled="page >= totalPages"
              @click="changePage(page + 1)"
            >
              {{ t("knowledge.next") }}
            </button>
          </footer>
        </section>
      </main>

      <!-- 标签管理 -->
      <aside class="kb-side kb-side-right">
        <h2 class="kb-h2">{{ t("knowledge.tagManageTitle") }}</h2>
        <div class="kb-side-block">
          <input v-model="newTagName" class="kb-input" :placeholder="t('knowledge.newTagPlaceholder')" @keyup.enter="createTag">
          <button type="button" class="kb-btn kb-btn-sm" @click="createTag">{{ t("knowledge.create") }}</button>
        </div>
        <p v-if="tags.length === 0" class="kb-note">{{ t("knowledge.noTags") }}</p>
        <ul v-else class="kb-tag-list">
          <li v-for="tag in tags" :key="tag.id" class="kb-tag-row">
            <span class="kb-tag-name">{{ tag.name }}</span>
            <span class="kb-tag-count">{{ tag.asset_count }}</span>
            <span v-if="!tag.in_use" class="kb-tag-idle">{{ t("knowledge.tagUnused") }}</span>
            <button type="button" class="kb-btn kb-btn-xs kb-btn-danger" @click="deleteTag(tag)">{{ t("knowledge.delete") }}</button>
          </li>
        </ul>
        <p class="kb-note">
          {{ t("knowledge.tagManageHint") }}
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.kb-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  color: var(--text-2);
}
.kb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.kb-head-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.kb-head-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* 页头实体编辑（第 59 批）：四行窄表单，不用弹窗——改名是高频小事 */
.kb-base-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  max-width: 560px;
}
.kb-base-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.kb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kb-field-label {
  font-size: 12px;
  color: var(--text-4);
}
.kb-cover {
  max-width: 240px;
  max-height: 120px;
  object-fit: cover;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-1);
}
.kb-base-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}
.kb-base-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-4);
  line-height: 1.6;
}
.kb-title {
  margin: 0;
  font-size: 20px;
  color: var(--text-1);
}
.kb-sub {
  margin: var(--space-1) 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.kb-state {
  padding: var(--space-6);
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
}
.kb-state-error {
  color: var(--danger);
  border-color: var(--danger);
}
.kb-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 200px;
  gap: var(--space-4);
  align-items: start;
}
@media (max-width: 1100px) {
  .kb-body {
    grid-template-columns: 1fr;
  }
}
.kb-side {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.kb-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kb-h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-1);
}
.kb-tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.kb-tree-child {
  list-style: none;
  margin: var(--space-1) 0 0 var(--space-4);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.kb-node {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-2);
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.kb-node:hover {
  background: var(--bg-hover);
}
.kb-node-active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.kb-node-child {
  font-size: 12px;
}
.kb-node-count {
  color: var(--text-4);
  font-size: 11px;
}
.kb-side-block {
  display: flex;
  gap: var(--space-2);
}
.kb-side-block-col {
  flex-direction: column;
}
.kb-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.kb-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.kb-input {
  background: var(--bg-sunken);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 12px;
  min-width: 0;
}
.kb-input-wide {
  flex: 1;
  min-width: 220px;
}
.kb-textarea {
  resize: vertical;
  font-family: inherit;
  width: 100%;
}
.kb-check {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 12px;
  color: var(--text-3);
}
.kb-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.kb-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.kb-form-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.kb-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.kb-tag {
  background: transparent;
  border: 1px solid var(--border-2);
  color: var(--text-2);
  border-radius: var(--radius-full);
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.kb-tag-sm {
  font-size: 11px;
  padding: 2px 8px;
}
.kb-tag-active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.kb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.kb-batch {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.kb-assets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.kb-asset {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-raised);
}
.kb-asset-check {
  padding-top: 2px;
}
.kb-asset-body {
  flex: 1;
  min-width: 0;
}
.kb-asset-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.kb-asset-title {
  color: var(--text-1);
  font-size: 13px;
}
.kb-asset-type {
  font-size: 11px;
  color: var(--brand-on-soft);
}
.kb-asset-dir {
  font-size: 11px;
  color: var(--text-4);
}
.kb-asset-content {
  margin: var(--space-1) 0;
  font-size: 12px;
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-word;
}
.kb-asset-resource {
  margin: var(--space-1) 0;
  font-size: 12px;
  color: var(--info);
}
.kb-asset-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
.kb-asset-ops {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.kb-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}
.kb-btn {
  border: 1px solid var(--border-2);
  background: var(--bg-raised);
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.kb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.kb-btn-primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
}
.kb-btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}
.kb-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.kb-btn-xs {
  padding: 2px 8px;
  font-size: 11px;
}
.kb-tag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.kb-tag-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
.kb-tag-name {
  color: var(--text-1);
  flex: 1;
}
.kb-tag-count {
  color: var(--text-4);
}
.kb-tag-idle {
  color: var(--warning);
  font-size: 11px;
}
.kb-note {
  margin: 0;
  font-size: 11px;
  color: var(--text-4);
}
</style>
