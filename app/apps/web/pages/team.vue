<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 团队管理（cam 域）
 *
 * 结构对齐参照产品实测（2026-10-26 登录态采集）：
 *   tabs = 成员管理 / 积分管理 / 规则说明
 *   成员表格 8 列 = 成员 / 账号 / 角色 / 成员组 / 参与项目形式 / 当前积分 / 状态 / 备注
 *
 * 关键语义（ADR-011）：团队积分池 = 该 space 的 credit_accounts.balance；
 * 成员「当前积分」是**已分配额度**（credits_quota），不是余额，回收会回落。
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

// 状态用字符串桥接（SelectField 的 model 是 string）
const statusStr = computed({
  get: () => String(editForm.value.status),
  set: (v: string) => (editForm.value.status = Number(v)),
});

const tabs = computed(() => [
  { value: "members", label: "成员管理", badge: total.value },
  { value: "points", label: "积分管理" },
  { value: "rules", label: "规则说明" },
]);

const canManage = computed(() => perm.value?.privileged === true);
const roleName = (code: string | null): string => roles.value.find((r) => r.role_code === code)?.role_name ?? (code ?? "—");
const groupName_ = (id: string | null): string => groups.value.find((g) => g.id === id)?.name ?? "未分组";
const kindLabel: Record<string, string> = {
  team_allocate_out: "分配（团队出账）",
  team_allocate_in: "分配（成员入账）",
  team_recover_out: "回收（成员出账）",
  team_recover_in: "回收（团队入账）",
};

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
  flash("已切换空间");
}

