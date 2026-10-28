<script setup lang="ts">
import type { TeamPermissionCatalogDto, TeamRolePermissionsDto } from "~/types/api";

/**
 * 角色权限矩阵编辑器（`/team` →「角色权限」页签）。
 *
 * 数据口径（`_acceptance/_gap/contract-draft-cam-film.md` §3.2）：
 * - 权限码 = `domain.action`（如 `project.edit`），竞品实测 53 个细码 + 10 个模块粗码并存，
 *   我方另加 5 个影视版码与 2 个团队管理码，目录共 70 条（见 `permission-catalog.ts`）；
 * - 落库形状是 `team_roles.power_list = [{module, action, permission_code}]`，
 *   **不是**裸字符串数组——前端只管勾选，换算在服务端做；
 * - 本批**只做目录 + 存储**，勾选结果**不会**立刻改变任何接口的可访问性（边界见后端注释）。
 *   这点必须在 UI 上说明，否则运营会以为"取消勾选 = 立刻封权"。
 *
 * 第 100 批修正：上面这条边界**已经只对一部分码成立** —— `ENFORCED_PERMISSIONS` 里的 6 个码
 * 真的会拦（403101），其余仍是"只存不生效"。所以不再写一句笼统的"都没接拦截"，
 * 而是把「哪些已生效」逐码标出来（数据来自后端一直返回、前端此前忽略的 `enforced`）。
 * 笼统的免责声明和有选择的标注，后者才让运营敢用。
 *
 * 幂等：重复保存同一集合时后端返回 `changed=false`，这里用来做"没有变化就不吵用户"。
 */

interface RoleItem {
  id: string;
  role_code: string;
  role_name: string;
  role_level: number;
  is_system: boolean;
}

const props = defineProps<{
  roles: RoleItem[];
  /** 只有管理特权能保存（后端 403 的前置，避免按钮点了必失败） */
  canManage: boolean;
}>();

const api = useApi();
const toast = useToast();

const loading = ref(true);
const busy = ref(false);
const errorMsg = ref("");
const catalog = ref<TeamPermissionCatalogDto | null>(null);
const roleId = ref("");
const roleInfo = ref<TeamRolePermissionsDto | null>(null);
const selected = ref<Set<string>>(new Set());
const saved = ref<Set<string>>(new Set());
const savingRoleId = ref("");

/**
 * 第 100 批：已落接口级拦截的码集合。
 *
 * 后端 `GET /cam/permissions` 一直在返回 `enforced` / `enforced_count`，
 * 但前端 DTO 里没有这两个字段、模板也从不渲染 —— 于是「后端算好的元数据没人用」，
 * 页面还停在一句笼统的「尚未接入接口级拦截」。
 * 那是**过期且会误导**的：`team.edit` / `member.remove` 等 6 个码早就真拦了（403101）。
 */
const enforcedCodes = computed(() => new Set((catalog.value?.enforced ?? []).map((e) => e.code)));
const enforcedCount = computed(() => catalog.value?.enforced_count ?? enforcedCodes.value.size);

function enforcedNote(code: string): string {
  const hit = (catalog.value?.enforced ?? []).filter((e) => e.code === code);
  return hit.length === 0 ? "" : hit.map((e) => `${e.method} ${e.endpoint} — ${e.note}`).join("\n");
}

const ROLE_LABEL: Record<string, string> = {
  master: "团队主账号",
  admin: "管理员",
  group_admin: "组管理员",
};

const currentRole = computed(() => props.roles.find((r) => r.id === roleId.value) ?? null);
const isOwnerRole = computed(() => currentRole.value?.role_code === "master");
const dirty = computed(() => {
  if (selected.value.size !== saved.value.size) return true;
  for (const code of selected.value) if (!saved.value.has(code)) return true;
  return false;
});
const totalSelected = computed(() => selected.value.size);

/** 每个分组的勾选进度（矩阵头部显示 3/6，一眼看出漏配） */
function groupProgress(group: { codes: string[] }): { checked: number; total: number } {
  const checked = group.codes.filter((c) => selected.value.has(c)).length;
  return { checked, total: group.codes.length };
}

function roleLabel(role: RoleItem): string {
  const base = ROLE_LABEL[role.role_code] ?? role.role_name;
  return `${base}（L${role.role_level}）`;
}

