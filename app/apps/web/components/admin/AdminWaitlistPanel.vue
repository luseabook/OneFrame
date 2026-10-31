<script setup lang="ts">
/**
 * 等待名单面板（前端契约 §3.1 / API 契约 §2.2）。
 *
 * 为什么这一屏没有"手机号"列、也没有"发短信"按钮：等待名单表**只存手机号的 HMAC**
 * （`waitlist_entries.phone_hash`），平台侧根本没有明文，拿不出手机号也发不了短信。
 * 后端只回 `phone_hash_prefix`（前 10 位 + …），前端把它当唯一的用户标识展示即可；
 * 伪造一个"手机号"字段或加个发短信按钮，等于在界面上撒谎。
 *
 * "标记已邀请"只写 `invited_at`（幂等）：这条记录代表运营**已经线下/其它渠道邀请过**，
 * 不代表系统发出过任何消息——所以按钮文案是"标记"，不是"邀请"。
 */
import { adminApi, adminErrorCode } from "~/composables/useAdminApi";

interface WaitlistRow {
  id: string;
  /** 手机号 HMAC 的前 10 位 + "…"；平台没有明文手机号 */
  phone_hash_prefix: string;
  source: string | null;
  invited_at: string | null;
  created_at: string;
}

interface WaitlistList {
  list: WaitlistRow[];
  total: number;
  page: number;
  page_size: number;
}

const { t } = useI18n();

const PAGE_SIZES = [20, 50, 100];

const rows = ref<WaitlistRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref("");
const ok = ref("");
/** 行内 busy：只禁用正在标记的那一行 */
const busy = ref("");

/** 输入中的筛选条件（已邀请 / 未邀请） */
const form = reactive({ invited: "" });
/** 已生效条件快照：翻页沿用"点搜索时"的条件，避免输入框改动让两页口径不同 */
const applied = ref({ invited: "" });

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

function buildQuery(): string {
  const parts = [`page=${page.value}`, `page_size=${pageSize.value}`];
  if (applied.value.invited) parts.push(`invited=${encodeURIComponent(applied.value.invited)}`);
  return parts.join("&");
}

/**
 * 身份类错误：401101 回登录页；403/403101 就地提示（viewer 重登还是 viewer，踢人只会形成死循环）。
 */
async function handleError(err: unknown, fallbackKey: string): Promise<void> {
  const code = adminErrorCode(err);
  if (code === 401101) {
    localStorage.removeItem("admin_token");
    await navigateTo("/admin/login", { replace: true });
    return;
  }
  if (code === 403 || code === 403101) {
    error.value = t("adminWaitlist.needRole");
    return;
  }
  error.value = err instanceof Error && err.message ? err.message : t(fallbackKey);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await adminApi<WaitlistList>(`/ops/admin/waitlist?${buildQuery()}`);
    rows.value = data.list ?? [];
    total.value = data.total ?? 0;
    page.value = data.page ?? page.value;
  } catch (err) {
    await handleError(err, "adminWaitlist.loadFailed");
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  applied.value = { invited: form.invited };
  page.value = 1;
  void load();
}

function resetFilters(): void {
  form.invited = "";
  applyFilters();
}

function changePageSize(): void {
  page.value = 1;
  void load();
}

function go(next: number): void {
  if (next < 1 || next > pages.value) return;
  page.value = next;
  void load();
}

async function markInvited(row: WaitlistRow): Promise<void> {
  busy.value = row.id;
  error.value = "";
  ok.value = "";
  try {
    const data = await adminApi<{ id: string; invited_at: string | null; idempotent: boolean }>(
      `/ops/admin/waitlist/${encodeURIComponent(row.id)}/invite`,
      { method: "POST" },
    );
    // 幂等标记：后端回 idempotent=true 说明之前已经标过，此时文案说"已标记过"更诚实
    await load();
    ok.value = data.idempotent
      ? t("adminWaitlist.alreadyInvited", { hash: row.phone_hash_prefix })
      : t("adminWaitlist.marked", { hash: row.phone_hash_prefix });
  } catch (err) {
    await handleError(err, "adminWaitlist.inviteFailed");
  } finally {
    busy.value = "";
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="card">
    <header class="head">
      <h2>{{ t("adminWaitlist.title") }}</h2>
      <p class="muted small">{{ t("adminWaitlist.hint") }}</p>
    </header>

    <div class="filters">
      <select v-model="form.invited" class="input" :aria-label="t('adminWaitlist.fInvited')" @change="applyFilters">
        <option value="">{{ t("adminWaitlist.invitedAll") }}</option>
        <option value="1">{{ t("adminWaitlist.invitedYes") }}</option>
        <option value="0">{{ t("adminWaitlist.invitedNo") }}</option>
      </select>
      <select
        v-model.number="pageSize"
        class="input narrow"
        :aria-label="t('adminWaitlist.pageSize')"
        @change="changePageSize"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <button class="mini" :disabled="loading" @click="applyFilters">{{ t("adminWaitlist.refresh") }}</button>
      <button class="mini" :disabled="loading" @click="resetFilters">{{ t("adminWaitlist.reset") }}</button>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="ok" class="banner ok">{{ ok }}</p>

    <p v-if="loading" class="muted small">{{ t("adminWaitlist.loading") }}</p>
    <p v-else-if="rows.length === 0 && !error" class="muted small">{{ t("adminWaitlist.empty") }}</p>

    <template v-else>
      <div class="row head-row">
        <span>{{ t("adminWaitlist.colHash") }}</span>
        <span>{{ t("adminWaitlist.colSource") }}</span>
        <span>{{ t("adminWaitlist.colInvitedAt") }}</span>
        <span>{{ t("adminWaitlist.colCreatedAt") }}</span>
        <span>{{ t("adminWaitlist.colOps") }}</span>
      </div>

      <div v-for="row in rows" :key="row.id" class="row">
        <span class="mono ellipsis" :title="row.phone_hash_prefix">{{ row.phone_hash_prefix }}</span>
        <span class="muted ellipsis" :title="row.source || ''">{{ row.source || "-" }}</span>
        <span :class="row.invited_at ? 'state-on' : 'muted'">
          {{ row.invited_at ? formatTime(row.invited_at) : t("adminWaitlist.notInvited") }}
        </span>
        <span class="muted">{{ formatTime(row.created_at) }}</span>
        <span class="ops">
          <button class="mini" :disabled="busy === row.id || !!row.invited_at" @click="markInvited(row)">
            {{ busy === row.id ? t("adminWaitlist.marking") : t("adminWaitlist.markInvited") }}
          </button>
        </span>
      </div>
    </template>

    <div class="pager">
      <button class="mini" :disabled="page <= 1 || loading" @click="go(page - 1)">{{ t("adminWaitlist.prev") }}</button>
      <span class="muted small">
        {{ t("adminWaitlist.pageInfo", { page: page, pages: pages, total: total }) }}
      </span>
      <button class="mini" :disabled="page >= pages || loading" @click="go(page + 1)">{{ t("adminWaitlist.next") }}</button>
    </div>
  </section>
</template>

<style scoped>
/* 样式刻意复制 `pages/admin/index.vue` 的 .card/.row/.mini/.input 口径（scoped，不引全局新样式） */
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
  min-width: 72px;
  width: 72px;
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
  background: var(--danger-bg, rgba(255, 107, 107, 0.12));
  color: #ff6b6b;
}
.banner.ok {
  background: var(--bg-subtle, #16161f);
  color: #4ade80;
}
.row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(110px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) 130px;
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
.state-on {
  color: #4ade80;
  font-size: 12px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
}
@media (max-width: 860px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
