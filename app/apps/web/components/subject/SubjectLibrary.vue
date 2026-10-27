<script setup lang="ts">
import type { SubjectDto, SubjectListDto, SubjectStatusItemDto } from "~/types/api";

/**
 * 主体库（subject）面板 —— 对照竞品 `cmd/subject.md`。
 *
 * 为什么审核态要显眼地挂在卡片上：竞品的硬语义是「**只有 approved 可用于生成**，
 * 驳回 retryable=false、禁止自动重试」（subject.md:204-226），如果界面上看不出状态，
 * 用户会在生成时才撞 400105，属于不可解释的失败。
 */
const api = useApi();

const list = ref<SubjectDto[]>([]);
const total = ref(0);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");

const kindFilter = ref<"" | "character" | "scene" | "prop">("");
const reviewFilter = ref<"" | "1" | "2" | "3">("");
const keyword = ref("");

const KINDS = [
  { value: "", label: "全部类型" },
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "prop", label: "道具" },
] as const;
const REVIEWS = [
  { value: "", label: "全部审核态" },
  { value: "1", label: "审核中" },
  { value: "2", label: "已通过" },
  { value: "3", label: "已驳回" },
] as const;
const KIND_BY_LABEL: Record<string, number> = { character: 1, scene: 2, prop: 3 };

const REVIEW_BADGE: Record<string, { text: string; cls: string }> = {
  reviewing: { text: "审核中", cls: "reviewing" },
  approved: { text: "已通过", cls: "approved" },
  rejected: { text: "已驳回", cls: "rejected" },
  unknown: { text: "状态未知", cls: "unknown" },
};

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const parts = ["page=1", "page_size=60"];
    if (kindFilter.value) parts.push(`kind=${kindFilter.value}`);
    if (reviewFilter.value) parts.push(`review_status=${reviewFilter.value}`);
    if (keyword.value.trim()) parts.push(`q=${encodeURIComponent(keyword.value.trim())}`);
    const data = await api.get<SubjectListDto>(`/subjects?${parts.join("&")}`);
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载主体库失败";
  } finally {
    loading.value = false;
  }
}

// ── 新建（单条；竞品 create 必填只有 name，其余透传）────────────────────
const creating = ref(false);
const draft = reactive({ name: "", kind: "character" as "character" | "scene" | "prop", desc: "" });

async function createSubject(): Promise<void> {
  if (!draft.name.trim()) {
    error.value = "主体名称不能为空";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await api.post<SubjectDto>("/subjects", {
      name: draft.name.trim(),
      kind: KIND_BY_LABEL[draft.kind],
      desc: draft.desc.trim() || null,
      business_list: [3],
    });
    notice.value = `已创建「${draft.name.trim()}」，当前为审核中`;
    creating.value = false;
    draft.name = "";
    draft.desc = "";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建失败";
  } finally {
    busy.value = false;
  }
}

// ── 审核三态动作 ─────────────────────────────────────────────────────
async function approve(subject: SubjectDto): Promise<void> {
  busy.value = true;
  try {
    await api.patch<SubjectDto>(`/subjects/${subject.id}`, { review_status: 2 });
    notice.value = `「${subject.name}」已通过审核，可用于生成`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "审核失败";
  } finally {
    busy.value = false;
  }
}

async function reject(subject: SubjectDto): Promise<void> {
  const reason = prompt(`驳回「${subject.name}」的原因（必填，驳回后不可自动重试）`);
  if (!reason || !reason.trim()) return;
  busy.value = true;
  try {
    await api.patch<SubjectDto>(`/subjects/${subject.id}`, {
      review_status: 3,
      reject_reason: reason.trim(),
    });
    notice.value = `「${subject.name}」已驳回（retryable=false，不会自动重试）`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "驳回失败";
  } finally {
    busy.value = false;
  }
}

async function batchStatus(): Promise<void> {
  if (list.value.length === 0) return;
  busy.value = true;
  try {
    const data = await api.post<{ items: SubjectStatusItemDto[] }>("/subjects/status", {
      subject_ids: list.value.map((item) => item.id),
    });
    const byId = new Map(data.items.map((item) => [item.subject_id, item]));
    list.value = list.value.map((item) => {
      const remote = byId.get(item.id);
      return remote
        ? { ...item, review_status_name: remote.status, retryable: remote.retryable }
        : item;
    });
    notice.value = "已刷新本页审核状态";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "批量查状态失败";
  } finally {
    busy.value = false;
  }
}

