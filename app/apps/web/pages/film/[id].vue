<script setup lang="ts">
import type {
  FilmCanvasOptionDto,
  FilmFieldDto,
  FilmFuncWhitelistDto,
  FilmStatsDto,
  FilmTableDto,
  FilmTaskDto,
  FilmTaskQueryDto,
} from "~/types/api";

/**
 * 影视版任务表视图（`/film/:projectId`）—— 行=任务、列=字段、单元格按 field_type 渲染。
 *
 * 这页要证明四件事能真的点：
 * 1. **稀疏单元格**：改一格只发这一格（`PUT cells` + 行版本 CAS），版本冲突就提示刷新；
 * 2. **审核版本链**：审核抽屉里能看到 V01/V02…、按版本评论、按版本已读；
 * 3. **批量派工**：勾多行 → 写 assignees → notify-assignees（通知走广播面）；
 * 4. **画布衔接**：绑定画布、导出（csv/zip，xlsx 未提供已在响应里声明）。
 *
 * 所有写请求都带 `client_id`：用于服务端广播的回声抑制（同端不重复应用自己的修改）。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const route = useRoute();
const api = useApi();
const toast = useToast();
const activeSpace = useActiveSpaceId();

const projectId = computed(() => String(route.params.id ?? ""));
/** 本页面的协同身份（每次打开页面一个新值；服务端只透传，不解释语义） */
const clientId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const loading = ref(true);
const busy = ref(false);
const errorMsg = ref("");
const authorized = ref<boolean | null>(null);

const tables = ref<FilmTableDto[]>([]);
const currentTableId = ref("");
const projectTitle = ref("");
const query = ref<FilmTaskQueryDto | null>(null);
const stats = ref<FilmStatsDto | null>(null);
const hiddenFieldIds = ref<string[]>([]);
const selectedIds = ref<string[]>([]);

const showFieldDialog = ref(false);
const newFieldName = ref("");
const newFieldType = ref("text");
const showBindDialog = ref(false);
const bindTarget = ref<FilmTaskDto | null>(null);
const canvasOptions = ref<FilmCanvasOptionDto[]>([]);
const bindSelection = ref<string[]>([]);
const reviewTask = ref<FilmTaskDto | null>(null);
const assignUserId = ref("");
const pageNo = ref(1);
const PAGE_SIZE = 50;

const FIELD_TYPES = [
  { value: "text", label: "文本" },
  { value: "date", label: "日期" },
  { value: "user", label: "成员" },
  { value: "select", label: "单选" },
  { value: "multi_select", label: "多选" },
  { value: "number", label: "数字" },
  { value: "link", label: "链接" },
  { value: "canvas_ref", label: "画布引用" },
  { value: "asset_ref", label: "资产引用" },
];

const STATUS_OPTIONS = [
  { value: 1, label: "未开始" },
  { value: 2, label: "制作中" },
  { value: 3, label: "提交审核" },
  { value: 4, label: "驳回修改" },
  { value: 5, label: "定稿完成" },
];

const currentTable = computed(() => tables.value.find((t) => t.id === currentTableId.value) ?? null);
const fields = computed<FilmFieldDto[]>(() => query.value?.fields ?? []);
const visibleFields = computed<FilmFieldDto[]>(() =>
  fields.value.filter((f) => !hiddenFieldIds.value.includes(f.id)),
);
const tasks = computed<FilmTaskDto[]>(() => query.value?.tasks ?? []);
const totalRows = computed(() => query.value?.page.total_main ?? 0);
const assigneesField = computed(() => fields.value.find((f) => f.key === "assignees") ?? null);
const canManage = computed(() => tableIsPresetEditable.value);

/** 预置表同样可编辑（只有"删表"受限），这里仅用于审核决策按钮的可用性提示 */
const tableIsPresetEditable = computed(() => currentTable.value !== null);

