<script setup lang="ts">
import type {
  KnowledgeAssetDto,
  KnowledgeAssetListDto,
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
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const toast = useToast();

const loading = ref(true);
const errorMsg = ref("");
const tree = ref<KnowledgeDirNodeDto[]>([]);
const flatDirs = ref<KnowledgeDirNodeDto[]>([]);
const tags = ref<KnowledgeTagDto[]>([]);
const info = ref<KnowledgeInfoDto | null>(null);
const assets = ref<KnowledgeAssetDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;

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
    errorMsg.value = (e as Error).message || "知识库加载失败";
  } finally {
    loading.value = false;
  }
}

function tagNamesOf(ids: string[]): string[] {
  return ids
    .map((id) => tags.value.find((t) => t.id === id)?.name)
    .filter((n): n is string => Boolean(n));
}

// ── 目录 ────────────────────────────────────────────────
async function createDir() {
  const name = newDirName.value.trim();
  if (!name) {
    toast.error("请填目录名");
    return;
  }
  try {
    await api.post("/knowledge/dirs", { name, ...(selectedDirId.value ? { parent_id: selectedDirId.value } : {}) });
    toast.success("目录已创建");
    newDirName.value = "";
    newSubDirName.value = "";
    await loadDirs();
    await loadInfo();
  } catch (e) {
    toast.error((e as Error).message || "创建目录失败");
  }
}

async function renameDir(dir: KnowledgeDirNodeDto) {
  const name = renamingDirName.value.trim();
  if (!name) {
    toast.error("请填新名字");
    return;
  }
  try {
    await api.patch(`/knowledge/dirs/${dir.id}`, { name });
    toast.success("已改名");
    renamingDirId.value = "";
    renamingDirName.value = "";
    await loadDirs();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || "改名失败");
  }
}

async function deleteDir(dir: KnowledgeDirNodeDto) {
  if (!window.confirm(`删除目录「${dir.name}」？子目录与目录内条目会被一并软删（行保留，可恢复）。`)) return;
  try {
    const res = await api.delete<{ dirs: number; assets: number }>(`/knowledge/dirs/${dir.id}`);
    toast.success(`已删除 ${res.dirs} 个目录、${res.assets} 条资产`);
    if (selectedDirId.value === dir.id) selectedDirId.value = "";
    await loadDirs();
    await loadInfo();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || "删除失败");
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
    toast.error("请填标签名");
    return;
  }
  try {
    await api.post("/knowledge/tags", { name });
    toast.success("标签已创建");
    newTagName.value = "";
    await loadTags();
  } catch (e) {
    toast.error((e as Error).message || "创建标签失败");
  }
}

async function deleteTag(tag: KnowledgeTagDto) {
  if (!window.confirm(`删除标签「${tag.name}」？会同时从 ${tag.asset_count} 条资产上移除。`)) return;
  try {
    await api.delete(`/knowledge/tags/${tag.id}`);
    toast.success("标签已删除");
    if (filterTag.value === tag.name) filterTag.value = "";
    await loadTags();
    await loadAssets();
  } catch (e) {
    toast.error((e as Error).message || "删除标签失败");
  }
}

// ── 资产 ────────────────────────────────────────────────
async function createAsset() {
  const title = assetForm.title.trim();
  if (!title) {
    toast.error("请填标题");
    return;
  }
  try {
    await api.post("/knowledge/assets", {
      title,
      ...(assetForm.content.trim() ? { content: assetForm.content.trim() } : {}),
      ...(selectedDirId.value ? { dir_id: selectedDirId.value } : {}),
      ...(assetForm.tagIds.length > 0 ? { tags: tagNamesOf(assetForm.tagIds) } : {}),
    });
    toast.success("条目已创建");
    assetForm.title = "";
    assetForm.content = "";
    assetForm.tagIds = [];
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || "创建条目失败");
  }
}

/** 从资产库导入：后端会校验同 space，跨团队素材直接 403 */
async function importFromAsset() {
  const assetId = importAssetId.value.trim();
  if (!assetId) {
    toast.error("请填资产库条目 ID");
    return;
  }
  try {
    await api.post("/knowledge/assets/import-from-asset", {
      asset_id: assetId,
      ...(importDirId.value ? { dir_id: importDirId.value } : {}),
    });
    toast.success("已从资产库导入");
    importAssetId.value = "";
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || "导入失败（只能导入本空间资产）");
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
    toast.error((e as Error).message || "更新标签失败");
  }
}

