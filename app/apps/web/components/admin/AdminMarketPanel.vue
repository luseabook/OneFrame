<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { Ref } from "vue";
import { adminApi, isAdminAuthError } from "~/composables/useAdminApi";

/**
 * 剧本广场运营面板（`/v1/ops/market/*`，见 `market-admin.controller.ts`）。
 *
 * 为什么这个面板自己拉数据而不复用 `pages/admin/index.vue` 的 `loadAll`：
 * 集市侧有 20+ 条端点、5 个互不相干的子域（作品审核 / 分类 / 标签 / 推广位 / 提现），
 * 首屏一次性拉全会让后台概览被集市请求拖慢，而且任何一段失败都会连带整页报错。
 * 这里按子页签惰性加载、写操作后只刷新自己这一段（§4.3「自己拉数据」）。
 *
 * 所有字段严格对齐控制器 zod schema 与 service DTO，**不臆造字段**：
 * - 作品：`toWorkDto()`（`market.service.ts`）+ `author{user_id,nickname}`
 * - 分类：`{id,name,sort,status}`；标签：`{id,name,status}`（status 恒 1）
 * - 推广位：写 `promo_slots`，DTO 含 `view_count/click_count`
 * - 提现：DTO 带 `next_actions`（服务端算好的状态机出口，前端据此决定渲染哪个按钮）
 */

const { t } = useI18n();

// ── 类型（与 API DTO 一一对应，避免 `Record<string, unknown>` 丢掉字段校验）──

interface Paged<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}