async function loadProject() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const wl = await api.get<FilmFuncWhitelistDto>("/func-whitelist?scene=ai_film");
    authorized.value = wl.check;
    if (!wl.check) return;
    // 项目标题：服务端按"该项目最早那张表名"聚合（film 项目本体表未建），从列表里取本项目的
    const projects = await api.get<{ list: Array<{ project_id: string; title: string }> }>("/film/projects");
    projectTitle.value = projects.list.find((p) => p.project_id === projectId.value)?.title ?? "";
    const res = await api.get<{ list: FilmTableDto[] }>(`/film/projects/${projectId.value}/task-tables`);
    tables.value = res.list;
    if (res.list.length === 0) {
      // 空项目：自动补预置表（幂等端点，前端可以无脑调）
      await api.post(`/film/projects/${projectId.value}/task-tables/ensure-presets`);
      const again = await api.get<{ list: FilmTableDto[] }>(`/film/projects/${projectId.value}/task-tables`);
      tables.value = again.list;
    }
    if (!currentTableId.value && tables.value.length > 0) currentTableId.value = tables.value[0].id;
    await Promise.all([loadTable(), loadStats()]);
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadTable() {
  if (!currentTableId.value) return;
  try {
    const res = await api.get<FilmTaskQueryDto>(
      `/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/query?page=${pageNo.value}&page_size=${PAGE_SIZE}`,
    );
    query.value = res;
    hiddenFieldIds.value = res.pref.hidden_field_ids ?? [];
    selectedIds.value = [];
    await api
      .post(`/film/projects/${projectId.value}/recent-open`, { table_id: currentTableId.value })
      .catch(() => undefined);
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载任务表失败";
  }
}

async function loadStats() {
  try {
    stats.value = await api.get<FilmStatsDto>(`/film/projects/${projectId.value}/tasks/stats`);
  } catch {
    stats.value = null;
  }
}

async function selectTable(id: string) {
  currentTableId.value = id;
  pageNo.value = 1;
  await loadTable();
}

async function createTable() {
  const name = window.prompt("新表名称", "新任务表");
  if (!name) return;
  busy.value = true;
  try {
    const created = await api.post<FilmTableDto>(`/film/projects/${projectId.value}/task-tables`, { name });
    tables.value = [...tables.value, created];
    await selectTable(created.id);
    toast.success("任务表已创建");
  } catch (e) {
    toast.error((e as Error).message || "创建失败");
  } finally {
    busy.value = false;
  }
}

/** 单元格提交：只发这一格（稀疏），带行版本做 CAS */
async function commitCell(task: FilmTaskDto, field: FilmFieldDto, value: unknown) {
  if (!currentTableId.value) return;
  busy.value = true;
  try {
    await api.put(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${task.id}/cells`, {
      version: task.version,
      cells: { [field.id]: value },
      client_id: clientId,
    });
    await loadTable();
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 746002) {
      toast.error("这一行刚才被别人改过，已刷新到最新版本，请重试");
      await loadTable();
    } else {
      toast.error(err.message || "保存失败");
    }
  } finally {
    busy.value = false;
  }
}

async function addRow() {
  if (!currentTableId.value) return;
  busy.value = true;
  try {
    await api.post(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks`, { count: 1 });
    await Promise.all([loadTable(), loadStats()]);
  } catch (e) {
    toast.error((e as Error).message || "新建行失败");
  } finally {
    busy.value = false;
  }
}

async function deleteRow(task: FilmTaskDto) {
  if (!currentTableId.value) return;
  if (!window.confirm(`删除行「${task.title || task.id.slice(-6)}」？（可从批量恢复入口找回）`)) return;
  busy.value = true;
  try {
    await api.delete(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${task.id}`);
    await Promise.all([loadTable(), loadStats()]);
    toast.success("已删除");
  } catch (e) {
    toast.error((e as Error).message || "删除失败");
  } finally {
    busy.value = false;
  }
}

async function changeStatus(task: FilmTaskDto, status: number) {
  if (!currentTableId.value) return;
  busy.value = true;
  try {
    await api.post(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${task.id}/status`, {
      status,
      client_id: clientId,
    });
    await Promise.all([loadTable(), loadStats()]);
    toast.success("状态已更新");
  } catch (e) {
    toast.error((e as Error).message || "改状态失败（定稿需先有审核通过的版本）");
  } finally {
    busy.value = false;
  }
}

/** 批量派工：写 assignees 单元格 + 通知（通知走广播面，见后端 film.tasks.service 注释） */
async function batchAssign() {
  if (!currentTableId.value || !assigneesField.value) return;
  const userId = assignUserId.value.trim();
  if (!/^\d+$/.test(userId)) {
    toast.error("请填成员 ID（数字）");
    return;
  }
  if (selectedIds.value.length === 0) {
    toast.error("先勾选要派工的行");
    return;
  }
  busy.value = true;
  let ok = 0;
  try {
    for (const id of selectedIds.value) {
      const row = tasks.value.find((t) => t.id === id);
      if (!row) continue;
      try {
        await api.put(
          `/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${id}/cells`,
          { version: row.version, cells: { [assigneesField.value.id]: userId }, client_id: clientId },
        );
        await api.post(
          `/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${id}/notify-assignees`,
          { op_user_ids: [userId] },
        );
        ok += 1;
      } catch {
        // 单行失败（版本冲突/非本 space 成员）不阻塞其它行，最后统一汇报成功数
      }
    }
    toast.success(`已派工 ${ok}/${selectedIds.value.length} 行`);
    await Promise.all([loadTable(), loadStats()]);
  } finally {
    busy.value = false;
  }
}

