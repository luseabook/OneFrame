<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { adminApi, adminErrorCode, isAdminAuthError } from "~/composables/useAdminApi";

interface ProviderRow {
  id: string;
  code: string;
  name: string;
  protocol: string;
  base_url: string;
  auth_type: string;
  key_hint: string;
  key_configured: boolean;
  status: number;
  model_count: number;
  route_count: number;
  last_check_at: string | null;
  last_check_status: string | null;
  last_check_message: string | null;
}

interface ProviderModelRow {
  id: string;
  remote_model_id: string;
  display_name: string;
  status: number;
  last_seen_at: string;
}

interface ProviderTestResult {
  ok: boolean;
  kind?: string;
  message?: string;
  latency_ms?: number;
}

interface DiscoverResult {
  supported: boolean;
  reason?: string;
  message?: string;
  models?: ProviderModelRow[];
  fetched_at?: string;
  latency_ms?: number;
}

/** 我方模型（GET /ops/admin/models 返回裸数组，不是 { list }） */
interface ModelRow {
  id: string;
  name: string;
  displayName?: string;
  display_name?: string;
  capability?: string;
  visible?: boolean;
}

/** 模型路由（service 直接回 camelCase，没走 DTO —— 两种都兼容读） */
interface RouteRow {
  id: string;
  modelId?: string;
  model_id?: string;
  providerId?: string;
  provider_id?: string;
  remoteModelId?: string;
  remote_model_id?: string;
  priority?: number;
  weight?: number;
  active?: boolean;
  modelName?: string;
  model_name?: string;
  providerName?: string;
  provider_name?: string;
}

const PROTOCOLS = [
  { value: "openai-compatible", label: "OpenAI 兼容", hint: "GET /v1/models 自动发现" },
  { value: "ark", label: "火山方舟 Ark", hint: "手工录入 ep-xxx / 模型 ID" },
  { value: "http-video", label: "HTTP 视频网关", hint: "手工录入模型 ID" },
  { value: "h3", label: "H3 视频网关（自建 GPU）", hint: "手工录入模型别名（如 h3-base）" },
  { value: "jianying", label: "剪影生图网关", hint: "手工录入模型别名（如 jianying-draw）" },
] as const;

const rows = ref<ProviderRow[]>([]);
const loading = ref(false);
const error = ref("");
const ok = ref("");
const createOpen = ref(false);
const saving = ref(false);
const busy = ref("");
const expanded = ref<Record<string, boolean>>({});
const models = ref<Record<string, ProviderModelRow[]>>({});
const testResults = ref<Record<string, ProviderTestResult>>({});
const discoverResults = ref<Record<string, DiscoverResult>>({});
const manualDrafts = reactive<Record<string, string>>({});
const keyDrafts = reactive<Record<string, string>>({});
const keyEditId = ref("");

const form = reactive({
  code: "",
  name: "",
  protocol: "openai-compatible" as (typeof PROTOCOLS)[number]["value"],
  base_url: "",
  api_key: "",
  auth_type: "bearer" as "bearer" | "header",
  /**
   * 高级选项（JSON）。必须给入口的原因：OpenCode Zen 这类网关在 OpenAI 协议之外
   * 强制私有头（`x-opencode-session`、自报 UA），缺失直接 400 `MissingSessionID`。
   * 后端 `POST/PATCH /ops/admin/providers` 早就接受 `options`，只有前端没有入口 ——
   * 那等于"代码支持、运营做不到"，是配置面最典型的断头路。
   */
  options: "",
});