interface MarketWorkRow {
  id: string;
  novel_id: string | null;
  owner_user_id: string;
  space_id: string;
  title: string;
  summary: string;
  cover_uri: string | null;
  kind: number;
  kind_name: string;
  price_credits: number;
  preorder_price_credits: number | null;
  status: number;
  status_name: string;
  audit_note: string | null;
  sales_count: number;
  revenue_credits: number;
  category_id: string | null;
  tag_ids: string[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author: { user_id: string; nickname: string };
}

/** `market_review_logs` 的一行（`toReviewLogDto()`）：action 1 提交 / 2 通过 / 3 驳回 / 4 下架 */
interface ReviewLogRow {
  id: string;
  work_id: string;
  action: number;
  action_name: string;
  operator_admin_id: string | null;
  operator_user_id: string | null;
  note: string | null;
  created_at: string;
}

/**
 * `GET /ops/market/scripts/:id` 的 DTO = 作品 DTO + 作者 + 计数 + 审核态 + 轨迹。
 * 为什么单独定义而不复用列表行：详情多了 `counts`/`review`/`review_logs`，
 * 且 `author` 多一个 `avatar_uri`（列表路径不 join 头像）。
 */
interface MarketWorkDetail extends MarketWorkRow {
  author: { user_id: string; nickname: string; avatar_uri: string | null };
  counts: { chapters: number; characters: number; episodes: number; total_word_count: number };
  review: { auditable: boolean; rejected_can_resubmit: boolean; last_audit_note: string | null };
  review_logs: ReviewLogRow[];
}

/** `GET /ops/market/dashboard/scripts`（`adminDashboard()`） */
interface MarketDashboard {
  /** 键是 `MARKET_WORK_STATUS_LABEL` 的中文常量（服务端按 label 聚合），见 WORK_STATUS 映射 */
  works_by_status: Record<string, number>;
  pending_review: number;
  agreements: number;
  gross_credits: number;
  commission_credits: number;
  creator_revenue_credits: number;
  commission_bps: number;
  pending_withdrawals: { count: number; amount_credits: number };
}

interface MarketCategoryRow {
  id: string;
  name: string;
  sort: number;
  status: number;
}

interface MarketTagRow {
  id: string;
  name: string;
  status: number;
}

interface PromotionRow {
  id: string;
  slot: string;
  title: string;
  image_uri: string | null;
  link_uri: string | null;
  sort: number;
  status: number;
  starts_at: string | null;
  ends_at: string | null;
  view_count: number;
  click_count: number;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  space_id: string;
  amount_credits: number;
  work_id: string | null;
  status: number;
  status_name: string;
  channel: string;
  account_info: Record<string, unknown>;
  review_note: string | null;
  paid_at: string | null;
  /** 服务端算好的状态机出口：pending → approve/reject/cancel，approved → payout/reject，终态为空 */
  next_actions: string[];
  created_at: string;
  updated_at: string;
  user_nickname: string;
}

// ── 子页签 ────────────────────────────────────────────────

const SUBTABS = [
  { key: "review", labelKey: "adminMarket.subtabReview" },
  { key: "categories", labelKey: "adminMarket.subtabCategories" },
  { key: "tags", labelKey: "adminMarket.subtabTags" },
  { key: "promotions", labelKey: "adminMarket.subtabPromotions" },
  { key: "withdrawals", labelKey: "adminMarket.subtabWithdrawals" },
] as const;

type SubTab = (typeof SUBTABS)[number]["key"];

const subtab = ref<SubTab>("review");

/** 面板级错误行：一次只显示最近一条，够用且不会把表格挤走 */
const error = ref("");

// ── 通用工具 ──────────────────────────────────────────────

/**
 * 统一错误出口：**只有身份类错误才回登录页**，其余就地显示。
 * 原因见契约 §4.3 与 `useAdminApi.ts` 注释：一个接口 500 就把运营踢下线是不可接受的。
 */
async function fail(e: unknown, fallbackKey: string): Promise<void> {
  if (isAdminAuthError(e)) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  error.value = e instanceof Error && e.message ? e.message : t(fallbackKey);
}

/**
 * 写操作统一包装：置 busy → 清错误 → 执行 → 成功后刷新 → 失败走 `fail`。
 * 抽出来的原因是本面板有 12 个写动作，逐个写 try/catch 极易漏掉 busy 复位（按钮卡死）。
 */
async function mutate(
  busyRef: Ref<string>,
  id: string,
  action: () => Promise<unknown>,
  refresh: () => Promise<void> | void,
): Promise<void> {
  busyRef.value = id;
  error.value = "";
  try {
    await action();
    await refresh();
  } catch (e) {
    await fail(e, "adminMarket.opFailed");
  } finally {
    busyRef.value = "";
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

/** ISO → `datetime-local` 的本地值（控件只认 `YYYY-MM-DDTHH:mm`，不能直接塞 UTC 串） */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` 值 → ISO（`z.string().datetime()` 只收 UTC `Z` 结尾） */
function toIso(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 收款信息只摊平标量字段：运营打款时看的是账号/姓名，嵌套对象展开只会挤爆一行 */
function accountBrief(info: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(info ?? {})) {
    if (value === null || value === undefined || typeof value === "object") continue;
    parts.push(`${key}: ${String(value)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

// ── 集市看板（`GET /ops/market/dashboard/scripts`）──────────

/**
 * 作品状态码 → 中文 label 的映射（与 `market.constants.ts` 的 `MARKET_WORK_STATUS`/`_LABEL` 同源）。
 *
 * 为什么必须有一张表而不是直接用 DTO：
 * 1. 看板 `works_by_status` 的**键是服务端的中文常量 label**（`byStatus[MARKET_WORK_STATUS_LABEL[s]]`），
 *    不是状态码，取数时只能按 label 反查；
 * 2. 筛选下拉与列表「状态」列也需要这 6 个文案——DTO 里的 `status_name` 同样是中文常量，
 *    直接渲染会在 en/ja/pt/es 界面里漏中文。
 */
const WORK_STATUS = [
  { status: 1, label: "草稿", key: "adminMarket.wsDraft" },
  { status: 2, label: "待审核", key: "adminMarket.workStatusPending" },
  { status: 3, label: "在售", key: "adminMarket.wsOnSale" },
  { status: 4, label: "已驳回", key: "adminMarket.wsRejected" },
  { status: 5, label: "已下架", key: "adminMarket.wsOffline" },
  { status: 6, label: "预售中", key: "adminMarket.wsPreorder" },
] as const;

const dashboard = ref<MarketDashboard | null>(null);
const dashboardLoading = ref(false);

async function loadDashboard(): Promise<void> {
  dashboardLoading.value = true;
  try {
    dashboard.value = await adminApi<MarketDashboard>("/ops/market/dashboard/scripts");
  } catch (e) {
    // 看板是"附加信息"：拉不到就整块隐藏，但不该把已加载的列表也清掉
    dashboard.value = null;
    await fail(e, "adminMarket.dashLoadFailed");
  } finally {
    dashboardLoading.value = false;
  }
}

/** 按状态取看板计数：服务端只下发"有作品的"状态，缺项即 0 */
function dashCount(status: number): number {
  const found = WORK_STATUS.find((item) => item.status === status);
  if (!found || !dashboard.value) return 0;
  return dashboard.value.works_by_status[found.label] ?? 0;
}

// ── 剧本审核 ──────────────────────────────────────────────

const REVIEW_PAGE_SIZE = 20;

const reviewRows = ref<MarketWorkRow[]>([]);
const reviewTotal = ref(0);
const reviewPage = ref(1);
const reviewKeyword = ref("");
/**
 * 当前状态筛选（1..6），默认 2 = 待审队列（等价旧版的 `/scripts/pending`）。
 *
 * 为什么没有"全部状态"这个选项：`adminListWorks()` 里是
 * `eq(marketWorks.status, query.status ?? MARKET_WORK_STATUS.PENDING)` ——
 * `status` 缺省即"待审核"，接口层面**不存在**"不过滤"的取值。
 * 给一个假的"全部"选项会让运营以为看到的是全量作品，所以只提供 6 个真实状态。
 */
const reviewStatus = ref<number>(2);
const reviewLoading = ref(false);
const reviewBusy = ref("");
/**
 * 每行的审核备注 / 归类选择，按 id 存：列表刷新后仍保留运营已输入但未提交的内容。
 * 用 `reactive` 而非 `ref` 是为了让 `v-model="reviewNotes[row.id]"` 直接落在响应式对象上
 * （`ref` 包一层对象时模板里的动态下标赋值容易写成非响应式写法，这里不留这个坑）。
 */
const reviewNotes = reactive<Record<string, string>>({});
const reviewCategory = reactive<Record<string, string>>({});

/** 当前展开的作品详情：一次只开一个（长列表里同时展开多个会让人滚动错位） */
const reviewDetail = ref<MarketWorkDetail | null>(null);
const detailLoading = ref(false);
const detailBusy = ref("");

const reviewPages = computed(() => Math.max(1, Math.ceil(reviewTotal.value / REVIEW_PAGE_SIZE)));

/**
 * 作品列表（`GET /ops/market/scripts/list?status&keyword&page&page_size`）。
 * `retryOnEmpty` 只用于「处理掉当前页最后一条后自动回退一页」，避免运营误以为队列已清空。
 */
async function loadWorks(retryOnEmpty = true): Promise<void> {
  reviewLoading.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams({
      page: String(reviewPage.value),
      page_size: String(REVIEW_PAGE_SIZE),
      status: String(reviewStatus.value),
    });
    const keyword = reviewKeyword.value.trim();
    if (keyword) query.set("keyword", keyword);
    const data = await adminApi<Paged<MarketWorkRow>>(`/ops/market/scripts/list?${query.toString()}`);
    reviewRows.value = data.list;
    reviewTotal.value = data.total;
    reviewPage.value = data.page;
    // 只为仍在列表里的行保留草稿，避免输入框把上一次的搜索结果带进来
    const keep = new Set(data.list.map((row) => row.id));
    for (const key of Object.keys(reviewNotes)) if (!keep.has(key)) delete reviewNotes[key];
    for (const key of Object.keys(reviewCategory)) if (!keep.has(key)) delete reviewCategory[key];
    for (const row of data.list) {
      if (reviewNotes[row.id] === undefined) reviewNotes[row.id] = "";
      if (reviewCategory[row.id] === undefined) reviewCategory[row.id] = "";
    }
    if (retryOnEmpty && data.list.length === 0 && data.total > 0 && reviewPage.value > 1) {
      reviewPage.value -= 1;
      await loadWorks(false);
    }
  } catch (e) {
    reviewRows.value = [];
    reviewTotal.value = 0;
    await fail(e, "adminMarket.loadFailed");
  } finally {
    reviewLoading.value = false;
  }
}

function goReviewPage(page: number): void {
  reviewPage.value = Math.min(Math.max(1, page), reviewPages.value);
  void loadWorks();
}

function resetReviewSearch(): void {
  reviewKeyword.value = "";
  reviewPage.value = 1;
  void loadWorks();
}

/** 切换状态筛选：换队列等于换上下文，顺手收起旧详情，避免"详情与列表不是同一批" */
function selectWorkStatus(status: number): void {
  reviewStatus.value = status;
  reviewPage.value = 1;
  reviewDetail.value = null;
  error.value = "";
  // 从看板 chip 或别的子页签点进来时要切回审核页；此时交给 watch(subtab) 触发加载，避免拉两次
  if (subtab.value !== "review") {
    subtab.value = "review";
    return;
  }
  void loadWorks();
}

/**
 * 作品详情（`GET /ops/market/scripts/:id`）。
 *
 * 为什么不把 `counts`/`review`/`review_logs` 塞进列表接口：审核轨迹是每作品 50 行的子查询，
 * 放进列表会让一页 20 条变成 20 次 join；按需拉取才符合"点开才看"的使用方式。
 */
async function openDetail(workId: string): Promise<void> {
  detailLoading.value = true;
  error.value = "";
  try {
    reviewDetail.value = await adminApi<MarketWorkDetail>(`/ops/market/scripts/${workId}`);
  } catch (e) {
    reviewDetail.value = null;
    await fail(e, "adminMarket.detailLoadFailed");
  } finally {
    detailLoading.value = false;
  }
}

/**
 * 重新提审（`POST /ops/market/scripts/:id/submit-review`，双段式第一段）：
 * 草稿/已驳回/已下架 → 待审核。已待审时后端幂等返回，所以按钮重复点也安全。
 *
 * 注意后端要求 `price_credits > 0` 才允许送审（`adminSubmitReview` 的 400101），
 * 所以价格 ≤ 0 时按钮禁用并给出提示，别让运营白点一次。
 */
function resubmitWork(workId: string): void {
  void mutate(
    detailBusy,
    workId,
    () => adminApi(`/ops/market/scripts/${workId}/submit-review`, { method: "POST" }),
    async () => {
      // 提审把作品挪进"待审核"队列：列表、详情、看板的待审计数三处都要刷新
      await loadWorks();
      if (reviewDetail.value?.id === workId) await openDetail(workId);
      await loadDashboard();
    },
  );
}

/** 审核结论后的统一刷新：列表 + 仍在展开的详情 + 看板 */
async function afterReview(workId: string): Promise<void> {
  await loadWorks();
  if (reviewDetail.value?.id === workId) await openDetail(workId);
  await loadDashboard();
}

/** 出审核结论（`POST /ops/market/scripts/:id/review-result`）：只有「待审核」可审，不可逆 */
function reviewWork(row: MarketWorkRow, result: "approved" | "rejected"): void {
  const note = (reviewNotes[row.id] ?? "").trim();
  // 后端对「驳回无理由」直接 400101；前端先挡住，省掉一次往返报错
  if (result === "rejected" && note === "") {
    error.value = t("adminMarket.rejectNeedsNote");
    return;
  }
  const categoryId = reviewCategory[row.id] ?? "";
  void mutate(
    reviewBusy,
    row.id,
    () =>
      adminApi(`/ops/market/scripts/${row.id}/review-result`, {
        method: "POST",
        body: {
          result,
          ...(note ? { audit_note: note } : {}),
          // 归类只在通过时一起落库：驳回的作品不对外展示，先分类没有意义
          ...(result === "approved" && categoryId ? { category_id: categoryId } : {}),
        },
      }),
    () => afterReview(row.id),
  );
}

function categoryName(categoryId: string | null): string {
  if (!categoryId) return t("adminMarket.uncategorized");
  return categories.value.find((item) => item.id === categoryId)?.name ?? categoryId;
}

/**
 * 审核归类只列**启用**的分类：`market-taxonomy.resolveRefs()` 会校验 `status=1`，
 * 选了停用分类后端必报 400101 —— 与其让运营点了才看到错误，不如不给他这个选项。
 */
const activeCategories = computed(() => categories.value.filter((item) => item.status === 1));

/** 状态列文案：优先本地映射（DTO 的 `status_name` 是中文常量，直出会污染其它语言界面） */
function workStatusName(row: MarketWorkRow): string {
  const found = WORK_STATUS.find((item) => item.status === row.status);
  return found ? t(found.key) : row.status_name;
}

/** 审核轨迹动作（`MARKET_REVIEW_ACTION` 1 提交 / 2 通过 / 3 驳回 / 4 下架） */
const REVIEW_ACTION_KEY: Record<number, string> = {
  1: "adminMarket.actionSubmit",
  2: "adminMarket.actionApprove",
  3: "adminMarket.actionReject",
  4: "adminMarket.actionOffline",
};

function reviewActionName(log: ReviewLogRow): string {
  const key = REVIEW_ACTION_KEY[log.action];
  return key ? t(key) : log.action_name;
}

/**
 * 操作人：后台动作记 `operator_admin_id`，创作者侧动作记 `operator_user_id`。
 * 两个 id 空间不同（`admin_users` vs `users`），混着显示会让人分不清"这条是运营还是作者做的"。
 */
function reviewOperator(log: ReviewLogRow): string {
  if (log.operator_admin_id) return t("adminMarket.logOperatorAdmin", { id: log.operator_admin_id });
  if (log.operator_user_id) return t("adminMarket.logOperatorUser", { id: log.operator_user_id });
  return t("adminMarket.logOperatorSystem");
}

/** 收起详情（模板里直接给 ref 赋 null 会依赖 setup 代理的写语义，用函数更直白） */
function closeDetail(): void {
  reviewDetail.value = null;
}

/** 详情里"可重新提审"只对当前展开的那一行生效（列表 DTO 没有该标记） */
function canResubmit(row: MarketWorkRow): boolean {
  return reviewDetail.value?.id === row.id && reviewDetail.value.review.rejected_can_resubmit;
}

// ── 分类 ──────────────────────────────────────────────────

const categories = ref<MarketCategoryRow[]>([]);
const categoriesLoading = ref(false);
const categoryKeyword = ref("");
const categoryBusy = ref("");
const categoryEditingId = ref("");
const categoryForm = reactive({ name: "", sort: 0 });

/** 搜索走本地过滤：`adminCategories()` 本身就是 JS 过滤（分类是小目录，不必多一轮请求） */
const categoryRows = computed(() => {
  const keyword = categoryKeyword.value.trim().toLowerCase();
  if (!keyword) return categories.value;
  return categories.value.filter((item) => item.name.toLowerCase().includes(keyword));
});

async function loadCategories(): Promise<void> {
  categoriesLoading.value = true;
  error.value = "";
  try {
    const data = await adminApi<{ list: MarketCategoryRow[]; total: number }>("/ops/market/categories");
    categories.value = data.list;
  } catch (e) {
    categories.value = [];
    await fail(e, "adminMarket.loadFailed");
  } finally {
    categoriesLoading.value = false;
  }
}

function resetCategoryForm(): void {
  categoryEditingId.value = "";
  categoryForm.name = "";
  categoryForm.sort = 0;
}

function editCategory(row: MarketCategoryRow): void {
  categoryEditingId.value = row.id;
  categoryForm.name = row.name;
  categoryForm.sort = row.sort;
}

function saveCategory(): void {
  const name = categoryForm.name.trim();
  if (!name) {
    error.value = t("adminMarket.nameRequired");
    return;
  }
  const sort = Number(categoryForm.sort) || 0;
  const editing = categoryEditingId.value;
  void mutate(
    categoryBusy,
    editing || "create",
    () =>
      editing
        ? adminApi(`/ops/market/categories/${editing}`, { method: "PATCH", body: { name, sort } })
        : adminApi("/ops/market/categories", { method: "POST", body: { name, sort } }),
    async () => {
      resetCategoryForm();
      await loadCategories();
    },
  );
}

/**
 * 「删除」在这套接口里是**停用**（`DELETE` → `disableCategory`，status=2）：
 * 物理删会让历史作品的 `category_id` 变成悬空指针，所以按钮文案按状态机区分停用/启用。
 */
function toggleCategory(row: MarketCategoryRow): void {
  const disable = row.status === 1;
  if (disable && !window.confirm(t("adminMarket.confirmDisable", { name: row.name }))) return;
  void mutate(
    categoryBusy,
    row.id,
    () =>
      disable
        ? adminApi(`/ops/market/categories/${row.id}`, { method: "DELETE" })
        : adminApi(`/ops/market/categories/${row.id}`, { method: "PATCH", body: { status: 1 } }),
    loadCategories,
  );
}

// ── 标签 ──────────────────────────────────────────────────

const tags = ref<MarketTagRow[]>([]);
const tagsLoading = ref(false);
const tagKeyword = ref("");
const tagBusy = ref("");
const tagEditingId = ref("");
const tagForm = reactive({ name: "" });

const tagRows = computed(() => {
  const keyword = tagKeyword.value.trim().toLowerCase();
  if (!keyword) return tags.value;
  return tags.value.filter((item) => item.name.toLowerCase().includes(keyword));
});

async function loadTags(): Promise<void> {
  tagsLoading.value = true;
  error.value = "";
  try {
    const data = await adminApi<{ list: MarketTagRow[]; total: number }>("/ops/market/tags");
    tags.value = data.list;
  } catch (e) {
    tags.value = [];
    await fail(e, "adminMarket.loadFailed");
  } finally {
    tagsLoading.value = false;
  }
}

function resetTagForm(): void {
  tagEditingId.value = "";
  tagForm.name = "";
}

function editTag(row: MarketTagRow): void {
  tagEditingId.value = row.id;
  tagForm.name = row.name;
}

function saveTag(): void {
  const name = tagForm.name.trim();
  if (!name) {
    error.value = t("adminMarket.nameRequired");
    return;
  }
  const editing = tagEditingId.value;
  void mutate(
    tagBusy,
    editing || "create",
    () =>
      editing
        // 标签只有 name 可改（`market_tags` 就是一张名字表），故 PATCH 只带 name
        ? adminApi(`/ops/market/tags/${editing}`, { method: "PATCH", body: { name } })
        : adminApi("/ops/market/tags", { method: "POST", body: { name } }),
    async () => {
      resetTagForm();
      await loadTags();
    },
  );
}

/** 删标签是物理删 + 从所有作品 `tag_ids` 摘除（返回 affected_works），不可撤销 */
function removeTag(row: MarketTagRow): void {
  if (!window.confirm(t("adminMarket.confirmDelete", { name: row.name }))) return;
  void mutate(tagBusy, row.id, () => adminApi(`/ops/market/tags/${row.id}`, { method: "DELETE" }), loadTags);
}

// ── 推广位 ────────────────────────────────────────────────

const promotions = ref<PromotionRow[]>([]);
const promotionsLoading = ref(false);
const promotionBusy = ref("");
const promotionEditingId = ref("");
const promotionSlotFilter = ref("");
const promotionEnabledFilter = ref<"" | "1" | "2">("");
const promotionForm = reactive({
  slot: "market",
  title: "",
  image_uri: "",
  link_uri: "",
  sort: 0,
  starts_at: "",
  ends_at: "",
});

/**
 * 推广位列表（`GET /ops/market/promotions?slot=&enabled=`）。
 * `enabled` 是 1/2 的数值枚举（不是布尔），缺省 = 全部位、全部状态。
 */
async function loadPromotions(): Promise<void> {
  promotionsLoading.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams();
    const slot = promotionSlotFilter.value.trim();
    if (slot) query.set("slot", slot);
    if (promotionEnabledFilter.value) query.set("enabled", promotionEnabledFilter.value);
    const suffix = query.toString();
    const data = await adminApi<{ list: PromotionRow[]; total: number }>(
      `/ops/market/promotions${suffix ? `?${suffix}` : ""}`,
    );
    promotions.value = data.list;
  } catch (e) {
    promotions.value = [];
    await fail(e, "adminMarket.loadFailed");
  } finally {
    promotionsLoading.value = false;
  }
}

function resetPromotionForm(): void {
  promotionEditingId.value = "";
  promotionForm.slot = "market";
  promotionForm.title = "";
  promotionForm.image_uri = "";
  promotionForm.link_uri = "";
  promotionForm.sort = 0;
  promotionForm.starts_at = "";
  promotionForm.ends_at = "";
}

function editPromotion(row: PromotionRow): void {
  promotionEditingId.value = row.id;
  promotionForm.slot = row.slot;
  promotionForm.title = row.title;
  promotionForm.image_uri = row.image_uri ?? "";
  promotionForm.link_uri = row.link_uri ?? "";
  promotionForm.sort = row.sort;
  promotionForm.starts_at = toLocalInput(row.starts_at);
  promotionForm.ends_at = toLocalInput(row.ends_at);
}

function savePromotion(): void {
  const title = promotionForm.title.trim();
  if (!title) {
    error.value = t("adminMarket.nameRequired");
    return;
  }
  const slot = promotionForm.slot.trim() || "market";
  const sort = Number(promotionForm.sort) || 0;
  const starts = toIso(promotionForm.starts_at);
  const ends = toIso(promotionForm.ends_at);
  const editing = promotionEditingId.value;
  void mutate(
    promotionBusy,
    editing || "create",
    () =>
      editing
        ? // PATCH 的 `starts_at/ends_at` 可空：清空输入框 = 清掉投放窗口（不是"保持不变"）
          adminApi(`/ops/market/promotions/${editing}`, {
            method: "PATCH",
            body: {
              title,
              image_uri: promotionForm.image_uri.trim(),
              link_uri: promotionForm.link_uri.trim(),
              sort,
              starts_at: starts,
              ends_at: ends,
            },
          })
        : // 新建时 `promotionBody` 不接受 status（默认 1 启用）、也不接受 null 时间
          adminApi("/ops/market/promotions", {
            method: "POST",
            body: {
              slot,
              title,
              image_uri: promotionForm.image_uri.trim() || undefined,
              link_uri: promotionForm.link_uri.trim() || undefined,
              sort,
              ...(starts ? { starts_at: starts } : {}),
              ...(ends ? { ends_at: ends } : {}),
            },
          }),
    async () => {
      resetPromotionForm();
      await loadPromotions();
    },
  );
}

/** 停用 = `DELETE`（软停，保留曝光/点击与投放历史）；启用走 `PATCH {status:1}` */
function togglePromotion(row: PromotionRow): void {
  const disable = row.status === 1;
  if (disable && !window.confirm(t("adminMarket.confirmDisable", { name: row.title }))) return;
  void mutate(
    promotionBusy,
    row.id,
    () =>
      disable
        ? adminApi(`/ops/market/promotions/${row.id}`, { method: "DELETE" })
        : adminApi(`/ops/market/promotions/${row.id}`, { method: "PATCH", body: { status: 1 } }),
    loadPromotions,
  );
}

// ── 提现 ──────────────────────────────────────────────────

const WD_PAGE_SIZE = 20;

const withdrawals = ref<WithdrawalRow[]>([]);
const withdrawalTotal = ref(0);
const withdrawalPage = ref(1);
const withdrawalStatus = ref<"" | "1" | "2" | "3" | "4" | "5">("");
const withdrawalLoading = ref(false);
const withdrawalBusy = ref("");

const withdrawalPages = computed(() => Math.max(1, Math.ceil(withdrawalTotal.value / WD_PAGE_SIZE)));

async function loadWithdrawals(): Promise<void> {
  withdrawalLoading.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams({
      page: String(withdrawalPage.value),
      page_size: String(WD_PAGE_SIZE),
    });
    if (withdrawalStatus.value) query.set("status", withdrawalStatus.value);
    const data = await adminApi<Paged<WithdrawalRow>>(`/ops/market/withdrawals?${query.toString()}`);
    withdrawals.value = data.list;
    withdrawalTotal.value = data.total;
    withdrawalPage.value = data.page;
  } catch (e) {
    withdrawals.value = [];
    withdrawalTotal.value = 0;
    await fail(e, "adminMarket.loadFailed");
  } finally {
    withdrawalLoading.value = false;
  }
}

function goWithdrawalPage(page: number): void {
  withdrawalPage.value = Math.min(Math.max(1, page), withdrawalPages.value);
  void loadWithdrawals();
}

/** 只渲染服务端 `next_actions` 里运营真能点的动作：`cancel` 是用户侧动作，不在此面板 */
function withdrawalActions(row: WithdrawalRow): Array<"approved" | "rejected" | "payout"> {
  const actions: Array<"approved" | "rejected" | "payout"> = [];
  if (row.next_actions.includes("approve")) actions.push("approved");
  if (row.next_actions.includes("reject")) actions.push("rejected");
  if (row.next_actions.includes("payout")) actions.push("payout");
  return actions;
}

const WITHDRAW_ACTION_LABEL: Record<"approved" | "rejected" | "payout", string> = {
  approved: "adminMarket.approveWithdrawal",
  rejected: "adminMarket.rejectWithdrawal",
  payout: "adminMarket.payout",
};

const WITHDRAW_STATUS_LABEL: Record<number, string> = {
  1: "adminMarket.wdStatusPending",
  2: "adminMarket.wdStatusApproved",
  3: "adminMarket.wdStatusPaid",
  4: "adminMarket.wdStatusRejected",
  5: "adminMarket.wdStatusCancelled",
};

function withdrawalStatusName(row: WithdrawalRow): string {
  const key = WITHDRAW_STATUS_LABEL[row.status];
  return key ? t(key) : row.status_name;
}

/** 提现写操作的统一刷新：列表 + 看板（`pending_withdrawals.count/amount_credits` 会变） */
async function afterWithdrawal(): Promise<void> {
  await loadWithdrawals();
  await loadDashboard();
}

/**
 * 提现状态机（1 待审 → 2 已通过 → 3 已打款；1|2 → 4 已驳回），**不可跳步**。
 * 驳回必须给理由（后端会 400101 之外的路径没有理由字段可追溯）；
 * 打款只是回填渠道流水号——真实打款在支付宝/微信后台完成，系统不接资金通道。
 */
function runWithdrawalAction(row: WithdrawalRow, action: "approved" | "rejected" | "payout"): void {
  if (action === "payout") {
    const ref = window.prompt(t("adminMarket.payoutRefPrompt"));
    if (ref === null) return;
    void mutate(
      withdrawalBusy,
      row.id,
      () =>
        adminApi(`/ops/market/withdrawals/${row.id}/payout`, {
          method: "POST",
          body: { channel_refund_no: ref.trim() || undefined },
        }),
      afterWithdrawal,
    );
    return;
  }
  let note = "";
  if (action === "rejected") {
    const input = window.prompt(t("adminMarket.rejectReasonPrompt"));
    if (input === null) return;
    note = input.trim();
    if (!note) {
      error.value = t("adminMarket.rejectReasonRequired");
      return;
    }
  }
  void mutate(
    withdrawalBusy,
    row.id,
    () =>
      adminApi(`/ops/market/withdrawals/${row.id}/review`, {
        method: "POST",
        body: { result: action, ...(note ? { review_note: note } : {}) },
      }),
    afterWithdrawal,
  );
}

// ── 子页签切换：惰性加载（首屏只拉「待审」与「分类池」）──────────

function reloadCurrent(): void {
  switch (subtab.value) {
    case "review":
      void loadWorks();
      break;
    case "categories":
      void loadCategories();
      break;
    case "tags":
      void loadTags();
      break;
    case "promotions":
      void loadPromotions();
      break;
    case "withdrawals":
      void loadWithdrawals();
      break;
  }
}

watch(subtab, (next) => {
  error.value = "";
  // 每次切回都重拉：运营切页签的动机通常就是"刚改完，看最新值"
  switch (next) {
    case "review":
      void loadWorks();
      break;
    case "categories":
      void loadCategories();
      break;
    case "tags":
      void loadTags();
      break;
    case "promotions":
      void loadPromotions();
      break;
    case "withdrawals":
      void loadWithdrawals();
      break;
  }
});

onMounted(async () => {
  // 分类池同时被「审核通过时归类」的下拉框复用，所以首屏一起拉
  await Promise.all([loadDashboard(), loadWorks(), loadCategories()]);
});
</script>

<template>
  <section class="card market">
    <header class="panel-head">
      <h2>{{ t("adminMarket.title") }}</h2>
      <p class="muted small">{{ t("adminMarket.hint") }}</p>
    </header>

