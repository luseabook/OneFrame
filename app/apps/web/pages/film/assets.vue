<script setup lang="ts">
/**
 * 影视资产需求（竞品 /film/assets 的对应页）
 *
 * 静态路由必须优先于 film/[id].vue 的动态段——这也顺带修掉"访问 /film/assets 落到 [id] 报 500"的老问题。
 * 数据源全部是既有接口，不新增后端：
 *   GET /film/projects                         → 项目清单
 *   GET /film/projects/:id/task-tables         → 该项目的表（预置表名含「资产」）
 *   GET /film/projects/:id/task-tables/:tid/tasks/query?page_size=1 → 取 total_main 作为任务数
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const { t } = useI18n();
useHead({ title: () => t("filmAssets.metaTitle") });

interface FilmProjectRow {
  project_id: string;
  title: string;
  table_count: number;
  task_count: number;
  updated_at: string;
}
interface FilmTableRow {
  id: string;
  table_id?: string;
  name: string;
  is_preset: boolean;
}
interface AssetRow {
  projectId: string;
  projectTitle: string;
  tableId: string;
  tableName: string;
  tasks: number;
  updatedAt: string;
}

const rows = ref<AssetRow[]>([]);
const loading = ref(true);
const error = ref("");
const truncated = ref(false);
const MAX_PROJECTS = 20;

function tableIdOf(table: FilmTableRow): string {
  return table.table_id ?? table.id;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const projects = await api.get<{ list: FilmProjectRow[] }>("/film/projects");
    const list = (projects.list ?? []).slice(0, MAX_PROJECTS);
    truncated.value = (projects.list ?? []).length > MAX_PROJECTS;
    const out: AssetRow[] = [];
    for (const p of list) {
      const tables = await api.get<{ list: FilmTableRow[] }>(`/film/projects/${p.project_id}/task-tables`);
      const assetTables = (tables.list ?? []).filter((tb) => tb.name.includes("资产"));
      for (const tb of assetTables) {
        const tid = tableIdOf(tb);
        let tasks = 0;
        try {
          const q = await api.get<{ page?: { total_main?: number } }>(
            `/film/projects/${p.project_id}/task-tables/${tid}/tasks/query?page=1&page_size=1`,
          );
          tasks = q.page?.total_main ?? 0;
        } catch {
          tasks = 0;
        }
        out.push({
          projectId: p.project_id,
          projectTitle: p.title,
          tableId: tid,
          tableName: tb.name,
          tasks,
          updatedAt: p.updated_at,
        });
      }
    }
    rows.value = out;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("filmAssets.loadFailed");
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="fa">
    <header class="fa-head">
      <NuxtLink to="/film" class="fa-back">← {{ t("filmAssets.back") }}</NuxtLink>
      <h1>{{ t("filmAssets.title") }}</h1>
      <p class="fa-sub">{{ t("filmAssets.sub") }}</p>
    </header>

    <p v-if="loading" class="fa-state">{{ t("common.loading") }}</p>
    <div v-else-if="error" class="fa-state fa-state--err" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="fa-btn" @click="load">{{ t("common.retry") }}</button>
    </div>
    <p v-else-if="!rows.length" class="fa-state">{{ t("filmAssets.empty") }}</p>
    <template v-else>
      <table class="fa-table">
        <thead>
          <tr>
            <th>{{ t("filmAssets.colProject") }}</th>
            <th>{{ t("filmAssets.colTable") }}</th>
            <th class="num">{{ t("filmAssets.colTasks") }}</th>
            <th>{{ t("filmAssets.colUpdated") }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.projectId + r.tableId">
            <td>{{ r.projectTitle }}</td>
            <td>{{ r.tableName }}</td>
            <td class="num">{{ r.tasks }}</td>
            <td>{{ new Date(r.updatedAt).toLocaleDateString() }}</td>
            <td class="num">
              <NuxtLink :to="`/film/${r.projectId}`" class="fa-btn">{{ t("filmAssets.open") }}</NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="truncated" class="fa-hint">{{ t("filmAssets.truncated", { n: MAX_PROJECTS }) }}</p>
    </template>
  </div>
</template>

<style scoped>
.fa {
  padding: 20px 24px 48px;
  max-width: 1120px;
  margin: 0 auto;
  color: #2a2f3a;
}
.fa-back {
  display: inline-block;
  margin-bottom: 8px;
  color: #6b7280;
  text-decoration: none;
  font-size: 13px;
}
.fa-head h1 {
  font-size: 22px;
  font-weight: 600;
}
.fa-sub {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}
.fa-state {
  padding: 40px 0;
  text-align: center;
  color: #6b7280;
  font-size: 13px;
}
.fa-state--err {
  color: #b91c1c;
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}
.fa-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  font-size: 13px;
}
.fa-table th,
.fa-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f2f4;
  text-align: left;
}
.fa-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
}
.fa-table .num {
  text-align: right;
}
.fa-btn {
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.fa-hint {
  margin-top: 8px;
  color: #9ca3af;
  font-size: 12px;
}
</style>