/** 空串 → undefined（不带该字段，后端保留原值）；非法/非对象 → null（调用方报错） */
function parseOptionsJson(raw: string): Record<string, unknown> | undefined | null {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const modelRows = ref<ModelRow[]>([]);
const routeRows = ref<RouteRow[]>([]);
const routeBusy = ref("");
const routeForm = reactive({
  model_id: "",
  provider_id: "",
  remote_model_id: "",
  priority: 100,
});
const canCreateRoute = computed(
  () =>
    routeForm.model_id.trim().length > 0 &&
    routeForm.provider_id.trim().length > 0 &&
    routeForm.remote_model_id.trim().length > 0,
);

const canSubmit = computed(
  () =>
    form.code.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.base_url.trim().length > 0 &&
    form.api_key.trim().length >= 8,
);

function protocolLabel(protocol: string): string {
  return PROTOCOLS.find((item) => item.value === protocol)?.label ?? protocol;
}

function formatTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function fail(e: unknown, fallback: string): Promise<void> {
  if (isAdminAuthError(e)) {
    await adminLogout();
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (adminErrorCode(e) === 403101) {
    error.value = "当前管理员没有此操作权限（新增/修改供应商需要 super）";
    return;
  }
  error.value = e instanceof Error && e.message ? e.message : fallback;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<{ list: ProviderRow[] }>("/ops/admin/providers");
    rows.value = data.list;
  } catch (e) {
    rows.value = [];
    await fail(e, "加载供应商失败");
  } finally {
    loading.value = false;
  }
}

async function loadModels(providerId: string): Promise<void> {
  const data = await adminApi<{ list: ProviderModelRow[] }>(
    `/ops/admin/provider-models?provider_id=${encodeURIComponent(providerId)}`,
  );
  models.value = { ...models.value, [providerId]: data.list };
}

async function toggleModels(row: ProviderRow): Promise<void> {
  const next = !expanded.value[row.id];
  expanded.value = { ...expanded.value, [row.id]: next };
  if (next) {
    if (manualDrafts[row.id] === undefined) manualDrafts[row.id] = "";
    if (!models.value[row.id]) {
      busy.value = `${row.id}:models`;
      try {
        await loadModels(row.id);
      } catch (e) {
        await fail(e, "加载模型失败");
      } finally {
        busy.value = "";
      }
    }
  }
}

async function createProvider(): Promise<void> {
  if (!canSubmit.value || saving.value) return;
  const options = parseOptionsJson(form.options);
  if (options === null) {
    error.value = "高级选项必须是 JSON 对象，例如 {\"headers\":{\"user-agent\":\"oneframe/1.0\"},\"session_header\":\"x-opencode-session\"}";
    return;
  }
  saving.value = true;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<ProviderRow>("/ops/admin/providers", {
      method: "POST",
      body: {
        code: form.code.trim(),
        name: form.name.trim(),
        protocol: form.protocol,
        base_url: form.base_url.trim(),
        api_key: form.api_key,
        auth_type: form.auth_type,
        ...(options ? { options } : {}),
      },
    });
    ok.value = `已创建供应商 ${form.name.trim()}`;
    form.code = "";
    form.name = "";
    form.base_url = "";
    form.api_key = "";
    form.options = "";
    createOpen.value = false;
    await load();
  } catch (e) {
    await fail(e, "创建供应商失败");
  } finally {
    saving.value = false;
  }
}

async function testProvider(row: ProviderRow): Promise<void> {
  busy.value = `${row.id}:test`;
  error.value = "";
  try {
    const result = await adminApi<ProviderTestResult>(`/ops/admin/providers/${row.id}/test`, { method: "POST" });
    testResults.value = { ...testResults.value, [row.id]: result };
    await load();
  } catch (e) {
    await fail(e, "测试连接失败");
  } finally {
    busy.value = "";
  }
}

async function discoverModels(row: ProviderRow): Promise<void> {
  busy.value = `${row.id}:discover`;
  error.value = "";
  ok.value = "";
  try {
    const result = await adminApi<DiscoverResult>(`/ops/admin/providers/${row.id}/discover`, { method: "POST" });
    discoverResults.value = { ...discoverResults.value, [row.id]: result };
    expanded.value = { ...expanded.value, [row.id]: true };
    if (result.supported && result.models) {
      models.value = { ...models.value, [row.id]: result.models };
      ok.value = `发现 ${result.models.length} 个模型`;
    }
    await load();
  } catch (e) {
    await fail(e, "拉取模型失败");
  } finally {
    busy.value = "";
  }
}