    <!-- ── 顶部看板（`GET /ops/market/dashboard/scripts`）──────────
         看板是"一眼看全局"的位置；状态 chip 直接当筛选器用（点「待审核」= 旧版的待审队列），
         这样运营不需要"先看数字再自己去下面选状态"走两遍。 -->
    <section class="dash">
      <header class="dash-head">
        <b>{{ t("adminMarket.dashTitle") }}</b>
        <span v-if="dashboardLoading" class="muted small">{{ t("adminMarket.loading") }}</span>
        <button type="button" class="mini" :disabled="dashboardLoading" @click="loadDashboard()">
          {{ t("adminMarket.retry") }}
        </button>
      </header>
      <template v-if="dashboard">
        <div class="dash-grid">
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashPendingReview") }}</span>
            <b>{{ dashboard.pending_review }}</b>
          </div>
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashAgreements") }}</span>
            <b>{{ dashboard.agreements }}</b>
          </div>
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashGross") }}</span>
            <b>{{ dashboard.gross_credits }}</b>
          </div>
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashCommission") }}</span>
            <b>{{ dashboard.commission_credits }}</b>
            <!-- commission_bps 是基点（1000 = 10%），比直接显示"1000"可读 -->
            <span class="muted small">{{ (dashboard.commission_bps / 100).toFixed(2) }}%</span>
          </div>
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashCreatorRevenue") }}</span>
            <b>{{ dashboard.creator_revenue_credits }}</b>
          </div>
          <div class="dash-card">
            <span class="muted small">{{ t("adminMarket.dashWdCount") }}</span>
            <b>{{ dashboard.pending_withdrawals.count }}</b>
            <span class="muted small">
              {{ t("adminMarket.dashWdAmount") }}: {{ dashboard.pending_withdrawals.amount_credits }}
            </span>
          </div>
        </div>
        <div class="dash-status">
          <span class="muted small">{{ t("adminMarket.dashWorksByStatus") }}</span>
          <button
            v-for="item in WORK_STATUS"
            :key="item.status"
            type="button"
            class="chip"
            :class="{ active: subtab === 'review' && reviewStatus === item.status }"
            :title="t('adminMarket.dashStatusFilterHint')"
            @click="selectWorkStatus(item.status)"
          >
            {{ t(item.key) }}<b>{{ dashCount(item.status) }}</b>
          </button>
        </div>
      </template>
      <p v-else-if="!dashboardLoading" class="muted small">{{ t("adminMarket.dashLoadFailed") }}</p>
    </section>

