<script setup lang="ts">
/**
 * 价格管理面板（PRD F8 / api-spec §11）。
 *
 * 为什么独立成组件而不是塞进 `pages/admin/index.vue`：定价是运营改得最频繁的一屏
 * （模型目录一加档位就要补价目），而 index.vue 已经近千行；这里自己拉数据、自己管
 * 分页与错误，写操作只刷新自己，不会牵动概览/任务的请求。
 *
 * 计价规则（后端 `model_prices`）：唯一键是 (model_id, mode, resolution, duration_s)。
 * `resolution = "per_call"` 是**按次计价的哨兵值**，不是画质档；`duration_s IS NULL`
 * 同样表示按次。运营把 per_call 当成分辨率去配，会造出"一调用就找不到价"的档位，
 * 所以这里在表格里把它显示成「按次」而不是原样吐出字符串。
 *
 * 类型在本文件内定义（不改 `types/api.ts`）：契约 §2.3-2.5 的字段还在 api-core 并行
 * 施工中，本地定义 + 可选字段能让前端先落地，后端字段到位后自动显示、无需再改。
 */
import { adminApi, isAdminAuthError } from "~/composables/useAdminApi";

/** `models.modes` 里单个 mode 的档位声明（只取本面板用得到的三项） */
interface AdminModelModeConfig {
  resolution_options?: Array<{ value: string; label?: string }>;
  durations?: number[];
  default_resolution?: string;
  default_duration?: number;
}

interface AdminModel {
  id: string;
  name: string;
  display_name: string;
  /** 契约 §2.1 新增；老后端不返回时按"没有档位声明"处理 */
  modes?: Record<string, AdminModelModeConfig> | null;
}

interface AdminPriceRow {
  id: string;
  model_id: string;
  /** 契约 §2.3 新增（join models.name）；未上线时回退到本地模型表 */
  model_name?: string | null;
  mode: string;
  resolution: string;
  duration_s: number | null;
  credits: number;
  strike_credits: number | null;
  member_credits: number | null;
  time_limited_credits: number | null;
  /** 契约 §2.3 新增；缺省按"启用"处理，不能让老后端把整表误显示成停用 */
  active?: boolean;
  /** 契约 §2.3 新增 */
  updated_at?: string | null;
}