async function batchDelete() {
  if (!currentTableId.value || selectedIds.value.length === 0) return;
  if (!window.confirm(`批量删除 ${selectedIds.value.length} 行？`)) return;
  busy.value = true;
  try {
    await api.post(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/batch-delete`, {
      task_ids: selectedIds.value,
    });
    toast.success("已移入回收站");
    await Promise.all([loadTable(), loadStats()]);
  } catch (e) {
    toast.error((e as Error).message || "批量删除失败");
  } finally {
    busy.value = false;
  }
}

async function createField() {
  if (!currentTableId.value) return;
  const name = newFieldName.value.trim();
  if (!name) {
    toast.error("请填列名");
    return;
  }
  busy.value = true;
  try {
    await api.post(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/fields`, {
      name,
      field_type: newFieldType.value,
    });
    showFieldDialog.value = false;
    newFieldName.value = "";
    await loadTable();
    toast.success("列已创建");
  } catch (e) {
    toast.error((e as Error).message || "建列失败（可能该类型已有唯一列）");
  } finally {
    busy.value = false;
  }
}

/** 隐藏列偏好：per table + user 覆盖写（后端 pref PUT） */
async function toggleHidden(fieldId: string) {
  if (!currentTableId.value) return;
  const next = hiddenFieldIds.value.includes(fieldId)
    ? hiddenFieldIds.value.filter((id) => id !== fieldId)
    : [...hiddenFieldIds.value, fieldId];
  hiddenFieldIds.value = next;
  try {
    await api.put(`/film/projects/${projectId.value}/task-tables/${currentTableId.value}/pref`, {
      hidden_field_ids: next,
      filter: query.value?.pref.filter ?? [],
      ui: query.value?.pref.ui ?? {},
    });
  } catch (e) {
    toast.error((e as Error).message || "保存列偏好失败");
  }
}

async function openBind(task: FilmTaskDto) {
  bindTarget.value = task;
  bindSelection.value = [...(task.produce?.canvas_ids ?? [])];
  showBindDialog.value = true;
  try {
    const res = await api.get<{ list: FilmCanvasOptionDto[] }>(`/film/projects/${projectId.value}/canvases/visible`);
    canvasOptions.value = res.list;
  } catch {
    canvasOptions.value = [];
  }
}

async function saveBind() {
  if (!currentTableId.value || !bindTarget.value) return;
  busy.value = true;
  try {
    await api.put(
      `/film/projects/${projectId.value}/task-tables/${currentTableId.value}/tasks/${bindTarget.value.id}/canvas-bindings`,
      { canvas_ids: bindSelection.value },
    );
    showBindDialog.value = false;
    await loadTable();
    toast.success("画布绑定已更新");
  } catch (e) {
    toast.error((e as Error).message || "绑定失败");
  } finally {
    busy.value = false;
  }
}

async function exportTable() {
  if (!currentTableId.value) return;
  busy.value = true;
  try {
    const res = await api.post<{
      delivered_format: string;
      download_url: string | null;
      row_count: number;
      note: string;
    }>(`/film/projects/${projectId.value}/exports`, { table_ids: [currentTableId.value], format: "xlsx" });
    toast.success(`已导出 ${res.row_count} 行（${res.delivered_format}）：${res.note}`);
    if (res.download_url) window.open(res.download_url, "_blank");
  } catch (e) {
    toast.error((e as Error).message || "导出失败（需要管理特权）");
  } finally {
    busy.value = false;
  }
}

function toggleSelect(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((v) => v !== id)
    : [...selectedIds.value, id];
}

function toggleAll() {
  selectedIds.value =
    selectedIds.value.length === tasks.value.length ? [] : tasks.value.map((t) => t.id);
}

async function changePage(delta: number) {
  const next = pageNo.value + delta;
  if (next < 1) return;
  pageNo.value = next;
  await loadTable();
}

watch(projectId, () => {
  currentTableId.value = "";
  void loadProject();
});