    <nav class="subtabs">
      <button
        v-for="tab in SUBTABS"
        :key="tab.key"
        type="button"
        class="subtab"
        :class="{ active: subtab === tab.key }"
        @click="subtab = tab.key"
      >
        {{ t(tab.labelKey) }}
      </button>
    </nav>

    <p v-if="error" class="err">
      {{ error }}
      <button type="button" class="mini" @click="reloadCurrent()">{{ t("adminMarket.retry") }}</button>
    </p>

    <!-- ── 剧本审核 ───────────────────────────────────── -->
    <template v-if="subtab === 'review'">
      <p class="muted small">{{ t("adminMarket.reviewHint") }}</p>
      <div class="filters">
        <!-- 没有"全部状态"：接口 status 缺省即"待审核"，见 reviewStatus 的注释 -->
        <select v-model.number="reviewStatus" class="input narrow" @change="selectWorkStatus(reviewStatus)">
          <option v-for="item in WORK_STATUS" :key="item.status" :value="item.status">{{ t(item.key) }}</option>
        </select>
        <button
          type="button"
          class="mini"
          :class="{ active: reviewStatus === 2 }"
          @click="selectWorkStatus(2)"
        >
          {{ t("adminMarket.pendingShortcut") }}
        </button>
        <input
          v-model="reviewKeyword"
          class="input"
          :placeholder="t('adminMarket.reviewKeyword')"
          maxlength="100"
          @keyup.enter="goReviewPage(1)"
        />
        <button type="button" class="mini" :disabled="reviewLoading" @click="goReviewPage(1)">
          {{ t("adminMarket.search") }}
        </button>
        <button type="button" class="mini" :disabled="reviewLoading" @click="resetReviewSearch()">
          {{ t("adminMarket.reset") }}
        </button>
        <span class="muted small">{{ t("adminMarket.totalN", { n: reviewTotal }) }}</span>
      </div>