async function toggleStatus(row: ProviderRow): Promise<void> {
  busy.value = `${row.id}:status`;
  error.value = "";
  ok.value = "";
  try {
    const updated =
      row.status === 1
        ? await adminApi<ProviderRow>(`/ops/admin/providers/${row.id}`, { method: "DELETE" })
        : await adminApi<ProviderRow>(`/ops/admin/providers/${row.id}`, {
            method: "PATCH",
            body: { status: 1 },
          });
    ok.value = updated.status === 1 ? "供应商已启用" : "供应商已停用";
    await load();
  } catch (e) {
    await fail(e, "更新供应商状态失败");
  } finally {
    busy.value = "";
  }
}

async function rotateKey(row: ProviderRow): Promise<void> {
  const key = (keyDrafts[row.id] ?? "").trim();
  if (key.length < 8) {
    error.value = "新 Key 至少 8 个字符";
    return;
  }
  busy.value = `${row.id}:rotate-key`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<ProviderRow>(`/ops/admin/providers/${row.id}`, {
      method: "PATCH",
      body: { api_key: key },
    });
    keyDrafts[row.id] = "";
    keyEditId.value = "";
    ok.value = "Key 已轮换；已提交任务继续使用原快照，新任务使用新 Key";
    await load();
  } catch (e) {
    await fail(e, "轮换 Key 失败");
  } finally {
    busy.value = "";
  }
}

async function importManual(row: ProviderRow): Promise<void> {
  const ids = (manualDrafts[row.id] ?? "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    error.value = "请先粘贴至少一个模型 / endpoint ID";
    return;
  }
  busy.value = `${row.id}:import`;
  error.value = "";
  ok.value = "";
  try {
    const data = await adminApi<{ list: ProviderModelRow[] }>(`/ops/admin/providers/${row.id}/provider-models`, {
      method: "POST",
      body: { remote_model_ids: ids },
    });
    models.value = { ...models.value, [row.id]: data.list };
    manualDrafts[row.id] = "";
    ok.value = `已导入 ${ids.length} 个模型`;
    await load();
  } catch (e) {
    await fail(e, "导入模型失败");
  } finally {
    busy.value = "";
  }
}

async function loadRouteData(): Promise<void> {
  routeBusy.value = "load";
  error.value = "";
  try {
    const [modelData, routeData] = await Promise.all([
      adminApi<ModelRow[] | { list: ModelRow[] }>("/ops/admin/models"),
      adminApi<{ list: RouteRow[] }>("/ops/admin/model-routes"),
    ]);
    modelRows.value = Array.isArray(modelData) ? modelData : (modelData.list ?? []);
    routeRows.value = routeData.list ?? [];
  } catch (e) {
    await fail(e, "加载接线数据失败");
  } finally {
    routeBusy.value = "";
  }
}

async function createRoute(): Promise<void> {
  if (!canCreateRoute.value || routeBusy.value) return;
  routeBusy.value = "create";
  error.value = "";
  ok.value = "";
  try {
    await adminApi<RouteRow>("/ops/admin/model-routes", {
      method: "POST",
      body: {
        model_id: routeForm.model_id,
        provider_id: routeForm.provider_id,
        remote_model_id: routeForm.remote_model_id.trim(),
        priority: routeForm.priority,
      },
    });
    ok.value = "路由已建立：该模型现在能真正调到供应商";
    routeForm.remote_model_id = "";
    await Promise.all([loadRouteData(), load()]);
  } catch (e) {
    await fail(e, "建立路由失败");
  } finally {
    routeBusy.value = "";
  }
}

async function toggleRoute(row: RouteRow): Promise<void> {
  routeBusy.value = `${row.id}:toggle`;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<RouteRow>(`/ops/admin/model-routes/${row.id}`, {
      method: "PATCH",
      body: { active: !routeActive(row) },
    });
    await Promise.all([loadRouteData(), load()]);
  } catch (e) {
    await fail(e, "更新路由失败");
  } finally {
    routeBusy.value = "";
  }
}

function routeModelName(row: RouteRow): string {
  return row.modelName ?? row.model_name ?? "-";
}

function routeProviderName(row: RouteRow): string {
  return row.providerName ?? row.provider_name ?? "-";
}

function routeRemote(row: RouteRow): string {
  return row.remoteModelId ?? row.remote_model_id ?? "-";
}

