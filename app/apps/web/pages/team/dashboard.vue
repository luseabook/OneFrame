<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 团队数据看板（kds/da 域，对照参照产品 `/web/v1/kds/da/*` 13 端点 + `/team/dashboard`）
 *
 * 口径三件事（错了看板数字就不可信）：
 * 1. 「消耗」= `credit_flows` 的 settle 流水绝对值之和（结算是真扣；freeze 只是占用）。
 * 2. 「成功率」= 成功态 / 已终态，PENDING/RUNNING 不计入分母（否则中途看板永远偏低）。
 * 3. 「配额」是已分配上限（`space_members.credits_quota`），**不是余额**，回收会回落。
 *
 * 所有数据来自一个聚合端点 `/kds/da/team/:id/query`，避免首屏连打 6 个请求。
 */

interface BasicInfo {
  space_id: string;
  name: string;
  type: number;
  max_seats: number | null;
  member_total: number;
  member_active: number;
  pool_balance: number;
  pool_frozen: number;
  created_at: string;
}
interface Kpi {
  total_consume: number;
  task_count: number;
  active_member: number;
  project_count: number;
}
interface RankRow {
  rank: number;
  user_id: string;
  nickname: string | null;
  role_code: string | null;
  role_level: number | null;
  consumed: number;
  task_count: number;
}
interface ProjectRow {
  episode_id: string | null;
  task_total: number;
  task_done: number;
  task_failed: number;
  success_rate: number | null;
  consumed: number;
}
interface CanvasStat {
  total_point: number;
  task_count: number;
  scope: string;
}
interface TeamQueryResp {
  basic: BasicInfo;
  kpi: Kpi;
  rank: RankRow[];
  canvas: CanvasStat;
  projects: ProjectRow[];
  from: string | null;
  to: string | null;
}
interface ParticipateRow {
  user_id: string;
  nickname: string | null;
  role_code: string | null;
  group_id: string | null;
  task_total: number;
  task_done: number;
  task_failed: number;
  consumed: number;
  last_active: string | null;
}

const api = useApi();
const toast = useToast();
const activeSpace = useActiveSpaceId();

const loading = ref(true);
const errorMsg = ref("");
const data = ref<TeamQueryResp | null>(null);
const participate = ref<ParticipateRow[]>([]);
const participateTotal = ref(0);
const participatePage = ref(1);
const PAGE_SIZE = 20;

/** 时间范围：默认本月（竞品默认就是本月，切换器在右上） */
type RangeKey = "month" | "week" | "all";
const range = ref<RangeKey>("month");
const RANGE_LABEL: Record<RangeKey, string> = { month: "本月", week: "本周", all: "全部" };