      <!-- 详情优先于列表渲染：点开某一行后它就在上面，列表刷新时不会把视线顶走 -->
      <p v-if="detailLoading" class="muted small">{{ t("adminMarket.detailLoading") }}</p>
      <section v-else-if="reviewDetail" class="detail">
        <header class="detail-head">
          <b class="ellipsis">{{ reviewDetail.title }}</b>
          <span class="muted small">{{ t("adminMarket.detailTitle") }} · {{ workStatusName(reviewDetail) }}</span>
          <button type="button" class="mini" @click="closeDetail()">{{ t("adminMarket.detailClose") }}</button>
        </header>

        <div class="detail-grid">
          <span class="muted small">
            {{ t("adminMarket.colAuthor") }}:
            {{ reviewDetail.author.nickname || reviewDetail.author.user_id.slice(-6) }}
          </span>
          <span class="muted small">{{ t("adminMarket.colKind") }}: {{ reviewDetail.kind_name }}</span>
          <span class="muted small">{{ t("adminMarket.colPrice") }}: {{ reviewDetail.price_credits }}</span>
          <span class="muted small">
            {{ t("adminMarket.reviewAuditable") }}:
            {{ reviewDetail.review.auditable ? t("adminMarket.flagYes") : t("adminMarket.flagNo") }}
          </span>
          <span class="muted small">
            {{ t("adminMarket.reviewRejectedResubmit") }}:
            {{ reviewDetail.review.rejected_can_resubmit ? t("adminMarket.flagYes") : t("adminMarket.flagNo") }}
          </span>
          <span class="muted small ellipsis" :title="reviewDetail.review.last_audit_note ?? ''">
            {{ t("adminMarket.reviewLastNote") }}: {{ reviewDetail.review.last_audit_note || "-" }}
          </span>
        </div>