async function loadCatalog(): Promise<void> {
  loading.value = true;
  errorMsg.value = "";
  try {
    catalog.value = await api.get<TeamPermissionCatalogDto>("/cam/permissions");
    // 默认选第一个非 owner 角色（owner 的权限是固定的，选它只能看不能改）
    if (!roleId.value && props.roles.length > 0) {
      const first = props.roles.find((r) => r.role_code !== "master") ?? props.roles[0];
      await selectRole(first.id);
    }
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载权限目录失败";
  } finally {
    loading.value = false;
  }
}

async function selectRole(id: string): Promise<void> {
  roleId.value = id;
  errorMsg.value = "";
  try {
    const data = await api.get<TeamRolePermissionsDto>(`/cam/roles/${id}/permissions`);
    roleInfo.value = data;
    selected.value = new Set(data.permissions);
    saved.value = new Set(data.permissions);
  } catch (e) {
    roleInfo.value = null;
    errorMsg.value = (e as Error).message || "加载角色权限失败";
  }
}

function toggle(code: string): void {
  if (!props.canManage || isOwnerRole.value) return;
  const next = new Set(selected.value);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  selected.value = next;
}

function toggleGroup(codes: string[], check: boolean): void {
  if (!props.canManage || isOwnerRole.value) return;
  const next = new Set(selected.value);
  for (const code of codes) {
    if (check) next.add(code);
    else next.delete(code);
  }
  selected.value = next;
}

function reset(): void {
  selected.value = new Set(saved.value);
}

async function save(): Promise<void> {
  if (!roleId.value || !props.canManage || isOwnerRole.value) return;
  busy.value = true;
  savingRoleId.value = roleId.value;
  errorMsg.value = "";
  try {
    const res = await api.put<{ changed: boolean; permissions: string[] }>(
      `/cam/roles/${roleId.value}/permissions`,
      { permissions: [...selected.value] },
    );
    saved.value = new Set(res.permissions);
    selected.value = new Set(res.permissions);
    if (res.changed) toast.success(`已保存 ${res.permissions.length} 项权限`);
    else toast.info("权限没有变化（幂等保存）");
  } catch (e) {
    errorMsg.value = (e as Error).message || "保存失败";
    toast.error(errorMsg.value);
  } finally {
    busy.value = false;
    savingRoleId.value = "";
  }
}

watch(
  () => props.roles.length,
  () => {
    if (!loading.value && props.roles.length > 0 && !roleId.value) void loadCatalog();
  },
);

onMounted(loadCatalog);
</script>

