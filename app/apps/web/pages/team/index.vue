<script setup lang="ts">
import type { TeamTempInfoDto } from "~/types/api";

/**
 * ⚠️ 文件位置说明（2026-10-28 修复）：本页原为 `pages/team.vue`，与 `pages/team/dashboard.vue`
 * 构成 Nuxt 的**父子路由**（父级没有 `<NuxtPage/>`），导致 `/team/dashboard` 实际渲染的是
 * 本页（团队管理）——数据看板**整页打不开**，而 HTTP 仍是 200（SSR 壳层正常），只有真浏览器能发现。
 * 现改为 `pages/team/index.vue`，两个页面成为同级路由，`/team` 与 `/team/dashboard` 各自渲染。
 * 不要再改回 `pages/team.vue`。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 团队管理（cam 域）
 *
 * 结构对齐参照产品实测（2026-10-26 登录态采集）：
 *   tabs = 成员管理 / 积分管理 / 角色权限 / 规则说明
 *   成员表格 8 列 = 成员 / 账号 / 角色 / 成员组 / 参与项目形式 / 当前积分 / 状态 / 备注
 *
 * 关键语义（ADR-011）：团队积分池 = 该 space 的 credit_accounts.balance；
 * 成员「当前积分」是**已分配额度**（credits_quota），不是余额，回收会回落。
 *
 * 「角色权限」页签（第 9 批 B）：权限码目录（70 条：竞品实测 53 细码 + 10 粗码
 * + 5 影视版码 + 2 团队管理扩展码）与角色 power_list 的勾选/保存，
 * **本批只存储不拦截**（边界写在 `components/team/TeamPermissionMatrix.vue` 里）。
 */

interface TeamInfo {
  space_id: string;
  name: string;
  type: number;
  status: number;
  max_seats: number;
  used_seats: number;
  credit_total: number;
  frozen: number;
  film_enabled: boolean;
  agent_whitelist: boolean;
}
interface MemberDto {
  user_id: string;
  role: number;
  role_code: string | null;
  role_level: number | null;
  group_id: string | null;
  nickname: string | null;
  account: string | null;
  remark: string | null;
  status: number;
  credits_quota: number;
  joined_at: string | null;
}
interface GroupDto { id: string; parent_id: string | null; name: string; sort: number; status: number }
interface RoleDto { id: string; role_code: string; role_name: string; role_level: number; is_system: boolean }
interface PermDto { role: number; role_code: string | null; privileged: boolean }
interface FlowDto {
  id: string; kind: string; delta: number; balance_after: number;
  target_user_id: string | null; op_user_id: string | null; group_id: string | null;
  memo: string | null; created_at: string;
}

const api = useApi();
const auth = useAuth();

// 空间切换（ADR-010）：团队场景靠 X-Space-Id 指定上下文
const activeSpace = useActiveSpaceId();
const myTeams = ref<Array<{ space_id: string; name: string; type: number; role: number; role_code: string | null; status: number }>>([]);
const newTeamOpen = ref(false);
const newTeamName = ref("");

const tab = ref("members");
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const info = ref<string>("");

const team = ref<TeamInfo | null>(null);
const perm = ref<PermDto | null>(null);
const members = ref<MemberDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const groups = ref<GroupDto[]>([]);
const roles = ref<RoleDto[]>([]);
const flows = ref<FlowDto[]>([]);
const flowTotal = ref(0);
const ranking = ref<Array<{ user_id: string; nickname: string | null; credits: number }>>([]);

// 分配/回收表单
const allocForm = ref({ user_id: "", amount: "100", memo: "" });
const recoverForm = ref({ user_id: "", amount: "100", memo: "" });
// 成员编辑
const editOpen = ref(false);
const editTarget = ref<MemberDto | null>(null);
const editForm = ref({ role_code: "", group_id: "", nickname: "", remark: "", status: 1 });
// 分组新建
const groupOpen = ref(false);
const groupName = ref("");

// 批量添加成员 / 选中态
const inviteOpen = ref(false);
const invitePhones = ref("");
const inviteRole = ref("");
const inviteGroup = ref("");
const inviteResult = ref<Array<{ phone?: string; user_id?: string; ok: boolean; reason?: string }>>([]);
const selected = ref<string[]>([]);
const allSelected = computed(() => members.value.length > 0 && selected.value.length === members.value.length);

// 状态用字符串桥接（SelectField 的 model 是 string）
const statusStr = computed({
  get: () => String(editForm.value.status),
  set: (v: string) => (editForm.value.status = Number(v)),
});

const { t, locale } = useI18n();
useHead({ title: () => t("teamPage.metaTitle") });

const tabs = computed(() => [
  { value: "members", label: t("teamPage.tabs.members"), badge: total.value },
  { value: "points", label: t("teamPage.tabs.points") },
  { value: "permissions", label: t("teamPage.tabs.permissions") },
  { value: "rules", label: t("teamPage.tabs.rules") },
]);

/** 数据看板入口（kds 域，对照参照产品 /team/dashboard） */
const router = useRouter();
function openDashboard() {
  void router.push("/team/dashboard");
}

