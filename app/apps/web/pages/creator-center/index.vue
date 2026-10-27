<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 创作者中心（对照竞品 `/creator-center`，`rt:43`；数据来自 `crc/*` 域，`rt:275-304`）
 *
 * 五个 tab 的顺序是按创作者的真实动线排的：
 *   我的作品（投稿/送审/看驳回）→ 作品广场（点赞/关注，内容消费）→ 资料（对外形象）
 *   → 粉丝（关系维护）→ 激励（收益，只读视图）。
 *
 * 三态齐全：加载（骨架）/ 空（明确引导去建作品）/ 错误（可重试）。
 * 审核按钮只对 `can_review` 渲染——后端 `/crc/user/info` 下发该标记，
 * 避免"按钮在但点了 403"。
 */

import type {
  CreatorFollowRowDto,
  CreatorIncentiveDto,
  CreatorProfileDto,
  CreatorWorkDto,
  Paged,
} from "~/types/api";

const api = useApi();
const toast = useToast();

type TabKey = "works" | "square" | "profile" | "fans" | "incentive";
// tab 文案走 i18n（computed：常量在 setup 期固化，切语言不更新）
const TABS = computed<Array<{ key: TabKey; label: string }>>(() => [
  { key: "works", label: t("creatorCenter.tabWorks") },
  { key: "square", label: t("creatorCenter.tabSquare") },
  { key: "profile", label: t("creatorCenter.tabProfile") },
  { key: "fans", label: t("creatorCenter.tabFans") },
  { key: "incentive", label: t("creatorCenter.tabIncentive") },
]);
const tab = ref<TabKey>("works");

const { t, locale } = useI18n();
useHead({ title: () => t("creatorCenter.metaTitle") });

const loading = ref(true);
const errorMsg = ref("");
const busy = ref("");

const profile = ref<CreatorProfileDto | null>(null);
const works = ref<CreatorWorkDto[]>([]);
const worksFilter = ref<number | 0>(0);
const square = ref<CreatorWorkDto[]>([]);
const fans = ref<CreatorFollowRowDto[]>([]);
const follows = ref<CreatorFollowRowDto[]>([]);
const incentive = ref<CreatorIncentiveDto | null>(null);

const STATUS_FILTERS = computed<Array<{ value: number; label: string }>>(() => [
  { value: 0, label: t("creatorCenter.filterAll") },
  { value: 1, label: t("creatorCenter.filterDraft") },
  { value: 2, label: t("creatorCenter.filterPending") },
  { value: 3, label: t("creatorCenter.filterApproved") },
  { value: 4, label: t("creatorCenter.filterRejected") },
  { value: 5, label: t("creatorCenter.filterOffline") },
]);

// 新建作品表单（真实可用：标题必填，素材地址可选但送审时要求有素材/封面）
const draft = reactive({ title: "", summary: "", uri: "" });
const profileForm = reactive({ nickname: "", bio: "" });
const rejectNote = ref("");

const canReview = computed(() => profile.value?.can_review === true);

function fmtTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