<template>
  <section class="pm">
    <header class="pm-head">
      <div>
        <h2 class="pm-title">角色权限矩阵</h2>
        <p class="pm-sub">
          按 <code>domain.action</code> 勾选；保存写团队角色的 <code>power_list</code>。
        </p>
      </div>
      <div class="pm-head-right">
        <span class="pm-count">已选 {{ totalSelected }} 项</span>
        <button type="button" class="pm-btn" :disabled="!dirty || busy" @click="reset">撤销改动</button>
        <button
          type="button"
          class="pm-btn pm-btn-primary"
          :disabled="!dirty || busy || !canManage || isOwnerRole"
          @click="save"
        >
          {{ busy && savingRoleId === roleId ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <!-- 边界说明：已生效的码逐条标出（第 100 批）——笼统免责会让运营不敢用，也会误判 -->
    <p class="pm-notice">
      说明：权限矩阵负责<strong>目录与角色绑定存储</strong>。
      其中 <strong>{{ enforcedCount }}</strong> 个码已接入<strong>接口级拦截</strong>（下表标「已生效」），
      取消勾选会立刻 403；其余码目前只存不生效。
    </p>
    <p v-if="enforcedCount > 0" class="pm-notice pm-notice-sub">
      已生效：<code v-for="e in catalog?.enforced ?? []" :key="e.code" class="pm-enforced-chip">{{ e.code }}</code>
    </p>

    <p v-if="errorMsg" class="pm-alert">{{ errorMsg }}</p>
    <p v-if="!canManage" class="pm-alert">当前角色没有管理特权，只可查看（保存需管理员）。</p>

    <div class="pm-body">
      <aside class="pm-roles">
        <p v-if="loading" class="pm-muted">加载中…</p>
        <button
          v-for="r in roles"
          :key="r.id"
          type="button"
          class="pm-role"
          :class="{ active: r.id === roleId }"
          @click="selectRole(r.id)"
        >
          <span class="pm-role-name">{{ roleLabel(r) }}</span>
          <span v-if="r.role_code === 'master'" class="pm-role-tag">固定</span>
          <span v-else-if="r.is_system" class="pm-role-tag">系统</span>
        </button>
      </aside>

      <div class="pm-matrix">
        <p v-if="isOwnerRole" class="pm-hint">
          团队主账号（owner）的权限由 <code>role_code=master</code> 短路决定，不通过 power_list 配置；
          该角色只读，避免"配置了却不生效"的假象。
        </p>
        <p v-else-if="!catalog" class="pm-muted">没有权限目录数据</p>

        <template v-else>
          <div v-for="g in catalog.groups" :key="g.group" class="pm-group">
            <header class="pm-group-head">
              <label class="pm-group-label">
                <input
                  type="checkbox"
                  :checked="groupProgress(g).checked === groupProgress(g).total && groupProgress(g).total > 0"
                  :disabled="!canManage || isOwnerRole"
                  @change="toggleGroup(g.codes, ($event.target as HTMLInputElement).checked)"
                />
                <strong>{{ g.name }}</strong>
                <span class="pm-group-progress">{{ groupProgress(g).checked }}/{{ groupProgress(g).total }}</span>
              </label>
            </header>
            <ul class="pm-codes">
              <li v-for="code in g.codes" :key="code">
                <label class="pm-code">
                  <input
                    type="checkbox"
                    :checked="selected.has(code)"
                    :disabled="!canManage || isOwnerRole"
                    @change="toggle(code)"
                  />
                  <code class="pm-code-text">{{ code }}</code>
                  <span class="pm-code-name">{{ catalog.list.find((p) => p.code === code)?.name ?? "" }}</span>
                  <span v-if="enforcedCodes.has(code)" class="pm-code-enforced" :title="enforcedNote(code)">已生效</span>
                </label>
              </li>
            </ul>
          </div>

          <p v-if="roleInfo && roleInfo.unknown_permissions.length > 0" class="pm-warn">
            该角色存有目录外的历史码：{{ roleInfo.unknown_permissions.join("、") }}
            （保存时会被校验拒绝，需先清理历史数据）。
          </p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pm {
  color: #e7e9f2;
}
.pm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}
.pm-title {
  margin: 0;
  font-size: 16px;
}
.pm-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8a90a6;
}
.pm-sub code,
.pm-hint code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
.pm-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pm-count {
  font-size: 12px;
  color: #8a90a6;
}
.pm-btn {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #e7e9f2;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.pm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pm-btn-primary {
  background: #2f5bd7;
  border-color: #2f5bd7;
  color: #fff;
}
.pm-notice {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(246, 173, 85, 0.12);
  border: 1px solid rgba(246, 173, 85, 0.28);
  color: #f0c48a;
  font-size: 12px;
  line-height: 1.6;
}
.pm-alert {
  margin: 0 0 8px;
  font-size: 12px;
  color: #ff8a8a;
}
.pm-warn {
  margin: 10px 0 0;
  font-size: 12px;
  color: #f0c48a;
}
.pm-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 16px;
}
.pm-roles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}
.pm-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.04);
  color: #c9cede;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.pm-role.active {
  background: rgba(47, 91, 215, 0.18);
  border-color: rgba(47, 91, 215, 0.5);
  color: #fff;
}
.pm-role-tag {
  font-size: 10px;
  color: #8a90a6;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  padding: 0 4px;
}
.pm-matrix {
  max-height: 560px;
  overflow-y: auto;
}
.pm-muted {
  font-size: 12px;
  color: #8a90a6;
}
.pm-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #8a90a6;
}
.pm-group {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.pm-group-head {
  margin-bottom: 6px;
}
.pm-group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.pm-group-progress {
  font-size: 11px;
  color: #8a90a6;
}
.pm-codes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 4px 12px;
}
.pm-code {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c9cede;
  cursor: pointer;
}
.pm-code-text {
  color: #9fc0ff;
  font-size: 11px;
}
.pm-code-name {
  color: #8a90a6;
}
/* 第 100 批：已落接口级拦截的标记（数据来自后端 enforced，前端此前未接） */
.pm-code-enforced {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid #2f8f5b;
  border-radius: 999px;
  background: rgba(47, 143, 91, 0.14);
  color: #7ee2a8;
  font-size: 10px;
  white-space: nowrap;
  cursor: help;
}
.pm-notice-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.pm-enforced-chip {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(47, 143, 91, 0.14);
  color: #7ee2a8;
  font-size: 11px;
}
</style>