const canManage = computed(() => perm.value?.privileged === true);
const roleName = (code: string | null): string => roles.value.find((r) => r.role_code === code)?.role_name ?? (code ?? "—");
const groupName_ = (id: string | null): string => groups.value.find((g) => g.id === id)?.name ?? t("teamPage.ungrouped");
const kindLabel = computed<Record<string, string>>(() => ({
  team_allocate_out: t("teamPage.flowTypes.team_allocate_out"),
  team_allocate_in: t("teamPage.flowTypes.team_allocate_in"),
  team_recover_out: t("teamPage.flowTypes.team_recover_out"),
  team_recover_in: t("teamPage.flowTypes.team_recover_in"),
}));

async function bootstrap(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    // 先拉「我所属的团队」，决定活动空间：
    // 若未选过，默认优先团队（便于直接进入团队工作台），否则留在个人空间。
    const mine = await api.get<{ list: typeof myTeams.value }>("/cam/teams/mine");
    myTeams.value = mine.list;
    if (!activeSpace.value) {
      const firstTeam = mine.list.find((t) => t.type === 2 && t.status === 1);
      if (firstTeam) setActiveSpaceId(firstTeam.space_id);
    }
    const [t, p] = await Promise.all([
      api.get<TeamInfo>("/cam/team/info"),
      api.get<PermDto>("/cam/permission/user"),
    ]);
    team.value = t;
    perm.value = p;
    await Promise.all([loadMembers(), loadGroups(), loadRoles()]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

/** 切到某个空间（个人或团队）后重载 */
async function switchSpace(spaceId: string): Promise<void> {
  setActiveSpaceId(spaceId);
  flows.value = [];
  await bootstrap();
  flash(t("teamPage.switched"));
}

/** 创建团队：建 spaces(type=2) → 自动切进去 */
async function createTeam(): Promise<void> {
  if (!newTeamName.value.trim()) return flash(t("teamPage.inputTeamName"));
  busy.value = true;
  error.value = "";
  try {
    const created = await api.post<{ space_id: string; name: string }>("/cam/team", {
      name: newTeamName.value.trim(),
    });
    newTeamOpen.value = false;
    newTeamName.value = "";
    await switchSpace(created.space_id);
    flash(t("teamPage.teamCreated"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function loadMembers(): Promise<void> {
  const q = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
  const data = await api.get<{ list: MemberDto[]; total: number }>(`/cam/team/members?${q.toString()}`);
  members.value = data.list;
  total.value = data.total;
}
async function loadGroups(): Promise<void> {
  const data = await api.get<{ list: GroupDto[] }>("/cam/team/groups");
  groups.value = data.list;
}
async function loadRoles(): Promise<void> {
  const data = await api.get<{ list: RoleDto[] }>("/cam/role/list");
  roles.value = data.list;
}

/**
 * 团队模型开关矩阵（`GET /cam/temp-info`）。
 *
 * 页签懒加载：只有点开「角色权限」才拉，避免团队页首屏多一个请求。
 * 展示口径与后端一致：可推导的给真值，未取证项显示「未取证」而不是「不支持」。
 */
const tempInfo = ref<TeamTempInfoDto | null>(null);
const tempInfoLoading = ref(false);
async function loadTempInfo(): Promise<void> {
  if (tempInfo.value || tempInfoLoading.value) return;
  tempInfoLoading.value = true;
  try {
    tempInfo.value = await api.get<TeamTempInfoDto>("/cam/temp-info");
  } catch {
    tempInfo.value = null;
  } finally {
    tempInfoLoading.value = false;
  }
}

/** 切到「角色权限」页签时顺带拉开关矩阵 */
watch(tab, (next) => {
  if (next === "permissions") void loadTempInfo();
});

async function loadPoints(): Promise<void> {
  const [f, r] = await Promise.all([
    api.get<{ list: FlowDto[]; total: number }>("/cam/team/points-flow/list?page=1&page_size=50"),
    api.get<{ list: Array<{ user_id: string; nickname: string | null; credits: number }> }>("/cam/team/account-points-ranking?limit=20"),
  ]);
  flows.value = f.list;
  flowTotal.value = f.total;
  ranking.value = r.list;
}

watch(tab, async (v) => {
  if (v === "points") {
    try {
      if (flows.value.length === 0) await loadPoints();
      await loadGroupStats();
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
});

function flash(msg: string): void {
  info.value = msg;
  setTimeout(() => (info.value = ""), 2500);
}

async function doAllocate(): Promise<void> {
  if (!allocForm.value.user_id) return flash(t("teamPage.selectMember"));
  busy.value = true;
  error.value = "";
  try {
    await api.post("/cam/team/points-allocation", {
      user_id: allocForm.value.user_id,
      amount: Number(allocForm.value.amount),
      ...(allocForm.value.memo ? { memo: allocForm.value.memo } : {}),
    });
    flash(t("teamPage.allocated", { amount: allocForm.value.amount }));
    allocForm.value.memo = "";
    await Promise.all([loadMembers(), loadPoints()]);
    if (team.value) team.value = await api.get<TeamInfo>("/cam/team/info");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function doRecover(): Promise<void> {
  if (!recoverForm.value.user_id) return flash(t("teamPage.selectMember"));
  busy.value = true;
  error.value = "";
  try {
    await api.post("/cam/team/points-recovery", {
      user_id: recoverForm.value.user_id,
      amount: Number(recoverForm.value.amount),
      ...(recoverForm.value.memo ? { memo: recoverForm.value.memo } : {}),
    });
    flash(t("teamPage.recovered", { amount: recoverForm.value.amount }));
    recoverForm.value.memo = "";
    await Promise.all([loadMembers(), loadPoints()]);
    if (team.value) team.value = await api.get<TeamInfo>("/cam/team/info");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function openEdit(m: MemberDto): void {
  editTarget.value = m;
  editForm.value = {
    role_code: m.role_code ?? "",
    group_id: m.group_id ?? "",
    nickname: m.nickname ?? "",
    remark: m.remark ?? "",
    status: m.status,
  };
  editOpen.value = true;
}
async function saveEdit(): Promise<void> {
  if (!editTarget.value) return;
  busy.value = true;
  try {
    await api.patch(`/cam/team/member/${editTarget.value.user_id}`, {
      ...(editForm.value.role_code ? { role_code: editForm.value.role_code } : {}),
      group_id: editForm.value.group_id || null,
      nickname: editForm.value.nickname || undefined,
      remark: editForm.value.remark || undefined,
      status: editForm.value.status,
    });
    editOpen.value = false;
    flash(t("teamPage.saved"));
    await loadMembers();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function createGroup(): Promise<void> {
  if (!groupName.value.trim()) return flash(t("teamPage.inputGroupName"));
  busy.value = true;
  try {
    await api.post("/cam/team/group", { name: groupName.value.trim() });
    groupOpen.value = false;
    groupName.value = "";
    await loadGroups();
    flash(t("teamPage.groupCreated"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ── 批量添加成员 ─────────────────────────────────────────
async function inviteMembers(): Promise<void> {
  const phones = invitePhones.value
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (phones.length === 0) return flash(t("teamPage.inputPhones"));
  const bad = phones.filter((p) => !/^1\d{10}$/.test(p));
  if (bad.length > 0) return flash(t("teamPage.badPhones", { list: bad.slice(0, 3).join("、") }));
  busy.value = true;
  error.value = "";
  try {
    const res = await api.post<{ added: number; failed: number; items: typeof inviteResult.value }>(
      "/cam/team/member/batch",
      {
        members: phones.map((phone) => ({
          phone,
          ...(inviteRole.value ? { role_code: inviteRole.value } : {}),
          ...(inviteGroup.value ? { group_id: inviteGroup.value } : {}),
        })),
      },
    );
    inviteResult.value = res.items;
    await Promise.all([loadMembers(), bootstrapTeamInfo()]);
    flash(
      res.failed > 0
        ? t("teamPage.addedMembersPartial", { added: res.added, failed: res.failed })
        : t("teamPage.addedMembers", { added: res.added }),
    );
    if (res.failed === 0) {
      inviteOpen.value = false;
      invitePhones.value = "";
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function bootstrapTeamInfo(): Promise<void> {
  try {
    team.value = await api.get<TeamInfo>("/cam/team/info");
  } catch { /* 忽略：抬头信息刷新失败不影响列表 */ }
}

function toggleAll(): void {
  selected.value = allSelected.value ? [] : members.value.map((m) => m.user_id);
}
function toggle(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}

/** 批量改状态 */
async function batchStatus(status: number): Promise<void> {
  if (selected.value.length === 0) return flash(t("teamPage.selectFirst"));
  busy.value = true;
  try {
    await api.post("/cam/team/member/batch/status", { user_ids: selected.value, status });
    selected.value = [];
    await loadMembers();
    flash(t("teamPage.statusUpdated"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/** 批量换组 */
async function batchGroup(groupId: string): Promise<void> {
  if (selected.value.length === 0) return flash(t("teamPage.selectMembersFirst"));
  busy.value = true;
  try {
    await api.post("/cam/team/member/change-group", {
      user_ids: selected.value,
      group_id: groupId || null,
    });
    selected.value = [];
    await loadMembers();
    flash(t("teamPage.groupAdjusted"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ── 团队设置（团队名 / 席位 / 功能开关）──────────────────
const teamEditOpen = ref(false);
const teamEditForm = ref({ name: "", max_seats: "5", film_enabled: false, agent_whitelist: false });
function openTeamEdit(): void {
  const t = team.value;
  if (!t) return;
  teamEditForm.value = {
    name: t.name,
    max_seats: String(t.max_seats),
    film_enabled: t.film_enabled,
    agent_whitelist: t.agent_whitelist,
  };
  teamEditOpen.value = true;
}
async function saveTeamEdit(): Promise<void> {
  if (!teamEditForm.value.name.trim()) return flash(t("teamPage.inputTeamName"));
  busy.value = true;
  error.value = "";
  try {
    team.value = await api.patch<TeamInfo>("/cam/team/info", {
      name: teamEditForm.value.name.trim(),
      max_seats: Number(teamEditForm.value.max_seats),
      film_enabled: teamEditForm.value.film_enabled,
      agent_whitelist: teamEditForm.value.agent_whitelist,
    });
    teamEditOpen.value = false;
    flash(t("teamPage.settingsSaved"));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ── 批量分配（选中成员 × 统一数量，逐条独立）──────────────
const batchAllocOpen = ref(false);
const batchAllocAmount = ref("10");
const batchAllocMemo = ref("");
function openBatchAlloc(): void {
  if (selected.value.length === 0) return flash(t("teamPage.selectMembersFirst"));
  batchAllocAmount.value = "10";
  batchAllocMemo.value = "";
  batchAllocOpen.value = true;
}
async function doBatchAlloc(): Promise<void> {
  const amount = Number(batchAllocAmount.value);
  if (!Number.isInteger(amount) || amount <= 0) return flash(t("teamPage.positiveCredits"));
  busy.value = true;
  error.value = "";
  try {
    const res = await api.post<{ succeeded: number; failed: number }>("/cam/team/batch-points-allocation", {
      items: selected.value.map((id) => ({ user_id: id, amount })),
      ...(batchAllocMemo.value ? { memo: batchAllocMemo.value } : {}),
    });
    batchAllocOpen.value = false;
    selected.value = [];
    await Promise.all([loadMembers(), loadPoints()]);
    await bootstrapTeamInfo();
    flash(
      res.failed > 0
        ? t("teamPage.batchDonePartial", { ok: res.succeeded, failed: res.failed })
        : t("teamPage.batchDone", { ok: res.succeeded }),
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ── 流水导出（现签链接，1h 有效）─────────────────────────
const flowExporting = ref(false);
async function exportFlows(): Promise<void> {
  flowExporting.value = true;
  error.value = "";
  try {
    const res = await api.get<{ file_uri: string; filename: string; row_count: number }>(
      "/cam/team/points-flow/export",
    );
    if (res.row_count === 0) {
      flash(t("teamPage.noFlowsToExport"));
      return;
    }
    window.open(res.file_uri, "_blank", "noopener");
    flash(t("teamPage.exportDone", { filename: res.filename, rows: res.row_count }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    flowExporting.value = false;
  }
}

// ── 分组统计（进积分页时按需拉，失败不影响主列表）────────
interface GroupStat { member_count: number; task_count: number; points_used: number; points_allocated: number }
const groupStats = ref<Record<string, GroupStat>>({});
async function loadGroupStats(): Promise<void> {
  if (groups.value.length === 0) return;
  try {
    const rows = await Promise.all(
      groups.value.map(async (g) => {
        const s = await api.get<GroupStat>(`/cam/team/group/${g.id}/stats`);
        return [g.id, s] as const;
      }),
    );
    groupStats.value = Object.fromEntries(rows);
  } catch {
    /* 统计是辅助信息，拉取失败不该打断页面 */
  }
}

/** 导出成员 CSV */
function exportMembers(): void {
  const token = auth.state.value.accessToken;
  const base = (useRuntimeConfig().public.apiBase as string) || "";
  const space = activeSpace.value;
  // 用 fetch 带 Authorization/X-Space-Id 拿 blob，避免把 token 放 URL
  fetch(`${base}/v1/cam/team/member/export`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(space ? { "X-Space-Id": space } : {}),
    },
    credentials: "include",
  })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(t("teamPage.exportFailed", { status: r.status })))))
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "team-members.csv";
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((e) => (error.value = (e as Error).message));
}

onMounted(bootstrap);
</script>

<template>
  <div class="tm">
    <header class="tm-head">
      <div>
        <h1 class="tm-title">{{ t("teamPage.title") }}</h1>
        <p class="tm-sub">
          <template v-if="team">
            {{ t("teamPage.teamLine", { name: team.name, used: team.used_seats, max: team.max_seats, total: team.credit_total }) }}
            <span v-if="team.frozen > 0">{{ t("teamPage.frozenSuffix", { frozen: team.frozen }) }}</span>
            <span v-if="team.type === 1" class="tm-badge">{{ t("teamPage.personalBadge") }}</span>
          </template>
          <template v-else>{{ t("teamPage.loading") }}</template>
        </p>
      </div>
      <div class="tm-head-actions">
        <SelectField
          v-if="myTeams.length > 0"
          class="tm-space-picker"
          label=""
          :options="myTeams.map((item) => ({ value: item.space_id, label: `${item.name}${item.type === 2 ? t('teamPage.teamOptionTeam') : t('teamPage.teamOptionPersonal')}` }))"
          :model-value="activeSpace || myTeams[0]?.space_id || ''"
          @update:model-value="switchSpace"
        />
        <Button :disabled="busy" @click="newTeamOpen = true">{{ t("teamPage.createTeam") }}</Button>
        <Button v-if="team?.type === 2" :disabled="busy" @click="navigateTo('/pricing')">{{ t("teamPage.rechargeTeam") }}</Button>
        <Button v-if="canManage" :disabled="busy" @click="inviteOpen = true">{{ t("teamPage.inviteMembers") }}</Button>
        <Button :disabled="!canManage || busy" @click="groupOpen = true">{{ t("teamPage.newGroup") }}</Button>
        <Button v-if="canManage && team?.type === 2" :disabled="busy" @click="openTeamEdit">{{ t("teamPage.teamSettings") }}</Button>
        <Button v-if="canManage" :disabled="busy" @click="exportMembers">{{ t("teamPage.exportCsv") }}</Button>
        <Button :disabled="busy" @click="bootstrap">{{ t("teamPage.refresh") }}</Button>
      </div>
    </header>

    <p v-if="error" class="tm-alert tm-alert--err">{{ error }}</p>
    <p v-if="info" class="tm-alert tm-alert--ok">{{ info }}</p>
    <p v-if="!canManage" class="tm-alert tm-alert--hint">
      {{ t("teamPage.memberOnlyHint", { role: perm?.role_code ?? "member" }) }}
    </p>

    <div class="tm-tabbar-row">
      <TabBar v-model="tab" :tabs="tabs" />
      <button type="button" class="tm-dash-entry" @click="openDashboard">{{ t("teamPage.dashboardEntry") }}</button>
    </div>

    <!-- 成员管理 -->
    <section v-if="tab === 'members'" class="tm-panel">
      <!-- 批量操作条 -->
      <div v-if="canManage && selected.length > 0" class="tm-batch">
        <span>{{ t("teamPage.selectedCount", { count: selected.length }) }}</span>
        <Button :disabled="busy" @click="batchStatus(1)">{{ t("teamPage.enable") }}</Button>
        <Button :disabled="busy" @click="batchStatus(2)">{{ t("teamPage.disable") }}</Button>
        <Button :disabled="busy" @click="openBatchAlloc">{{ t("teamPage.batchAllocate") }}</Button>
        <SelectField
          class="tm-batch-group"
          label=""
          :options="[{ value: '', label: t('teamPage.moveToGroup') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]"
          @update:model-value="batchGroup"
        />
        <Button :disabled="busy" @click="selected = []">{{ t("teamPage.clearSelection") }}</Button>
      </div>

      <table class="tm-table">
        <thead>
          <tr>
            <th v-if="canManage" class="tm-check">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" />
            </th>
            <th>{{ t("teamPage.thMember") }}</th><th>{{ t("teamPage.thAccount") }}</th><th>{{ t("teamPage.thRole") }}</th><th>{{ t("teamPage.thGroup") }}</th>
            <th>{{ t("teamPage.thCredits") }}</th><th>{{ t("teamPage.thStatus") }}</th><th>{{ t("teamPage.thRemark") }}</th><th v-if="canManage">{{ t("teamPage.thOps") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.user_id">
            <td v-if="canManage" class="tm-check">
              <input type="checkbox" :checked="selected.includes(m.user_id)" @change="toggle(m.user_id)" />
            </td>
            <td>{{ m.nickname || m.user_id }}</td>
            <td class="tm-mono">{{ m.account || "—" }}</td>
            <td><Tag>{{ roleName(m.role_code) }}</Tag></td>
            <td>{{ groupName_(m.group_id) }}</td>
            <td class="tm-num">{{ m.credits_quota }}</td>
            <td>{{ m.status === 1 ? t("teamPage.statusNormal") : m.status === 2 ? t("teamPage.statusDisabled") : t("teamPage.statusPending") }}</td>
            <td class="tm-ellipsis">{{ m.remark || "—" }}</td>
            <td v-if="canManage">
              <button class="tm-link" @click="openEdit(m)">{{ t("teamPage.edit") }}</button>
            </td>
          </tr>
          <tr v-if="members.length === 0">
            <td :colspan="canManage ? 9 : 7" class="tm-empty">
              {{ t("teamPage.noMembers") }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 积分管理 -->
    <section v-else-if="tab === 'points'" class="tm-panel">
      <div class="tm-cards">
        <Card class="tm-card">
          <h2 class="tm-h2">{{ t("teamPage.poolTitle") }}</h2>
          <p class="tm-hint">
            {{ t("teamPage.poolLine", { total: team?.credit_total ?? 0, frozen: (team?.frozen ?? 0) > 0 ? t("teamPage.frozenSuffix", { frozen: team?.frozen ?? 0 }) : "" }) }}
            {{ t("teamPage.poolHint") }}
          </p>
          <Button :disabled="busy" @click="navigateTo('/pricing')">{{ t("teamPage.rechargeTeam") }}</Button>
        </Card>
        <Card class="tm-card">
          <h2 class="tm-h2">{{ t("teamPage.allocateRulesTitle") }}</h2>
          <p class="tm-hint">
            {{ t("teamPage.allocateRulesText") }}
          </p>
        </Card>
      </div>

      <div class="tm-cards">
        <Card class="tm-card">
          <h2 class="tm-h2">{{ t("teamPage.allocateTitle") }}</h2>
          <p class="tm-hint">{{ t("teamPage.allocateHint") }}</p>
          <SelectField
            v-model="allocForm.user_id"
            :label="t('teamPage.fieldMember')"
            :disabled="!canManage"
            :options="[{ value: '', label: t('teamPage.select') }, ...members.map((m) => ({ value: m.user_id, label: m.nickname || m.user_id }))]"
          />
          <TextField v-model="allocForm.amount" :label="t('teamPage.fieldCredits')" type="number" :disabled="!canManage" />
          <TextField v-model="allocForm.memo" :label="t('teamPage.fieldMemo')" :disabled="!canManage" />
          <Button :disabled="!canManage || busy" @click="doAllocate">{{ t("teamPage.confirmAllocate") }}</Button>
        </Card>

        <Card class="tm-card">
          <h2 class="tm-h2">{{ t("teamPage.recoverTitle") }}</h2>
          <p class="tm-hint">{{ t("teamPage.recoverHint") }}</p>
          <SelectField
            v-model="recoverForm.user_id"
            :label="t('teamPage.thMember')"
            :disabled="!canManage"
            :options="[{ value: '', label: t('teamPage.select') }, ...members.map((m) => ({ value: m.user_id, label: t('teamPage.memberOptionWithQuota', { name: m.nickname || m.user_id, quota: m.credits_quota }) }))]"
          />
          <TextField v-model="recoverForm.amount" :label="t('teamPage.fieldCredits')" type="number" :disabled="!canManage" />
          <TextField v-model="recoverForm.memo" :label="t('teamPage.fieldMemo')" :disabled="!canManage" />
          <Button :disabled="!canManage || busy" @click="doRecover">{{ t("teamPage.confirmRecover") }}</Button>
        </Card>
      </div>

      <div class="tm-split">
        <div>
          <div class="tm-h2-row">
            <h2 class="tm-h2">{{ t("teamPage.flowsTitle", { total: flowTotal }) }}</h2>
            <Button :disabled="flowExporting" size="sm" variant="secondary" @click="exportFlows">
              {{ flowExporting ? t("teamPage.generating") : t("teamPage.exportFlows") }}
            </Button>
          </div>
          <table class="tm-table">
            <thead><tr><th>{{ t("teamPage.thTime") }}</th><th>{{ t("teamPage.thType") }}</th><th>{{ t("teamPage.thChange") }}</th><th>{{ t("teamPage.thMember") }}</th><th>{{ t("teamPage.thRemark") }}</th></tr></thead>
            <tbody>
              <tr v-for="f in flows" :key="f.id">
                <td class="tm-mono">{{ new Date(f.created_at).toLocaleString() }}</td>
                <td>{{ kindLabel[f.kind] ?? f.kind }}</td>
                <td class="tm-num" :class="f.delta > 0 ? 'up' : 'down'">{{ f.delta > 0 ? "+" : "" }}{{ f.delta }}</td>
                <td class="tm-mono">{{ f.target_user_id ?? "—" }}</td>
                <td class="tm-ellipsis">{{ f.memo || "—" }}</td>
              </tr>
              <tr v-if="flows.length === 0"><td colspan="5" class="tm-empty">{{ t("teamPage.noFlows") }}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 class="tm-h2">{{ t("teamPage.rankTitle") }}</h2>
          <ol class="tm-rank">
            <li v-for="(r, i) in ranking" :key="r.user_id">
              <span class="tm-rank-no">{{ i + 1 }}</span>
              <span class="tm-rank-name">{{ r.nickname || r.user_id }}</span>
              <span class="tm-num">{{ r.credits }}</span>
            </li>
            <li v-if="ranking.length === 0" class="tm-empty">{{ t("teamPage.noData") }}</li>
          </ol>
        </div>
      </div>
      <div class="tm-cards">
        <Card class="tm-card tm-group-stats">
          <h2 class="tm-h2">{{ t("teamPage.groupStatsTitle") }}</h2>
          <p class="tm-hint">{{ t("teamPage.groupStatsHint") }}</p>
          <table class="tm-table">
            <thead>
              <tr><th>{{ t("teamPage.thGroupName") }}</th><th>{{ t("teamPage.thMembers") }}</th><th>{{ t("teamPage.thTasks") }}</th><th>{{ t("teamPage.thConsumed") }}</th><th>{{ t("teamPage.thAllocated") }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in groups" :key="g.id">
                <td>{{ g.name }}</td>
                <td class="tm-num">{{ groupStats[g.id]?.member_count ?? "—" }}</td>
                <td class="tm-num">{{ groupStats[g.id]?.task_count ?? "—" }}</td>
                <td class="tm-num">{{ groupStats[g.id]?.points_used ?? "—" }}</td>
                <td class="tm-num">{{ groupStats[g.id]?.points_allocated ?? "—" }}</td>
              </tr>
              <tr v-if="groups.length === 0"><td colspan="5" class="tm-empty">{{ t("teamPage.noGroups") }}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </section>

    <!-- 规则说明 -->
    <!-- 角色权限（第 9 批 B）：权限码目录（70 条）+ 角色 power_list 勾选保存 -->
    <section v-else-if="tab === 'permissions'" class="tm-panel">
      <TeamPermissionMatrix :roles="roles" :can-manage="canManage" />

      <div class="tm-switches">
        <h3 class="tm-switches-title">{{ t("teamPage.switchesTitle") }}</h3>
        <p v-if="tempInfoLoading" class="tm-muted">{{ t("teamPage.loading") }}</p>
        <p v-else-if="!tempInfo" class="tm-muted">{{ t("teamPage.noSwitchData") }}</p>
        <ul v-else class="tm-switch-list">
          <li><span>{{ t("teamPage.switchFilm") }}</span><strong>{{ tempInfo.film_enabled ? t("teamPage.enabled") : t("teamPage.notEnabled") }}</strong></li>
          <li><span>{{ t("teamPage.switchAgent") }}</span><strong>{{ tempInfo.agent_whitelist ? t("teamPage.enabled") : t("teamPage.notEnabled") }}</strong></li>
          <li><span>{{ t("teamPage.switchByok") }}</span><strong>{{ tempInfo.api_key_white ? t("teamPage.configured") : t("teamPage.notConfigured") }}</strong></li>
          <li><span>{{ t("teamPage.switchSeedance") }}</span><strong>{{ tempInfo.seedance_is_support ? t("teamPage.supported") : t("teamPage.notSupported") }}</strong></li>
          <li v-for="key in tempInfo.unverified" :key="key">
            <span>{{ key }}</span><strong class="tm-unverified">{{ t("teamPage.unverified") }}</strong>
          </li>
        </ul>
        <p v-if="tempInfo" class="tm-muted tm-switch-note">
          {{ t("teamPage.switchNote", { from: tempInfo.derived_from }) }}
        </p>
      </div>
    </section>

    <section v-else class="tm-panel tm-rules">
      <h2 class="tm-h2">{{ t("teamPage.rulesTitle") }}</h2>
      <ul>
        <li>{{ t("teamPage.rules.pool") }}</li>
        <li>{{ t("teamPage.rules.quota") }}</li>
        <li>{{ t("teamPage.rules.pair") }}</li>
        <li>{{ t("teamPage.rules.consume") }}</li>
        <li>{{ t("teamPage.rules.role") }}</li>
        <li>{{ t("teamPage.rules.seats") }}</li>
      </ul>
    </section>

    <!-- 编辑成员弹窗 -->
    <Modal :open="editOpen" :title="t('teamPage.editMemberTitle')" @close="editOpen = false">
      <SelectField
        v-model="editForm.role_code"
        :label="t('teamPage.roleLabel')"
        :options="[{ value: '', label: t('teamPage.notSet') }, ...roles.map((r) => ({ value: r.role_code, label: r.role_name }))]"
      />
      <SelectField
        v-model="editForm.group_id"
        :label="t('teamPage.groupLabel')"
        :options="[{ value: '', label: t('teamPage.ungrouped') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]"
      />
      <TextField v-model="editForm.nickname" :label="t('teamPage.nicknameLabel')" />
      <TextField v-model="editForm.remark" :label="t('teamPage.remarkLabel')" />
      <SelectField
        v-model="statusStr"
        :label="t('teamPage.statusLabel')"
        :options="[{ value: '1', label: t('teamPage.statusNormal') }, { value: '2', label: t('teamPage.statusDisabled') }, { value: '3', label: t('teamPage.statusPending') }]"
      />
      <template #footer>
        <Button :disabled="busy" @click="saveEdit">{{ t("teamPage.save") }}</Button>
      </template>
    </Modal>

    <!-- 邀请成员弹窗 -->
    <Modal :open="inviteOpen" :title="t('teamPage.inviteTitle')" @close="inviteOpen = false">
      <p class="tm-hint">
        {{ t("teamPage.inviteHint") }}
      </p>
      <TextAreaField
        v-model="invitePhones"
        :label="t('teamPage.phoneLabel')"
        placeholder="13800000000 13900000000"
      />
      <SelectField
        v-model="inviteRole"
        :label="t('teamPage.roleOptional')"
        :options="[{ value: '', label: t('teamPage.defaultRole') }, ...roles.map((r) => ({ value: r.role_code, label: r.role_name }))]"
      />
      <SelectField
        v-model="inviteGroup"
        :label="t('teamPage.groupOptional')"
        :options="[{ value: '', label: t('teamPage.ungrouped') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]"
      />
      <div v-if="inviteResult.length > 0" class="tm-invite-result">
        <p v-for="(r, i) in inviteResult" :key="i" :class="r.ok ? 'ok' : 'bad'">
          {{ r.phone || r.user_id }} — {{ r.ok ? t("teamPage.joined") : r.reason || t("teamPage.failed") }}
        </p>
      </div>
      <template #footer>
        <Button :disabled="busy" @click="inviteMembers">{{ t("teamPage.addMembers") }}</Button>
      </template>
    </Modal>

    <!-- 新建分组弹窗 -->
    <Modal :open="groupOpen" :title="t('teamPage.newGroupTitle')" @close="groupOpen = false">
      <TextField v-model="groupName" :label="t('teamPage.groupNameLabel')" :placeholder="t('teamPage.groupNamePlaceholder')" />
      <template #footer>
        <Button :disabled="busy" @click="createGroup">{{ t("teamPage.create") }}</Button>
      </template>
    </Modal>

    <!-- 团队设置弹窗 -->
    <Modal :open="teamEditOpen" :title="t('teamPage.settingsTitle')" @close="teamEditOpen = false">
      <TextField v-model="teamEditForm.name" class="tm-team-name" :label="t('teamPage.teamNameLabel')" />
      <TextField v-model="teamEditForm.max_seats" class="tm-team-seats" :label="t('teamPage.seatsLabel')" type="number" />
      <p class="tm-hint">{{ t("teamPage.seatsHint", { count: team?.used_seats ?? 0 }) }}</p>
      <label class="tm-check-row">
        <input v-model="teamEditForm.film_enabled" type="checkbox" />
        <span>{{ t("teamPage.toggleFilm") }}</span>
      </label>
      <label class="tm-check-row">
        <input v-model="teamEditForm.agent_whitelist" type="checkbox" />
        <span>{{ t("teamPage.toggleAgent") }}</span>
      </label>
      <template #footer>
        <Button :disabled="busy" @click="saveTeamEdit">{{ t("teamPage.saveSettings") }}</Button>
      </template>
    </Modal>

    <!-- 批量分配弹窗 -->
    <Modal :open="batchAllocOpen" :title="t('teamPage.batchTitle')" @close="batchAllocOpen = false">
      <p class="tm-hint">
        {{ t("teamPage.batchHint", { count: selected.length }) }}
      </p>
      <TextField v-model="batchAllocAmount" class="tm-batch-amount" :label="t('teamPage.perMember')" type="number" />
      <TextField v-model="batchAllocMemo" class="tm-batch-memo" :label="t('teamPage.fieldMemo')" />
      <template #footer>
        <Button :disabled="busy" @click="doBatchAlloc">{{ t("teamPage.confirmAllocate") }}</Button>
      </template>
    </Modal>

    <!-- 创建团队弹窗 -->
    <Modal :open="newTeamOpen" :title="t('teamPage.createTeam')" @close="newTeamOpen = false">
      <p class="tm-hint">
        {{ t("teamPage.createTeamHint") }}
      </p>
      <TextField v-model="newTeamName" :label="t('teamPage.teamNameLabel')" :placeholder="t('teamPage.teamNamePlaceholder')" />
      <template #footer>
        <Button :disabled="busy" @click="createTeam">{{ t("teamPage.createAndEnter") }}</Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.tm { display: flex; flex-direction: column; gap: var(--space-4); }
.tm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.tm-title { font-size: 24px; font-weight: 700; margin: 0; }
.tm-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.tm-head-actions { display: flex; gap: var(--space-2); }
.tm-tabbar-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); border-bottom: 1px solid var(--border-1);
}
.tm-tabbar-row :deep(.tabs) { border-bottom: 0; }
.tm-dash-entry {
  border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-2);
  font-size: 13px; padding: 6px 12px; border-radius: var(--radius-2); cursor: pointer;
  white-space: nowrap; margin-bottom: 4px;
}
.tm-dash-entry:hover { color: var(--text-1); border-color: var(--brand-500); }
.tm-panel { display: flex; flex-direction: column; gap: var(--space-4); }
.tm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tm-table th {
  text-align: left; font-weight: 500; color: var(--text-3);
  padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-1); white-space: nowrap;
}
.tm-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-1); }
.tm-check { width: 32px; }
.tm-batch {
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: var(--space-2) var(--space-3); background: var(--surface-2);
  border-radius: var(--radius-2); font-size: 13px;
}
.tm-batch-group { min-width: 160px; }
.tm-invite-result { max-height: 140px; overflow: auto; font-size: 12px; }
.tm-invite-result p { margin: 2px 0; }
.tm-invite-result .ok { color: var(--success-1, #2f9e44); }
.tm-invite-result .bad { color: var(--danger-1, #e03131); }
.tm-empty { text-align: center; color: var(--text-3); padding: var(--space-6); }
.tm-mono { font-family: var(--font-mono); font-size: 12px; color: var(--text-2); }
.tm-num { font-variant-numeric: tabular-nums; font-weight: 600; }
.tm-num.up { color: var(--success-1, #2f9e44); }
.tm-num.down { color: var(--danger-1, #e03131); }
.tm-ellipsis { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-link { background: none; border: 0; color: var(--brand-1); cursor: pointer; font-size: 13px; padding: 0; }
.tm-alert { padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); font-size: 13px; margin: 0; }
.tm-alert--err { background: var(--danger-soft, #fff0f0); color: var(--danger-1, #e03131); }
.tm-alert--ok { background: var(--success-soft, #f0fff4); color: var(--success-1, #2f9e44); }
.tm-alert--hint { background: var(--surface-2); color: var(--text-2); }
.tm-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-4); }
.tm-card { display: flex; flex-direction: column; gap: var(--space-2); }
.tm-h2 { font-size: 15px; font-weight: 600; margin: 0 0 var(--space-2); }
.tm-h2-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.tm-check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
.tm-hint { font-size: 12px; color: var(--text-3); margin: 0 0 var(--space-2); }
.tm-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-5); }
.tm-rank { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.tm-rank li { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; }
.tm-rank-no { width: 20px; color: var(--text-3); }
.tm-rank-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-rules ul { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 13px; color: var(--text-2); }
/* ── 角色权限页签的「模型开关」小卡 ── */
.tm-switches { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--line-1); }
.tm-switches-title { margin: 0 0 var(--space-3); font-size: 14px; color: var(--text-1); }
.tm-switches-title code { background: rgba(255, 255, 255, 0.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.tm-switch-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-2) var(--space-4); font-size: 13px; }
.tm-switch-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: 6px 10px; background: var(--bg-2); border-radius: var(--radius-2); color: var(--text-2); }
.tm-switch-list strong { color: var(--text-1); font-weight: 600; }
.tm-unverified { color: var(--warn-1, #f0c48a) !important; }
.tm-switch-note { margin: var(--space-3) 0 0; font-size: 12px; color: var(--text-3); }
.tm-switch-note code { background: rgba(255, 255, 255, 0.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.tm-muted { font-size: 12px; color: var(--text-3); }
@media (max-width: 960px) { .tm-split { grid-template-columns: 1fr; } }
</style>