        <!-- counts 来自 novelCounts()：未关联本子的外部投稿会全是 0，这是真实值不是缺数据 -->
        <div class="detail-grid">
          <span class="muted small">{{ t("adminMarket.countsTitle") }}</span>
          <span class="muted small">{{ t("adminMarket.countChapters") }}: {{ reviewDetail.counts.chapters }}</span>
          <span class="muted small">{{ t("adminMarket.countCharacters") }}: {{ reviewDetail.counts.characters }}</span>
          <span class="muted small">{{ t("adminMarket.countEpisodes") }}: {{ reviewDetail.counts.episodes }}</span>
          <span class="muted small">{{ t("adminMarket.countWords") }}: {{ reviewDetail.counts.total_word_count }}</span>
        </div>

        <div v-if="reviewDetail.review.rejected_can_resubmit" class="detail-ops">
          <button
            type="button"
            class="mini"
            :disabled="detailBusy === reviewDetail.id || reviewDetail.price_credits <= 0"
            @click="resubmitWork(reviewDetail.id)"
          >
            {{ t("adminMarket.resubmit") }}
          </button>
          <span v-if="reviewDetail.price_credits <= 0" class="muted small">
            {{ t("adminMarket.resubmitBlocked") }}
          </span>
        </div>

        <h3 class="detail-sub">{{ t("adminMarket.reviewLogs") }}</h3>
        <p v-if="reviewDetail.review_logs.length === 0" class="muted small">{{ t("adminMarket.logEmpty") }}</p>
        <template v-else>
          <div class="row log-row head-row">
            <span>{{ t("adminMarket.logTime") }}</span>
            <span>{{ t("adminMarket.logAction") }}</span>
            <span>{{ t("adminMarket.logOperator") }}</span>
            <span>{{ t("adminMarket.logNote") }}</span>
          </div>
          <div v-for="log in reviewDetail.review_logs" :key="log.id" class="row log-row">
            <span class="muted">{{ formatTime(log.created_at) }}</span>
            <span>{{ reviewActionName(log) }}</span>
            <span class="muted">{{ reviewOperator(log) }}</span>
            <span class="muted ellipsis" :title="log.note ?? ''">{{ log.note || "-" }}</span>
          </div>
        </template>
      </section>

      <p v-if="reviewLoading" class="muted">{{ t("adminMarket.loading") }}</p>
      <p v-else-if="reviewRows.length === 0" class="muted">{{ t("adminMarket.empty") }}</p>
      <template v-else>
        <div class="row review-row head-row">
          <span>{{ t("adminMarket.colTitle") }}</span>
          <span>{{ t("adminMarket.colAuthor") }}</span>
          <span>{{ t("adminMarket.colKind") }}</span>
          <span>{{ t("adminMarket.colCategory") }}</span>
          <span>{{ t("adminMarket.colPrice") }}</span>
          <span>{{ t("adminMarket.colStatus") }}</span>
          <span>{{ t("adminMarket.colCreated") }}</span>
        </div>
        <div v-for="row in reviewRows" :key="row.id" class="review-item">
          <div class="row review-row">
            <span class="ellipsis" :title="row.summary">{{ row.title }}</span>
            <span class="muted">{{ row.author.nickname || row.author.user_id.slice(-6) }}</span>
            <span class="muted">{{ row.kind_name }}</span>
            <span class="muted">{{ categoryName(row.category_id) }}</span>
            <span class="muted">{{ row.price_credits }}</span>
            <span class="muted">{{ workStatusName(row) }}</span>
            <span class="muted">{{ formatTime(row.created_at) }}</span>
          </div>
          <div class="review-ops">
            <button type="button" class="mini" :disabled="detailLoading" @click="openDetail(row.id)">
              {{ t("adminMarket.openDetail") }}
            </button>
            <!-- 只有「待审核」能出结论：其它状态后端一律 400101，所以这里根本不渲染按钮 -->
            <template v-if="row.status === 2">
              <select v-model="reviewCategory[row.id]" class="input narrow" :title="t('adminMarket.assignCategory')">
                <option value="">{{ t("adminMarket.untouched") }}</option>
                <option v-for="item in activeCategories" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
              <input
                v-model="reviewNotes[row.id]"
                class="input"
                :placeholder="t('adminMarket.notePlaceholder')"
                maxlength="1000"
              />
              <button
                type="button"
                class="mini"
                :disabled="reviewBusy === row.id"
                @click="reviewWork(row, 'approved')"
              >
                {{ t("adminMarket.approve") }}
              </button>
              <button
                type="button"
                class="mini danger"
                :disabled="reviewBusy === row.id"
                @click="reviewWork(row, 'rejected')"
              >
                {{ t("adminMarket.reject") }}
              </button>
            </template>
            <!-- 重新提审按详情里的 rejected_can_resubmit 渲染：价格 ≤ 0 时后端会拒，故置灰 -->
            <button
              v-if="canResubmit(row)"
              type="button"
              class="mini"
              :disabled="detailBusy === row.id || row.price_credits <= 0"
              :title="row.price_credits <= 0 ? t('adminMarket.resubmitBlocked') : ''"
              @click="resubmitWork(row.id)"
            >
              {{ t("adminMarket.resubmit") }}
            </button>
          </div>
        </div>
      </template>

      <div v-if="reviewTotal > REVIEW_PAGE_SIZE" class="pager">
        <button type="button" class="mini" :disabled="reviewPage <= 1 || reviewLoading" @click="goReviewPage(reviewPage - 1)">
          {{ t("adminMarket.pagePrev") }}
        </button>
        <span class="muted small">{{ t("adminMarket.pageInfo", { page: reviewPage, pages: reviewPages }) }}</span>
        <button
          type="button"
          class="mini"
          :disabled="reviewPage >= reviewPages || reviewLoading"
          @click="goReviewPage(reviewPage + 1)"
        >
          {{ t("adminMarket.pageNext") }}
        </button>
      </div>
    </template>

