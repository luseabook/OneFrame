<script setup lang="ts">
// 运营后台控制台：独立登录页（/admin/login）+ 独立侧栏菜单（layouts/admin.vue）。
//
// 本版按 deliverables/software-company/admin-console-completion-contract-2026-10-29.md §4.4 补齐 P0：
// 模型排序/档位热更、任务状态+模型筛选与分页、漏斗流失与耗时、订单对账导出、
// 举报/分享/创作者审核分页、运营位编辑、导出审计页签、概览任务状态分布。
//
// 贯穿全页的三条原则（改这个文件前先读）：
// 1. 列表一律「加载 / 空 / 错误」三态：运营看到空白必须先分清「没数据」还是「接口挂了」；
// 2. 所有请求走 `adminApi`（composables/useAdminApi.ts）：它保留业务错误码，本页据此区分
//    「身份失效 → 回登录页」与「就地报错」。契约 §4.4.9：单个接口 500 不能把运营踢下线——
//    旧实现在 `loadAll` 里 any 错都清 token 跳登录，一个 500 就等于全员被踢；
// 3. 后台 DTO 在本文件本地声明：这些运维 DTO 尚未进 `packages/shared`（api-core 正按契约 §2
//    扩展字段），本地类型只描述「本页真正用到的字段」，契约里后到的字段一律可选，
//    这样接口先上线/后上线都不会让页面白屏或类型报错。
import type { PromoSlotDto, PromoSlotListDto } from "~/types/api";
import type { AdminTab } from "~/composables/useAdminMenu";
import { adminApi, downloadAdminCsv, isAdminAuthError } from "~/composables/useAdminApi";

const { t } = useI18n();

definePageMeta({ ssr: false, layout: "admin", middleware: "admin-auth" });

/** 列表三态：loading / error 各列表独立，互不遮挡（一个接口挂了不影响其它面板） */
interface ListState {
  loading: boolean;
  error: string;
}
function newListState(): ListState {
  return reactive<ListState>({ loading: false, error: "" });
}

interface Dashboard {
  users: number;
  admins: number;
  tasks: { total: number; by_status: Record<string, number> };
  exports: number;
  active_shares: number;
  pending_reports?: number;
  queues?: Record<string, Record<string, number>>;
}

/** 契约 §2.1：list 项原样返回 `models.modes`（可能是 `{}`）；`types` 可空 */
interface ModelRow {
  id: string;
  name: string;
  display_name: string;
  vendor: string;
  capability: string;
  visible: boolean;
  sort: number;
  adapter_code: string;
  vip: boolean;
  modes?: Record<string, unknown>;
  types?: string[];
}

/** 契约 §2.6：model_name/adapter_code 来自 join models，error_* 来自 tasks.error JSON */
interface TaskRow {
  task_id: string;
  space_id: string;
  model_id?: string;
  model_name?: string;
  adapter_code?: string;
  mode: string;
  status: number;
  error_code?: string | null;
  error_message?: string | null;
  credits_frozen: number;
  credits_settled: number;
  created_at: string;
  finished_at?: string | null;
}

/** 契约 §2.9：新增 dropoff/avg_hours；旧接口没有这些字段时按 null 渲染成 `-` */
interface FunnelStage {
  key: string;
  label: string;
  count: number;
  conversion_from_previous: number | null;
  dropoff_from_previous?: number | null;
  avg_hours_from_previous?: number | null;
  avg_hours_from_project_created?: number | null;
}

interface TaskMetrics {
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  failure_rate: number;
  adapter_latency: Array<{ adapter: string; samples: number; avg_ms: number; p95_ms: number }>;
  errors_by_code: Array<{ code: string; count: number }>;
}

interface OrderRow {
  order_id: string;
  space_id: string;
  user_id: string;
  sku: string;
  amount_cents: number;
  credits: number;
  channel: string;
  status: number;
  paid_at: string | null;
  refund_no: string | null;
  refund_status: number | null;
  refund_amount_cents: number | null;
  refunded_at: string | null;
  refund_reason: string | null;
  refund_operator: string | null;
  created_at: string;
}

interface ShareRow {
  id: string;
  token: string;
  task_id: string;
  space_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  task_id: string;
  share_id: string | null;
  space_id: string;
  reason: string;
  detail: string | null;
  contact: string | null;
  status: number;
  resolution: string | null;
  handled_at: string | null;
  created_at: string;
}

/** 导出审计（契约 §2 无变更；表注释见 packages/db/src/schema.ts exports：1排队 2打包 3成功 4失败） */
interface ExportRow {
  export_id: string;
  space_id: string;
  episode_id: string;
  status: number;
  created_at: string;
  expires_at: string | null;
}