async function loadAll() {
  loading.value = true;
  errorMsg.value = "";
  try {
    profile.value = await api.get<CreatorProfileDto>("/crc/user/info");
    profileForm.nickname = profile.value.nickname;
    profileForm.bio = profile.value.bio;
    await Promise.all([loadWorks(), loadSquare(), loadFans(), loadIncentive()]);
  } catch (e) {
    errorMsg.value = (e as Error).message || t("creatorCenter.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function loadWorks() {
  const q = worksFilter.value ? `?status=${worksFilter.value}` : "";
  const res = await api.get<Paged<CreatorWorkDto>>(`/crc/assets/me${q}`);
  works.value = res.list;
}

async function loadSquare() {
  const res = await api.get<Paged<CreatorWorkDto>>("/crc/home/list?page_size=20");
  square.value = res.list;
}

async function loadFans() {
  const [f, g] = await Promise.all([
    api.post<Paged<CreatorFollowRowDto> & { list: CreatorFollowRowDto[] }>("/crc/user/fans", {}),
    api.post<{ list: CreatorFollowRowDto[] }>("/crc/user/follows", {}),
  ]);
  fans.value = f.list;
  follows.value = g.list;
}

async function loadIncentive() {
  incentive.value = await api.post<CreatorIncentiveDto>("/crc/user/incentive", {});
}

async function withBusy(key: string, fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = key;
  try {
    await fn();
  } catch (e) {
    toast.error((e as Error).message || t("creatorCenter.opFailed"));
  } finally {
    busy.value = "";
  }
}

async function createWork() {
  if (!draft.title.trim()) {
    toast.error(t("creatorCenter.titleRequired"));
    return;
  }
  await withBusy("create", async () => {
    await api.post("/crc/assets/create", {
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      uri: draft.uri.trim() || null,
    });
    draft.title = "";
    draft.summary = "";
    draft.uri = "";
    toast.success(t("creatorCenter.savedDraft"));
    await loadWorks();
    if (profile.value) profile.value = await api.get<CreatorProfileDto>("/crc/user/info");
  });
}

async function changeStatus(work: CreatorWorkDto, action: "submit" | "resubmit" | "offline" | "approve" | "reject") {
  if (action === "reject" && !rejectNote.value.trim()) {
    toast.error(t("creatorCenter.rejectReasonRequired"));
    return;
  }
  await withBusy(`${action}:${work.id}`, async () => {
    await api.post("/crc/resource/action/status", {
      asset_id: work.id,
      action,
      ...(action === "reject" ? { review_note: rejectNote.value.trim() } : {}),
    });
    if (action === "reject") rejectNote.value = "";
    toast.success(
      action === "submit" || action === "resubmit"
        ? t("creatorCenter.submitted")
        : action === "approve"
          ? t("creatorCenter.approvedMsg")
          : action === "reject"
            ? t("creatorCenter.rejectedMsg")
            : t("creatorCenter.offlineMsg"),
    );
    await loadWorks();
    await loadSquare();
  });
}

async function removeWork(work: CreatorWorkDto, mode: "delete" | "audit-fail") {
  const hint =
    mode === "audit-fail"
      ? t("creatorCenter.deleteConfirmAuditFail", { title: work.title })
      : t("creatorCenter.deleteConfirm", { title: work.title });
  if (!window.confirm(hint)) return;
  await withBusy(`del:${work.id}`, async () => {
    await api.post(mode === "audit-fail" ? "/crc/assets/audit-fail/del" : "/crc/assets/delete", {
      asset_id: work.id,
    });
    toast.success(t("creatorCenter.deleted"));
    await loadWorks();
  });
}

/** 点赞是幂等接口：重复点返回同一态，所以直接用响应覆盖本地计数，不做乐观自增 */
async function toggleLike(work: CreatorWorkDto) {
  await withBusy(`like:${work.id}`, async () => {
    const res = await api.post<{ liked: boolean; like_count: number }>("/crc/assets/likes/action", {
      asset_id: work.id,
      action: work.liked ? "unlike" : "like",
    });
    work.liked = res.liked;
    work.like_count = res.like_count;
    if (!res.liked && res.like_count === 0) toast.info(t("creatorCenter.unliked"));
  });
}

async function toggleFollow(row: CreatorFollowRowDto, following: boolean) {
  await withBusy(`follow:${row.user_id}`, async () => {
    const res = await api.post<{ following: boolean; follower_count: number }>("/crc/user/follows/action", {
      creator_user_id: row.user_id,
      action: following ? "unfollow" : "follow",
    });
    toast.success(res.following ? t("creatorCenter.followed", { name: row.nickname ?? row.user_id }) : t("creatorCenter.unfollowed"));
    await loadFans();
  });
}

async function saveProfile() {
  if (!profileForm.nickname.trim()) {
    toast.error(t("creatorCenter.nicknameRequired"));
    return;
  }
  await withBusy("profile", async () => {
    profile.value = await api.post<CreatorProfileDto>("/crc/user/update", {
      nickname: profileForm.nickname.trim(),
      bio: profileForm.bio.trim(),
    });
    toast.success(t("creatorCenter.profileSaved"));
  });
}

async function changeFilter(v: number) {
  worksFilter.value = v;
  await withBusy("filter", loadWorks);
}

watch(tab, async (key) => {
  if (key === "incentive") await withBusy("incentive", loadIncentive);
  if (key === "fans") await withBusy("fans", loadFans);
});

onMounted(loadAll);
</script>

<template>
  <div class="cc">
    <header class="cc-head">
      <div>
        <h1 class="cc-title">{{ t("creatorCenter.title") }}</h1>
        <p class="cc-sub">
          <template v-if="profile">
            {{ t("creatorCenter.subProfile", { name: profile.nickname, approved: profile.works.approved, total: profile.works.total, fans: profile.follower_count }) }}
          </template>
          <template v-else>{{ t("creatorCenter.subDefault") }}</template>
        </p>
      </div>
      <button type="button" class="cc-btn" :disabled="loading" @click="loadAll">{{ t("creatorCenter.refresh") }}</button>
    </header>

    <nav class="cc-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="cc-tab"
        :class="{ active: tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <p v-if="errorMsg" class="cc-alert">
      {{ errorMsg }}
      <button type="button" class="cc-link" @click="loadAll">{{ t("creatorCenter.retry") }}</button>
    </p>

    <div v-if="loading" class="cc-skeleton">{{ t("creatorCenter.loading") }}</div>

    <template v-else>
      <!-- ── 我的作品 ───────────────────────────────── -->
      <section v-if="tab === 'works'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">{{ t("creatorCenter.createTitle") }}</h2>
          <p class="cc-hint">{{ t("creatorCenter.createHint") }}</p>
          <div class="cc-form">
            <input v-model="draft.title" class="cc-input" maxlength="80" :placeholder="t('creatorCenter.titlePlaceholder')" />
            <input v-model="draft.uri" class="cc-input" maxlength="500" :placeholder="t('creatorCenter.uriPlaceholder')" />
            <input v-model="draft.summary" class="cc-input" maxlength="200" :placeholder="t('creatorCenter.summaryPlaceholder')" />
            <button type="button" class="cc-btn primary" :disabled="busy === 'create'" @click="createWork">
              {{ busy === "create" ? t("creatorCenter.creating") : t("creatorCenter.createDraft") }}
            </button>
          </div>
        </div>

        <div class="cc-filters">
          <button
            v-for="f in STATUS_FILTERS"
            :key="f.value"
            type="button"
            class="cc-chip"
            :class="{ active: worksFilter === f.value }"
            @click="changeFilter(f.value)"
          >
            {{ f.label }}
          </button>
        </div>

        <p v-if="works.length === 0" class="cc-empty">{{ t("creatorCenter.worksEmpty") }}</p>
        <ul v-else class="cc-list">
          <li v-for="w in works" :key="w.id" class="cc-item">
            <div class="cc-item-main">
              <div class="cc-item-title">
                {{ w.title }}
                <span class="cc-tag" :class="`s${w.status}`">{{ w.status_label }}</span>
                <span class="cc-tag ghost">{{ w.kind_label }}</span>
              </div>
              <p class="cc-item-meta">
                {{ t("creatorCenter.itemMeta", { views: w.view_count, likes: w.like_count, time: fmtTime(w.updated_at) }) }}
              </p>
              <p v-if="w.review_note" class="cc-item-note">{{ t("creatorCenter.auditNote", { note: w.review_note }) }}</p>
            </div>
            <div class="cc-item-actions">
              <button
                v-if="w.status === 1 || w.status === 4"
                type="button"
                class="cc-btn primary sm"
                :disabled="busy === `submit:${w.id}`"
                @click="changeStatus(w, 'submit')"
              >
                {{ t("creatorCenter.submit") }}
              </button>
              <button
                v-if="w.status === 5"
                type="button"
                class="cc-btn primary sm"
                :disabled="busy === `resubmit:${w.id}`"
                @click="changeStatus(w, 'resubmit')"
              >
                {{ t("creatorCenter.resubmit") }}
              </button>
              <template v-if="w.status === 2 && canReview">
                <button
                  type="button"
                  class="cc-btn sm"
                  :disabled="busy === `approve:${w.id}`"
                  @click="changeStatus(w, 'approve')"
                >
                  {{ t("creatorCenter.approve") }}
                </button>
                <input v-model="rejectNote" class="cc-input sm" maxlength="200" :placeholder="t('creatorCenter.rejectNotePlaceholder')" />
                <button
                  type="button"
                  class="cc-btn danger sm"
                  :disabled="busy === `reject:${w.id}`"
                  @click="changeStatus(w, 'reject')"
                >
                  {{ t("creatorCenter.reject") }}
                </button>
              </template>
              <button
                v-if="w.status === 3"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `offline:${w.id}`"
                @click="changeStatus(w, 'offline')"
              >
                {{ t("creatorCenter.offline") }}
              </button>
              <button
                v-if="w.status === 4"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `del:${w.id}`"
                @click="removeWork(w, 'audit-fail')"
              >
                {{ t("creatorCenter.delete") }}
              </button>
              <button
                v-if="w.status === 1 || w.status === 5"
                type="button"
                class="cc-btn danger sm"
                :disabled="busy === `del:${w.id}`"
                @click="removeWork(w, 'delete')"
              >
                {{ t("creatorCenter.delete") }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── 作品广场（点赞 / 关注） ──────────────────── -->
      <section v-else-if="tab === 'square'" class="cc-panel">
        <p class="cc-hint">{{ t("creatorCenter.squareHint") }}</p>
        <p v-if="square.length === 0" class="cc-empty">{{ t("creatorCenter.squareEmpty") }}</p>
        <ul v-else class="cc-grid">
          <li v-for="w in square" :key="w.id" class="cc-tile">
            <div class="cc-tile-title">{{ w.title }}</div>
            <p class="cc-tile-meta">
              {{ t("creatorCenter.tileMeta", { name: w.creator?.nickname || w.kind_label || "", views: w.view_count }) }}
            </p>
            <div class="cc-tile-actions">
              <button type="button" class="cc-btn sm" :disabled="busy === `like:${w.id}`" @click="toggleLike(w)">
                {{ w.liked ? t("creatorCenter.liked") : t("creatorCenter.like") }} {{ w.like_count }}
              </button>
              <button
                v-if="w.creator_user_id !== profile?.user_id"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${w.creator_user_id}`"
                @click="toggleFollow({ user_id: w.creator_user_id, nickname: w.creator?.nickname ?? null }, false)"
              >
                {{ t("creatorCenter.followAuthor") }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── 资料 ──────────────────────────────────── -->
      <section v-else-if="tab === 'profile'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">{{ t("creatorCenter.profileTitle") }}</h2>
          <p class="cc-hint">{{ t("creatorCenter.profileHint") }}</p>
          <div class="cc-form">
            <input v-model="profileForm.nickname" class="cc-input" maxlength="30" :placeholder="t('creatorCenter.nicknamePlaceholder')" />
            <textarea v-model="profileForm.bio" class="cc-input" rows="3" maxlength="500" :placeholder="t('creatorCenter.bioPlaceholder')" />
            <button type="button" class="cc-btn primary" :disabled="busy === 'profile'" @click="saveProfile">
              {{ busy === "profile" ? t("creatorCenter.saving") : t("creatorCenter.saveProfile") }}
            </button>
          </div>
          <dl v-if="profile" class="cc-kv">
            <div><dt>{{ t("creatorCenter.statWorksTotal") }}</dt><dd>{{ profile.works.total }}</dd></div>
            <div><dt>{{ t("creatorCenter.statApproved") }}</dt><dd>{{ profile.works.approved }}</dd></div>
            <div><dt>{{ t("creatorCenter.statPending") }}</dt><dd>{{ profile.works.pending }}</dd></div>
            <div><dt>{{ t("creatorCenter.statRejected") }}</dt><dd>{{ profile.works.rejected }}</dd></div>
            <div><dt>{{ t("creatorCenter.statViews") }}</dt><dd>{{ profile.view_count }}</dd></div>
            <div><dt>{{ t("creatorCenter.statLikes") }}</dt><dd>{{ profile.like_count }}</dd></div>
          </dl>
        </div>
      </section>

      <!-- ── 粉丝 / 关注 ────────────────────────────── -->
      <section v-else-if="tab === 'fans'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">{{ t("creatorCenter.fansTitle", { count: fans.length }) }}</h2>
          <p v-if="fans.length === 0" class="cc-empty">{{ t("creatorCenter.fansEmpty") }}</p>
          <ul v-else class="cc-list">
            <li v-for="f in fans" :key="f.user_id" class="cc-item">
              <span class="cc-item-title">{{ f.nickname || f.user_id }}</span>
              <button
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${f.user_id}`"
                @click="toggleFollow(f, false)"
              >
                {{ t("creatorCenter.followBack") }}
              </button>
            </li>
          </ul>
        </div>
        <div class="cc-card">
          <h2 class="cc-card-title">{{ t("creatorCenter.followsTitle", { count: follows.length }) }}</h2>
          <p v-if="follows.length === 0" class="cc-empty">{{ t("creatorCenter.followsEmpty") }}</p>
          <ul v-else class="cc-list">
            <li v-for="f in follows" :key="f.user_id" class="cc-item">
              <span class="cc-item-title">{{ f.nickname || f.user_id }}</span>
              <span class="cc-item-meta">{{ t("creatorCenter.followerCount", { count: f.follower_count ?? 0 }) }}</span>
              <button
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${f.user_id}`"
                @click="toggleFollow(f, true)"
              >
                {{ t("creatorCenter.unfollow") }}
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- ── 激励 ──────────────────────────────────── -->
      <section v-else class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">{{ t("creatorCenter.incentiveTitle") }}</h2>
          <p class="cc-hint">{{ t("creatorCenter.incentiveHint") }}</p>
          <div v-if="incentive" class="cc-kpis">
            <div class="cc-kpi"><span>{{ t("creatorCenter.totalEarned") }}</span><strong>{{ incentive.total_credits }}</strong></div>
            <div class="cc-kpi"><span>{{ t("creatorCenter.recordCount") }}</span><strong>{{ incentive.record_count }}</strong></div>
            <div class="cc-kpi">
              <span>{{ t("creatorCenter.campaignReward") }}</span><strong>{{ incentive.by_category.campaign ?? 0 }}</strong>
            </div>
            <div class="cc-kpi">
              <span>{{ t("creatorCenter.dailyReward") }}</span><strong>{{ incentive.by_category.daily_reward ?? 0 }}</strong>
            </div>
          </div>
          <p v-if="incentive && incentive.list.length === 0" class="cc-empty">{{ t("creatorCenter.incentiveEmpty") }}</p>
          <table v-else-if="incentive" class="cc-table">
            <thead>
              <tr><th>{{ t("creatorCenter.thTime") }}</th><th>{{ t("creatorCenter.thSource") }}</th><th>{{ t("creatorCenter.thCredits") }}</th><th>{{ t("creatorCenter.thMemo") }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in incentive.list" :key="r.id">
                <td>{{ fmtTime(r.created_at) }}</td>
                <td><span class="cc-tag ghost">{{ r.category }}</span></td>
                <td class="cc-num">+{{ r.credits }}</td>
                <td class="cc-memo">{{ r.memo }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cc { display: flex; flex-direction: column; gap: var(--space-4); }
.cc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.cc-title { font-size: 24px; font-weight: 700; margin: 0; }
.cc-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.cc-tabs { display: flex; gap: 4px; background: var(--surface-2); padding: 3px; border-radius: var(--radius-2); }
.cc-tab {
  border: 0; background: transparent; color: var(--text-2); font-size: 13px;
  padding: 7px 14px; border-radius: var(--radius-1); cursor: pointer;
}
.cc-tab.active { background: var(--surface-1); color: var(--text-1); font-weight: 600; }
.cc-panel { display: flex; flex-direction: column; gap: var(--space-3); }
.cc-card {
  padding: var(--space-4); background: var(--surface-1);
  border: 1px solid var(--border-1); border-radius: var(--radius-3);
}
.cc-card-title { font-size: 15px; font-weight: 600; margin: 0 0 var(--space-2); }
.cc-hint { color: var(--text-3); font-size: 12px; margin: 0 0 var(--space-3); line-height: 1.6; }
.cc-alert {
  margin: 0; padding: var(--space-3); border-radius: var(--radius-2); font-size: 13px;
  background: color-mix(in srgb, var(--danger-1, #e03131) 12%, transparent); color: var(--danger-1, #e03131);
}
.cc-skeleton { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.cc-empty { padding: var(--space-5); text-align: center; color: var(--text-3); font-size: 13px; margin: 0; }
.cc-form { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.cc-input {
  flex: 1 1 220px; min-width: 160px; padding: 8px 10px; font-size: 13px;
  border: 1px solid var(--border-1); border-radius: var(--radius-2);
  background: var(--surface-1); color: var(--text-1);
}
.cc-input.sm { flex: 0 1 140px; min-width: 100px; padding: 5px 8px; }
.cc-btn {
  border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-1);
  font-size: 13px; padding: 7px 12px; border-radius: var(--radius-2); cursor: pointer;
}
.cc-btn.sm { padding: 5px 10px; font-size: 12px; }
.cc-btn.primary { background: var(--brand-1, #7e70ff); border-color: transparent; color: #fff; }
.cc-btn.danger { color: var(--danger-1, #e03131); border-color: color-mix(in srgb, var(--danger-1, #e03131) 40%, transparent); }
.cc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cc-link { border: 0; background: transparent; color: var(--brand-1, #7e70ff); cursor: pointer; font-size: 13px; }
.cc-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.cc-chip {
  border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-2);
  font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
}
.cc-chip.active { border-color: var(--brand-1, #7e70ff); color: var(--brand-1, #7e70ff); }
.cc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.cc-item {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-3); background: var(--surface-1);
  border: 1px solid var(--border-1); border-radius: var(--radius-2);
}
.cc-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cc-item-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cc-item-meta { margin: 0; color: var(--text-3); font-size: 12px; }
.cc-item-note { margin: 0; color: var(--danger-1, #e03131); font-size: 12px; }
.cc-item-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.cc-tag { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); font-size: 11px; }
.cc-tag.ghost { background: transparent; border: 1px solid var(--border-1); }
.cc-tag.s2 { color: #f08c00; }
.cc-tag.s3 { color: var(--success-1, #2f9e44); }
.cc-tag.s4 { color: var(--danger-1, #e03131); }
.cc-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.cc-tile {
  padding: var(--space-3); background: var(--surface-1); border: 1px solid var(--border-1);
  border-radius: var(--radius-3); display: flex; flex-direction: column; gap: 6px;
}
.cc-tile-title { font-size: 13px; font-weight: 600; }
.cc-tile-meta { margin: 0; color: var(--text-3); font-size: 12px; }
.cc-tile-actions { display: flex; gap: 6px; margin-top: auto; }
.cc-kv { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--space-3); margin: var(--space-3) 0 0; }
.cc-kv dt { color: var(--text-3); font-size: 12px; margin: 0; }
.cc-kv dd { margin: 2px 0 0; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); margin-bottom: var(--space-3); }
.cc-kpi {
  display: flex; flex-direction: column; gap: 4px; padding: var(--space-3);
  background: var(--surface-2); border-radius: var(--radius-2); font-size: 12px; color: var(--text-3);
}
.cc-kpi strong { font-size: 20px; color: var(--text-1); font-variant-numeric: tabular-nums; }
.cc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cc-table th { text-align: left; font-weight: 500; color: var(--text-3); padding: var(--space-2); border-bottom: 1px solid var(--border-1); }
.cc-table td { padding: var(--space-2); border-bottom: 1px solid var(--border-1); }
.cc-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--success-1, #2f9e44); }
.cc-memo { color: var(--text-3); font-size: 12px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1080px) {
  .cc-grid { grid-template-columns: repeat(2, 1fr); }
  .cc-kv { grid-template-columns: repeat(3, 1fr); }
  .cc-kpis { grid-template-columns: repeat(2, 1fr); }
}
</style>