    <!-- ── 分类 ───────────────────────────────────────── -->
    <template v-else-if="subtab === 'categories'">
      <p class="muted small">{{ t("adminMarket.categoriesHint") }}</p>
      <div class="filters">
        <input v-model="categoryForm.name" class="input" :placeholder="t('adminMarket.catNamePlaceholder')" maxlength="40" />
        <input
          v-model.number="categoryForm.sort"
          class="input narrow"
          type="number"
          min="0"
          max="9999"
          :placeholder="t('adminMarket.sortPlaceholder')"
        />
        <button type="button" class="mini" :disabled="!!categoryBusy" @click="saveCategory()">
          {{ categoryEditingId ? t("adminMarket.saveCategory") : t("adminMarket.createCategory") }}
        </button>
        <button v-if="categoryEditingId" type="button" class="mini" @click="resetCategoryForm()">
          {{ t("adminMarket.cancelEdit") }}
        </button>
        <input v-model="categoryKeyword" class="input" :placeholder="t('adminMarket.search')" maxlength="40" />
      </div>

      <p v-if="categoriesLoading" class="muted">{{ t("adminMarket.loading") }}</p>
      <p v-else-if="categoryRows.length === 0" class="muted">{{ t("adminMarket.empty") }}</p>
      <template v-else>
        <div class="row cat-row head-row">
          <span>{{ t("adminMarket.colName") }}</span>
          <span>{{ t("adminMarket.colSort") }}</span>
          <span>{{ t("adminMarket.colStatus") }}</span>
          <span>{{ t("adminMarket.colOps") }}</span>
        </div>
        <div v-for="row in categoryRows" :key="row.id" class="row cat-row">
          <span>{{ row.name }}</span>
          <span class="muted">{{ row.sort }}</span>
          <span :class="row.status === 1 ? 'state-on' : 'state-off'">
            {{ row.status === 1 ? t("adminMarket.statusOn") : t("adminMarket.statusOff") }}
          </span>
          <span class="ops">
            <button type="button" class="mini" :disabled="categoryBusy === row.id" @click="editCategory(row)">
              {{ t("adminMarket.edit") }}
            </button>
            <button type="button" class="mini" :disabled="categoryBusy === row.id" @click="toggleCategory(row)">
              {{ row.status === 1 ? t("adminMarket.disable") : t("adminMarket.enable") }}
            </button>
          </span>
        </div>
      </template>
    </template>

    <!-- ── 标签 ───────────────────────────────────────── -->
    <template v-else-if="subtab === 'tags'">
      <p class="muted small">{{ t("adminMarket.tagsHint") }}</p>
      <div class="filters">
        <input v-model="tagForm.name" class="input" :placeholder="t('adminMarket.tagNamePlaceholder')" maxlength="40" />
        <button type="button" class="mini" :disabled="!!tagBusy" @click="saveTag()">
          {{ tagEditingId ? t("adminMarket.saveTag") : t("adminMarket.createTag") }}
        </button>
        <button v-if="tagEditingId" type="button" class="mini" @click="resetTagForm()">
          {{ t("adminMarket.cancelEdit") }}
        </button>
        <input v-model="tagKeyword" class="input" :placeholder="t('adminMarket.search')" maxlength="40" />
      </div>

      <p v-if="tagsLoading" class="muted">{{ t("adminMarket.loading") }}</p>
      <p v-else-if="tagRows.length === 0" class="muted">{{ t("adminMarket.empty") }}</p>
      <template v-else>
        <div class="row tag-row head-row">
          <span>{{ t("adminMarket.colName") }}</span>
          <span>{{ t("adminMarket.colOps") }}</span>
        </div>
        <div v-for="row in tagRows" :key="row.id" class="row tag-row">
          <span>{{ row.name }}</span>
          <span class="ops">
            <button type="button" class="mini" :disabled="tagBusy === row.id" @click="editTag(row)">
              {{ t("adminMarket.edit") }}
            </button>
            <button type="button" class="mini danger" :disabled="tagBusy === row.id" @click="removeTag(row)">
              {{ t("adminMarket.delete") }}
            </button>
          </span>
        </div>
      </template>
    </template>

    <!-- ── 推广位 ─────────────────────────────────────── -->
    <template v-else-if="subtab === 'promotions'">
      <p class="muted small">{{ t("adminMarket.promotionsHint") }}</p>
      <div class="filters">
        <input v-model="promotionSlotFilter" class="input narrow" :placeholder="t('adminMarket.slotPlaceholder')" maxlength="32" />
        <select v-model="promotionEnabledFilter" class="input narrow" @change="loadPromotions()">
          <option value="">{{ t("adminMarket.wdFilterAll") }}</option>
          <option value="1">{{ t("adminMarket.statusOn") }}</option>
          <option value="2">{{ t("adminMarket.statusOff") }}</option>
        </select>
        <button type="button" class="mini" :disabled="promotionsLoading" @click="loadPromotions()">
          {{ t("adminMarket.search") }}
        </button>
      </div>

      <div class="filters">
        <input
          v-model="promotionForm.slot"
          class="input narrow"
          :placeholder="t('adminMarket.slotPlaceholder')"
          :disabled="!!promotionEditingId"
          maxlength="32"
        />
        <input v-model="promotionForm.title" class="input" :placeholder="t('adminMarket.colTitle')" maxlength="120" />
        <input v-model="promotionForm.image_uri" class="input" :placeholder="t('adminMarket.imagePlaceholder')" maxlength="2048" />
        <input v-model="promotionForm.link_uri" class="input" :placeholder="t('adminMarket.linkPlaceholder')" maxlength="2048" />
        <input
          v-model.number="promotionForm.sort"
          class="input narrow"
          type="number"
          min="0"
          max="9999"
          :placeholder="t('adminMarket.sortPlaceholder')"
        />
        <input v-model="promotionForm.starts_at" class="input" type="datetime-local" :title="t('adminMarket.startsPlaceholder')" />
        <input v-model="promotionForm.ends_at" class="input" type="datetime-local" :title="t('adminMarket.endsPlaceholder')" />
        <button type="button" class="mini" :disabled="!!promotionBusy" @click="savePromotion()">
          {{ promotionEditingId ? t("adminMarket.savePromotion") : t("adminMarket.createPromotion") }}
        </button>
        <button v-if="promotionEditingId" type="button" class="mini" @click="resetPromotionForm()">
          {{ t("adminMarket.cancelEdit") }}
        </button>
      </div>
      <p v-if="promotionEditingId" class="muted small">{{ t("adminMarket.slotLocked") }}</p>

