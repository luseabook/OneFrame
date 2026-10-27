<script setup lang="ts">

const { t } = useI18n();
// 运营后台控制台：独立登录页（/admin/login）+ 独立侧栏菜单（layouts/admin.vue）
import type { PromoSlotDto, PromoSlotListDto } from "~/types/api";

definePageMeta({ ssr: false, layout: "admin", middleware: "admin-auth" });

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
  pending_reports?: number;
  queues?: Record<string, Record<string, number>>;
}

const token = ref("");
const error = ref("");
// 菜单由 URL query 决定（layout 侧栏是唯一导航入口）
const tab = useAdminTab();
const dashboard = ref<Dashboard | null>(null);
const models = ref<Array<Record<string, unknown>>>([]);
const tasks = ref<Array<Record<string, unknown>>>([]);
const shares = ref<Array<Record<string, unknown>>>([]);
const reports = ref<Array<Record<string, unknown>>>([]);
const orders = ref<Array<Record<string, unknown>>>([]);
/**
 * 创作者审核队列（模块 #10）：平台运营视角的待审作品。
 *
 * 为什么运营后台要有一份：创作者作品此前**只有空间管理员能审**，平台运营看不到队列，
 * "内容安全"最该有人管的环节反而没人管。审核人写 `reviewed_by_admin`（与空间管理员的
 * `reviewed_by` 分开留痕），两个身份域不混用。
 */
interface CreatorAuditRow {
  id: string;
  title: string;
  summary: string;
  kind: number;
  category: string;
  effect: string | null;
  status: number;
  cover_uri: string | null;
  creator_user_id: string;
  space_id: string;
  created_at: string;
}
const creatorAudits = ref<CreatorAuditRow[]>([]);
const creatorAuditBusy = ref("");
const creatorAuditStatus = ref(2);
const creatorAuditNote = ref("");
const creatorAuditQuery = ref("");