/** 创建团队：建 spaces(type=2) → 自动切进去 */
async function createTeam(): Promise<void> {
  if (!newTeamName.value.trim()) return flash("请输入团队名称");
  busy.value = true;
  error.value = "";
  try {
    const created = await api.post<{ space_id: string; name: string }>("/cam/team", {
      name: newTeamName.value.trim(),
    });
    newTeamOpen.value = false;
    newTeamName.value = "";
    await switchSpace(created.space_id);
    flash("团队已创建");
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
  if (v === "points" && flows.value.length === 0) {
    try {
      await loadPoints();
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
  if (!allocForm.value.user_id) return flash("请选择成员");
  busy.value = true;
  error.value = "";
  try {
    await api.post("/cam/team/points-allocation", {
      user_id: allocForm.value.user_id,
      amount: Number(allocForm.value.amount),
      ...(allocForm.value.memo ? { memo: allocForm.value.memo } : {}),
    });
    flash(`已分配 ${allocForm.value.amount} 积分`);
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
  if (!recoverForm.value.user_id) return flash("请选择成员");
  busy.value = true;
  error.value = "";
  try {
    await api.post("/cam/team/points-recovery", {
      user_id: recoverForm.value.user_id,
      amount: Number(recoverForm.value.amount),
      ...(recoverForm.value.memo ? { memo: recoverForm.value.memo } : {}),
    });
    flash(`已回收 ${recoverForm.value.amount} 积分`);
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
    flash("已保存");
    await loadMembers();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function createGroup(): Promise<void> {
  if (!groupName.value.trim()) return flash("请输入分组名");
  busy.value = true;
  try {
    await api.post("/cam/team/group", { name: groupName.value.trim() });
    groupOpen.value = false;
    groupName.value = "";
    await loadGroups();
    flash("分组已创建");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(bootstrap);
</script>

<template>
  <div class="tm">
    <header class="tm-head">
      <div>
        <h1 class="tm-title">团队管理</h1>
        <p class="tm-sub">
          <template v-if="team">
            {{ team.name }} · 席位 {{ team.used_seats }}/{{ team.max_seats }} ·
            团队积分池 <b>{{ team.credit_total }}</b>
            <span v-if="team.frozen > 0">（冻结 {{ team.frozen }}）</span>
            <span v-if="team.type === 1" class="tm-badge">当前是个人空间</span>
          </template>
          <template v-else>加载中…</template>
        </p>
      </div>
      <div class="tm-head-actions">
        <SelectField
          v-if="myTeams.length > 0"
          class="tm-space-picker"
          label=""
          :options="myTeams.map((t) => ({ value: t.space_id, label: `${t.name}${t.type === 2 ? '（团队）' : '（个人）'}` }))"
          :model-value="activeSpace || myTeams[0]?.space_id || ''"
          @update:model-value="switchSpace"
        />
        <Button :disabled="busy" @click="newTeamOpen = true">创建团队</Button>
        <Button :disabled="!canManage || busy" @click="groupOpen = true">新建分组</Button>
        <Button :disabled="busy" @click="bootstrap">刷新</Button>
      </div>
    </header>

    <p v-if="error" class="tm-alert tm-alert--err">{{ error }}</p>
    <p v-if="info" class="tm-alert tm-alert--ok">{{ info }}</p>
    <p v-if="!canManage" class="tm-alert tm-alert--hint">
      你当前是团队成员（{{ perm?.role_code ?? "member" }}），只能查看；编辑需管理员/制片等特权角色。
    </p>

    <TabBar v-model="tab" :tabs="tabs" />

    <!-- 成员管理 -->
    <section v-if="tab === 'members'" class="tm-panel">
      <table class="tm-table">
        <thead>
          <tr>
            <th>成员</th><th>账号</th><th>角色</th><th>成员组</th>
            <th>当前积分</th><th>状态</th><th>备注</th><th v-if="canManage">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.user_id">
            <td>{{ m.nickname || m.user_id }}</td>
            <td class="tm-mono">{{ m.account || "—" }}</td>
            <td><Tag>{{ roleName(m.role_code) }}</Tag></td>
            <td>{{ groupName_(m.group_id) }}</td>
            <td class="tm-num">{{ m.credits_quota }}</td>
            <td>{{ m.status === 1 ? "正常" : m.status === 2 ? "停用" : "待激活" }}</td>
            <td class="tm-ellipsis">{{ m.remark || "—" }}</td>
            <td v-if="canManage">
              <button class="tm-link" @click="openEdit(m)">编辑</button>
            </td>
          </tr>
          <tr v-if="members.length === 0">
            <td :colspan="canManage ? 8 : 7" class="tm-empty">
              还没有成员。团队成员用于协作制片与积分分配。
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 积分管理 -->
    <section v-else-if="tab === 'points'" class="tm-panel">
      <div class="tm-cards">
        <Card class="tm-card">
          <h2 class="tm-h2">分配积分</h2>
          <p class="tm-hint">从团队积分池转给成员个人空间（成对记账，团队池减少、成员余额增加）。</p>
          <SelectField
            v-model="allocForm.user_id"
            label="成员"
            :disabled="!canManage"
            :options="[{ value: '', label: '请选择' }, ...members.map((m) => ({ value: m.user_id, label: m.nickname || m.user_id }))]"
          />
          <TextField v-model="allocForm.amount" label="积分数量" type="number" :disabled="!canManage" />
          <TextField v-model="allocForm.memo" label="备注（可选）" :disabled="!canManage" />
          <Button :disabled="!canManage || busy" @click="doAllocate">确认分配</Button>
        </Card>

        <Card class="tm-card">
          <h2 class="tm-h2">回收积分</h2>
          <p class="tm-hint">从成员个人空间收回团队（成员余额减少、团队池增加；已分配额度回落）。</p>
          <SelectField
            v-model="recoverForm.user_id"
            label="成员"
            :disabled="!canManage"
            :options="[{ value: '', label: '请选择' }, ...members.map((m) => ({ value: m.user_id, label: `${m.nickname || m.user_id}（已分配 ${m.credits_quota}）` }))]"
          />
          <TextField v-model="recoverForm.amount" label="积分数量" type="number" :disabled="!canManage" />
          <TextField v-model="recoverForm.memo" label="备注（可选）" :disabled="!canManage" />
          <Button :disabled="!canManage || busy" @click="doRecover">确认回收</Button>
        </Card>
      </div>

      <div class="tm-split">
        <div>
          <h2 class="tm-h2">流水（最近 50 条，共 {{ flowTotal }}）</h2>
          <table class="tm-table">
            <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>成员</th><th>备注</th></tr></thead>
            <tbody>
              <tr v-for="f in flows" :key="f.id">
                <td class="tm-mono">{{ new Date(f.created_at).toLocaleString() }}</td>
                <td>{{ kindLabel[f.kind] ?? f.kind }}</td>
                <td class="tm-num" :class="f.delta > 0 ? 'up' : 'down'">{{ f.delta > 0 ? "+" : "" }}{{ f.delta }}</td>
                <td class="tm-mono">{{ f.target_user_id ?? "—" }}</td>
                <td class="tm-ellipsis">{{ f.memo || "—" }}</td>
              </tr>
              <tr v-if="flows.length === 0"><td colspan="5" class="tm-empty">暂无团队积分流水</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 class="tm-h2">成员已分配额度排行</h2>
          <ol class="tm-rank">
            <li v-for="(r, i) in ranking" :key="r.user_id">
              <span class="tm-rank-no">{{ i + 1 }}</span>
              <span class="tm-rank-name">{{ r.nickname || r.user_id }}</span>
              <span class="tm-num">{{ r.credits }}</span>
            </li>
            <li v-if="ranking.length === 0" class="tm-empty">暂无数据</li>
          </ol>
        </div>
      </div>
    </section>

    <!-- 规则说明 -->
    <section v-else class="tm-panel tm-rules">
      <h2 class="tm-h2">团队积分怎么算</h2>
      <ul>
        <li><b>团队积分池</b>就是团队空间的可用余额，不是另一个账本；分配/回收是「空间之间的转账」。</li>
        <li><b>成员「当前积分」是已分配额度</b>（未回收上限），<b>不是余额</b>——回收后会回落。</li>
        <li>每次分配都会同时写两条流水（团队出账 + 成员入账），所以全系统积分总量守恒，可对账。</li>
        <li>成员在团队空间里消耗的是<b>团队池</b>；在自己的个人空间消耗的是<b>个人余额</b>。</li>
        <li><b>角色决定能做什么</b>：管理员/制片/制作等特权角色可管理成员与积分；导演/编剧等创作岗位只参与制作。</li>
        <li>席位数由订阅档位决定，满员时新增成员会提示「席位已满」。</li>
      </ul>
    </section>

    <!-- 编辑成员弹窗 -->
    <Modal :open="editOpen" title="编辑成员" @close="editOpen = false">
      <SelectField
        v-model="editForm.role_code"
        label="角色"
        :options="[{ value: '', label: '（不设置）' }, ...roles.map((r) => ({ value: r.role_code, label: r.role_name }))]"
      />
      <SelectField
        v-model="editForm.group_id"
        label="成员组"
        :options="[{ value: '', label: '未分组' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]"
      />
      <TextField v-model="editForm.nickname" label="昵称" />
      <TextField v-model="editForm.remark" label="备注" />
      <SelectField
        v-model="statusStr"
        label="状态"
        :options="[{ value: '1', label: '正常' }, { value: '2', label: '停用' }, { value: '3', label: '待激活' }]"
      />
      <template #footer>
        <Button :disabled="busy" @click="saveEdit">保存</Button>
      </template>
    </Modal>

    <!-- 新建分组弹窗 -->
    <Modal :open="groupOpen" title="新建成员组" @close="groupOpen = false">
      <TextField v-model="groupName" label="分组名称" placeholder="如：编剧组 / 动画组" />
      <template #footer>
        <Button :disabled="busy" @click="createGroup">创建</Button>
      </template>
    </Modal>

    <!-- 创建团队弹窗 -->
    <Modal :open="newTeamOpen" title="创建团队" @close="newTeamOpen = false">
      <p class="tm-hint">
        团队用于多人协作制片与积分分配。创建后你会成为团队主账号（master），
        可邀请成员、建分组、把团队积分分配给成员。
      </p>
      <TextField v-model="newTeamName" label="团队名称" placeholder="如：星辰短剧工作室" />
      <template #footer>
        <Button :disabled="busy" @click="createTeam">创建并进入</Button>
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
.tm-panel { display: flex; flex-direction: column; gap: var(--space-4); }
.tm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.tm-table th {
  text-align: left; font-weight: 500; color: var(--text-3);
  padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-1); white-space: nowrap;
}
.tm-table td { padding: var(--space-3); border-bottom: 1px solid var(--border-1); }
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
.tm-hint { font-size: 12px; color: var(--text-3); margin: 0 0 var(--space-2); }
.tm-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-5); }
.tm-rank { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.tm-rank li { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; }
.tm-rank-no { width: 20px; color: var(--text-3); }
.tm-rank-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-rules ul { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 13px; color: var(--text-2); }
@media (max-width: 960px) { .tm-split { grid-template-columns: 1fr; } }
</style>