async function deleteAsset(asset: KnowledgeAssetDto) {
  if (!window.confirm(`删除条目「${asset.title}」？`)) return;
  try {
    await api.delete(`/knowledge/assets/${asset.id}`);
    toast.success("已删除");
    await loadAssets();
    await loadInfo();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || "删除失败");
  }
}

async function exportToAsset(asset: KnowledgeAssetDto) {
  try {
    const res = await api.post<{ asset: { id: string } }>(`/knowledge/assets/${asset.id}/to-asset`);
    toast.success(`已导出到资产库（${res.asset.id}）`);
  } catch (e) {
    toast.error((e as Error).message || "导出失败（仅资产引用条目可导出）");
  }
}

// ── 批量 ────────────────────────────────────────────────
async function batchMove() {
  if (selectedIds.value.length === 0) {
    toast.error("先勾选条目");
    return;
  }
  try {
    await api.post("/knowledge/assets/batch-move", {
      ids: selectedIds.value,
      dir_id: movingDirId.value || null,
    });
    toast.success("已移动");
    selectedIds.value = [];
    await loadAssets();
    await loadDirs();
  } catch (e) {
    toast.error((e as Error).message || "批量移动失败");
  }
}

async function batchDelete() {
  if (selectedIds.value.length === 0) {
    toast.error("先勾选条目");
    return;
  }
  if (!window.confirm(`删除 ${selectedIds.value.length} 条资产？`)) return;
  try {
    await api.post("/knowledge/assets/batch-delete", { ids: selectedIds.value });
    toast.success("已删除");
    selectedIds.value = [];
    await loadAssets();
    await loadInfo();
  } catch (e) {
    toast.error((e as Error).message || "批量删除失败");
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
    <header class="kb-head">
      <div>
        <h1 class="kb-title">团队知识库</h1>
        <p class="kb-sub">
          目录 {{ info?.dir_count ?? 0 }} · 条目 {{ info?.asset_count ?? 0 }} · 标签 {{ info?.tag_count ?? 0 }} ·
          最多 {{ info?.max_dir_depth ?? 5 }} 层目录
        </p>
      </div>
      <div class="kb-head-actions">
        <button type="button" class="kb-btn" :disabled="loading" @click="load">刷新</button>
      </div>
    </header>

    <p v-if="loading" class="kb-state">正在加载知识库…</p>
    <div v-else-if="errorMsg" class="kb-state kb-state-error">
      <p>{{ errorMsg }}</p>
      <button type="button" class="kb-btn" @click="load">重试</button>
    </div>

    <div v-else class="kb-body">
      <!-- 左：目录树 -->
      <aside class="kb-side">
        <div class="kb-side-head">
          <h2 class="kb-h2">目录</h2>
          <button type="button" class="kb-btn kb-btn-sm" @click="selectDir('')">全部</button>
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
        <p v-if="tree.length === 0" class="kb-note">还没有目录，先在下面建一个。</p>

        <div class="kb-side-block">
          <input
            v-model="newDirName"
            class="kb-input"
            :placeholder="selectedDirId ? '在选中目录下建子目录' : '新建顶层目录'"
            @keyup.enter="createDir"
          >
          <button type="button" class="kb-btn kb-btn-sm" @click="createDir">新建</button>
        </div>

        <div v-if="selectedDirId" class="kb-side-block kb-side-block-col">
          <button
            type="button"
            class="kb-btn kb-btn-sm"
            @click="renamingDirId = selectedDirId; renamingDirName = flatDirs.find((d) => d.id === selectedDirId)?.name ?? ''"
          >
            重命名选中目录
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
            删除选中目录（级联）
          </button>
          <div v-if="renamingDirId" class="kb-side-block">
            <input v-model="renamingDirName" class="kb-input" placeholder="新名字">
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
              保存
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
            placeholder="搜索标题或正文（跨目录）"
            @keyup.enter="page = 1; loadAssets()"
          >
          <button type="button" class="kb-btn" @click="page = 1; loadAssets()">搜索</button>
          <label class="kb-check">
            <input v-model="includeChildren" type="checkbox" @change="loadAssets()">
            含子目录
          </label>
          <select v-model="filterTag" class="kb-input" @change="page = 1; loadAssets()">
            <option value="">全部标签</option>
            <option v-for="t in tags" :key="t.id" :value="t.name">{{ t.name }}</option>
          </select>
        </section>

        <section class="kb-panel">
          <h2 class="kb-h2">新建条目</h2>
          <div class="kb-form">
            <input v-model="assetForm.title" class="kb-input" placeholder="标题（如「雨夜街景参考」）">
            <textarea v-model="assetForm.content" class="kb-input kb-textarea" rows="3" placeholder="正文（设定/提示词/参考链接）" />
            <div class="kb-tags">
              <button
                v-for="t in tags"
                :key="t.id"
                type="button"
                class="kb-tag"
                :class="{ 'kb-tag-active': assetForm.tagIds.includes(t.id) }"
                @click="
                  assetForm.tagIds.includes(t.id)
                    ? assetForm.tagIds.splice(assetForm.tagIds.indexOf(t.id), 1)
                    : assetForm.tagIds.push(t.id)
                "
              >
                {{ t.name }}
              </button>
            </div>
            <div class="kb-form-actions">
              <button type="button" class="kb-btn kb-btn-primary" @click="createAsset">创建条目</button>
              <span class="kb-note">标签需先创建（见右侧标签管理），不会自动新建</span>
            </div>
          </div>
        </section>

        <section class="kb-panel">
          <h2 class="kb-h2">从资产库导入</h2>
          <div class="kb-form-actions">
            <input v-model="importAssetId" class="kb-input" placeholder="资产库条目 ID">
            <select v-model="importDirId" class="kb-input">
              <option value="">不指定目录</option>
              <option v-for="d in flatDirs" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <button type="button" class="kb-btn" @click="importFromAsset">导入</button>
            <span class="kb-note">只能导入本空间素材（跨团队会被服务端 403 拒绝）</span>
          </div>
        </section>

        <section class="kb-panel">
          <div class="kb-list-head">
            <h2 class="kb-h2">条目（{{ total }}）</h2>
            <div class="kb-batch">
              <select v-model="movingDirId" class="kb-input">
                <option value="">移到…</option>
                <option v-for="d in flatDirs" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
              <button type="button" class="kb-btn kb-btn-sm" @click="batchMove">批量移动</button>
              <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="batchDelete">批量删除</button>
            </div>
          </div>

          <p v-if="assets.length === 0" class="kb-state">
            这个范围内还没有条目。用上面的表单新建，或从资产库导入。
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
                  <span class="kb-asset-dir">{{ asset.dir_name || "未分类" }}</span>
                </div>
                <p v-if="asset.content" class="kb-asset-content">{{ asset.content }}</p>
                <p v-if="asset.resource" class="kb-asset-resource">
                  引用资产：{{ asset.resource.name || asset.resource.id }}（{{ asset.resource.kind }}）
                </p>
                <div class="kb-asset-tags">
                  <button
                    v-for="t in tags"
                    :key="t.id"
                    type="button"
                    class="kb-tag kb-tag-sm"
                    :class="{ 'kb-tag-active': asset.tags.includes(t.name) }"
                    @click="toggleAssetTag(asset, t)"
                  >
                    {{ t.name }}
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
                  导出到资产库
                </button>
                <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="deleteAsset(asset)">删除</button>
              </div>
            </li>
          </ul>

          <footer v-if="total > pageSize" class="kb-pager">
            <button type="button" class="kb-btn kb-btn-sm" :disabled="page <= 1" @click="changePage(page - 1)">
              上一页
            </button>
            <span class="kb-note">{{ page }} / {{ totalPages }}</span>
            <button
              type="button"
              class="kb-btn kb-btn-sm"
              :disabled="page >= totalPages"
              @click="changePage(page + 1)"
            >
              下一页
            </button>
          </footer>
        </section>
      </main>

      <!-- 标签管理 -->
      <aside class="kb-side kb-side-right">
        <h2 class="kb-h2">标签管理</h2>
        <div class="kb-side-block">
          <input v-model="newTagName" class="kb-input" placeholder="新标签名" @keyup.enter="createTag">
          <button type="button" class="kb-btn kb-btn-sm" @click="createTag">新建</button>
        </div>
        <p v-if="tags.length === 0" class="kb-note">还没有标签。</p>
        <ul v-else class="kb-tag-list">
          <li v-for="t in tags" :key="t.id" class="kb-tag-row">
            <span class="kb-tag-name">{{ t.name }}</span>
            <span class="kb-tag-count">{{ t.asset_count }}</span>
            <span v-if="!t.in_use" class="kb-tag-idle">未使用</span>
            <button type="button" class="kb-btn kb-btn-xs kb-btn-danger" @click="deleteTag(t)">删除</button>
          </li>
        </ul>
        <p class="kb-note">
          标签改名会同步改写条目上的标签文本；删除会从所有条目上摘掉。
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