async function loadCreatorAudits(): Promise<void> {
  const q = creatorAuditQuery.value.trim();
  const data = await api<{ list: CreatorAuditRow[]; total: number }>(
    `/ops/admin/creator-audits?status=${creatorAuditStatus.value}&page_size=50${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  creatorAudits.value = data.list;
}

async function reviewCreatorAudit(row: CreatorAuditRow, action: "approve" | "reject" | "offline"): Promise<void> {
  creatorAuditBusy.value = row.id;
  error.value = "";
  try {
    await api(`/ops/admin/creator-audits/${row.id}/review`, {
      method: "POST",
      body: { action, ...(action === "reject" ? { note: creatorAuditNote.value.trim() || undefined } : {}) },
    });
    await loadCreatorAudits();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.auditFailed");
  } finally {
    creatorAuditBusy.value = "";
  }
}
const refunding = ref("");
const funnel = ref<
  Array<{ key: string; label: string; count: number; conversion_from_previous: number | null }>
>([]);
const metrics = ref<{
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  failure_rate: number;
  adapter_latency: Array<{ adapter: string; samples: number; avg_ms: number; p95_ms: number }>;
  errors_by_code: Array<{ code: string; count: number }>;
}>({
  total: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failure_rate: 0,
  adapter_latency: [],
  errors_by_code: [],
});

async function api<T>(path: string, options: Record<string, unknown> = {}): Promise<T> {
  const res = await $fetch<Envelope<T>>(`/v1${path}`, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string>) || {}),
      ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
    },
  });
  if (res.code !== 0) throw new Error(res.msg || t("adminUi.requestFailed", { code: res.code }));
  return res.data as T;
}

// 登录在独立页面 /admin/login 完成；此处只消费 admin_token
async function loadAll(): Promise<void> {
  const [d, m, t, s, r, f, tm, o] = await Promise.all([
    api<Dashboard>("/ops/admin/dashboard"),
    api<Array<Record<string, unknown>>>("/ops/admin/models"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/tasks"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/shares"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/reports"),
    api<Array<{ key: string; label: string; count: number; conversion_from_previous: number | null }>>(
      "/ops/admin/funnel",
    ),
    api<{
      total: number;
      succeeded: number;
      failed: number;
      canceled: number;
      failure_rate: number;
      adapter_latency: Array<{ adapter: string; samples: number; avg_ms: number; p95_ms: number }>;
      errors_by_code: Array<{ code: string; count: number }>;
    }>("/ops/admin/task-metrics"),
    api<{ list: Array<Record<string, unknown>> }>("/ops/admin/orders?page=1&page_size=50"),
  ]);
  dashboard.value = d;
  models.value = m;
  tasks.value = t.list;
  shares.value = s.list;
  reports.value = r.list;
  funnel.value = f;
  metrics.value = tm;
  orders.value = o.list;
}

/**
 * 全额退款（api-spec §10.5）：运营审批后执行，reason 填工单号。
 * 仅已支付订单（status=2）可退；接口幂等（重复点击不会重复退钱/重复调渠道）。
 */
async function refundOrder(order: Record<string, unknown>): Promise<void> {
  const reason = window.prompt(
    t("adminUi.refundConfirm", { amount: (Number(order.amount_cents) / 100).toFixed(2), credits: String(order.credits) }),
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
    await api(`/ops/admin/orders/${String(order.order_id)}/refund`, {
      method: "POST",
      body: { reason: trimmed },
    });
    await loadAll();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.refundFailed");
  } finally {
    refunding.value = "";
  }
}

async function downloadFailedCsv(): Promise<void> {
  try {
    const res = await fetch("/v1/ops/admin/failed-tasks.csv", {
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    if (!res.ok) throw new Error(t("adminUi.exportFailedWith", { status: res.status }));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "failed-tasks.csv";
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.exportFailed");
  }
}

async function toggleModel(model: Record<string, unknown>): Promise<void> {
  await api(`/ops/admin/models/${model.id}`, { method: "PATCH", body: { visible: !model.visible } });
  await loadAll();
}

async function revokeShare(share: Record<string, unknown>): Promise<void> {
  await api(`/ops/admin/shares/${share.id}/revoke`, { method: "POST" });
  await loadAll();
}

async function resolveReport(report: Record<string, unknown>, action: "takedown" | "dismiss"): Promise<void> {
  await api(`/ops/admin/reports/${report.id}/resolve`, {
    method: "POST",
    body: {
      action,
      note: action === "takedown" ? t("adminUi.reportTakedownNote") : t("adminUi.reportDismissNote"),
    },
  });
  await loadAll();
}

// ── 运营位（模块 #27 收尾）────────────────────────────────────────────
//
// 这个面板是「配置驱动」的写入口：新建/停用后**公开读接口立即变化**
// （`GET /crc/banner_list?type=banner|pop_up|activity` 读的就是同一张 promo_slots 表，
// 条件 = status=1 且当前时间在窗口内）。面板把服务端算好的 `active_now` 直接展示，
// 避免运营自己拿本机时间比时间戳（时区差一小时就会误判）。
const promoSlots = ref<PromoSlotDto[]>([]);
const promoBusy = ref("");
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

async function loadPromo(): Promise<void> {
  try {
    const data = await api<PromoSlotListDto>("/ops/admin/promo-slots");
    promoSlots.value = data.list;
  } catch {
    // 运营位读失败不阻断其它面板（概览仍然可用）
    promoSlots.value = [];
  }
}

async function createPromo(): Promise<void> {
  if (!promoForm.title.trim()) {
    error.value = t("adminUi.slotNeedTitle");
    return;
  }
  promoBusy.value = "create";
  error.value = "";
  try {
    await api("/ops/admin/promo-slots", {
      method: "POST",
      body: {
        slot: promoForm.slot,
        title: promoForm.title.trim(),
        image_uri: promoForm.image_uri.trim() || null,
        link_uri: promoForm.link_uri.trim() || null,
        sort: Number(promoForm.sort) || 0,
        starts_at: promoForm.starts_at.trim() || null,
        ends_at: promoForm.ends_at.trim() || null,
      },
    });
    promoForm.title = "";
    promoForm.image_uri = "";
    promoForm.link_uri = "";
    await loadPromo();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.slotCreateFailed");
  } finally {
    promoBusy.value = "";
  }
}

async function togglePromo(slot: PromoSlotDto): Promise<void> {
  promoBusy.value = slot.id;
  error.value = "";
  try {
    await api(`/ops/admin/promo-slots/${slot.id}`, {
      method: "PUT",
      body: { status: slot.status === 1 ? 2 : 1 },
    });
    await loadPromo();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.slotUpdateFailed");
  } finally {
    promoBusy.value = "";
  }
}

async function removePromo(slot: PromoSlotDto): Promise<void> {
  if (!window.confirm(t("adminUi.slotDeleteConfirm", { name: slot.title || slot.id }))) return;
  promoBusy.value = slot.id;
  error.value = "";
  try {
    await api(`/ops/admin/promo-slots/${slot.id}`, { method: "DELETE" });
    await loadPromo();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("adminUi.slotDeleteFailed");
  } finally {
    promoBusy.value = "";
  }
}

onMounted(async () => {
  const saved = localStorage.getItem("admin_token");
  if (!saved) {
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  token.value = saved;
  try {
    await loadAll();
  } catch {
    // token 失效：回到独立登录页
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  await loadPromo();
  // 创作者审核队列不是首屏必需（省一次请求），但运营打开该 tab 时必须有数据
  if (tab.value === "creatorAudits") await loadCreatorAudits().catch(() => {});
  watch(
    () => tab.value,
    (next) => {
      if (next === "creatorAudits") void loadCreatorAudits().catch(() => {});
    },
  );
});
</script>

<template>
  <div class="page">
    <p v-if="error" class="error banner">{{ error }}</p>

      <section v-if="tab === 'dashboard' && dashboard" class="cards">
        <div class="card"><span class="muted">{{ t("adminUi.statUsers") }}</span><b>{{ dashboard.users }}</b></div>
        <div class="card"><span class="muted">{{ t("adminUi.statTasks") }}</span><b>{{ dashboard.tasks.total }}</b></div>
        <div class="card"><span class="muted">{{ t("adminUi.statExports") }}</span><b>{{ dashboard.exports }}</b></div>
        <div class="card"><span class="muted">{{ t("adminUi.statShares") }}</span><b>{{ dashboard.active_shares }}</b></div>
        <div class="card"><span class="muted">{{ t("adminUi.statAdmins") }}</span><b>{{ dashboard.admins }}</b></div>
        <div class="card"><span class="muted">{{ t("adminUi.statPendingReports") }}</span><b>{{ dashboard.pending_reports ?? 0 }}</b></div>
      </section>
      <section v-if="tab === 'dashboard' && dashboard?.queues" class="queues">
        <div v-for="(counts, queue) in dashboard.queues" :key="queue" class="queue-card">
          <b>{{ queue }}</b>
          <span class="muted">wait {{ counts.wait ?? 0 }} · active {{ counts.active ?? 0 }} · failed {{ counts.failed ?? 0 }}</span>
        </div>
      </section>

      <!-- 运营位（模块 #27）：新建/停用后公开读接口 crc/banner_list 立即变化 -->
      <section v-if="tab === 'dashboard'" class="card promo">
        <h2>{{ t("adminUi.slotsTitle") }}</h2>
        <p class="muted small">
          {{ t("adminUi.slotsHint") }}
        </p>

        <div class="promo-form">
          <select v-model="promoForm.slot" class="input">
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
          <button class="mini" :disabled="promoBusy === 'create'" @click="createPromo">
            {{ promoBusy === "create" ? t("adminUi.creating") : t("adminUi.create") }}
          </button>
        </div>

        <div class="row head-row">
          <span>{{ t("adminUi.thType") }}</span><span>{{ t("adminUi.thTitle") }}</span><span>{{ t("adminUi.thSort") }}</span><span>{{ t("adminUi.thWindow") }}</span><span>{{ t("adminUi.thLive") }}</span><span>{{ t("adminUi.thOps") }}</span>
        </div>
        <p v-if="promoSlots.length === 0" class="muted small">{{ t("adminUi.slotsEmpty") }}</p>
        <div v-for="slot in promoSlots" :key="slot.id" class="row">
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
            <button class="mini" :disabled="promoBusy === slot.id" @click="togglePromo(slot)">
              {{ slot.status === 1 ? t("adminUi.disable") : t("adminUi.enable") }}
            </button>
            <button class="mini danger" :disabled="promoBusy === slot.id" @click="removePromo(slot)">{{ t("adminUi.delete") }}</button>
          </span>
        </div>
      </section>

      <section v-if="tab === 'models'" class="card">
        <h2>{{ t("adminUi.modelsTitle") }}</h2>
        <div class="row head-row"><span>{{ t("adminUi.thName") }}</span><span>{{ t("adminUi.thCapability") }}</span><span>adapter</span><span>{{ t("adminUi.thSort") }}</span><span>{{ t("adminUi.thVisible") }}</span></div>
        <div v-for="m in models" :key="String(m.id)" class="row">
          <span>{{ m.display_name }}</span>
          <span class="muted">{{ m.capability }}</span>
          <span class="muted">{{ m.adapter_code }}</span>
          <span class="muted">{{ m.sort }}</span>
          <button class="mini" @click="toggleModel(m)">{{ m.visible ? t("adminUi.unlist") : t("adminUi.list") }}</button>
        </div>
      </section>

      <section v-if="tab === 'tasks' && metrics" class="card">
        <h2>{{ t("adminUi.metricsTitle") }}</h2>
        <div class="cards">
          <div class="card"><span class="muted">{{ t("adminUi.failureRate") }}</span><b>{{ metrics.failure_rate }}%</b></div>
          <div class="card"><span class="muted">{{ t("adminUi.succFailCancel") }}</span><b>{{ metrics.succeeded }} / {{ metrics.failed }} / {{ metrics.canceled }}</b></div>
          <button class="mini csv" @click="downloadFailedCsv">{{ t("adminUi.downloadFailedCsv") }}</button>
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
      </section>

      <section v-if="tab === 'tasks'" class="card">
        <h2>{{ t("adminUi.auditTitle") }}</h2>
        <div class="row task-row head-row"><span>task</span><span>space</span><span>mode</span><span>{{ t("adminUi.thStatus") }}</span><span>积分</span><span>时间</span></div>
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
        <h2>{{ t("adminUi.sharesTitle") }}</h2>
        <div v-for="s in shares" :key="String(s.id)" class="share-row">
          <span class="mono">{{ String(s.token).slice(0, 12) }}…</span>
          <span class="muted">task {{ String(s.task_id).slice(-8) }}</span>
          <span class="muted">{{ s.revoked_at ? t("adminUi.revoked") : t("adminUi.untilDate", { date: new Date(String(s.expires_at)).toLocaleDateString() }) }}</span>
          <button v-if="!s.revoked_at" class="mini" @click="revokeShare(s)">{{ t("adminUi.takeDown") }}</button>
        </div>
        <p v-if="shares.length === 0" class="muted">{{ t("adminUi.sharesEmpty") }}</p>
      </section>

      <section v-if="tab === 'funnel'" class="card">
        <h2>{{ t("adminUi.funnelTitle") }}</h2>
        <div class="funnel">
          <div v-for="stage in funnel" :key="stage.key" class="funnel-stage">
            <span class="muted">{{ stage.label }}</span>
            <b>{{ stage.count }}</b>
            <span v-if="stage.conversion_from_previous !== null" class="muted">
              {{ t("adminUi.conversion", { percent: stage.conversion_from_previous }) }}
            </span>
          </div>
        </div>
        <p v-if="funnel.length === 0" class="muted">{{ t("adminUi.funnelEmpty") }}</p>
      </section>

      <section v-if="tab === 'reports'" class="card">
        <h2>{{ t("adminUi.reportsTitle") }}</h2>
        <div v-for="r in reports" :key="String(r.id)" class="report-row">
          <span class="badge" :data-status="r.status">{{
            r.status === 1
              ? t("adminUi.reportPending")
              : r.status === 2
                ? t("adminUi.reportTakenDown")
                : t("adminUi.reportRejected")
          }}</span>
          <span class="muted">{{ r.reason }}</span>
          <span class="report-detail">{{ r.detail || "-" }}</span>
          <span class="muted">task {{ String(r.task_id).slice(-8) }}</span>
          <template v-if="r.status === 1">
            <button class="mini danger" @click="resolveReport(r, 'takedown')">{{ t("adminUi.takeDown") }}</button>
            <button class="mini" @click="resolveReport(r, 'dismiss')">{{ t("adminUi.reject") }}</button>
          </template>
          <span v-else class="muted">{{ r.resolution }}</span>
        </div>
        <p v-if="reports.length === 0" class="muted">{{ t("adminUi.reportsEmpty") }}</p>
      </section>

      <section v-if="tab === 'creatorAudits'" class="card">
        <h2>{{ t("adminUi.creatorAuditTitle") }}</h2>
        <p class="muted small">
          {{ t("adminUi.creatorAuditHint") }}
        </p>
        <p class="muted small">
          {{ t("adminUi.currentStatus") }}
          <select v-model.number="creatorAuditStatus" class="mini" @change="loadCreatorAudits()">
            <option :value="2">{{ t("adminUi.statusPendingReview") }}</option>
            <option :value="3">{{ t("adminUi.statusApproved") }}</option>
            <option :value="4">{{ t("adminUi.statusRejected") }}</option>
            <option :value="5">{{ t("adminUi.statusTakenDown") }}</option>
          </select>
          <input v-model="creatorAuditNote" class="mini note" :placeholder="t('adminUi.rejectReasonPlaceholder')" maxlength="120" />
          <!-- 队列按 FIFO 翻页；运营常"只找某个作品"，给搜索框免得一页页翻 -->
          <input
            v-model="creatorAuditQuery"
            class="mini note"
            :placeholder="t('adminUi.searchByTitle')"
            maxlength="80"
            @keyup.enter="loadCreatorAudits()"
          />
        </p>
        <div v-for="row in creatorAudits" :key="row.id" class="report-row">
          <span class="badge" :data-status="row.status">
            {{
              row.status === 2
                ? t("adminUi.statusPendingReview")
                : row.status === 3
                  ? t("adminUi.statusApproved")
                  : row.status === 4
                    ? t("adminUi.statusRejected")
                    : t("adminUi.statusTakenDown")
            }}
          </span>
          <span class="report-detail">{{ row.title }}</span>
          <span class="muted">{{ row.category }}<template v-if="row.effect"> · {{ row.effect }}</template></span>
          <span class="muted">user {{ row.creator_user_id.slice(-6) }}</span>
          <template v-if="row.status === 2">
            <button class="mini" :disabled="creatorAuditBusy === row.id" @click="reviewCreatorAudit(row, 'approve')">
              {{ t("adminUi.approve") }}
            </button>
            <button class="mini danger" :disabled="creatorAuditBusy === row.id" @click="reviewCreatorAudit(row, 'reject')">
              {{ t("adminUi.reject") }}
            </button>
          </template>
          <button
            v-else-if="row.status === 3"
            class="mini danger"
            :disabled="creatorAuditBusy === row.id"
            @click="reviewCreatorAudit(row, 'offline')"
          >
             {{ t("adminUi.takeDown") }}
          </button>
        </div>
        <p v-if="creatorAudits.length === 0" class="muted">{{ t("adminUi.creatorEmpty") }}</p>
      </section>

      <section v-if="tab === 'orders'" class="card">
        <h2>{{ t("adminUi.ordersTitle") }}</h2>
        <p class="muted small">
          {{ t("adminUi.ordersHint") }}
        </p>
        <div v-for="o in orders" :key="String(o.order_id)" class="order-row">
          <span class="mono">{{ String(o.order_id).slice(-10) }}</span>
          <span>{{ o.sku }}</span>
          <span class="muted">¥{{ (Number(o.amount_cents) / 100).toFixed(2) }}</span>
          <span class="muted">{{ o.channel }}</span>
          <span class="badge" :data-status="o.status">
            {{
              o.status === 1
                ? t("adminUi.orderPendingPay")
                : o.status === 2
                  ? t("adminUi.orderPaid")
                  : o.status === 3
                    ? t("adminUi.orderClosed")
                    : t("adminUi.orderRefunded")
            }}
          </span>
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
        <p v-if="orders.length === 0" class="muted">{{ t("adminUi.ordersEmpty") }}</p>
      </section>
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
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
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
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-xl);
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
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
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
  background: var(--bg-raised);
  border: 1px solid var(--border-1);
  color: var(--text-2);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.active {
  border-color: var(--brand-500);
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
.task-row {
  grid-template-columns: 90px 70px 1fr 50px 80px 150px;
}
.head-row {
  color: var(--text-3);
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
  min-width: 110px;
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