function routeActive(row: RouteRow): boolean {
  return row.active !== false;
}

function testLabel(result: ProviderTestResult): string {
  if (result.ok) return `连接成功${result.latency_ms === undefined ? "" : ` · ${result.latency_ms}ms`}`;
  const kinds: Record<string, string> = {
    auth: "认证失败",
    network: "网络失败",
    timeout: "请求超时",
    unsupported: "该协议无安全探测接口",
    invalid_config: "配置无效",
  };
  return `${kinds[result.kind ?? ""] ?? "连接失败"}${result.message ? `：${result.message}` : ""}`;
}

function testLabelFor(id: string): string {
  const result = testResults.value[id];
  return result ? testLabel(result) : "";
}

function testOk(id: string): boolean {
  return testResults.value[id]?.ok === true;
}

function discoveredError(id: string): string {
  const result = discoverResults.value[id];
  if (!result || result.supported) return "";
  return result.message || result.reason || "拉取模型失败";
}

function modelsFor(id: string): ProviderModelRow[] {
  return models.value[id] ?? [];
}

onMounted(() => {
  void load();
  void loadRouteData();
});
</script>

<template>
  <section class="card provider-panel">
    <div class="panel-head">
      <div>
        <h2>供应商接入</h2>
        <p class="muted small">
          Key 加密落库、只回显末四位；OpenAI 兼容可自动发现模型，Ark 等私有协议请手工录入 endpoint ID。
        </p>
      </div>
      <button class="mini primary" type="button" @click="createOpen = !createOpen">
        {{ createOpen ? "取消" : "新增供应商" }}
      </button>
    </div>

    <p v-if="error" class="error banner">{{ error }}</p>
    <p v-if="ok" class="ok banner">{{ ok }}</p>

    <form v-if="createOpen" class="provider-form" @submit.prevent="createProvider">
      <label class="field">
        <span>编码（唯一，小写 slug）</span>
        <input v-model="form.code" class="input" placeholder="ark-main" maxlength="64" />
      </label>
      <label class="field">
        <span>名称</span>
        <input v-model="form.name" class="input" placeholder="火山方舟主账号" maxlength="120" />
      </label>
      <label class="field">
        <span>协议</span>
        <select v-model="form.protocol" class="input">
          <option v-for="item in PROTOCOLS" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <label class="field field-wide">
        <span>Base URL</span>
        <input v-model="form.base_url" class="input" placeholder="https://api.example.com" />
      </label>
      <label class="field field-wide">
        <span>API Key（保存后不再显示）</span>
        <input v-model="form.api_key" class="input" type="password" autocomplete="new-password" placeholder="sk-..." />
      </label>
      <label class="field">
        <span>认证方式</span>
        <select v-model="form.auth_type" class="input">
          <option value="bearer">Bearer</option>
          <option value="header">自定义 Header</option>
        </select>
      </label>
      <label class="field field-wide">
        <span>高级选项（JSON，可选）</span>
        <textarea
          v-model="form.options"
          class="input manual-text"
          rows="3"
          placeholder='{"headers":{"user-agent":"oneframe-worker/1.0"},"session_header":"x-opencode-session"}'
        ></textarea>
        <span class="muted small">
          headers = 静态请求头；session_header = 需要「每会话稳定」的活值（取 space_id）。OpenCode Zen 必须填这两项，否则 400 MissingSessionID。
        </span>
      </label>
      <div class="form-actions">
        <button class="mini primary" type="submit" :disabled="saving || !canSubmit">
          {{ saving ? "保存中…" : "保存供应商" }}
        </button>
      </div>
    </form>

    <p v-if="loading" class="muted small">加载中…</p>
    <p v-else-if="rows.length === 0" class="muted">还没有供应商。先新增一个，再测试连接或拉取模型。</p>

    <div v-else class="provider-list">
      <article v-for="row in rows" :key="row.id" class="provider-card">
        <header class="provider-head">
          <div class="provider-title">
            <b>{{ row.name }}</b>
            <span class="badge">{{ protocolLabel(row.protocol) }}</span>
            <span class="badge" :data-status="row.status === 1 ? '3' : '4'">{{ row.status === 1 ? "启用" : "停用" }}</span>
            <code class="mono">{{ row.code }}</code>
          </div>
          <div class="provider-actions">
            <button class="mini" type="button" :disabled="busy === `${row.id}:test`" @click="testProvider(row)">
              {{ busy === `${row.id}:test` ? "测试中…" : "测试连接" }}
            </button>
            <button
              v-if="row.protocol === 'openai-compatible'"
              class="mini"
              type="button"
              :disabled="busy === `${row.id}:discover`"
              @click="discoverModels(row)"
            >
              {{ busy === `${row.id}:discover` ? "拉取中…" : "拉取模型" }}
            </button>
            <button class="mini" type="button" :disabled="busy === `${row.id}:status`" @click="toggleStatus(row)">
              {{ row.status === 1 ? "停用" : "启用" }}
            </button>
            <button class="mini" type="button" @click="keyEditId = keyEditId === row.id ? '' : row.id">
              {{ keyEditId === row.id ? "取消轮换" : "轮换 Key" }}
            </button>
          </div>
        </header>

        <div class="provider-meta">
          <span class="mono">{{ row.base_url }}</span>
          <span>Key {{ row.key_configured ? row.key_hint : "未配置" }}</span>
          <span>{{ row.model_count }} 个候选模型 · {{ row.route_count }} 条路由</span>
          <span v-if="row.last_check_at">最近检查 {{ formatTime(row.last_check_at) }} · {{ row.last_check_status }}</span>
        </div>

        <p
          v-if="testResults[row.id]"
          class="test-result"
          :class="testOk(row.id) ? 'is-ok' : 'is-bad'"
        >
          {{ testLabelFor(row.id) }}
        </p>
        <p v-if="discoveredError(row.id)" class="test-result is-bad">
          {{ discoveredError(row.id) }}
        </p>

        <div v-if="keyEditId === row.id" class="manual-import">
          <input
            v-model="keyDrafts[row.id]"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="输入新 API Key（保存后只显示末四位）"
          />
          <button class="mini primary" type="button" :disabled="busy === `${row.id}:rotate-key`" @click="rotateKey(row)">
            {{ busy === `${row.id}:rotate-key` ? "保存中…" : "保存新 Key" }}
          </button>
        </div>

        <button class="link-btn" type="button" @click="toggleModels(row)">
          {{ expanded[row.id] ? "收起模型" : `查看模型（${row.model_count}）` }}
        </button>

        <div v-if="expanded[row.id]" class="provider-models">
          <div v-if="row.protocol !== 'openai-compatible'" class="manual-import">
            <textarea
              v-model="manualDrafts[row.id]"
              class="input manual-text"
              rows="3"
              placeholder="每行一个模型 / endpoint ID，例如 ep-2026xxxx"
            ></textarea>
            <button class="mini" type="button" :disabled="busy === `${row.id}:import`" @click="importManual(row)">
              {{ busy === `${row.id}:import` ? "导入中…" : "导入" }}
            </button>
          </div>

          <p v-if="busy === `${row.id}:models`" class="muted small">加载中…</p>
          <p v-else-if="modelsFor(row.id).length === 0" class="muted small">
            暂无候选模型。OpenAI 兼容可点「拉取模型」，其它协议在上方手工导入。
          </p>
          <template v-else>
            <div class="model-line model-head">
              <span>远端模型 ID</span>
              <span>显示名</span>
              <span>状态</span>
              <span>最近发现</span>
            </div>
            <div v-for="model in modelsFor(row.id)" :key="model.id" class="model-line">
              <code class="mono">{{ model.remote_model_id }}</code>
              <span class="muted">{{ model.display_name || "-" }}</span>
              <span class="badge" :data-status="model.status === 1 ? '3' : '4'">{{ model.status === 1 ? "可见" : "下线" }}</span>
              <span class="muted small">{{ formatTime(model.last_seen_at) }}</span>
            </div>
          </template>
        </div>
      </article>
    </div>

    <div class="route-block">
      <div class="panel-head">
        <div>
          <h2>模型接线（路由）</h2>
          <p class="muted small">
            我方模型 → 供应商的远端模型 ID。只建供应商不建路由，创作页点了只会报「该模型暂不可用」；
            路由是「能不能真调到」的唯一开关。
          </p>
        </div>
        <button class="mini" type="button" :disabled="routeBusy === 'load'" @click="loadRouteData">
          {{ routeBusy === "load" ? "刷新中…" : "刷新" }}
        </button>
      </div>

      <form class="provider-form" @submit.prevent="createRoute">
        <label class="field">
          <span>我方模型</span>
          <select v-model="routeForm.model_id" class="input">
            <option value="" disabled>选择模型</option>
            <option v-for="m in modelRows" :key="m.id" :value="m.id">
              {{ m.name }}（{{ m.displayName ?? m.display_name }}）
            </option>
          </select>
        </label>
        <label class="field">
          <span>供应商</span>
          <select v-model="routeForm.provider_id" class="input">
            <option value="" disabled>选择供应商</option>
            <option v-for="p in rows" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>远端模型 ID</span>
          <input v-model="routeForm.remote_model_id" class="input" placeholder="deepseek-v4.1-flash" maxlength="200" />
        </label>
        <div class="form-actions">
          <button class="mini primary" type="submit" :disabled="routeBusy === 'create' || !canCreateRoute">
            {{ routeBusy === "create" ? "保存中…" : "新增路由" }}
          </button>
        </div>
      </form>

      <p v-if="routeRows.length === 0" class="muted small">还没有路由。</p>
      <template v-else>
        <div class="model-line route-line route-head">
          <span>模型</span>
          <span>供应商</span>
          <span>远端模型</span>
          <span>状态</span>
          <span></span>
        </div>
        <div v-for="row in routeRows" :key="row.id" class="model-line route-line">
          <span class="mono">{{ routeModelName(row) }}</span>
          <span class="muted">{{ routeProviderName(row) }}</span>
          <code class="mono">{{ routeRemote(row) }}</code>
          <span class="badge" :data-status="routeActive(row) ? '3' : '4'">{{ routeActive(row) ? "启用" : "停用" }}</span>
          <button class="mini" type="button" :disabled="routeBusy === `${row.id}:toggle`" @click="toggleRoute(row)">
            {{ routeActive(row) ? "停用" : "启用" }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.route-block {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.route-line {
  grid-template-columns: 1.4fr 1fr 1.8fr 0.6fr 0.7fr;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.provider-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-sunken);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-3);
  font-size: 11px;
}

