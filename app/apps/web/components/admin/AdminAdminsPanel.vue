<script setup lang="ts">
/**
 * 管理员账号面板（契约 §3.3）。
 *
 * 只做账号本身：角色（super/ops/viewer）、启停、改密。
 * 为什么不做"删除"：后端明确不物理删除（`DELETE admins/:id` 不做），停用走 PATCH status=2，
 * 这样 `admin_audit_logs.admin_id` 的外键始终指向一条真实存在的账号，历史留痕才解释得清。
 */
const { t } = useI18n();

type AdminRole = "super" | "ops" | "viewer";

interface AdminRow {
  id: string;
  username: string;
  role: AdminRole;
  /** 1 启用 / 2 停用 */
  status: number;
  created_at: string | null;
  last_login_at: string | null;
}

const ROLES: AdminRole[] = ["super", "ops", "viewer"];

/** 角色 → 文案 key（角色值是后端契约，不能本地化，只翻译展示名） */
const ROLE_LABEL_KEY: Record<AdminRole, string> = {
  super: "adminAdmins.roleSuper",
  ops: "adminAdmins.roleOps",
  viewer: "adminAdmins.roleViewer",
};

const rows = ref<AdminRow[]>([]);
const loading = ref(false);
const error = ref("");
const ok = ref("");
/** 行内操作的 busy 标识：`<id>:role` / `<id>:status` / `<id>:password`，控制单按钮禁用 */
const busy = ref("");

/** 新建表单：默认 role=viewer 是最小权限原则；要提权必须显式选，避免"默认超管"的误操作 */
const form = reactive<{ username: string; password: string; role: AdminRole }>({
  username: "",
  password: "",
  role: "viewer",
});
const createBusy = ref(false);

function roleLabel(role: string): string {
  const key = ROLE_LABEL_KEY[role as AdminRole];
  return key ? t(key) : role;
}