      <p v-if="promotionsLoading" class="muted">{{ t("adminMarket.loading") }}</p>
      <p v-else-if="promotions.length === 0" class="muted">{{ t("adminMarket.empty") }}</p>
      <template v-else>
        <div class="row promo-row head-row">
          <span>{{ t("adminMarket.colSlot") }}</span>
          <span>{{ t("adminMarket.colTitle") }}</span>
          <span>{{ t("adminMarket.colSort") }}</span>
          <span>{{ t("adminMarket.colWindow") }}</span>
          <span>{{ t("adminMarket.colStats") }}</span>
          <span>{{ t("adminMarket.colStatus") }}</span>
          <span>{{ t("adminMarket.colOps") }}</span>
        </div>
        <div v-for="row in promotions" :key="row.id" class="row promo-row">
          <span class="mono">{{ row.slot }}</span>
          <span class="ellipsis">{{ row.title }}</span>
          <span class="muted">{{ row.sort }}</span>
          <span class="muted small">
            {{ row.starts_at ? formatTime(row.starts_at) : t("adminMarket.unlimited") }}
            →
            {{ row.ends_at ? formatTime(row.ends_at) : t("adminMarket.unlimited") }}
          </span>
          <span class="muted">{{ row.view_count }}/{{ row.click_count }}</span>
          <span :class="row.status === 1 ? 'state-on' : 'state-off'">
            {{ row.status === 1 ? t("adminMarket.statusOn") : t("adminMarket.statusOff") }}
          </span>
          <span class="ops">
            <button type="button" class="mini" :disabled="promotionBusy === row.id" @click="editPromotion(row)">
              {{ t("adminMarket.edit") }}
            </button>
            <button type="button" class="mini" :disabled="promotionBusy === row.id" @click="togglePromotion(row)">
              {{ row.status === 1 ? t("adminMarket.disable") : t("adminMarket.enable") }}
            </button>
          </span>
        </div>
      </template>
    </template>

    <!-- ── 提现 ───────────────────────────────────────── -->
    <template v-else-if="subtab === 'withdrawals'">
      <p class="muted small">{{ t("adminMarket.withdrawalsHint") }}</p>
      <div class="filters">
        <select v-model="withdrawalStatus" class="input narrow" @change="goWithdrawalPage(1)">
          <option value="">{{ t("adminMarket.wdFilterAll") }}</option>
          <option value="1">{{ t("adminMarket.wdStatusPending") }}</option>
          <option value="2">{{ t("adminMarket.wdStatusApproved") }}</option>
          <option value="3">{{ t("adminMarket.wdStatusPaid") }}</option>
          <option value="4">{{ t("adminMarket.wdStatusRejected") }}</option>
          <option value="5">{{ t("adminMarket.wdStatusCancelled") }}</option>
        </select>
        <span class="muted small">{{ t("adminMarket.totalN", { n: withdrawalTotal }) }}</span>
      </div>

      <p v-if="withdrawalLoading" class="muted">{{ t("adminMarket.loading") }}</p>
      <p v-else-if="withdrawals.length === 0" class="muted">{{ t("adminMarket.empty") }}</p>
      <template v-else>
        <div class="row wd-row head-row">
          <span>{{ t("adminMarket.colUser") }}</span>
          <span>{{ t("adminMarket.colAmount") }}</span>
          <span>{{ t("adminMarket.colChannel") }}</span>
          <span>{{ t("adminMarket.colAccount") }}</span>
          <span>{{ t("adminMarket.colStatus") }}</span>
          <span>{{ t("adminMarket.colCreated") }}</span>
          <span>{{ t("adminMarket.colOps") }}</span>
        </div>
        <div v-for="row in withdrawals" :key="row.id" class="row wd-row">
          <span class="muted">{{ row.user_nickname || row.user_id.slice(-6) }}</span>
          <span>{{ row.amount_credits }}</span>
          <span class="muted">{{ row.channel }}</span>
          <span class="muted small ellipsis" :title="accountBrief(row.account_info)">
            {{ accountBrief(row.account_info) || "-" }}
          </span>
          <span class="muted" :title="row.review_note ?? ''">{{ withdrawalStatusName(row) }}</span>
          <span class="muted">{{ formatTime(row.created_at) }}</span>
          <span class="ops">
            <template v-for="action in withdrawalActions(row)" :key="action">
              <button
                type="button"
                class="mini"
                :class="{ danger: action === 'rejected' }"
                :disabled="withdrawalBusy === row.id"
                @click="runWithdrawalAction(row, action)"
              >
                {{ t(WITHDRAW_ACTION_LABEL[action]) }}
              </button>
            </template>
            <span v-if="withdrawalActions(row).length === 0" class="muted small">-</span>
          </span>
        </div>
      </template>

      <div v-if="withdrawalTotal > WD_PAGE_SIZE" class="pager">
        <button
          type="button"
          class="mini"
          :disabled="withdrawalPage <= 1 || withdrawalLoading"
          @click="goWithdrawalPage(withdrawalPage - 1)"
        >
          {{ t("adminMarket.pagePrev") }}
        </button>
        <span class="muted small">{{ t("adminMarket.pageInfo", { page: withdrawalPage, pages: withdrawalPages }) }}</span>
        <button
          type="button"
          class="mini"
          :disabled="withdrawalPage >= withdrawalPages || withdrawalLoading"
          @click="goWithdrawalPage(withdrawalPage + 1)"
        >
          {{ t("adminMarket.pageNext") }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* 样式骨架照现状 `pages/admin/index.vue` 的 .card/.row/.mini/.input 复制（scoped，不新增全局样式） */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel-head h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
.subtabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.subtab {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  color: var(--text-2);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.subtab.active {
  border-color: var(--brand-500);
  color: var(--text-1);
}
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 6px 10px;
  font-size: 12px;
  min-width: 140px;
}
.input.narrow {
  min-width: 96px;
  max-width: 140px;
}
.mini {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mini.danger {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.row {
  display: grid;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
}
.review-row {
  grid-template-columns: 2fr 1fr 0.8fr 1fr 0.7fr 0.8fr 1.2fr;
}
.cat-row {
  grid-template-columns: 2fr 0.6fr 0.8fr 1.2fr;
}
.tag-row {
  grid-template-columns: 3fr 1.4fr;
}
.promo-row {
  grid-template-columns: 0.8fr 2fr 0.5fr 1.6fr 0.9fr 0.7fr 1.2fr;
}
.wd-row {
  grid-template-columns: 1fr 0.8fr 0.8fr 1.6fr 0.8fr 1.2fr 1.6fr;
}
.review-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--border-1);
  padding-bottom: 8px;
}
/* ── 看板（`dashboard/scripts`）────────────────────────────── */
.dash {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg, var(--radius-md));
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-surface);
}
.dash-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dash-head b {
  font-size: 13px;
}
.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.dash-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 8px 10px;
}
.dash-card b {
  font-size: 18px;
}
.dash-status {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
/* 状态 chip 同时是筛选器：计数来自看板，点一下就切到该状态的列表 */
.chip {
  background: none;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  color: var(--text-2);
  font-size: 11px;
  padding: 3px 10px;
  cursor: pointer;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.chip.active {
  border-color: var(--brand-500);
  color: var(--text-1);
}
.chip b {
  color: var(--text-1);
}
/* ── 作品详情（`scripts/:id`）─────────────────────────────── */
.detail {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-surface);
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.detail-head b {
  font-size: 13px;
  max-width: 420px;
}
.detail-head .mini {
  margin-left: auto;
}
.detail-grid {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.detail-ops {
  display: flex;
  gap: 10px;
  align-items: center;
}
.detail-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-2);
}
.log-row {
  grid-template-columns: 1.4fr 0.8fr 1.1fr 2fr;
}
.review-ops {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.review-ops .input:not(.narrow) {
  flex: 1;
  min-width: 220px;
}
.ops {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.pager {
  display: flex;
  gap: 10px;
  align-items: center;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, monospace;
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: 11px;
}
.err {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.state-on {
  color: #4ade80;
}
.state-off {
  color: var(--text-3);
}
@media (max-width: 980px) {
  .review-row,
  .promo-row,
  .wd-row,
  .cat-row,
  .tag-row,
  .log-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