.field-wide {
  grid-column: span 3;
}

.form-actions {
  display: flex;
  align-items: flex-end;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.provider-card {
  padding: 14px 16px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
}

.provider-card:hover {
  border-color: var(--border-2);
}

.provider-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.provider-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.provider-title b {
  font-size: 14px;
}

.provider-title code {
  color: var(--text-4);
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.provider-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 9px;
  color: var(--text-3);
  font-size: 11.5px;
}

.test-result {
  margin: 9px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 11.5px;
}

.test-result.is-ok {
  color: #8ee9af;
  background: rgba(95, 208, 138, 0.08);
  border: 1px solid rgba(95, 208, 138, 0.24);
}

.test-result.is-bad {
  color: #ff9b9b;
  background: rgba(245, 103, 103, 0.08);
  border: 1px solid rgba(245, 103, 103, 0.24);
}

.link-btn {
  margin-top: 9px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-300);
  font-size: 11.5px;
  cursor: pointer;
}

.link-btn:hover {
  color: var(--brand-200);
}

.provider-models {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-1);
}

.manual-import {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}

.manual-text {
  flex: 1;
  min-height: 64px;
  resize: vertical;
}

.model-line {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 70px 150px;
  gap: 10px;
  align-items: center;
  min-height: 30px;
  padding: 4px 2px;
  border-bottom: 1px solid var(--border-1);
  font-size: 11.5px;
}

.model-head {
  color: var(--text-3);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

@media (max-width: 900px) {
  .provider-form {
    grid-template-columns: 1fr;
  }
  .field-wide {
    grid-column: span 1;
  }
  .provider-head {
    flex-direction: column;
  }
  .provider-actions {
    justify-content: flex-start;
  }
  .model-line {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