interface PageResp<Row> {
  list: Row[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 创作者审核队列（模块 #10）：平台运营视角的待审作品。
 *
 * 为什么运营后台要有一份：创作者作品此前**只有空间管理员能审**，平台运营看不到队列，
 * 「内容安全」最该有人管的环节反而没人管。审核人写 `reviewed_by_admin`（与空间管理员的
 * `reviewed_by` 分开留痕），两个身份域不混用。
 */

const tab = useAdminTab();
const route = useRoute();
const error = ref("");
/** 成功提示（后台页没有 toast，用一行绿字） */
const ok = ref("");
/** 已发起跳登录：避免首屏多个并发请求同时失效时连发多次 navigateTo */
const kicked = ref(false);

// ── 通用小工具 ─────────────────────────────────────────────
/** 拼 query：空串/null/undefined 一律丢弃，避免生成 `?status=&model_id=` 这种让服务端 NaN 的参数 */
function qs(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function pagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** 分页「上一页/下一页」统一夹取，避免点到越界页让服务端返回空 list 造成「数据消失」的错觉 */
function stepPage(current: number, total: number, pageSize: number, delta: number): number {
  const pages = pagesOf(total, pageSize);
  return Math.min(Math.max(1, current + delta), pages);
}

/**
 * `datetime-local` → ISO。
 * 为什么要转：服务端按 `tasks.created_at` 过滤并 zod 校验 ISO 时间（契约 §2.7），
 * 直接把 `2026-10-29T10:00` 发过去会被判非法（400101），而浏览器控件只给本地时间串。
 */
function toIso(local: string): string | undefined {
  const value = local.trim();
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

/** null/undefined/NaN 一律 `-`（契约 §4.4.3：漏斗无值显示 `-`，不能显示 0 误导运营） */
function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function shortId(value: string | null | undefined): string {
  return value ? String(value).slice(-8) : "-";
}

// ── 错误处理：只有身份类错误才踢人 ──────────────────────────
async function kickToLogin(reason: string): Promise<void> {
  if (kicked.value) return;
  kicked.value = true;
  error.value = reason;
  // 清 HttpOnly Cookie（托管在服务端，前端只能发请求注销）
  await adminLogout();
  await navigateTo("/admin/login", { replace: true });
}

/**
 * 统一错误落点：401101/403101 → 回登录页；其它（500/400101/网络）→ 留在页面上。
 * 有目标列表时写该列表的错误行（就近提示），否则写顶部横幅（写操作类错误）。
 */
async function fail(e: unknown, fallback: string, state?: ListState): Promise<void> {
  const message = e instanceof Error && e.message ? e.message : fallback;
  if (isAdminAuthError(e)) {
    await kickToLogin(message || t("adminUi.sessionExpired"));
    return;
  }
  if (state) state.error = message;
  else error.value = message;
}

// ── 概览 ──────────────────────────────────────────────────
const dashboard = ref<Dashboard | null>(null);
const dashboardState = newListState();
/** 任务状态分布（契约 §4.4.8）：by_status 的键是状态数字字符串，按数字升序展示 */
const dashboardStatuses = computed<Array<{ status: number; count: number }>>(() => {
  const map = dashboard.value?.tasks?.by_status ?? {};
  return Object.entries(map)
    .map(([status, count]) => ({ status: Number(status), count: Number(count) }))
    .sort((a, b) => a.status - b.status);
});
const dashboardTaskTotal = computed(() => Math.max(1, dashboardStatuses.value.reduce((sum, row) => sum + row.count, 0)));

function statusPercent(count: number): number {
  return Math.round((count / dashboardTaskTotal.value) * 100);
}

function queueHealth(counts: Record<string, number>): string {
  if ((counts.failed ?? 0) > 0) return "is-bad";
  if ((counts.active ?? 0) > 0) return "is-busy";
  return "";
}

async function loadDashboard(): Promise<void> {
  dashboardState.loading = true;
  dashboardState.error = "";
  try {
    dashboard.value = await adminApi<Dashboard>("/ops/admin/dashboard");
  } catch (e) {
    await fail(e, t("adminUi.dashboardLoadFailed"), dashboardState);
  } finally {
    dashboardState.loading = false;
  }
}

// ── 模型：排序 + 档位（modes）热更 ─────────────────────────
const models = ref<ModelRow[]>([]);
const modelsState = newListState();
/** 每行排序的草稿值：不改服务端数据前先在本地编辑，点「保存排序」才 PATCH */
const sortDrafts = reactive<Record<string, number>>({});
const sortBusy = ref("");
const modesOpenId = ref("");
const modesDraft = ref("");
const modesBusy = ref("");
const modesError = ref("");

async function loadModels(): Promise<void> {
  modelsState.loading = true;
  modelsState.error = "";
  try {
    models.value = await adminApi<ModelRow[]>("/ops/admin/models");
    // 草稿严格跟随服务端：保存排序后会重拉，若不重置会出现「输入框显示旧值但服务端已是新值」
    for (const model of models.value) sortDrafts[model.id] = model.sort;
  } catch (e) {
    await fail(e, t("adminUi.modelsLoadFailed"), modelsState);
  } finally {
    modelsState.loading = false;
  }
}

async function saveModelSort(model: ModelRow): Promise<void> {
  // 服务端 zod 是 int 0..9999（契约 §2.2），这里先夹取，避免运营输入 1.5 / -3 / 99999 换来一个 400101
  const raw = Number(sortDrafts[model.id] ?? model.sort);
  const next = Number.isFinite(raw) ? Math.min(9999, Math.max(0, Math.trunc(raw))) : model.sort;
  sortBusy.value = model.id;
  error.value = "";
  ok.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/models/${model.id}`, { method: "PATCH", body: { sort: next } });
    ok.value = t("adminUi.sortSaved", { name: model.display_name || model.name });
    await loadModels();
  } catch (e) {
    await fail(e, t("adminUi.sortSaveFailed"));
  } finally {
    sortBusy.value = "";
  }
}

function openModes(model: ModelRow): void {
  modesOpenId.value = model.id;
  modesError.value = "";
  ok.value = "";
  // 缩进 2 便于人工改；`modes` 缺省给 `{}`（契约 §2.1 允许空对象），不要给 null 让 textarea 空着
  modesDraft.value = JSON.stringify(model.modes ?? {}, null, 2);
}

function closeModes(): void {
  modesOpenId.value = "";
  modesError.value = "";
}

async function saveModes(model: ModelRow): Promise<void> {
  modesError.value = "";
  ok.value = "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(modesDraft.value);
  } catch (e) {
    modesError.value = t("adminUi.modesInvalid", { msg: e instanceof Error ? e.message : "" });
    return;
  }
  // 契约 §2.2：modes 必须是普通对象（mode → 配置）；数组/字符串先在前端拦掉，省一次 400101 往返
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    modesError.value = t("adminUi.modesNeedObject");
    return;
  }
  modesBusy.value = model.id;
  try {
    await adminApi<unknown>(`/ops/admin/models/${model.id}`, { method: "PATCH", body: { modes: parsed } });
    ok.value = t("adminUi.modesSaved", { name: model.display_name || model.name });
    modesOpenId.value = "";
    await loadModels();
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : t("adminUi.modesSaveFailed");
    modesError.value = message;
    if (isAdminAuthError(e)) await kickToLogin(message);
  } finally {
    modesBusy.value = "";
  }
}

async function toggleModel(model: ModelRow): Promise<void> {
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/models/${model.id}`, { method: "PATCH", body: { visible: !model.visible } });
    await loadModels();
  } catch (e) {
    await fail(e, t("adminUi.modelUpdateFailed"));
  }
}

// ── 任务：筛选 / 分页 / 指标 ───────────────────────────────
const TASK_STATUSES = [1, 2, 3, 4, 5, 6, 7] as const;
const TASK_PAGE_SIZE = 20;
const tasks = ref<TaskRow[]>([]);
const tasksState = newListState();
const tasksTotal = ref(0);
const tasksPage = ref(1);
const taskStatus = ref<number | "">("");
const taskModelId = ref("");
/** 概览状态分布可点进任务审计：?tab=tasks&status=4 直接落到失败任务 */
function syncTaskFilterFromQuery(): void {
  const raw = Number(route.query.status);
  taskStatus.value = (TASK_STATUSES as readonly number[]).includes(raw) ? raw : "";
  taskModelId.value = typeof route.query.model_id === "string" ? route.query.model_id : "";
}
/** 区间筛选只作用于「指标」与「CSV 导出」（服务端按 tasks.created_at，契约 §2.7/§2.8） */
const metricsFrom = ref("");
const metricsTo = ref("");
const csvBusy = ref(false);
const metrics = ref<TaskMetrics>({
  total: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failure_rate: 0,
  adapter_latency: [],
  errors_by_code: [],
});
const metricsState = newListState();
const tasksPages = computed(() => pagesOf(tasksTotal.value, TASK_PAGE_SIZE));

function taskStatusLabel(status: number): string {
  // 状态码来自 packages/shared constants.ts TaskStatus（1 排队 2 生成 3 成功 4 失败 5 取消 6 审核 7 审核驳回）
  switch (status) {
    case 1:
      return t("adminUi.taskStatusQueued");
    case 2:
      return t("adminUi.taskStatusRunning");
    case 3:
      return t("adminUi.taskStatusSucceeded");
    case 4:
      return t("adminUi.taskStatusFailed");
    case 5:
      return t("adminUi.taskStatusCanceled");
    case 6:
      return t("adminUi.taskStatusReviewing");
    case 7:
      return t("adminUi.taskStatusRejected");
    default:
      return String(status);
  }
}

function taskFilterQuery(): { status?: number; model_id?: string } {
  return {
    status: taskStatus.value === "" ? undefined : taskStatus.value,
    model_id: taskModelId.value || undefined,
  };
}

async function loadTasks(): Promise<void> {
  tasksState.loading = true;
  tasksState.error = "";
  try {
    const data = await adminApi<PageResp<TaskRow>>(
      `/ops/admin/tasks${qs({ ...taskFilterQuery(), page: tasksPage.value, page_size: TASK_PAGE_SIZE })}`,
    );
    tasks.value = data.list;
    tasksTotal.value = data.total;
  } catch (e) {
    await fail(e, t("adminUi.tasksLoadFailed"), tasksState);
  } finally {
    tasksState.loading = false;
  }
}

async function loadMetrics(): Promise<void> {
  metricsState.loading = true;
  metricsState.error = "";
  try {
    // 指标与列表共用 status/model_id（服务端 task-metrics 只支持 model_id/from/to，见契约 §2.7）
    metrics.value = await adminApi<TaskMetrics>(
      `/ops/admin/task-metrics${qs({
        model_id: taskModelId.value || undefined,
        from: toIso(metricsFrom.value),
        to: toIso(metricsTo.value),
      })}`,
    );
  } catch (e) {
    await fail(e, t("adminUi.metricsLoadFailed"), metricsState);
  } finally {
    metricsState.loading = false;
  }
}

/** 筛选变更：回到第 1 页再查，否则会停在「第 5 页但只有 2 页」的空列表上 */
function applyTaskFilters(): void {
  tasksPage.value = 1;
  void loadTasks();
  void loadMetrics();
}

function gotoTaskPage(delta: number): void {
  const next = stepPage(tasksPage.value, tasksTotal.value, TASK_PAGE_SIZE, delta);
  if (next === tasksPage.value) return;
  tasksPage.value = next;
  void loadTasks();
}

async function downloadFailedCsv(): Promise<void> {
  csvBusy.value = true;
  error.value = "";
  try {
    // CSV 带上与指标相同的区间/模型，保证「看到的口径」与「导出的口径」一致（契约 §4.4.2）
    await downloadAdminCsv(
      `/ops/admin/failed-tasks.csv${qs({
        model_id: taskModelId.value || undefined,
        from: toIso(metricsFrom.value),
        to: toIso(metricsTo.value),
      })}`,
      "failed-tasks.csv",
    );
  } catch (e) {
    await fail(e, t("adminUi.exportFailed"));
  } finally {
    csvBusy.value = false;
  }
}

// ── 漏斗 ──────────────────────────────────────────────────
const funnel = ref<FunnelStage[]>([]);
const funnelState = newListState();

async function loadFunnel(): Promise<void> {
  funnelState.loading = true;
  funnelState.error = "";
  try {
    funnel.value = await adminApi<FunnelStage[]>("/ops/admin/funnel");
  } catch (e) {
    await fail(e, t("adminUi.funnelLoadFailed"), funnelState);
  } finally {
    funnelState.loading = false;
  }
}

// ── 订单 / 退款 / 对账导出 ─────────────────────────────────
const ORDER_STATUSES = [1, 2, 3, 4] as const;
const ORDER_PAGE_SIZE = 20;
const orders = ref<OrderRow[]>([]);
const ordersState = newListState();
const ordersTotal = ref(0);
const ordersPage = ref(1);
const orderStatus = ref<number | "">("");
const refunding = ref("");
const ordersCsvBusy = ref(false);
const ordersPages = computed(() => pagesOf(ordersTotal.value, ORDER_PAGE_SIZE));

function orderStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return t("adminUi.orderPendingPay");
    case 2:
      return t("adminUi.orderPaid");
    case 3:
      return t("adminUi.orderClosed");
    case 4:
      return t("adminUi.orderRefunded");
    default:
      return String(status);
  }
}