async function removeSubject(subject: SubjectDto): Promise<void> {
  if (!confirm(`删除主体「${subject.name}」？删除后列表与生成侧都不再可见。`)) return;
  busy.value = true;
  try {
    await api.delete(`/subjects/${subject.id}`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除失败";
  } finally {
    busy.value = false;
  }
}

// ── 参考图管理（PATCH files 追加 / remove_file_ids 删除）──────────────
async function addReference(subject: SubjectDto): Promise<void> {
  const uri = prompt("参考图的 storage key 或可直接访问的 URL（写入主体参考图）");
  if (!uri || !uri.trim()) return;
  busy.value = true;
  try {
    await api.patch<SubjectDto>(`/subjects/${subject.id}`, {
      files: [{ uri: uri.trim(), role: 1, sort: subject.files.length }],
    });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "添加参考图失败";
  } finally {
    busy.value = false;
  }
}

async function removeReference(subject: SubjectDto, fileId: string): Promise<void> {
  busy.value = true;
  try {
    await api.patch<SubjectDto>(`/subjects/${subject.id}`, { remove_file_ids: [fileId] });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除参考图失败";
  } finally {
    busy.value = false;
  }
}

// ── 从项目资产保存为主体（save-from-resource 语义：不新建资产）─────────
interface ProjectBrief {
  id: string;
  title: string;
}
interface ProjectAssetDto {
  id: string;
  name: string;
  kind: string;
  status: number;
  ref_image_uri: string | null;
}
const savingFromAsset = ref(false);
const projects = ref<ProjectBrief[]>([]);
const assetProjectId = ref("");
const projectAssets = ref<ProjectAssetDto[]>([]);
const assetLoading = ref(false);

async function openSaveFromAsset(): Promise<void> {
  savingFromAsset.value = true;
  error.value = "";
  try {
    if (projects.value.length === 0) {
      const data = await api.get<{ list: ProjectBrief[]; total: number }>("/projects?page=1&page_size=50");
      projects.value = data.list;
    }
    if (!assetProjectId.value && projects.value[0]) assetProjectId.value = projects.value[0].id;
    await loadProjectAssets();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载项目失败";
  }
}

async function loadProjectAssets(): Promise<void> {
  if (!assetProjectId.value) return;
  assetLoading.value = true;
  try {
    const data = await api.get<{ list: ProjectAssetDto[] }>(`/projects/${assetProjectId.value}/assets`);
    projectAssets.value = data.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载项目资产失败";
  } finally {
    assetLoading.value = false;
  }
}

async function saveFromAsset(asset: ProjectAssetDto): Promise<void> {
  const name = prompt("主体名称（默认取资产名）", asset.name);
  if (name === null) return;
  busy.value = true;
  error.value = "";
  try {
    const saved = await api.post<SubjectDto & { created?: boolean }>("/subjects/from-asset", {
      project_id: assetProjectId.value,
      asset_id: asset.id,
      name: name.trim() || asset.name,
      business_list: [3],
    });
    notice.value = saved.created
      ? `已从资产「${asset.name}」保存为主体（审核中）`
      : `该资产已绑定主体「${saved.name}」，未重复创建`;
    savingFromAsset.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存主体失败";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="subject-lib">
    <div class="filters">
      <select v-model="kindFilter" class="mini-select" @change="load">
        <option v-for="kind in KINDS" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
      </select>
      <select v-model="reviewFilter" class="mini-select" @change="load">
        <option v-for="review in REVIEWS" :key="review.value" :value="review.value">{{ review.label }}</option>
      </select>
      <input
        v-model="keyword"
        class="mini-input"
        placeholder="按名称搜索"
        maxlength="40"
        @keyup.enter="load"
      />
      <Button size="sm" variant="ghost" :disabled="loading" @click="load">刷新</Button>
      <Button size="sm" variant="ghost" :disabled="busy || list.length === 0" @click="batchStatus">
        批量查审核态
      </Button>
      <span class="spacer" />
      <Button size="sm" variant="ghost" @click="openSaveFromAsset">从项目资产保存为主体</Button>
      <Button size="sm" @click="creating = !creating">{{ creating ? "取消" : "新建主体" }}</Button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="notice" class="ok">{{ notice }}</p>

    <div v-if="creating" class="create-box">
      <input v-model="draft.name" class="mini-input wide" placeholder="主体名称（必填）" maxlength="80" />
      <select v-model="draft.kind" class="mini-select">
        <option value="character">角色</option>
        <option value="scene">场景</option>
        <option value="prop">道具</option>
      </select>
      <input v-model="draft.desc" class="mini-input wide" placeholder="描述（可选）" maxlength="200" />
      <Button size="sm" :disabled="busy || !draft.name.trim()" @click="createSubject">创建（进入审核中）</Button>
    </div>

    <div v-if="savingFromAsset" class="create-box">
      <select v-model="assetProjectId" class="mini-select" @change="loadProjectAssets">
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.title }}</option>
      </select>
      <span class="hint">只列出「已定稿且有参考图」的资产（未定稿保存会返回 400105）</span>
      <div v-if="assetLoading" class="hint">加载项目资产…</div>
      <div v-else class="asset-picker">
        <button
          v-for="asset in projectAssets.filter((item) => item.status === 2 && item.ref_image_uri)"
          :key="asset.id"
          class="pick-chip"
          @click="saveFromAsset(asset)"
        >
          {{ asset.name }} · {{ asset.kind }}
        </button>
        <span v-if="projectAssets.filter((item) => item.status === 2 && item.ref_image_uri).length === 0" class="hint">
          该项目还没有已定稿资产
        </span>
      </div>
    </div>

    <Skeleton v-if="loading" :rows="3" />

    <template v-else>
      <div v-if="list.length" class="grid">
        <article v-for="subject in list" :key="subject.id" class="subject-card">
          <div class="cover">
            <img v-if="subject.files[0]?.url" :src="subject.files[0].url" :alt="subject.name" loading="lazy" />
            <span v-else class="cover-empty">无参考图</span>
            <span class="badge" :class="REVIEW_BADGE[subject.review_status_name]?.cls">
              {{ REVIEW_BADGE[subject.review_status_name]?.text ?? "状态未知" }}
            </span>
          </div>
          <div class="body">
            <p class="name" :title="subject.name">{{ subject.name }}</p>
            <p class="meta">{{ subject.kind_name }} · 参考图 {{ subject.files.length }} 张</p>
            <p v-if="subject.reject_reason" class="reject">驳回原因：{{ subject.reject_reason }}</p>
            <div class="thumbs">
              <span v-for="file in subject.files.slice(0, 4)" :key="file.id" class="thumb-chip">
                <img v-if="file.url" :src="file.url" :alt="file.uri" loading="lazy" />
                <button class="x" title="删除该参考图" @click="removeReference(subject, file.id)">✕</button>
              </span>
              <button class="thumb-add" title="添加参考图" @click="addReference(subject)">＋</button>
            </div>
            <div class="ops">
              <Button
                v-if="subject.review_status_name !== 'approved'"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="approve(subject)"
              >
                通过
              </Button>
              <Button
                v-if="subject.review_status_name !== 'rejected'"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="reject(subject)"
              >
                驳回
              </Button>
              <Button size="sm" variant="text" :disabled="busy" @click="removeSubject(subject)">删除</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="empty-wrap">
        <EmptyState
          icon="◉"
          title="主体库是空的"
          description="主体是「同一角色跨镜长得一样」的载体：新建主体并上传参考图，或把已定稿的项目资产一键存为主体。只有通过审核的主体可用于生成。"
        >
          <Button size="sm" @click="creating = true">新建主体</Button>
        </EmptyState>
      </div>
    </template>

    <p class="foot">共 {{ total }} 个主体 · 审核三态：审核中 / 已通过 / 已驳回（驳回不可自动重试）</p>
  </div>
</template>

<style scoped>
.subject-lib {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.mini-select,
.mini-input {
  height: 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-1);
  font-size: var(--text-sm);
  padding: 0 var(--space-2);
  outline: none;
}
.mini-input.wide {
  min-width: 200px;
}
.mini-select:focus,
.mini-input:focus {
  border-color: var(--brand-500);
}
.create-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}
.asset-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pick-chip {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--brand-border);
  background: var(--brand-soft);
  color: var(--brand-on-soft);
  font-size: 11px;
  cursor: pointer;
}
.pick-chip:hover {
  background: var(--brand-soft-strong);
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
  color: var(--text-4);
  font-size: var(--text-xs);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}