onMounted(loadProject);
</script>

<template>
  <div class="fl-page">
    <header class="fl-head">
      <div>
        <NuxtLink to="/film" class="fl-back">← 影视版</NuxtLink>
        <h1 class="fl-title">{{ projectTitle || "影视项目" }}</h1>
        <p class="fl-sub">
          项目 {{ projectId.slice(-8) }}
          <template v-if="stats"> · {{ stats.total }} 条任务 · 待审 {{ stats.pending_review }} · 定稿 {{ stats.done }}</template>
        </p>
      </div>
      <div class="fl-head-actions">
        <button type="button" class="fl-btn" :disabled="busy" @click="exportTable">导出</button>
        <button type="button" class="fl-btn" :disabled="busy" @click="showFieldDialog = true">＋ 新建列</button>
        <button type="button" class="fl-btn fl-btn-primary" :disabled="busy || !currentTableId" @click="addRow">
          ＋ 新建行
        </button>
      </div>
    </header>

    <p v-if="errorMsg" class="fl-alert">{{ errorMsg }}</p>

    <div v-if="loading" class="fl-skeleton">加载中…</div>

    <section v-else-if="authorized === false" class="fl-gate">
      <h2 class="fl-gate-title">影视版尚未开通</h2>
      <p class="fl-gate-text">请联系商务或团队管理员开通影视版后使用。</p>
    </section>

    <template v-else>
      <!-- 表页签 -->
      <nav class="fl-tabs">
        <button
          v-for="t in tables"
          :key="t.id"
          type="button"
          class="fl-tab"
          :class="{ active: t.id === currentTableId }"
          @click="selectTable(t.id)"
        >
          {{ t.name }}
          <span v-if="t.is_preset" class="fl-tab-preset">预置</span>
        </button>
        <button type="button" class="fl-tab fl-tab-add" :disabled="busy" @click="createTable">＋ 新表</button>
      </nav>

      <!-- 批量工具条 -->
      <div class="fl-toolbar">
        <span class="fl-selected">已选 {{ selectedIds.length }} 行</span>
        <input v-model="assignUserId" class="fl-input fl-input-sm" placeholder="成员ID（用于派工）" />
        <button type="button" class="fl-btn fl-btn-sm" :disabled="busy" @click="batchAssign">批量派工</button>
        <button type="button" class="fl-btn fl-btn-sm fl-btn-danger" :disabled="busy" @click="batchDelete">批量删除</button>
        <details class="fl-cols">
          <summary>列设置</summary>
          <ul>
            <li v-for="f in fields" :key="f.id">
              <label>
                <input type="checkbox" :checked="!hiddenFieldIds.includes(f.id)" @change="toggleHidden(f.id)" />
                {{ f.name }}<span class="fl-col-type">{{ f.field_type }}</span>
              </label>
            </li>
          </ul>
        </details>
      </div>

      <p v-if="tasks.length === 0" class="fl-empty">
        这张表还没有任务行。点右上「＋ 新建行」开始；或在画布侧提交产物后自动进入待审。
      </p>

      <div v-else class="fl-grid-wrap">
        <table class="fl-grid">
          <thead>
            <tr>
              <th class="fl-col-check">
                <input
                  type="checkbox"
                  :checked="selectedIds.length === tasks.length && tasks.length > 0"
                  @change="toggleAll"
                />
              </th>
              <th class="fl-col-idx">#</th>
              <th v-for="f in visibleFields" :key="f.id" class="fl-col">
                {{ f.name }}
                <span v-if="f.is_system" class="fl-sys" title="系统列">S</span>
              </th>
              <th class="fl-col-status">状态</th>
              <th class="fl-col-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(row, idx) in tasks" :key="row.id">
              <tr :class="{ 'fl-row-selected': selectedIds.includes(row.id) }">
                <td class="fl-col-check">
                  <input type="checkbox" :checked="selectedIds.includes(row.id)" @change="toggleSelect(row.id)" />
                </td>
                <td class="fl-col-idx">{{ (pageNo - 1) * PAGE_SIZE + idx + 1 }}</td>
                <td v-for="f in visibleFields" :key="f.id" class="fl-col">
                  <FilmCellEditor
                    :field="f"
                    :value="row.cells[f.id]"
                    :row-status="row.status"
                    :disabled="busy"
                    @commit="(v) => commitCell(row, f, v)"
                  />
                </td>
                <td class="fl-col-status">
                  <select
                    class="fl-input fl-input-sm"
                    :value="row.status"
                    :disabled="busy"
                    @change="changeStatus(row, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="s in STATUS_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
                  </select>
                </td>
                <td class="fl-col-ops">
                  <button type="button" class="fl-link" @click="reviewTask = row">
                    审核<span v-if="row.review_version_no > 0">({{ row.review_version_no }})</span>
                  </button>
                  <button type="button" class="fl-link" @click="openBind(row)">画布</button>
                  <button type="button" class="fl-link fl-link-danger" @click="deleteRow(row)">删除</button>
                </td>
              </tr>
              <tr v-for="child in row.children ?? []" :key="child.id" class="fl-row-child">
                <td class="fl-col-check" />
                <td class="fl-col-idx">↳</td>
                <td v-for="f in visibleFields" :key="f.id" class="fl-col">
                  <FilmCellEditor
                    :field="f"
                    :value="child.cells[f.id]"
                    :row-status="child.status"
                    :disabled="busy"
                    @commit="(v) => commitCell(child, f, v)"
                  />
                </td>
                <td class="fl-col-status">
                  <span class="fl-muted">{{ STATUS_OPTIONS.find((s) => s.value === child.status)?.label }}</span>
                </td>
                <td class="fl-col-ops">
                  <button type="button" class="fl-link" @click="reviewTask = child">审核</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="totalRows > PAGE_SIZE" class="fl-pager">
        <button type="button" class="fl-btn fl-btn-sm" :disabled="pageNo === 1" @click="changePage(-1)">上一页</button>
        <span class="fl-muted">{{ pageNo }} / {{ Math.ceil(totalRows / PAGE_SIZE) }}（共 {{ totalRows }} 行）</span>
        <button
          type="button"
          class="fl-btn fl-btn-sm"
          :disabled="pageNo * PAGE_SIZE >= totalRows"
          @click="changePage(1)"
        >
          下一页
        </button>
      </div>
    </template>

    <!-- 审核抽屉（机制 #1） -->
    <FilmReviewDrawer
      :project-id="projectId"
      :table-id="currentTableId"
      :task="reviewTask"
      :can-manage="canManage"
      @close="reviewTask = null"
      @changed="loadTable(); loadStats()"
    />

    <!-- 新建列 -->
    <div v-if="showFieldDialog" class="fl-modal-mask" @click.self="showFieldDialog = false">
      <div class="fl-modal">
        <h2 class="fl-modal-title">新建列</h2>
        <label class="fl-label" for="fl-field-name">列名</label>
        <input id="fl-field-name" v-model="newFieldName" class="fl-input" placeholder="例如：交付日期" />
        <label class="fl-label" for="fl-field-type">类型</label>
        <select id="fl-field-type" v-model="newFieldType" class="fl-input">
          <option v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <p class="fl-hint">审核/积分/状态是系统只读列，不在这里创建。</p>
        <div class="fl-modal-actions">
          <button type="button" class="fl-btn" @click="showFieldDialog = false">取消</button>
          <button type="button" class="fl-btn fl-btn-primary" :disabled="busy" @click="createField">创建</button>
        </div>
      </div>
    </div>

    <!-- 绑定画布 -->
    <div v-if="showBindDialog" class="fl-modal-mask" @click.self="showBindDialog = false">
      <div class="fl-modal">
        <h2 class="fl-modal-title">绑定画布 · {{ bindTarget?.title || bindTarget?.id.slice(-6) }}</h2>
        <p v-if="canvasOptions.length === 0" class="fl-empty">当前空间还没有画布。</p>
        <ul v-else class="fl-canvas-list">
          <li v-for="c in canvasOptions" :key="c.canvas_id">
            <label>
              <input v-model="bindSelection" type="checkbox" :value="c.canvas_id" />
              {{ c.name }}
            </label>
          </li>
        </ul>
        <div class="fl-modal-actions">
          <button type="button" class="fl-btn" @click="showBindDialog = false">取消</button>
          <button type="button" class="fl-btn fl-btn-primary" :disabled="busy" @click="saveBind">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fl-page {
  padding: 18px 20px 40px;
  /* 深色壳层（layouts/default 也能命中本页）：整页显式给深色文字，避免白底浅字 */
  color: #2a2f3a;
}
.fl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.fl-back {
  font-size: 12px;
  color: #2f5bd7;
  text-decoration: none;
}
.fl-title {
  margin: 4px 0 0;
  font-size: 20px;
}
.fl-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #6b7280;
}
.fl-head-actions {
  display: flex;
  gap: 8px;
}
.fl-btn {
  border: 1px solid #e3e6ee;
  background: #fff;
  color: #2a2f3a;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.fl-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}
.fl-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.fl-btn-primary {
  background: #2f5bd7;
  border-color: #2f5bd7;
  color: #fff;
}
.fl-btn-danger {
  color: #b33030;
  border-color: #f4c7c7;
}
.fl-alert {
  color: #c53030;
  font-size: 13px;
}
.fl-skeleton {
  padding: 32px 0;
  text-align: center;
  color: #8a90a6;
}
.fl-gate {
  border: 1px dashed #cfd5e6;
  border-radius: 12px;
  padding: 28px 20px;
  background: #fafbff;
}
.fl-gate-title {
  margin: 0 0 8px;
  font-size: 16px;
}
.fl-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.fl-tab {
  border: 1px solid #e3e6ee;
  background: #fff;
  color: #2a2f3a;
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}
.fl-tab.active {
  background: #eef2ff;
  border-color: #b9c8f5;
  color: #2f4bd7;
}
.fl-tab-preset {
  margin-left: 6px;
  font-size: 10px;
  color: #8a90a6;
}
.fl-tab-add {
  border-style: dashed;
  color: #5b6178;
}
.fl-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #fafbff;
  border: 1px solid #eef0f7;
  border-radius: 10px;
}
.fl-selected {
  font-size: 12px;
  color: #5b6178;
}
.fl-input {
  border: 1px solid #e3e6ee;
  border-radius: 8px;
  padding: 6px 8px;
  background: #fff;
  color: #2a2f3a;
  font-size: 13px;
}
.fl-input::placeholder {
  color: #9aa0b4;
}
.fl-input-sm {
  padding: 4px 8px;
  font-size: 12px;
}
.fl-cols {
  position: relative;
  margin-left: auto;
  font-size: 12px;
}
.fl-cols summary {
  cursor: pointer;
  color: #2f5bd7;
}
.fl-cols ul {
  position: absolute;
  right: 0;
  top: 22px;
  z-index: 20;
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e3e6ee;
  border-radius: 10px;
  box-shadow: 0 8px 22px rgba(16, 20, 32, 0.12);
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
}
.fl-cols li {
  padding: 3px 0;
}
.fl-col-type {
  margin-left: 6px;
  color: #9aa0b4;
  font-size: 11px;
}
.fl-empty {
  padding: 24px 0;
  font-size: 13px;
  color: #8a90a6;
}
.fl-grid-wrap {
  overflow-x: auto;
  border: 1px solid #eceef5;
  border-radius: 12px;
  background: #fff;
}
.fl-grid {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 13px;
}
.fl-grid th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fafbff;
  border-bottom: 1px solid #eceef5;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: #4b5266;
  white-space: nowrap;
}
.fl-grid td {
  border-bottom: 1px solid #f2f4f9;
  padding: 6px 10px;
  vertical-align: top;
}
.fl-col-check {
  width: 34px;
}
.fl-col-idx {
  width: 44px;
  color: #9aa0b4;
}
.fl-col {
  min-width: 120px;
}
.fl-col-status {
  width: 132px;
}
.fl-col-ops {
  width: 150px;
  white-space: nowrap;
}
.fl-sys {
  margin-left: 4px;
  font-size: 10px;
  color: #9aa0b4;
  border: 1px solid #e3e6ee;
  border-radius: 4px;
  padding: 0 3px;
}
.fl-row-selected td {
  background: #f7f9ff;
}
.fl-row-child td {
  background: #fcfcfe;
}
.fl-muted {
  color: #8a90a6;
}
.fl-link {
  border: none;
  background: none;
  color: #2f5bd7;
  font-size: 12px;
  cursor: pointer;
  padding: 0 6px 0 0;
}
.fl-link-danger {
  color: #b33030;
}
.fl-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12px;
}
.fl-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 20, 32, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.fl-modal {
  width: min(440px, 94vw);
  background: #fff;
  border-radius: 12px;
  padding: 20px;
}
.fl-modal-title {
  margin: 0 0 12px;
  font-size: 16px;
}
.fl-label {
  display: block;
  font-size: 12px;
  color: #5b6178;
  margin: 10px 0 4px;
}
.fl-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8a90a6;
}
.fl-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.fl-canvas-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
  font-size: 13px;
}
.fl-canvas-list li {
  padding: 4px 0;
}
</style>