async function loadOrders(): Promise<void> {
  ordersState.loading = true;
  ordersState.error = "";
  try {
    const data = await adminApi<PageResp<OrderRow>>(
      `/ops/admin/orders${qs({
        status: orderStatus.value === "" ? undefined : orderStatus.value,
        page: ordersPage.value,
        page_size: ORDER_PAGE_SIZE,
      })}`,
    );
    orders.value = data.list;
    ordersTotal.value = data.total;
  } catch (e) {
    await fail(e, t("adminUi.ordersLoadFailed"), ordersState);
  } finally {
    ordersState.loading = false;
  }
}

function applyOrderFilter(): void {
  ordersPage.value = 1;
  void loadOrders();
}

function gotoOrderPage(delta: number): void {
  const next = stepPage(ordersPage.value, ordersTotal.value, ORDER_PAGE_SIZE, delta);
  if (next === ordersPage.value) return;
  ordersPage.value = next;
  void loadOrders();
}

/**
 * 全额退款（api-spec §10.5）：运营审批后执行，reason 填工单号。
 * 仅已支付订单（status=2）可退；接口幂等（重复点击不会重复退钱/重复调渠道）。
 */
async function refundOrder(order: OrderRow): Promise<void> {
  const reason = window.prompt(
    t("adminUi.refundConfirm", {
      amount: (Number(order.amount_cents) / 100).toFixed(2),
      credits: String(order.credits),
    }),
  );
  if (reason === null) return;
  const trimmed = reason.trim();
  if (!trimmed) {
    error.value = t("adminUi.refundNeedNote");
    return;
  }
  refunding.value = String(order.order_id);
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/orders/${String(order.order_id)}/refund`, {
      method: "POST",
      body: { reason: trimmed },
    });
    // 退款会改订单状态与概览计数：两个都刷，避免「订单已退但概览还挂着待处理」
    await Promise.all([loadOrders(), loadDashboard()]);
  } catch (e) {
    await fail(e, t("adminUi.refundFailed"));
  } finally {
    refunding.value = "";
  }
}

async function exportOrdersCsv(): Promise<void> {
  ordersCsvBusy.value = true;
  error.value = "";
  try {
    // 带当前 status：导出必须与屏幕上的筛选一致，否则对账时「导出比看到的多」很难解释
    await downloadAdminCsv(
      `/ops/admin/orders.csv${qs({ status: orderStatus.value === "" ? undefined : orderStatus.value })}`,
      "orders.csv",
    );
  } catch (e) {
    await fail(e, t("adminUi.exportFailed"));
  } finally {
    ordersCsvBusy.value = false;
  }
}

// ── 分享 ──────────────────────────────────────────────────
const SHARE_PAGE_SIZE = 20;
const shares = ref<ShareRow[]>([]);
const sharesState = newListState();
const sharesTotal = ref(0);
const sharesPage = ref(1);
const sharesPages = computed(() => pagesOf(sharesTotal.value, SHARE_PAGE_SIZE));

async function loadShares(): Promise<void> {
  sharesState.loading = true;
  sharesState.error = "";
  try {
    const data = await adminApi<PageResp<ShareRow>>(
      `/ops/admin/shares${qs({ page: sharesPage.value, page_size: SHARE_PAGE_SIZE })}`,
    );
    shares.value = data.list;
    sharesTotal.value = data.total;
  } catch (e) {
    await fail(e, t("adminUi.sharesLoadFailed"), sharesState);
  } finally {
    sharesState.loading = false;
  }
}

function gotoSharePage(delta: number): void {
  const next = stepPage(sharesPage.value, sharesTotal.value, SHARE_PAGE_SIZE, delta);
  if (next === sharesPage.value) return;
  sharesPage.value = next;
  void loadShares();
}

async function revokeShare(share: ShareRow): Promise<void> {
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/shares/${share.id}/revoke`, { method: "POST" });
    await loadShares();
  } catch (e) {
    await fail(e, t("adminUi.shareRevokeFailed"));
  }
}

// ── 举报处置 ──────────────────────────────────────────────
const REPORT_STATUSES = [1, 2, 3] as const;
const REPORT_PAGE_SIZE = 20;
const reports = ref<ReportRow[]>([]);
const reportsState = newListState();
const reportsTotal = ref(0);
const reportsPage = ref(1);
const reportStatus = ref<number | "">("");
const reportsPages = computed(() => pagesOf(reportsTotal.value, REPORT_PAGE_SIZE));

function reportStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return t("adminUi.reportPending");
    case 2:
      return t("adminUi.reportTakenDown");
    case 3:
      return t("adminUi.reportRejected");
    default:
      return String(status);
  }
}

async function loadReports(): Promise<void> {
  reportsState.loading = true;
  reportsState.error = "";
  try {
    const data = await adminApi<PageResp<ReportRow>>(
      `/ops/admin/reports${qs({
        status: reportStatus.value === "" ? undefined : reportStatus.value,
        page: reportsPage.value,
        page_size: REPORT_PAGE_SIZE,
      })}`,
    );
    reports.value = data.list;
    reportsTotal.value = data.total;
  } catch (e) {
    await fail(e, t("adminUi.reportsLoadFailed"), reportsState);
  } finally {
    reportsState.loading = false;
  }
}

function applyReportFilter(): void {
  reportsPage.value = 1;
  void loadReports();
}

function gotoReportPage(delta: number): void {
  const next = stepPage(reportsPage.value, reportsTotal.value, REPORT_PAGE_SIZE, delta);
  if (next === reportsPage.value) return;
  reportsPage.value = next;
  void loadReports();
}