/** 行内按钮的 busy 判定收进函数：模板里少写反引号表达式，`vue-tsc` 与模板解析都更稳 */
function isBusy(row: AdminRow, action: string): boolean {
  return busy.value === `${row.id}:${action}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return t("adminAdmins.never");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

/**
 * 身份类错误统一处理：
 * - 401101（token 过期/被踢）：清 token 回登录页；
 * - 403101（角色不够）：就地提示"需要 super 角色"。**不回登录页**：非 super 账号
 *   重新登录还是同一个角色，会被反复弹回登录页形成死循环，而这里正好是角色管理页，
 *   更需要把"你权限不够"讲清楚（契约 §3.3 也要求该端点仅 super 可调）。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  if (adminErrorCode(err) === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (adminErrorCode(err) === 403101) {
    error.value = t("adminAdmins.needSuper");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<{ list: AdminRow[] }>("/ops/admin/admins");
    rows.value = data.list ?? [];
  } catch (err) {
    // 保留上一份成功数据，只把错误显示在上方：网络抖动不该把整张表清空
    await handleError(err, "adminAdmins.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function patch(
  row: AdminRow,
  body: { role?: AdminRole; status?: number; password?: string },
  action: string,
): Promise<void> {
  busy.value = `${row.id}:${action}`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/admins/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body,
    });
    // 写操作后刷新自身数据：后端可能连带 bump tokenVersion / 拒绝最后一个 super，以服务端为准
    await load();
    ok.value = t("adminAdmins.updated");
  } catch (err) {
    // 先与服务端对齐再提示：改角色失败（如"最后一个 super 不能降级"）时，
    // 原生 select 仍停在用户刚选的项上，不重新拉取就会显示一个并不存在的角色
    await load();
    await handleError(err, "adminAdmins.updateFailed");
  } finally {
    busy.value = "";
  }
}

async function createAdmin(): Promise<void> {
  error.value = "";
  ok.value = "";
  const username = form.username.trim();
  // 前端先挡最基本的两种错（后端 zod 仍会兜底）：空用户名、密码 <8
  if (!username) {
    error.value = t("adminAdmins.usernameRequired");
    return;
  }
  if (form.password.length < 8) {
    error.value = t("adminAdmins.passwordTooShort");
    return;
  }
  createBusy.value = true;
  try {
    await adminApi<unknown>("/ops/admin/admins", {
      method: "POST",
      body: { username, password: form.password, role: form.role },
    });
    form.username = "";
    form.password = "";
    form.role = "viewer";
    await load();
    ok.value = t("adminAdmins.created", { username });
  } catch (err) {
    await handleError(err, "adminAdmins.createFailed");
  } finally {
    createBusy.value = false;
  }
}

function onRoleChange(row: AdminRow, event: Event): void {
  const next = (event.target as HTMLSelectElement).value as AdminRole;
  if (!ROLES.includes(next) || next === row.role) return;
  void patch(row, { role: next }, "role");
}

function toggleStatus(row: AdminRow): void {
  void patch(row, { status: row.status === 1 ? 2 : 1 }, "status");
}

/** 改密用 window.prompt：与 `pages/admin/index.vue` 的退款填写风格一致，不额外引入弹窗组件 */
function changePassword(row: AdminRow): void {
  const input = window.prompt(t("adminAdmins.passwordPrompt", { username: row.username }));
  if (input === null) return;
  if (input.length < 8) {
    error.value = t("adminAdmins.passwordTooShort");
    return;
  }
  void patch(row, { password: input }, "password");
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="card">
    <h2>{{ t("adminAdmins.title") }}</h2>
    <p class="hint">{{ t("adminAdmins.hint") }}</p>

    <div class="create">
      <label class="field">
        <span class="label">{{ t("adminAdmins.fUsername") }}</span>
        <input
          v-model="form.username"
          class="input"
          :placeholder="t('adminAdmins.fUsernamePlaceholder')"
          maxlength="64"
          autocomplete="off"
        />
      </label>
      <label class="field">
        <span class="label">{{ t("adminAdmins.fPassword") }}</span>
        <input
          v-model="form.password"
          class="input"
          type="password"
          :placeholder="t('adminAdmins.fPasswordHint')"
          maxlength="128"
          autocomplete="new-password"
        />
      </label>
      <label class="field">
        <span class="label">{{ t("adminAdmins.fRole") }}</span>
        <select v-model="form.role" class="input">
          <option v-for="role in ROLES" :key="role" :value="role">{{ roleLabel(role) }}</option>
        </select>
      </label>
      <button class="mini primary create-btn" :disabled="createBusy" @click="createAdmin">
        {{ createBusy ? t("adminAdmins.creating") : t("adminAdmins.create") }}
      </button>
    </div>

    <p v-if="error" class="banner">{{ error }}</p>
    <p v-if="ok" class="ok">{{ ok }}</p>

    <p v-if="loading" class="muted">{{ t("adminAdmins.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted">{{ t("adminAdmins.empty") }}</p>

    <template v-else>
      <div class="row head-row">
        <span>{{ t("adminAdmins.colUsername") }}</span>
        <span>{{ t("adminAdmins.colRole") }}</span>
        <span>{{ t("adminAdmins.colStatus") }}</span>
        <span>{{ t("adminAdmins.colCreated") }}</span>
        <span>{{ t("adminAdmins.colLastLogin") }}</span>
        <span>{{ t("adminAdmins.colOps") }}</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="row">
        <span class="ellipsis" :title="row.username">{{ row.username }}</span>
        <span>
          <select
            class="input compact"
            :value="row.role"
            :disabled="isBusy(row, 'role')"
            @change="onRoleChange(row, $event)"
          >
            <option v-for="role in ROLES" :key="role" :value="role">{{ roleLabel(role) }}</option>
          </select>
        </span>
        <span :class="row.status === 1 ? 'state-on' : 'state-off'">
          {{ row.status === 1 ? t("adminAdmins.statusEnabled") : t("adminAdmins.statusDisabled") }}
        </span>
        <span class="muted">{{ formatTime(row.created_at) }}</span>
        <span class="muted">{{ formatTime(row.last_login_at) }}</span>
        <span class="ops">
          <button class="mini" :disabled="isBusy(row, 'status')" @click="toggleStatus(row)">
            {{ row.status === 1 ? t("adminAdmins.disable") : t("adminAdmins.enable") }}
          </button>
          <button class="mini" :disabled="isBusy(row, 'password')" @click="changePassword(row)">
            {{ t("adminAdmins.changePassword") }}
          </button>
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* 风格对齐 pages/admin/index.vue 的 .card/.row/.mini/.input（scoped 复制，避免引全局新样式） */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
}
h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
.hint {
  margin: 0 0 12px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}
.create {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  color: var(--text-3);
  font-size: 12px;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 170px;
}
.input.compact {
  min-width: 96px;
  padding: 3px 6px;
}
.create-btn {
  margin-bottom: 1px;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) 120px 80px 150px 150px 190px;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
}
.ops {
  display: inline-flex;
  gap: 6px;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.state-on {
  color: #4ade80;
  font-size: 12px;
}
.state-off {
  color: var(--text-3);
  font-size: 12px;
}
.banner {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-bg, rgba(255, 107, 107, 0.12));
  color: #ff6b6b;
  font-size: 12px;
}
.ok {
  margin: 0 0 12px;
  color: #4ade80;
  font-size: 12px;
}
.mini {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}
.mini.primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