interface AdminPriceList {
  list: AdminPriceRow[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * 行内编辑草稿：金额一律存字符串。
 *
 * 为什么不用 `v-model.number`：输入框被清空时`.number` 会得到 `""`（NaN 回退原值），
 * 类型变成 `number | ""`，每个使用点都要断言；存字符串则"空 = 未设置"的语义统一，
 * 保存时集中用 `parseIntInput` 校验一次。
 */
interface PriceDraft {
  credits: string;
  strike: string;
  member: string;
  timeLimited: string;
  active: boolean;
}

interface PriceRowVm extends AdminPriceRow {
  draft: PriceDraft;
}

/** PATCH body：字段名是 camelCase（后端 pricePatchSchema），不是列表里的 snake_case */
interface PricePatchBody {
  credits?: number;
  strikeCredits?: number;
  memberCredits?: number | null;
  timeLimitedCredits?: number | null;
  active?: boolean;
}

/** POST body：同上，snake_case 只有 model_id/mode/resolution/duration_s */
interface PriceCreateBody {
  model_id: string;
  mode: string;
  resolution: string;
  duration_s: number | null;
  credits: number;
  strikeCredits?: number;
  memberCredits: number | null;
  timeLimitedCredits: number | null;
}

const { t } = useI18n();

const models = ref<AdminModel[]>([]);
const rows = ref<PriceRowVm[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const filterModel = ref("");
const filterActive = ref<"all" | "1" | "0">("all");
const loading = ref(false);
/** 写操作 busy：行 id 或 "create"——用字符串而非布尔，才能只禁用正在保存的那一行 */
const busy = ref("");
const error = ref("");
const ok = ref("");

/** 401101/403101 已经在回登录页：拦住后续请求，避免连续 401 把错误行刷成一片 */
let redirecting = false;

async function handleError(e: unknown, fallback: string): Promise<void> {
  if (isAdminAuthError(e)) {
    if (redirecting) return;
    redirecting = true;
    await adminLogout();
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  error.value = e instanceof Error && e.message ? e.message : fallback;
}

function modelDisplay(model: AdminModel): string {
  return model.display_name || model.name || model.id;
}

/** 模型列：优先用后端 join 的 model_name，缺失时回退本地模型表，再回退 id */
function modelLabel(row: AdminPriceRow): string {
  const joined = row.model_name?.trim();
  if (joined) return joined;
  const matched = models.value.find((item) => item.id === row.model_id);
  return matched ? modelDisplay(matched) : t("adminPrices.unknownModel");
}

function resolutionLabel(value: string): string {
  if (!value) return t("adminPrices.unset");
  return value === "per_call" ? t("adminPrices.perCall") : value;
}

function durationLabel(value: number | null): string {
  return value === null ? t("adminPrices.perCall") : `${value}s`;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return t("adminPrices.unset");
  const date = new Date(value);
  // 坏值不渲染 "Invalid Date"：那看起来像前端崩了，反而掩盖了后端字段问题
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isActive(row: AdminPriceRow): boolean {
  return row.active !== false;
}

function toRowVm(row: AdminPriceRow): PriceRowVm {
  return {
    ...row,
    draft: {
      credits: String(row.credits),
      strike: row.strike_credits === null ? "" : String(row.strike_credits),
      member: row.member_credits === null ? "" : String(row.member_credits),
      timeLimited: row.time_limited_credits === null ? "" : String(row.time_limited_credits),
      active: row.active !== false,
    },
  };
}

/**
 * 解析数字输入：空串 → null（= 未设置），负数/小数/NaN → 抛本地错误。
 * 为什么不直接把字符串丢给后端：zod 会回一句英文 `Expected number, received string`，
 * 运营看不懂也不知道是哪一格；这里当场指出字段名。
 *
 * 入参可能是 **number**：`<input type="number">` 的 `v-model` 由 Vue 自动
 * looseToNumber，填了数就不再是字符串。按 string 调 `.trim()` 会抛
 * "…trim is not a function" —— 与 `AdminInviteCodesPanel` 同一类缺陷（第 107 批：
 * 运营后台 E2E 在邀请码「生成」上先踩到，价格编辑/新建是同一条路径）。
 */
function parseIntInput(raw: string | number, field: string): number | null {
  const text = String(raw).trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(t("adminPrices.errNumber", { field }));
  }
  return value;
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const pageInfo = computed(() =>
  t("adminPrices.pageInfo", { page: page.value, pages: totalPages.value, total: total.value }),
);

async function loadModels(): Promise<void> {
  try {
    models.value = await adminApi<AdminModel[]>("/ops/admin/models");
  } catch (e) {
    models.value = [];
    await handleError(e, t("adminPrices.errorModels"));
  }
}

async function loadPrices(): Promise<void> {
  if (redirecting) return;
  loading.value = true;
  try {
    const query = new URLSearchParams();
    query.set("page", String(page.value));
    query.set("page_size", String(pageSize.value));
    if (filterModel.value) query.set("model_id", filterModel.value);
    // active 用 1/0 传（契约 §2.3），不是 true/false 字符串
    if (filterActive.value !== "all") query.set("active", filterActive.value);
    const data = await adminApi<AdminPriceList>(`/ops/admin/model-prices?${query.toString()}`);
    total.value = data.total;
    rows.value = data.list.map(toRowVm);
    // 删掉最后一页的最后一条后，服务端会回一个空页；自动退一页，免得运营以为数据没了
    if (data.list.length === 0 && data.total > 0 && page.value > 1) {
      page.value = Math.max(1, Math.ceil(data.total / pageSize.value));
    }
  } catch (e) {
    rows.value = [];
    await handleError(e, t("adminPrices.errorLoad"));
  } finally {
    loading.value = false;
  }
}

async function refreshAll(): Promise<void> {
  error.value = "";
  await loadModels();
  await loadPrices();
}

/** 筛选变化一律回第 1 页：留在第 3 页配新筛选只会命中空页，看起来像"没数据" */
function onFilterChanged(): void {
  if (page.value === 1) void loadPrices();
  else page.value = 1;
}

// 筛选/页容量变化手动触发：用 watch 而不是 @change，因为"刷新"按钮与新建后也需要同一套拉取逻辑
watch([filterModel, filterActive, pageSize], () => onFilterChanged());
// 翻页只管拉当前页（不重置页码，否则上一页/下一页永远停在 1）
watch(page, () => void loadPrices());

function goPrev(): void {
  if (page.value > 1) page.value -= 1;
}

function goNext(): void {
  if (page.value < totalPages.value) page.value += 1;
}

// ── 行内编辑 ────────────────────────────────────────────────

async function saveRow(row: PriceRowVm): Promise<void> {
  error.value = "";
  ok.value = "";
  const body: PricePatchBody = {};
  try {
    const credits = parseIntInput(row.draft.credits, t("adminPrices.thCredits"));
    if (credits === null) {
      error.value = t("adminPrices.errCredits");
      return;
    }
    const strike = parseIntInput(row.draft.strike, t("adminPrices.thStrike"));
    const member = parseIntInput(row.draft.member, t("adminPrices.thMember"));
    const timeLimited = parseIntInput(row.draft.timeLimited, t("adminPrices.thTimeLimited"));

    if (credits !== row.credits) body.credits = credits;
    if (strike !== row.strike_credits) {
      // 后端 PATCH 的 strikeCredits 只接受非负整数（不接受 null），"清空划线价"在接口上
      // 无法表达；明确报错让运营填 0，而不是静默丢掉他的清空动作。
      if (strike === null) {
        error.value = t("adminPrices.errStrikeEmpty");
        return;
      }
      body.strikeCredits = strike;
    }
    // member/timeLimited 可空：空输入 = 显式清空（后端接受 null）
    if (member !== row.member_credits) body.memberCredits = member;
    if (timeLimited !== row.time_limited_credits) body.timeLimitedCredits = timeLimited;
    if (row.draft.active !== isActive(row)) body.active = row.draft.active;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminPrices.errNumber", { field: "" });
    return;
  }

  // 只传改动的字段：全量 PATCH 会把并发改价的另一个运营的改动覆盖回旧值
  if (Object.keys(body).length === 0) {
    ok.value = t("adminPrices.noChanges");
    return;
  }

  busy.value = row.id;
  try {
    await adminApi<unknown>(`/ops/admin/model-prices/${row.id}`, { method: "PATCH", body });
    ok.value = t("adminPrices.saved");
    await loadPrices();
  } catch (e) {
    await handleError(e, t("adminPrices.errSaveFailed"));
  } finally {
    busy.value = "";
  }
}

async function removeTier(row: PriceRowVm): Promise<void> {
  const name = `${modelLabel(row)} / ${row.mode} / ${resolutionLabel(row.resolution)} / ${durationLabel(row.duration_s)}`;
  if (!window.confirm(t("adminPrices.deleteConfirm", { name }))) return;
  error.value = "";
  ok.value = "";
  busy.value = row.id;
  try {
    await adminApi<unknown>(`/ops/admin/model-prices/${row.id}`, { method: "DELETE" });
    ok.value = t("adminPrices.deleted");
    await loadPrices();
  } catch (e) {
    await handleError(e, t("adminPrices.errDeleteFailed"));
  } finally {
    busy.value = "";
  }
}

// ── 新建档位 ────────────────────────────────────────────────
//
// 档位候选全部来自 `models.modes`（后端 createPrice 会用同一份数据再校验一次）：
// 这样运营不可能在这里选出"模型目录里不存在"的组合——那种行落库后一调用就失败。

const createForm = reactive({
  model_id: "",
  mode: "",
  resolution: "per_call",
  /** 空串 = 按次（发 POST 时转 null；后端按次计价不允许带 duration_s） */
  duration_s: "",
  credits: "",
  strike: "",
  member: "",
  timeLimited: "",
});

const selectedModel = computed<AdminModel | null>(
  () => models.value.find((item) => item.id === createForm.model_id) ?? null,
);
const modeKeys = computed<string[]>(() => Object.keys(selectedModel.value?.modes ?? {}));
const selectedModeConfig = computed<AdminModelModeConfig | null>(
  () => selectedModel.value?.modes?.[createForm.mode] ?? null,
);
const resolutionOptions = computed<Array<{ value: string; label: string }>>(() => {
  const options = selectedModeConfig.value?.resolution_options ?? [];
  // 没声明分辨率档 → 按次计价，用 per_call 哨兵（传空串会被当成"没选"）
  if (options.length === 0) return [{ value: "per_call", label: t("adminPrices.perCall") }];
  return options.map((item) => ({ value: item.value, label: item.label || item.value }));
});
const durationOptions = computed<number[]>(() => selectedModeConfig.value?.durations ?? []);

watch(
  () => createForm.model_id,
  () => {
    // 换模型后旧 mode 一定不存在于新模型目录，必须重选第一个，否则 POST 会被后端拒
    createForm.mode = Object.keys(selectedModel.value?.modes ?? {})[0] ?? "";
  },
);

watch(
  () => createForm.mode,
  () => {
    const config = selectedModeConfig.value;
    const options = resolutionOptions.value;
    const preferred = config?.default_resolution ?? "";
    createForm.resolution = options.some((item) => item.value === preferred)
      ? preferred
      : (options[0]?.value ?? "per_call");

    const durations = durationOptions.value;
    if (durations.length === 0) {
      // 按次计价模式带上 duration_s 会被后端拒（"per call, duration_s must be null"）
      createForm.duration_s = "";
      return;
    }
    const preferredDuration = config?.default_duration;
    const picked =
      preferredDuration !== undefined && durations.includes(preferredDuration)
        ? preferredDuration
        : durations[0];
    createForm.duration_s = String(picked ?? "");
  },
);

async function createTier(): Promise<void> {
  error.value = "";
  ok.value = "";
  if (!createForm.model_id) {
    error.value = t("adminPrices.pickModel");
    return;
  }
  if (!createForm.mode) {
    error.value = t("adminPrices.noModes");
    return;
  }
  let credits: number | null;
  let strike: number | null;
  let member: number | null;
  let timeLimited: number | null;
  try {
    credits = parseIntInput(createForm.credits, t("adminPrices.thCredits"));
    strike = parseIntInput(createForm.strike, t("adminPrices.thStrike"));
    member = parseIntInput(createForm.member, t("adminPrices.thMember"));
    timeLimited = parseIntInput(createForm.timeLimited, t("adminPrices.thTimeLimited"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminPrices.errNumber", { field: "" });
    return;
  }
  if (credits === null) {
    error.value = t("adminPrices.errCredits");
    return;
  }
  const body: PriceCreateBody = {
    model_id: createForm.model_id,
    mode: createForm.mode,
    resolution: createForm.resolution || "per_call",
    duration_s: createForm.duration_s === "" ? null : Number(createForm.duration_s),
    credits,
    ...(strike === null ? {} : { strikeCredits: strike }),
    memberCredits: member,
    timeLimitedCredits: timeLimited,
  };
  busy.value = "create";
  try {
    await adminApi<unknown>("/ops/admin/model-prices", { method: "POST", body });
    createForm.credits = "";
    createForm.strike = "";
    createForm.member = "";
    createForm.timeLimited = "";
    ok.value = t("adminPrices.created");
    // 新建的档位按 (model_id, mode) 排序，很可能落在首页之外：回第 1 页让运营看到结果
    if (page.value === 1) await loadPrices();
    else page.value = 1;
  } catch (e) {
    await handleError(e, t("adminPrices.errCreateFailed"));
  } finally {
    busy.value = "";
  }
}

onMounted(async () => {
  await loadModels();
  // 模型列表回来后再选中第一个：createForm 的 mode/resolution/duration 联动依赖它
  if (!createForm.model_id) createForm.model_id = models.value[0]?.id ?? "";
  await loadPrices();
});
</script>

<template>
  <section class="card">
    <header class="head">
      <h2>{{ t("adminPrices.title") }}</h2>
      <p class="muted small">{{ t("adminPrices.hint") }}</p>
    </header>

    <div class="filters">
      <select v-model="filterModel" class="input" :aria-label="t('adminPrices.filterModel')">
        <option value="">{{ t("adminPrices.allModels") }}</option>
        <option v-for="model in models" :key="model.id" :value="model.id">
          {{ modelDisplay(model) }}
        </option>
      </select>

      <select v-model="filterActive" class="input" :aria-label="t('adminPrices.filterStatus')">
        <option value="all">{{ t("adminPrices.statusAll") }}</option>
        <option value="1">{{ t("adminPrices.statusActive") }}</option>
        <option value="0">{{ t("adminPrices.statusInactive") }}</option>
      </select>

      <select v-model.number="pageSize" class="input narrow" :aria-label="t('adminPrices.pageSize')">
        <option :value="20">20</option>
        <option :value="50">50</option>
      </select>

      <button class="mini" :disabled="loading" @click="refreshAll()">{{ t("adminPrices.refresh") }}</button>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="ok" class="banner ok">{{ ok }}</p>

    <!-- 新建档位：档位候选来自模型目录，金额自己填 -->
    <div class="create">
      <h3>{{ t("adminPrices.createTitle") }}</h3>
      <p class="muted small">{{ t("adminPrices.createHint") }}</p>
      <div class="create-form">
        <select v-model="createForm.model_id" class="input" :aria-label="t('adminPrices.createTitle')">
          <option v-if="models.length === 0" value="">{{ t("adminPrices.pickModel") }}</option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ modelDisplay(model) }}
          </option>
        </select>

        <select v-model="createForm.mode" class="input" :disabled="modeKeys.length === 0">
          <option v-if="modeKeys.length === 0" value="">{{ t("adminPrices.noModes") }}</option>
          <option v-for="modeKey in modeKeys" :key="modeKey" :value="modeKey">{{ modeKey }}</option>
        </select>

        <select v-model="createForm.resolution" class="input">
          <option v-for="option in resolutionOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <select v-model="createForm.duration_s" class="input narrow" :disabled="durationOptions.length === 0">
          <option v-if="durationOptions.length === 0" value="">{{ t("adminPrices.perCall") }}</option>
          <option v-for="seconds in durationOptions" :key="seconds" :value="String(seconds)">{{ seconds }}s</option>
        </select>

        <input
          v-model="createForm.credits"
          class="input narrow"
          type="number"
          min="0"
          step="1"
          :placeholder="t('adminPrices.thCredits')"
          :aria-label="t('adminPrices.thCredits')"
        />
        <input
          v-model="createForm.strike"
          class="input narrow"
          type="number"
          min="0"
          step="1"
          :placeholder="t('adminPrices.thStrike')"
          :aria-label="t('adminPrices.thStrike')"
        />
        <input
          v-model="createForm.member"
          class="input narrow"
          type="number"
          min="0"
          step="1"
          :placeholder="t('adminPrices.thMember')"
          :aria-label="t('adminPrices.thMember')"
        />
        <input
          v-model="createForm.timeLimited"
          class="input narrow"
          type="number"
          min="0"
          step="1"
          :placeholder="t('adminPrices.thTimeLimited')"
          :aria-label="t('adminPrices.thTimeLimited')"
        />

        <button class="mini primary" :disabled="busy === 'create' || modeKeys.length === 0" @click="createTier()">
          {{ busy === "create" ? t("adminPrices.creating") : t("adminPrices.createSubmit") }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="muted small">{{ t("adminPrices.loading") }}</p>
    <p v-else-if="rows.length === 0" class="muted small">{{ t("adminPrices.empty") }}</p>

    <div v-else class="table-scroll">
      <div class="table-inner">
        <div class="row head-row">
          <span>{{ t("adminPrices.thModel") }}</span>
          <span>{{ t("adminPrices.thMode") }}</span>
          <span>{{ t("adminPrices.thResolution") }}</span>
          <span>{{ t("adminPrices.thDuration") }}</span>
          <span>{{ t("adminPrices.thCredits") }}</span>
          <span>{{ t("adminPrices.thStrike") }}</span>
          <span>{{ t("adminPrices.thMember") }}</span>
          <span>{{ t("adminPrices.thTimeLimited") }}</span>
          <span>{{ t("adminPrices.thActive") }}</span>
          <span>{{ t("adminPrices.thUpdated") }}</span>
          <span>{{ t("adminPrices.thOps") }}</span>
        </div>

        <div v-for="row in rows" :key="row.id" class="row">
          <span class="ellipsis" :title="modelLabel(row)">{{ modelLabel(row) }}</span>
          <span class="mono ellipsis" :title="row.mode">{{ row.mode }}</span>
          <span class="mono">{{ resolutionLabel(row.resolution) }}</span>
          <span class="muted">{{ durationLabel(row.duration_s) }}</span>
          <input v-model="row.draft.credits" class="input cell" type="number" min="0" step="1" />
          <input
            v-model="row.draft.strike"
            class="input cell"
            type="number"
            min="0"
            step="1"
            :placeholder="t('adminPrices.unset')"
          />
          <input
            v-model="row.draft.member"
            class="input cell"
            type="number"
            min="0"
            step="1"
            :placeholder="t('adminPrices.unset')"
          />
          <input
            v-model="row.draft.timeLimited"
            class="input cell"
            type="number"
            min="0"
            step="1"
            :placeholder="t('adminPrices.unset')"
          />
          <label class="active-cell">
            <input v-model="row.draft.active" type="checkbox" />
            <span class="muted small">
              {{ row.draft.active ? t("adminPrices.statusActive") : t("adminPrices.statusInactive") }}
            </span>
          </label>
          <span class="muted small">{{ formatTime(row.updated_at) }}</span>
          <span class="ops">
            <button class="mini" :disabled="busy === row.id" @click="saveRow(row)">
              {{ busy === row.id ? t("adminPrices.saving") : t("adminPrices.save") }}
            </button>
            <button class="mini danger" :disabled="busy === row.id" @click="removeTier(row)">
              {{ t("adminPrices.delete") }}
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="goPrev()">{{ t("adminPrices.prev") }}</button>
      <span class="muted small">{{ pageInfo }}</span>
      <button class="mini" :disabled="page >= totalPages || loading" @click="goNext()">
        {{ t("adminPrices.next") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 样式刻意复制 `pages/admin/index.vue` 的 .card/.row/.mini/.input 口径（scoped，不引全局新样式），
   保证这一屏和后台其它页签看起来是同一套零件。 */
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
.head p {
  margin: 0;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  color: var(--text-1);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 140px;
}
.input.narrow {
  min-width: 88px;
  width: 88px;
}
.input.cell {
  min-width: 0;
  width: 100%;
  padding: 4px 6px;
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
  color: var(--brand-300, #9db4ff);
  border-color: var(--brand-500);
}
.mini.danger {
  color: #ff6b6b;
  border-color: #ff6b6b;
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.banner {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  font-size: 12px;
}
.banner.error {
  background: var(--danger-bg);
  color: var(--danger, #ff6b6b);
}
.banner.ok {
  background: var(--bg-subtle, #16161f);
  color: #4ade80;
}
.create {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.create h3 {
  margin: 0;
  font-size: 13px;
}
.create p {
  margin: 0;
}
.create-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  align-items: center;
}
.table-scroll {
  overflow-x: auto;
}
.table-inner {
  /* 11 列在窄屏必然挤，给一个最小宽度 + 横向滚动，比压缩到看不清更有用 */
  min-width: 1160px;
}
.row {
  display: grid;
  grid-template-columns:
    minmax(110px, 1.3fr) minmax(90px, 1fr) minmax(80px, 0.8fr) minmax(64px, 0.6fr)
    minmax(70px, 0.7fr) minmax(70px, 0.7fr) minmax(70px, 0.7fr) minmax(80px, 0.8fr)
    minmax(72px, 0.6fr) minmax(120px, 1fr) minmax(130px, 0.9fr);
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-1);
  align-items: center;
  font-size: 12px;
}
.head-row {
  color: var(--text-3);
  padding-top: 4px;
}
.active-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ops {
  display: inline-flex;
  gap: 6px;
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
  font-size: 12px;
}
.small {
  font-size: 11px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