async function resolveReport(report: ReportRow, action: "takedown" | "dismiss"): Promise<void> {
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/reports/${report.id}/resolve`, {
      method: "POST",
      body: {
        action,
        note: action === "takedown" ? t("adminUi.reportTakedownNote") : t("adminUi.reportDismissNote"),
      },
    });
    await Promise.all([loadReports(), loadDashboard()]);
  } catch (e) {
    await fail(e, t("adminUi.reportResolveFailed"));
  }
}

// ── 导出审计（契约 §4.4.7） ────────────────────────────────
const EXPORT_PAGE_SIZE = 20;
const exportRows = ref<ExportRow[]>([]);
const exportsState = newListState();
const exportsTotal = ref(0);
const exportsPage = ref(1);
const exportsPages = computed(() => pagesOf(exportsTotal.value, EXPORT_PAGE_SIZE));

function exportStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return t("adminUi.exportStatus1");
    case 2:
      return t("adminUi.exportStatus2");
    case 3:
      return t("adminUi.exportStatus3");
    case 4:
      return t("adminUi.exportStatus4");
    default:
      return String(status);
  }
}

async function loadExports(): Promise<void> {
  exportsState.loading = true;
  exportsState.error = "";
  try {
    const data = await adminApi<PageResp<ExportRow>>(
      `/ops/admin/exports${qs({ page: exportsPage.value, page_size: EXPORT_PAGE_SIZE })}`,
    );
    exportRows.value = data.list;
    exportsTotal.value = data.total;
  } catch (e) {
    await fail(e, t("adminUi.exportsLoadFailed"), exportsState);
  } finally {
    exportsState.loading = false;
  }
}

function gotoExportPage(delta: number): void {
  const next = stepPage(exportsPage.value, exportsTotal.value, EXPORT_PAGE_SIZE, delta);
  if (next === exportsPage.value) return;
  exportsPage.value = next;
  void loadExports();
}

// ── 运营位（模块 #27 收尾）────────────────────────────────
//
// 这个面板是「配置驱动」的写入口：新建/停用后**公开读接口立即变化**
// （`GET /crc/banner_list?type=banner|pop_up|activity` 读的就是同一张 promo_slots 表，
// 条件 = status=1 且当前时间在窗口内）。面板把服务端算好的 `active_now` 直接展示，
// 避免运营自己拿本机时间比时间戳（时区差一小时就会误判）。
//
// 编辑用同一套表单：PUT 的 body 里**没有 slot**（类型决定公开读接口的 type 过滤，
// 契约里的 promoSlotBaseSchema 不接受 slot），所以编辑态下类型选择器置灰、只在 POST 时提交。
const promoSlots = ref<PromoSlotDto[]>([]);
const promoState = newListState();
const promoBusy = ref("");
const promoEditId = ref("");
const PROMO_KINDS = ["banner", "pop_up", "activity", "creator"] as const;
const PROMO_KIND_LABEL: Record<string, string> = {
  banner: t("adminUi.slotTypeBanner"),
  pop_up: t("adminUi.slotTypePopUp"),
  activity: t("adminUi.slotTypeActivity"),
  creator: t("adminUi.slotTypeCreator"),
};
const promoForm = reactive({
  slot: "banner" as (typeof PROMO_KINDS)[number],
  title: "",
  image_uri: "",
  link_uri: "",
  sort: 0,
  starts_at: "",
  ends_at: "",
});

function resetPromoForm(): void {
  promoForm.title = "";
  promoForm.image_uri = "";
  promoForm.link_uri = "";
  promoForm.sort = 0;
  promoForm.starts_at = "";
  promoForm.ends_at = "";
}

function startEditPromo(slot: PromoSlotDto): void {
  error.value = "";
  ok.value = "";
  promoEditId.value = slot.id;
  // 服务端返回的 slot 是字符串，只有落在枚举内才能赋给表单的联合类型（否则回填 "banner" 兜底）
  promoForm.slot = (PROMO_KINDS as readonly string[]).includes(slot.slot)
    ? (slot.slot as (typeof PROMO_KINDS)[number])
    : "banner";
  promoForm.title = slot.title ?? "";
  promoForm.image_uri = slot.image_uri ?? "";
  promoForm.link_uri = slot.link_uri ?? "";
  promoForm.sort = slot.sort;
  promoForm.starts_at = slot.starts_at ?? "";
  promoForm.ends_at = slot.ends_at ?? "";
}

function cancelEditPromo(): void {
  promoEditId.value = "";
  resetPromoForm();
}

async function savePromo(): Promise<void> {
  if (!promoForm.title.trim()) {
    error.value = t("adminUi.slotNeedTitle");
    return;
  }
  promoBusy.value = promoEditId.value || "create";
  error.value = "";
  ok.value = "";
  const body = {
    title: promoForm.title.trim(),
    image_uri: promoForm.image_uri.trim() || null,
    link_uri: promoForm.link_uri.trim() || null,
    sort: Number(promoForm.sort) || 0,
    starts_at: promoForm.starts_at.trim() || null,
    ends_at: promoForm.ends_at.trim() || null,
  };
  try {
    if (promoEditId.value) {
      await adminApi<unknown>(`/ops/admin/promo-slots/${promoEditId.value}`, { method: "PUT", body });
      ok.value = t("adminUi.slotSaved");
      promoEditId.value = "";
    } else {
      await adminApi<unknown>("/ops/admin/promo-slots", { method: "POST", body: { slot: promoForm.slot, ...body } });
    }
    resetPromoForm();
    await loadPromo();
  } catch (e) {
    await fail(e, promoEditId.value ? t("adminUi.slotUpdateFailed") : t("adminUi.slotCreateFailed"));
  } finally {
    promoBusy.value = "";
  }
}

async function togglePromo(slot: PromoSlotDto): Promise<void> {
  promoBusy.value = slot.id;
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/promo-slots/${slot.id}`, {
      method: "PUT",
      body: { status: slot.status === 1 ? 2 : 1 },
    });
    await loadPromo();
  } catch (e) {
    await fail(e, t("adminUi.slotUpdateFailed"));
  } finally {
    promoBusy.value = "";
  }
}

async function removePromo(slot: PromoSlotDto): Promise<void> {
  if (!window.confirm(t("adminUi.slotDeleteConfirm", { name: slot.title || slot.id }))) return;
  promoBusy.value = slot.id;
  error.value = "";
  try {
    await adminApi<unknown>(`/ops/admin/promo-slots/${slot.id}`, { method: "DELETE" });
    if (promoEditId.value === slot.id) cancelEditPromo();
    await loadPromo();
  } catch (e) {
    await fail(e, t("adminUi.slotDeleteFailed"));
  } finally {
    promoBusy.value = "";
  }
}

async function loadPromo(): Promise<void> {
  promoState.loading = true;
  promoState.error = "";
  try {
    const data = await adminApi<PromoSlotListDto>("/ops/admin/promo-slots");
    promoSlots.value = data.list;
  } catch (e) {
    // 运营位读失败不阻断其它面板（概览仍然可用），但错误要看得见
    promoSlots.value = [];
    await fail(e, t("adminUi.slotsLoadFailed"), promoState);
  } finally {
    promoState.loading = false;
  }
}

// ── 首页板块配置（home_configs global 层）────────────────
type HomeSection = { key: string; visible: boolean; sort: number };
const homeConfig = ref<{ version: number | null; source: "db" | "default"; sections: HomeSection[] }>({
  version: null,
  source: "default",
  sections: [],
});
const homeBusy = ref(false);
const homeState = newListState();

/** 内置板块的中文/多语言名（key 是后端契约，不翻译） */
function homeSectionLabel(key: string): string {
  const map: Record<string, string> = {
    hero: t("adminUi.homeSectionHero"),
    workflow: t("adminUi.homeSectionWorkflow"),
    canvas: t("adminUi.homeSectionCanvas"),
    tools: t("adminUi.homeSectionTools"),
    banner: t("adminUi.homeSectionBanner"),
    recent: t("adminUi.homeSectionRecent"),
  };
  return map[key] ?? key;
}

async function loadHomeConfig(): Promise<void> {
  homeState.loading = true;
  homeState.error = "";
  try {
    homeConfig.value = await adminApi<{ version: number | null; source: "db" | "default"; sections: HomeSection[] }>(
      "/ops/admin/home-config",
    );
  } catch (e) {
    await fail(e, t("adminUi.homeConfigLoadFailed"), homeState);
  } finally {
    homeState.loading = false;
  }
}

async function saveHomeConfig(): Promise<void> {
  homeBusy.value = true;
  error.value = "";
  ok.value = "";
  try {
    const res = await adminApi<{ version: number }>("/ops/admin/home-config", {
      method: "POST",
      body: {
        ...(homeConfig.value.version === null ? {} : { version: homeConfig.value.version }),
        sections: homeConfig.value.sections.map((s) => ({
          key: s.key,
          visible: s.visible,
          sort: Number(s.sort) || 0,
        })),
      },
    });
    homeConfig.value = { ...homeConfig.value, version: res.version, source: "db" };
    ok.value = t("adminUi.homeConfigSaved");
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (isAdminAuthError(e)) {
      await fail(e, t("adminUi.homeConfigSaveFailed"));
      return;
    }
    error.value =
      code === 746002
        ? t("adminUi.homeConfigConflict")
        : e instanceof Error && e.message
          ? e.message
          : t("adminUi.homeConfigSaveFailed");
  } finally {
    homeBusy.value = false;
  }
}

// ── 页签数据加载 ───────────────────────────────────────────
/**
 * 每个页签只拉自己要用的接口。
 * 为什么不再像旧版那样 onMounted 一次 `loadAll`：15 个接口串在一个 Promise.all 里，
 * 任何一个挂了整屏空，而且新增页签（导出审计/价格/日志…）会白白拉一遍全量数据。
 */