.subject-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color var(--duration-base) var(--ease-out);
}
.subject-card:hover {
  border-color: var(--border-3);
}
.cover {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--bg-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.badge {
  position: absolute;
  top: 8px;
  left: 8px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  font-size: 11px;
  line-height: 20px;
  border: 1px solid var(--border-2);
  background: var(--bg-surface);
  color: var(--text-2);
}
.badge.approved {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.badge.rejected {
  background: var(--danger-bg);
  color: var(--danger);
  border-color: var(--danger);
}
.badge.reviewing {
  background: var(--bg-sunken);
  color: var(--text-2);
}
.badge.unknown {
  color: var(--text-4);
}
.body {
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.name {
  margin: 0 0 2px;
  font-size: var(--text-sm);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin: 0 0 var(--space-2);
  font-size: 11px;
  color: var(--text-4);
}
.reject {
  margin: 0 0 var(--space-2);
  font-size: 11px;
  color: var(--danger);
}
.thumbs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}
.thumb-chip {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-2);
  display: inline-block;
}
.thumb-chip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-chip .x {
  position: absolute;
  inset: 0;
  opacity: 0;
  border: none;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.thumb-chip:hover .x {
  opacity: 1;
}
.thumb-add {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-2);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.thumb-add:hover {
  border-color: var(--brand-500);
  color: var(--brand-500);
}
.ops {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.empty-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 360px;
}
.foot {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
}
</style>