function fromISO(key: RangeKey): string | undefined {
  if (key === "all") return undefined;
  const now = new Date();
  const start = new Date(now);
  if (key === "week") {
    // 周一为一周起点
    const day = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - day);
  } else {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

const spaceId = computed(() => activeSpace.value ?? "");

const maxRankConsumed = computed(() =>
  Math.max(1, ...(data.value?.rank ?? []).map((r) => r.consumed)),
);

async function load() {
  if (!spaceId.value) {
    loading.value = false;
    errorMsg.value = "请先在「团队管理」里选择或创建一个团队空间";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const from = fromISO(range.value);
    const q = from ? `?from=${encodeURIComponent(from)}` : "";
    data.value = await api.get<TeamQueryResp>(`/kds/da/team/${spaceId.value}/query${q}`);
    await loadParticipate();
  } catch (e) {
    errorMsg.value = (e as Error).message || "看板加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadParticipate() {
  if (!spaceId.value) return;
  const q = new URLSearchParams({
    page: String(participatePage.value),
    page_size: String(PAGE_SIZE),
    from: fromISO(range.value) ?? "",
  });
  // 空 from 不要发（后端 zod datetime 校验会拒）
  if (!q.get("from")) q.delete("from");
  const res = await api.get<{ list: ParticipateRow[]; count: number; has_more: boolean }>(
    `/kds/da/team/${spaceId.value}/member-participate-detail?${q.toString()}`,
  );
  participate.value = res.list;
  participateTotal.value = res.count;
}

async function changeRange(key: RangeKey) {
  range.value = key;
  participatePage.value = 1;
  await load();
}

async function exportCsv(kind: "team" | "project") {
  if (!spaceId.value) return;
  const path =
    kind === "team"
      ? `/kds/da/team/${spaceId.value}/query/export`
      : `/kds/da/team/${spaceId.value}/project-data/export`;
  const config = useRuntimeConfig();
  const base = (config.public.apiBase as string) || "";
  try {
    const res = await fetch(`${base}/v1${path}`, {
      credentials: "include",
      headers: {
        Authorization: `Bearer ${useAuth().state.value.accessToken ?? ""}`,
        "X-Space-Id": spaceId.value,
      },
    });
    if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "team" ? "team-point-consume.csv" : "project-data.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("导出已开始");
  } catch (e) {
    toast.error((e as Error).message || "导出失败");
  }
}

function fmtRate(r: number | null): string {
  if (r === null) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

watch([spaceId, range], () => {
  participatePage.value = 1;
  void load();
});

onMounted(load);
</script>

<template>
  <div class="kd">
    <header class="kd-head">
      <div>
        <h1 class="kd-title">数据看板</h1>
        <p class="kd-sub">
          <template v-if="data">{{ data.basic.name }} · {{ data.basic.member_active }}/{{ data.basic.member_total }} 位成员在岗</template>
          <template v-else>团队生产与消耗概览</template>
        </p>
      </div>
      <div class="kd-head-actions">
        <div class="kd-range">
          <button
            v-for="(label, key) in RANGE_LABEL"
            :key="key"
            type="button"
            class="kd-range-btn"
            :class="{ active: range === key }"
            @click="changeRange(key as RangeKey)"
          >
            {{ label }}
          </button>
        </div>
        <button type="button" class="kd-btn" @click="load">刷新</button>
      </div>
    </header>

    <p v-if="errorMsg" class="kd-alert">{{ errorMsg }}</p>

    <div v-if="loading" class="kd-skeleton">加载中…</div>

    <template v-else-if="data">
      <!-- KPI 四卡 -->
      <section class="kd-kpis">
        <div class="kd-kpi">
          <span class="kd-kpi-label">团队总消耗</span>
          <strong class="kd-kpi-num">{{ data.kpi.total_consume.toLocaleString() }}</strong>
          <span class="kd-kpi-hint">积分 · {{ RANGE_LABEL[range] }}</span>
        </div>
        <div class="kd-kpi">
          <span class="kd-kpi-label">生成任务数</span>
          <strong class="kd-kpi-num">{{ data.kpi.task_count.toLocaleString() }}</strong>
          <span class="kd-kpi-hint">含全部状态</span>
        </div>
        <div class="kd-kpi">
          <span class="kd-kpi-label">活跃成员</span>
          <strong class="kd-kpi-num">{{ data.kpi.active_member }}</strong>
          <span class="kd-kpi-hint">共 {{ data.basic.member_total }} 席位</span>
        </div>
        <div class="kd-kpi">
          <span class="kd-kpi-label">池余额</span>
          <strong class="kd-kpi-num">{{ data.basic.pool_balance.toLocaleString() }}</strong>
          <span class="kd-kpi-hint">冻结 {{ data.basic.pool_frozen.toLocaleString() }}</span>
        </div>
      </section>

      <!-- 积分消耗排名（CSS 条形，不装图表库） -->
      <section class="kd-card">
        <header class="kd-card-head">
          <h2>积分消耗排名</h2>
          <button type="button" class="kd-link" @click="exportCsv('team')">导出 CSV</button>
        </header>
        <p v-if="data.rank.length === 0" class="kd-empty">该时间范围内还没有消耗记录</p>
        <ul v-else class="kd-bars">
          <li v-for="r in data.rank" :key="r.user_id" class="kd-bar-row">
            <span class="kd-bar-rank">{{ r.rank }}</span>
            <span class="kd-bar-name" :title="r.user_id">{{ r.nickname || r.user_id }}</span>
            <span class="kd-bar-track">
              <span class="kd-bar-fill" :style="{ width: `${Math.max(2, (r.consumed / maxRankConsumed) * 100)}%` }" />
            </span>
            <span class="kd-bar-val">{{ r.consumed.toLocaleString() }}</span>
            <span class="kd-bar-tasks">{{ r.task_count }} 任务</span>
          </li>
        </ul>
      </section>

      <!-- 成员参与明细 -->
      <section class="kd-card">
        <header class="kd-card-head">
          <h2>成员参与明细</h2>
          <span class="kd-muted">共 {{ participateTotal }} 人</span>
        </header>
        <p v-if="participate.length === 0" class="kd-empty">该时间范围内还没有成员产出</p>
        <table v-else class="kd-table">
          <thead>
            <tr>
              <th>成员</th><th>角色</th><th>任务总数</th><th>成功</th><th>失败</th><th>消耗</th><th>最后活跃</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in participate" :key="m.user_id">
              <td class="kd-ellipsis" :title="m.user_id">{{ m.nickname || m.user_id }}</td>
              <td><span class="kd-tag">{{ m.role_code || "—" }}</span></td>
              <td class="kd-num">{{ m.task_total }}</td>
              <td class="kd-num kd-ok">{{ m.task_done }}</td>
              <td class="kd-num" :class="{ 'kd-bad': m.task_failed > 0 }">{{ m.task_failed }}</td>
              <td class="kd-num">{{ m.consumed.toLocaleString() }}</td>
              <td class="kd-muted">{{ fmtTime(m.last_active) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="participateTotal > PAGE_SIZE" class="kd-pager">
          <button type="button" class="kd-btn" :disabled="participatePage === 1" @click="participatePage--; loadParticipate()">上一页</button>
          <span class="kd-muted">{{ participatePage }} / {{ Math.ceil(participateTotal / PAGE_SIZE) }}</span>
          <button type="button" class="kd-btn" :disabled="participatePage * PAGE_SIZE >= participateTotal" @click="participatePage++; loadParticipate()">下一页</button>
        </div>
      </section>

      <!-- 项目数据 -->
      <section class="kd-card">
        <header class="kd-card-head">
          <h2>项目数据</h2>
          <button type="button" class="kd-link" @click="exportCsv('project')">导出 CSV</button>
        </header>
        <p v-if="data.projects.length === 0" class="kd-empty">还没有关联剧集的任务</p>
        <table v-else class="kd-table">
          <thead>
            <tr><th>剧集</th><th>任务数</th><th>成功</th><th>失败</th><th>成功率</th><th>消耗</th></tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in data.projects" :key="p.episode_id || i">
              <td class="kd-ellipsis" :title="p.episode_id || ''">{{ p.episode_id || "—" }}</td>
              <td class="kd-num">{{ p.task_total }}</td>
              <td class="kd-num kd-ok">{{ p.task_done }}</td>
              <td class="kd-num" :class="{ 'kd-bad': p.task_failed > 0 }">{{ p.task_failed }}</td>
              <td class="kd-num">{{ fmtRate(p.success_rate) }}</td>
              <td class="kd-num">{{ p.consumed.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 画布消耗（独立口径：非流水线任务） -->
      <section class="kd-card">
        <header class="kd-card-head"><h2>画布消耗</h2></header>
        <p class="kd-muted">
          无限画布的节点生成消耗单独统计，与剧集流水线分开——团队排产时两条线的成本要拆开看。
        </p>
        <div class="kd-inline-kpi">
          <span>总消耗 <strong>{{ data.canvas.total_point.toLocaleString() }}</strong> 积分</span>
          <span>任务 <strong>{{ data.canvas.task_count }}</strong> 个</span>
        </div>
      </section>
    </template>

    <div v-else-if="!loading && !errorMsg" class="kd-empty">暂无数据</div>
  </div>
</template>

<style scoped>
.kd { display: flex; flex-direction: column; gap: var(--space-4); }
.kd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.kd-title { font-size: 24px; font-weight: 700; margin: 0; }
.kd-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.kd-head-actions { display: flex; align-items: center; gap: var(--space-2); }
.kd-range { display: flex; background: var(--surface-2); border-radius: var(--radius-2); padding: 2px; }
.kd-range-btn {
  border: 0; background: transparent; color: var(--text-2); font-size: 13px;
  padding: 6px 12px; border-radius: var(--radius-1); cursor: pointer;
}
.kd-range-btn.active { background: var(--surface-1); color: var(--text-1); font-weight: 600; }
.kd-btn {
  border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-1);
  font-size: 13px; padding: 6px 12px; border-radius: var(--radius-2); cursor: pointer;
}
.kd-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.kd-alert {
  margin: 0; padding: var(--space-3); border-radius: var(--radius-2); font-size: 13px;
  background: color-mix(in srgb, var(--danger-1, #e03131) 12%, transparent);
  color: var(--danger-1, #e03131);
}
.kd-skeleton { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.kd-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); }
.kd-kpi {
  display: flex; flex-direction: column; gap: 4px; padding: var(--space-4);
  background: var(--surface-1); border: 1px solid var(--border-1); border-radius: var(--radius-3);
}
.kd-kpi-label { font-size: 13px; color: var(--text-3); }
.kd-kpi-num { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.kd-kpi-hint { font-size: 12px; color: var(--text-3); }
.kd-card {
  padding: var(--space-4); background: var(--surface-1);
  border: 1px solid var(--border-1); border-radius: var(--radius-3);
}
.kd-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
.kd-card-head h2 { font-size: 15px; font-weight: 600; margin: 0; }
.kd-link { border: 0; background: transparent; color: var(--brand-1, #7e70ff); font-size: 13px; cursor: pointer; }
.kd-empty { margin: 0; padding: var(--space-5); text-align: center; color: var(--text-3); font-size: 13px; }
.kd-muted { color: var(--text-3); font-size: 12px; }
.kd-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.kd-bar-row { display: grid; grid-template-columns: 28px 140px 1fr 64px 64px; align-items: center; gap: var(--space-2); font-size: 13px; }
.kd-bar-rank { color: var(--text-3); font-variant-numeric: tabular-nums; }
.kd-bar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kd-bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.kd-bar-fill { display: block; height: 100%; background: var(--brand-1, #7e70ff); border-radius: 4px; }
.kd-bar-val, .kd-bar-tasks { text-align: right; font-variant-numeric: tabular-nums; }
.kd-bar-tasks { color: var(--text-3); font-size: 12px; }
.kd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.kd-table th {
  text-align: left; font-weight: 500; color: var(--text-3); padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-1); white-space: nowrap;
}
.kd-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-1); }
.kd-num { font-variant-numeric: tabular-nums; font-weight: 600; }
.kd-ok { color: var(--success-1, #2f9e44); }
.kd-bad { color: var(--danger-1, #e03131); }
.kd-tag {
  display: inline-block; padding: 1px 8px; border-radius: 999px;
  background: var(--surface-2); color: var(--text-2); font-size: 12px;
}
.kd-ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kd-pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
.kd-inline-kpi { display: flex; gap: var(--space-5); font-size: 13px; color: var(--text-2); }
.kd-inline-kpi strong { color: var(--text-1); font-variant-numeric: tabular-nums; }

@media (max-width: 1080px) {
  .kd-kpis { grid-template-columns: repeat(2, 1fr); }
  .kd-bar-row { grid-template-columns: 24px 100px 1fr 56px; }
  .kd-bar-tasks { display: none; }
}
</style>
