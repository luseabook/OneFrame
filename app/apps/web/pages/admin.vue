<script setup lang="ts">
definePageMeta({ ssr: false });

interface Envelope<T> {
  code: number;
  msg: string;
  data: T | null;
}

interface Dashboard {
  users: number;
  admins: number;
  tasks: { total: number; by_status: Record<string, number> };
  exports: number;
  active_shares: number;
  queues?: Record<string, Record<string, number>>;
}

const token = ref("");
const username = ref("admin");
const password = ref("");
const error = ref("");
const loading = ref(false);
const tab = ref<"dashboard" | "models" | "tasks" | "shares">("dashboard");
const dashboard = ref<Dashboard | null>(null);
const models = ref<Array<Record<string, unknown>>>([]);
const tasks = ref<Array<Record<string, unknown>>>([]);
const shares = ref<Array<Record<string, unknown>>>([]);

async function api<T>(path: string, options: Record<string, unknown> = {}): Promise<T> {
  const res = await $fetch<Envelope<T>>(`/v1${path}`, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string>) || {}),
      ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
    },
  });
  if (res.code !== 0) throw new Error(res.msg || `请求失败(${res.code})`);
  return res.data as T;
}

async function login(): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    const data = await api<{ token: string }>("/ops/admin/login", {
      method: "POST",
      body: { username: username.value, password: password.value },
    });
    token.value = data.token;
    localStorage.setItem("admin_token", data.token);
    await loadAll();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
  } finally {
    loading.value = false;
  }
}

async function loadAll(): Promise<void> {
  const [d, m, t, s] = await Promise.all([
    api<Dashboard>("/ops/admin/dashboard"),
    api<Array<Record<string, unknown>>>("/ops/admin/models"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/tasks"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/shares"),
  ]);
  dashboard.value = d;
  models.value = m;
  tasks.value = t.list;
  shares.value = s.list;
}

async function toggleModel(model: Record<string, unknown>): Promise<void> {
  await api(`/ops/admin/models/${model.id}`, { method: "PATCH", body: { visible: !model.visible } });
  await loadAll();
}

async function revokeShare(share: Record<string, unknown>): Promise<void> {
  await api(`/ops/admin/shares/${share.id}/revoke`, { method: "POST" });
  await loadAll();
}

function logout(): void {
  token.value = "";
  localStorage.removeItem("admin_token");
}

onMounted(async () => {
  const saved = localStorage.getItem("admin_token");
  if (saved) {
    token.value = saved;
    try {
      await loadAll();
    } catch {
      logout();
    }
  }
});
</script>

<template>
  <main class="page">
    <div class="head">
      <h1>运营后台</h1>
      <span v-if="token" class="muted">已登录</span>
    </div>

    <section v-if="!token" class="login card">
      <h2>管理员登录</h2>
      <label class="field"><span class="label">用户名</span><input v-model="username" class="input" /></label>
      <label class="field"><span class="label">密码</span><input v-model="password" type="password" class="input" @keyup.enter="login" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <Button :disabled="loading" @click="login">{{ loading ? "登录中…" : "登录" }}</Button>
      <p class="muted small">非生产环境默认 admin / admin12345；生产必须通过 ADMIN_USERNAME/ADMIN_PASSWORD 配置。</p>
    </section>

    <template v-else>
      <div class="tabs">
        <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">概览</button>
        <button :class="{ active: tab === 'models' }" @click="tab = 'models'">模型/价格</button>
        <button :class="{ active: tab === 'tasks' }" @click="tab = 'tasks'">任务审计</button>
        <button :class="{ active: tab === 'shares' }" @click="tab = 'shares'">分享管理</button>
        <button class="logout" @click="logout">退出</button>
      </div>

      <section v-if="tab === 'dashboard' && dashboard" class="cards">
        <div class="card"><span class="muted">用户</span><b>{{ dashboard.users }}</b></div>
        <div class="card"><span class="muted">任务总数</span><b>{{ dashboard.tasks.total }}</b></div>
        <div class="card"><span class="muted">导出</span><b>{{ dashboard.exports }}</b></div>
        <div class="card"><span class="muted">有效分享</span><b>{{ dashboard.active_shares }}</b></div>
        <div class="card"><span class="muted">管理员</span><b>{{ dashboard.admins }}</b></div>
      </section>
      <section v-if="tab === 'dashboard' && dashboard?.queues" class="queues">
        <div v-for="(counts, queue) in dashboard.queues" :key="queue" class="queue-card">
          <b>{{ queue }}</b>
          <span class="muted">wait {{ counts.wait ?? 0 }} · active {{ counts.active ?? 0 }} · failed {{ counts.failed ?? 0 }}</span>
        </div>
      </section>

      <section v-if="tab === 'models'" class="card">
        <h2>模型</h2>
        <div class="row head-row"><span>名称</span><span>能力</span><span>adapter</span><span>排序</span><span>上架</span></div>
        <div v-for="m in models" :key="String(m.id)" class="row">
          <span>{{ m.display_name }}</span>
          <span class="muted">{{ m.capability }}</span>
          <span class="muted">{{ m.adapter_code }}</span>
          <span class="muted">{{ m.sort }}</span>
          <button class="mini" @click="toggleModel(m)">{{ m.visible ? "下架" : "上架" }}</button>
        </div>
      </section>

      <section v-if="tab === 'tasks'" class="card">
        <h2>任务审计（最近 20）</h2>
        <div class="row task-row head-row"><span>task</span><span>space</span><span>mode</span><span>状态</span><span>积分</span><span>时间</span></div>
        <div v-for="t in tasks" :key="String(t.task_id)" class="row task-row">
          <span class="mono">{{ String(t.task_id).slice(-8) }}</span>
          <span class="mono">{{ String(t.space_id).slice(-6) }}</span>
          <span>{{ t.mode }}</span>
          <span class="muted">{{ t.status }}</span>
          <span class="muted">{{ t.credits_settled }}/{{ t.credits_frozen }}</span>
          <span class="muted">{{ new Date(String(t.created_at)).toLocaleString() }}</span>
        </div>
      </section>

      <section v-if="tab === 'shares'" class="card">
        <h2>分享管理</h2>
        <div v-for="s in shares" :key="String(s.id)" class="share-row">
          <span class="mono">{{ String(s.token).slice(0, 12) }}…</span>
          <span class="muted">task {{ String(s.task_id).slice(-8) }}</span>
          <span class="muted">{{ s.revoked_at ? "已撤销" : `至 ${new Date(String(s.expires_at)).toLocaleDateString()}` }}</span>
          <button v-if="!s.revoked_at" class="mini" @click="revokeShare(s)">下线</button>
        </div>
        <p v-if="shares.length === 0" class="muted">暂无分享。</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.login {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 18px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.cards .card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cards b {
  font-size: 24px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  color: var(--text-2);
  font-size: 12px;
}
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tabs button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--text-2);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.active {
  border-color: var(--color-primary);
  color: var(--text-1);
}
.tabs .logout {
  margin-left: auto;
}
.queues {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 12px;
}
.queue-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-m);
  padding: 12px;
}
.row {
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 1fr 0.6fr 0.6fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  align-items: center;
  font-size: 12px;
}
.task-row {
  grid-template-columns: 90px 70px 1fr 50px 80px 150px;
}
.head-row {
  color: var(--text-3);
}
.share-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.mini {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.small {
  font-size: 11px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
@media (max-width: 860px) {
  .cards {
    grid-template-columns: 1fr 1fr;
  }
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