async function loadTab(next: AdminTab): Promise<void> {
  switch (next) {
    case "dashboard":
      await Promise.all([loadDashboard(), loadFunnel(), loadModels()]);
      break;
    case "promo":
      await loadPromo();
      break;
    case "home":
      await loadHomeConfig();
      break;
    case "models":
      await loadModels();
      break;
    case "tasks":
      // 任务页签的模型下拉复用模型表；没拉过就先补一次（直接开 /admin?tab=tasks 的场景）
      syncTaskFilterFromQuery();
      if (models.value.length === 0) await loadModels();
      await Promise.all([loadTasks(), loadMetrics()]);
      break;
    case "funnel":
      await loadFunnel();
      break;
    case "orders":
      await loadOrders();
      break;
    case "shares":
      await loadShares();
      break;
    case "reports":
      await loadReports();
      break;
    case "exports":
      await loadExports();
      break;
    default:
      // prices/skills/audit/admins/config 由独立面板组件自己拉数据（契约 §4.3）
      break;
  }
}

onMounted(async () => {
  // 登录态已由 middleware/admin-auth 向服务端验证（/ops/admin/me），这里不再看 localStorage。
  // 只有身份类错误会跳登录（kickToLogin）；其它错误在各列表自己的错误行里显示，
  // 所以这里不需要外层 try/catch，也不会因为某一个接口 500 就把运营踢下线。
  await loadTab(tab.value);
});

watch(
  () => tab.value,
  (next) => {
    // 已经准备跳登录时不再发请求，避免失败风暴
    if (kicked.value) return;
    void loadTab(next);
  },
);
</script>

<template>
  <div class="page">
    <p v-if="error" class="error banner">{{ error }}</p>
    <p v-if="ok" class="ok banner">{{ ok }}</p>

    <!-- ── 概览 ─────────────────────────────────────────── -->
    <template v-if="tab === 'dashboard'">
      <p v-if="dashboardState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="dashboardState.error" class="error small">{{ dashboardState.error }}</p>
      <section v-if="dashboard" class="stat-grid">
        <NuxtLink class="stat-card tone-purple" :to="{ path: '/admin', query: { tab: 'users' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.7" />
                <path d="M3.5 19c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <path d="M16 6.4a3 3 0 010 5.2M17.5 19c-.2-1.8-.9-3.2-2-4.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statUsers") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.users }}</b>
          <span class="stat-foot"><span>用户管理</span><span class="stat-arrow">→</span></span>
        </NuxtLink>

        <NuxtLink class="stat-card tone-blue" :to="{ path: '/admin', query: { tab: 'tasks' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.7" />
                <path d="M8 9h8M8 13h5M8 17h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statTasks") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.tasks.total }}</b>
          <span class="stat-foot"><span>任务审计</span><span class="stat-arrow">→</span></span>
        </NuxtLink>

        <NuxtLink class="stat-card tone-cyan" :to="{ path: '/admin', query: { tab: 'exports' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 4v10m0 0l-3.4-3.4M12 14l3.4-3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M5 16.5v1.8A1.7 1.7 0 006.7 20h10.6a1.7 1.7 0 001.7-1.7v-1.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statExports") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.exports }}</b>
          <span class="stat-foot"><span>导出审计</span><span class="stat-arrow">→</span></span>
        </NuxtLink>

        <NuxtLink class="stat-card tone-green" :to="{ path: '/admin', query: { tab: 'shares' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M10.2 13.8a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7L11.3 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <path d="M13.8 10.2a4 4 0 00-5.7 0l-2.6 2.6a4 4 0 005.7 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statShares") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.active_shares }}</b>
          <span class="stat-foot"><span>分享管理</span><span class="stat-arrow">→</span></span>
        </NuxtLink>

        <NuxtLink class="stat-card tone-amber" :to="{ path: '/admin', query: { tab: 'admins' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3.8l6.5 2.5v5.1c0 4-2.7 7.4-6.5 8.8-3.8-1.4-6.5-4.8-6.5-8.8V6.3L12 3.8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                <path d="M9.2 12l2 2 3.7-3.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statAdmins") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.admins }}</b>
          <span class="stat-foot"><span>管理员</span><span class="stat-arrow">→</span></span>
        </NuxtLink>

        <NuxtLink class="stat-card tone-red" :to="{ path: '/admin', query: { tab: 'reports' } }">
          <span class="stat-top">
            <span class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 4.2l8 14.1H4l8-14.1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                <path d="M12 9.2v4.3M12 16.4v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </span>
            <span class="stat-label">{{ t("adminUi.statPendingReports") }}</span>
          </span>
          <b class="stat-value">{{ dashboard.pending_reports ?? 0 }}</b>
          <span class="stat-foot"><span>举报处置</span><span class="stat-arrow">→</span></span>
        </NuxtLink>
      </section>

      <!-- 任务状态分布（契约 §4.4.8）：任务卡只显示总数，运营排查时关心的是「卡在哪个状态」 -->
      <section v-if="dashboard" class="card">
        <h2>{{ t("adminUi.tasksByStatus") }}</h2>
        <p v-if="dashboardStatuses.length === 0" class="muted small">{{ t("adminUi.noTasksYet") }}</p>
        <div v-else class="status-seg-list">
          <NuxtLink
            v-for="row in dashboardStatuses"
            :key="row.status"
            class="status-seg"
            :class="`seg-${row.status}`"
            :to="{ path: '/admin', query: { tab: 'tasks', status: row.status } }"
          >
            <span class="seg-label">{{ taskStatusLabel(row.status) }}</span>
            <span class="seg-bar"><i :style="{ width: `${statusPercent(row.count)}%` }"></i></span>
            <b>{{ row.count }}</b>
            <span class="seg-pct">{{ statusPercent(row.count) }}%</span>
          </NuxtLink>
        </div>
      </section>

      <section v-if="dashboard?.queues" class="queues">
        <div v-for="(counts, queue) in dashboard.queues" :key="queue" class="queue-card">
          <b class="queue-name"><i class="queue-dot" :class="queueHealth(counts)" aria-hidden="true"></i>{{ queue }}</b>
          <div class="queue-metrics">
            <span class="queue-metric"><em>wait</em><b>{{ counts.wait ?? 0 }}</b></span>
            <span class="queue-metric"><em>active</em><b>{{ counts.active ?? 0 }}</b></span>
            <span class="queue-metric" :class="{ 'is-bad': (counts.failed ?? 0) > 0 }"><em>failed</em><b>{{ counts.failed ?? 0 }}</b></span>
          </div>
        </div>
      </section>
    </template>

    <!-- 运营位（模块 #27）：新建/停用后公开读接口 crc/banner_list 立即变化 -->
    <section v-if="tab === 'promo'" class="card promo">
      <h2>{{ t("adminUi.slotsTitle") }}</h2>
      <p class="muted small">
        {{ t("adminUi.slotsHint") }}
      </p>
      <p v-if="promoEditId" class="muted small">{{ t("adminUi.slotEditNote") }}</p>

      <div class="promo-form">
        <select v-model="promoForm.slot" class="input" :disabled="Boolean(promoEditId)">
          <option v-for="kind in PROMO_KINDS" :key="kind" :value="kind">
            {{ PROMO_KIND_LABEL[kind] }}（{{ kind }}）
          </option>
        </select>
        <input v-model="promoForm.title" class="input" :placeholder="t('adminUi.slotTitlePlaceholder')" maxlength="120" />
        <input v-model="promoForm.image_uri" class="input" :placeholder="t('adminUi.slotImagePlaceholder')" />
        <input v-model="promoForm.link_uri" class="input" :placeholder="t('adminUi.slotLinkPlaceholder')" />
        <input v-model.number="promoForm.sort" class="input sort" type="number" :placeholder="t('adminUi.slotSortPlaceholder')" />
        <input v-model="promoForm.starts_at" class="input time" :placeholder="t('adminUi.slotStartPlaceholder')" />
        <input v-model="promoForm.ends_at" class="input time" :placeholder="t('adminUi.slotEndPlaceholder')" />
        <button class="mini" :disabled="Boolean(promoBusy)" @click="savePromo">
          {{
            promoBusy === "create"
              ? t("adminUi.creating")
              : promoBusy
                ? t("adminUi.slotSaving")
                : promoEditId
                  ? t("adminUi.slotSaveEdit")
                  : t("adminUi.create")
          }}
        </button>
        <button v-if="promoEditId" class="mini" :disabled="Boolean(promoBusy)" @click="cancelEditPromo">
          {{ t("adminUi.cancel") }}
        </button>
      </div>

      <p v-if="promoState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="promoState.error" class="error small">{{ promoState.error }}</p>
      <template v-else>
        <div class="row head-row">
          <span>{{ t("adminUi.thType") }}</span><span>{{ t("adminUi.thTitle") }}</span><span>{{ t("adminUi.thSort") }}</span><span>{{ t("adminUi.thWindow") }}</span><span>{{ t("adminUi.thLive") }}</span><span>{{ t("adminUi.thOps") }}</span>
        </div>
        <p v-if="promoSlots.length === 0" class="muted small">{{ t("adminUi.slotsEmpty") }}</p>
        <div v-for="slot in promoSlots" :key="slot.id" class="row" :class="{ editing: promoEditId === slot.id }">
          <span>{{ PROMO_KIND_LABEL[slot.slot] ?? slot.slot }}</span>
          <span>{{ slot.title || t("adminUi.noTitle") }}</span>
          <span class="muted">{{ slot.sort }}</span>
          <span class="muted small">
            {{ slot.starts_at ? new Date(slot.starts_at).toLocaleString() : t("adminUi.unlimited") }}
            →
            {{ slot.ends_at ? new Date(slot.ends_at).toLocaleString() : t("adminUi.unlimited") }}
          </span>
          <span :class="slot.active_now ? 'state-on' : 'state-off'">{{ slot.active_now ? t("adminUi.liveOn") : t("adminUi.liveOff") }}</span>
          <span class="ops">
            <button class="mini" :disabled="Boolean(promoBusy)" @click="startEditPromo(slot)">{{ t("adminUi.edit") }}</button>
            <button class="mini" :disabled="promoBusy === slot.id" @click="togglePromo(slot)">
              {{ slot.status === 1 ? t("adminUi.disable") : t("adminUi.enable") }}
            </button>
            <button class="mini danger" :disabled="promoBusy === slot.id" @click="removePromo(slot)">{{ t("adminUi.delete") }}</button>
          </span>
        </div>
      </template>
    </section>

    <section v-if="tab === 'home'" class="card home-config">
      <h2>{{ t("adminUi.homeConfigTitle") }}</h2>
      <p class="muted small">{{ t("adminUi.homeConfigHint") }}</p>
      <p class="muted small">
        {{
          homeConfig.source === "db"
            ? t("adminUi.homeConfigSourceDb", { version: homeConfig.version ?? 0 })
            : t("adminUi.homeConfigSourceDefault")
        }}
      </p>
      <p v-if="homeState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="homeState.error" class="error small">{{ homeState.error }}</p>
      <template v-else>
        <div class="row head-row">
          <span>{{ t("adminUi.homeColKey") }}</span>
          <span>{{ t("adminUi.homeColVisible") }}</span>
          <span>{{ t("adminUi.homeColSort") }}</span>
        </div>
        <div v-for="(sec, idx) in homeConfig.sections" :key="sec.key" class="row home-section-row">
          <span>{{ homeSectionLabel(sec.key) }}</span>
          <span>
            <input v-model="homeConfig.sections[idx]!.visible" type="checkbox" />
          </span>
          <span>
            <input v-model.number="homeConfig.sections[idx]!.sort" class="input sort" type="number" />
          </span>
        </div>
        <div class="row">
          <Button :disabled="homeBusy" @click="saveHomeConfig">
            {{ homeBusy ? t("adminUi.homeConfigSaving") : t("adminUi.homeConfigSave") }}
          </Button>
        </div>
      </template>
    </section>

    <!-- ── 模型：上架 / 排序 / 档位（modes） ─────────────── -->
    <section v-if="tab === 'models'" class="card">
      <h2>{{ t("adminUi.modelsTitle") }}</h2>
      <p class="muted small">{{ t("adminUi.modelsHint") }}</p>
      <p v-if="modelsState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="modelsState.error" class="error small">{{ modelsState.error }}</p>
      <template v-else>
        <div class="row model-row head-row">
          <span>{{ t("adminUi.thName") }}</span><span>{{ t("adminUi.thCapability") }}</span><span>adapter</span><span>{{ t("adminUi.thSort") }}</span><span>{{ t("adminUi.thVisible") }}</span><span>{{ t("adminUi.thOps") }}</span>
        </div>
        <p v-if="models.length === 0" class="muted small">{{ t("adminUi.modelsEmpty") }}</p>
        <div v-for="m in models" :key="m.id" class="model-item">
          <div class="row model-row">
            <span>{{ m.display_name }}</span>
            <span class="muted">{{ m.capability }}</span>
            <span class="muted">{{ m.adapter_code }}</span>
            <span class="sort-cell">
              <input v-model.number="sortDrafts[m.id]" class="input sort" type="number" min="0" max="9999" />
              <button class="mini" :disabled="sortBusy === m.id" @click="saveModelSort(m)">
                {{ sortBusy === m.id ? t("adminUi.saving") : t("adminUi.saveSort") }}
              </button>
            </span>
            <button class="mini" :disabled="sortBusy === m.id" @click="toggleModel(m)">
              {{ m.visible ? t("adminUi.unlist") : t("adminUi.list") }}
            </button>
            <span class="ops">
              <button class="mini" @click="modesOpenId === m.id ? closeModes() : openModes(m)">
                {{ modesOpenId === m.id ? t("adminUi.collapse") : t("adminUi.editModes") }}
              </button>
            </span>
          </div>
          <div v-if="modesOpenId === m.id" class="modes-editor">
            <p class="muted small">{{ t("adminUi.modesHint") }}</p>
            <textarea v-model="modesDraft" class="input modes-text" spellcheck="false"></textarea>
            <p v-if="modesError" class="error small">{{ modesError }}</p>
            <div class="modes-actions">
              <button class="mini" :disabled="modesBusy === m.id" @click="saveModes(m)">
                {{ modesBusy === m.id ? t("adminUi.saving") : t("adminUi.save") }}
              </button>
              <button class="mini" :disabled="modesBusy === m.id" @click="closeModes()">{{ t("adminUi.cancel") }}</button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- ── 任务：指标 + 明细 ─────────────────────────────── -->
    <section v-if="tab === 'tasks'" class="card">
      <h2>{{ t("adminUi.metricsTitle") }}</h2>
      <div class="filters">
        <label class="filter">
          <span class="label">{{ t("adminUi.taskFilterStatus") }}</span>
          <select v-model.number="taskStatus" class="input" @change="applyTaskFilters()">
            <option :value="''">{{ t("adminUi.allStatuses") }}</option>
            <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ taskStatusLabel(s) }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="label">{{ t("adminUi.taskFilterModel") }}</span>
          <select v-model="taskModelId" class="input" @change="applyTaskFilters()">
            <option value="">{{ t("adminUi.allModels") }}</option>
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.display_name || m.name }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="label">{{ t("adminUi.taskFilterFrom") }}</span>
          <input v-model="metricsFrom" class="input" type="datetime-local" @change="loadMetrics()" />
        </label>
        <label class="filter">
          <span class="label">{{ t("adminUi.taskFilterTo") }}</span>
          <input v-model="metricsTo" class="input" type="datetime-local" @change="loadMetrics()" />
        </label>
        <button class="mini" @click="applyTaskFilters()">{{ t("adminUi.refresh") }}</button>
        <button class="mini csv" :disabled="csvBusy" @click="downloadFailedCsv">
          {{ csvBusy ? t("adminUi.exporting") : t("adminUi.downloadFailedCsv") }}
        </button>
      </div>
      <p class="muted small">{{ t("adminUi.taskRangeHint") }}</p>

      <p v-if="metricsState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="metricsState.error" class="error small">{{ metricsState.error }}</p>
      <template v-else>
        <div class="cards">
          <div class="card"><span class="muted">{{ t("adminUi.failureRate") }}</span><b>{{ metrics.failure_rate }}%</b></div>
          <div class="card"><span class="muted">{{ t("adminUi.succFailCancel") }}</span><b>{{ metrics.succeeded }} / {{ metrics.failed }} / {{ metrics.canceled }}</b></div>
        </div>
        <div v-if="metrics.adapter_latency.length > 0" class="latency">
          <div v-for="row in metrics.adapter_latency" :key="row.adapter" class="latency-row">
            <span class="mono">{{ row.adapter }}</span>
            <span class="muted">{{ t("adminUi.samplesN", { n: row.samples }) }}</span>
            <span>avg {{ row.avg_ms }}ms</span>
            <span>p95 {{ row.p95_ms }}ms</span>
          </div>
        </div>
        <div v-if="metrics.errors_by_code.length > 0" class="latency">
          <div v-for="row in metrics.errors_by_code" :key="row.code" class="latency-row">
            <span class="mono">{{ row.code }}</span>
            <span class="muted">{{ t("adminUi.timesN", { n: row.count }) }}</span>
          </div>
        </div>
      </template>
    </section>

    <section v-if="tab === 'tasks'" class="card">
      <h2>{{ t("adminUi.tasksListTitle") }}</h2>
      <p v-if="tasksState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="tasksState.error" class="error small">{{ tasksState.error }}</p>
      <template v-else>
        <div class="row task-row head-row">
          <span>{{ t("adminUi.thTask") }}</span><span>{{ t("adminUi.thModel") }}</span><span>{{ t("adminUi.thMode") }}</span><span>{{ t("adminUi.thStatus") }}</span><span>{{ t("adminUi.thCredits") }}</span><span>{{ t("adminUi.thError") }}</span><span>{{ t("adminUi.thTime") }}</span>
        </div>
        <p v-if="tasks.length === 0" class="muted small">{{ t("adminUi.tasksEmpty") }}</p>
        <div v-for="row in tasks" :key="row.task_id" class="row task-row">
          <span class="mono" :title="row.task_id">{{ shortId(row.task_id) }}</span>
          <span class="muted">{{ row.model_name || row.model_id || "-" }}</span>
          <span>{{ row.mode }}</span>
          <span class="muted">{{ taskStatusLabel(row.status) }}</span>
          <span class="muted">{{ row.credits_settled }}/{{ row.credits_frozen }}</span>
          <span class="cell-error" :title="row.error_message || row.error_code || ''">
            {{ row.error_code || row.error_message || "-" }}
          </span>
          <span class="muted">{{ fmtTime(row.created_at) }}</span>
        </div>
        <div class="pager">
          <button class="mini" :disabled="tasksPage <= 1" @click="gotoTaskPage(-1)">{{ t("adminUi.prevPage") }}</button>
          <span class="muted">{{ t("adminUi.pageInfo", { page: tasksPage, pages: tasksPages, total: tasksTotal }) }}</span>
          <button class="mini" :disabled="tasksPage >= tasksPages" @click="gotoTaskPage(1)">{{ t("adminUi.nextPage") }}</button>
        </div>
      </template>
    </section>

    <!-- ── 分享 ─────────────────────────────────────────── -->
    <section v-if="tab === 'shares'" class="card">
      <h2>{{ t("adminUi.sharesTitle") }}</h2>
      <p v-if="sharesState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="sharesState.error" class="error small">{{ sharesState.error }}</p>
      <template v-else>
        <p v-if="shares.length === 0" class="muted">{{ t("adminUi.sharesEmpty") }}</p>
        <div v-for="s in shares" :key="s.id" class="share-row">
          <span class="mono">{{ String(s.token).slice(0, 12) }}…</span>
          <span class="muted">task {{ shortId(s.task_id) }}</span>
          <span class="muted">{{ s.revoked_at ? t("adminUi.revoked") : t("adminUi.untilDate", { date: new Date(s.expires_at).toLocaleDateString() }) }}</span>
          <button v-if="!s.revoked_at" class="mini" @click="revokeShare(s)">{{ t("adminUi.takeDown") }}</button>
        </div>
        <div class="pager">
          <button class="mini" :disabled="sharesPage <= 1" @click="gotoSharePage(-1)">{{ t("adminUi.prevPage") }}</button>
          <span class="muted">{{ t("adminUi.pageInfo", { page: sharesPage, pages: sharesPages, total: sharesTotal }) }}</span>
          <button class="mini" :disabled="sharesPage >= sharesPages" @click="gotoSharePage(1)">{{ t("adminUi.nextPage") }}</button>
        </div>
      </template>
    </section>

    <!-- ── 漏斗 ─────────────────────────────────────────── -->
    <section v-if="tab === 'funnel'" class="card">
      <h2>{{ t("adminUi.funnelTitle") }}</h2>
      <p v-if="funnelState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="funnelState.error" class="error small">{{ funnelState.error }}</p>
      <template v-else>
        <div class="funnel">
          <div v-for="stage in funnel" :key="stage.key" class="funnel-stage">
            <span class="muted">{{ stage.label }}</span>
            <b>{{ stage.count }}</b>
            <span v-if="stage.conversion_from_previous !== null" class="muted">
              {{ t("adminUi.conversion", { percent: stage.conversion_from_previous }) }}
            </span>
            <!-- 契约 §4.4.3：流失率与环节耗时是运营最关心的两个数，null 必须显示 `-` 而不是 0 -->
            <span class="muted">{{ t("adminUi.dropoff", { percent: fmtNum(stage.dropoff_from_previous) }) }}</span>
            <span class="muted">{{ t("adminUi.avgHoursPrev", { hours: fmtNum(stage.avg_hours_from_previous) }) }}</span>
            <span class="muted">{{ t("adminUi.avgHoursCreated", { hours: fmtNum(stage.avg_hours_from_project_created) }) }}</span>
          </div>
        </div>
        <p v-if="funnel.length === 0" class="muted">{{ t("adminUi.funnelEmpty") }}</p>
      </template>
    </section>

    <!-- ── 举报处置 ─────────────────────────────────────── -->
    <section v-if="tab === 'reports'" class="card">
      <h2>{{ t("adminUi.reportsTitle") }}</h2>
      <div class="filters">
        <label class="filter">
          <span class="label">{{ t("adminUi.reportFilterStatus") }}</span>
          <select v-model.number="reportStatus" class="input" @change="applyReportFilter()">
            <option :value="''">{{ t("adminUi.allStatuses") }}</option>
            <option v-for="s in REPORT_STATUSES" :key="s" :value="s">{{ reportStatusLabel(s) }}</option>
          </select>
        </label>
      </div>
      <p v-if="reportsState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="reportsState.error" class="error small">{{ reportsState.error }}</p>
      <template v-else>
        <p v-if="reports.length === 0" class="muted">{{ t("adminUi.reportsEmpty") }}</p>
        <div v-for="r in reports" :key="r.id" class="report-row">
          <span class="badge" :data-status="r.status">{{ reportStatusLabel(r.status) }}</span>
          <span class="muted">{{ r.reason }}</span>
          <span class="report-detail">{{ r.detail || "-" }}</span>
          <span class="muted">task {{ shortId(r.task_id) }}</span>
          <template v-if="r.status === 1">
            <button class="mini danger" @click="resolveReport(r, 'takedown')">{{ t("adminUi.takeDown") }}</button>
            <button class="mini" @click="resolveReport(r, 'dismiss')">{{ t("adminUi.reject") }}</button>
          </template>
          <span v-else class="muted">{{ r.resolution }}</span>
        </div>
        <div class="pager">
          <button class="mini" :disabled="reportsPage <= 1" @click="gotoReportPage(-1)">{{ t("adminUi.prevPage") }}</button>
          <span class="muted">{{ t("adminUi.pageInfo", { page: reportsPage, pages: reportsPages, total: reportsTotal }) }}</span>
          <button class="mini" :disabled="reportsPage >= reportsPages" @click="gotoReportPage(1)">{{ t("adminUi.nextPage") }}</button>
        </div>
      </template>
    </section>

    <!-- ── 订单 / 全额退款 / 对账导出 ───────────────────── -->
    <section v-if="tab === 'orders'" class="card">
      <h2>{{ t("adminUi.ordersTitle") }}</h2>
      <p class="muted small">
        {{ t("adminUi.ordersHint") }}
      </p>
      <div class="filters">
        <label class="filter">
          <span class="label">{{ t("adminUi.orderFilterStatus") }}</span>
          <select v-model.number="orderStatus" class="input" @change="applyOrderFilter()">
            <option :value="''">{{ t("adminUi.allStatuses") }}</option>
            <option v-for="s in ORDER_STATUSES" :key="s" :value="s">{{ orderStatusLabel(s) }}</option>
          </select>
        </label>
        <button class="mini csv" :disabled="ordersCsvBusy" @click="exportOrdersCsv">
          {{ ordersCsvBusy ? t("adminUi.exporting") : t("adminUi.ordersExportRefund") }}
        </button>
      </div>
      <p v-if="ordersState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="ordersState.error" class="error small">{{ ordersState.error }}</p>
      <template v-else>
        <p v-if="orders.length === 0" class="muted">{{ t("adminUi.ordersEmpty") }}</p>
        <div v-for="o in orders" :key="o.order_id" class="order-row">
          <span class="mono">{{ String(o.order_id).slice(-10) }}</span>
          <span>{{ o.sku }}</span>
          <span class="muted">¥{{ (Number(o.amount_cents) / 100).toFixed(2) }}</span>
          <span class="muted">{{ o.channel }}</span>
          <span class="badge" :data-status="o.status">{{ orderStatusLabel(o.status) }}</span>
          <span v-if="o.refund_no" class="muted mono">{{ o.refund_no }} · {{ o.refund_status }}</span>
          <span v-else class="muted">-</span>
          <button
            v-if="o.status === 2"
            class="mini danger"
            :disabled="refunding === String(o.order_id)"
            @click="refundOrder(o)"
          >
            {{ refunding === String(o.order_id) ? t("adminUi.refunding") : t("adminUi.fullRefund") }}
          </button>
        </div>
        <div class="pager">
          <button class="mini" :disabled="ordersPage <= 1" @click="gotoOrderPage(-1)">{{ t("adminUi.prevPage") }}</button>
          <span class="muted">{{ t("adminUi.pageInfo", { page: ordersPage, pages: ordersPages, total: ordersTotal }) }}</span>
          <button class="mini" :disabled="ordersPage >= ordersPages" @click="gotoOrderPage(1)">{{ t("adminUi.nextPage") }}</button>
        </div>
      </template>
    </section>

    <!-- ── 导出审计（契约 §4.4.7） ───────────────────────── -->
    <section v-if="tab === 'exports'" class="card">
      <h2>{{ t("adminUi.exportsTitle") }}</h2>
      <p class="muted small">{{ t("adminUi.exportsHint") }}</p>
      <p v-if="exportsState.loading" class="muted small">{{ t("adminUi.loading") }}</p>
      <p v-else-if="exportsState.error" class="error small">{{ exportsState.error }}</p>
      <template v-else>
        <div class="row export-row head-row">
          <span>{{ t("adminUi.expColExport") }}</span><span>{{ t("adminUi.expColSpace") }}</span><span>{{ t("adminUi.expColEpisode") }}</span><span>{{ t("adminUi.thStatus") }}</span><span>{{ t("adminUi.expColCreated") }}</span><span>{{ t("adminUi.expColExpires") }}</span>
        </div>
        <p v-if="exportRows.length === 0" class="muted small">{{ t("adminUi.exportsEmpty") }}</p>
        <div v-for="row in exportRows" :key="row.export_id" class="row export-row">
          <span class="mono" :title="row.export_id">{{ shortId(row.export_id) }}</span>
          <span class="mono muted">{{ shortId(row.space_id) }}</span>
          <span class="mono muted">{{ shortId(row.episode_id) }}</span>
          <span class="muted">{{ exportStatusLabel(row.status) }}</span>
          <span class="muted">{{ fmtTime(row.created_at) }}</span>
          <span class="muted">{{ fmtTime(row.expires_at) }}</span>
        </div>
        <div class="pager">
          <button class="mini" :disabled="exportsPage <= 1" @click="gotoExportPage(-1)">{{ t("adminUi.prevPage") }}</button>
          <span class="muted">{{ t("adminUi.pageInfo", { page: exportsPage, pages: exportsPages, total: exportsTotal }) }}</span>
          <button class="mini" :disabled="exportsPage >= exportsPages" @click="gotoExportPage(1)">{{ t("adminUi.nextPage") }}</button>
        </div>
      </template>
    </section>

    <!--
      以下面板由独立组件实现（见 deliverables/software-company/admin-console-completion-contract-2026-10-29.md）：
      每个面板自己拉数据、自己管分页/错误，避免这个单页继续膨胀成"改一处怕碰十处"。
    -->
    <AdminPricePanel v-if="tab === 'prices'" />
    <AdminProvidersPanel v-if="tab === 'providers'" />
    <AdminSkillsPanel v-if="tab === 'skills'" />
    <AdminAuditPanel v-if="tab === 'audit'" />
    <AdminAdminsPanel v-if="tab === 'admins'" />
    <AdminConfigPanel v-if="tab === 'config'" />
    <AdminUsersPanel v-if="tab === 'users'" />
    <AdminWaitlistPanel v-if="tab === 'waitlist'" />
    <AdminInviteCodesPanel v-if="tab === 'invites'" />
    <AdminAiLabelPanel v-if="tab === 'aiLabels'" />
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.banner {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
}
.banner.error {
  background: var(--danger-bg);
  color: var(--danger);
}
.banner.ok {
  background: var(--success-bg, #14351f);
  color: var(--success, #4ade80);
}
h1 {
  margin: 0;
  font-size: 22px;
}
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
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
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 8px 10px;
  font-size: 13px;
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
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 12px;
}
.row {
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 1fr 0.6fr 0.6fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
/* 模型行：名称/能力/adapter/排序(输入+保存)/上架/操作 —— 排序列要放下输入框与按钮，给 170px */
.model-row {
  grid-template-columns: 1.3fr 0.8fr 0.9fr 170px 0.6fr 110px;
}
/* 任务行：task/model/mode/status/credits/error/时间（契约 §4.4.2） */
.task-row {
  grid-template-columns: 88px 1.1fr 0.9fr 80px 90px 1.3fr 150px;
}
/* 导出行：导出/空间/分集/状态/创建/过期 */
.export-row {
  grid-template-columns: 90px 80px 80px 80px 150px 150px;
}
.head-row {
  color: var(--text-3);
}
.sort-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sort-cell .sort {
  width: 72px;
}
.model-item {
  border-bottom: 1px solid var(--border-1);
}
.model-item .row {
  border-bottom: none;
}
.modes-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 12px;
}
.modes-text {
  width: 100%;
  min-height: 160px;
  box-sizing: border-box;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.modes-actions {
  display: flex;
  gap: 8px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 12px 0 6px;
}
.filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.filter .label {
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
}
.filters .input {
  min-width: 128px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}
.chip b {
  font-size: 13px;
}
.cell-error {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latency {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.latency-row {
  display: flex;
  gap: 14px;
  font-size: 12px;
  align-items: center;
}
.csv {
  align-self: center;
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
}
.funnel {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.funnel-stage {
  flex: 1;
  min-width: 130px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.funnel-stage b {
  font-size: 20px;
}
.report-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  font-size: 12px;
}
.report-detail {
  flex: 1;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini.danger {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.badge[data-status="1"] {
  color: #fbbf24;
  border-color: #fbbf24;
}
.badge[data-status="2"] {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.share-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.mini {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.order-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  font-size: 12px;
  flex-wrap: wrap;
}
.order-row .mini {
  margin-left: auto;
}
.badge[data-status="3"] {
  color: var(--text-3);
}
.badge[data-status="4"] {
  color: #4ade80;
  border-color: #4ade80;
}
.small {
  font-size: 11px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
/* ── 运营位面板（模块 #27）──────────────────────────────── */
.promo .promo-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin: 12px 0;
  align-items: center;
}
.promo .promo-form .input {
  width: 100%;
}
.promo .promo-form .sort {
  max-width: 90px;
}
.promo .promo-form .time {
  min-width: 180px;
}
/* 运营位表格是 6 列（类型/标题/排序/窗口/生效/操作），不能沿用 .row 的 5 列，
   否则最后一列会被挤到第二行（旧实现就有这个错位，顺手按 6 列钉住） */
.promo .row {
  grid-template-columns: 0.9fr 1.2fr 0.5fr 1.6fr 0.7fr 1.4fr;
}
.promo .state-on {
  color: #4ade80;
  font-size: 12px;
}
.promo .state-off {
  color: var(--text-3);
  font-size: 12px;
}
.promo .ops {
  display: inline-flex;
  gap: 6px;
}
.promo .small {
  font-size: 12px;
}
.promo .row.editing {
  background: var(--bg-hover, #ffffff08);
}
.promo code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-subtle, #16161f);
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
