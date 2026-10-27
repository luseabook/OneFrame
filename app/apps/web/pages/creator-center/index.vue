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
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "works", label: "我的作品" },
  { key: "square", label: "作品广场" },
  { key: "profile", label: "我的资料" },
  { key: "fans", label: "粉丝 / 关注" },
  { key: "incentive", label: "我的激励" },
];
const tab = ref<TabKey>("works");

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

const STATUS_FILTERS: Array<{ value: number; label: string }> = [
  { value: 0, label: "全部" },
  { value: 1, label: "草稿" },
  { value: 2, label: "待审" },
  { value: 3, label: "已通过" },
  { value: 4, label: "已驳回" },
  { value: 5, label: "已下架" },
];

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
    errorMsg.value = (e as Error).message || "创作者中心加载失败";
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
    toast.error((e as Error).message || "操作失败");
  } finally {
    busy.value = "";
  }
}

async function createWork() {
  if (!draft.title.trim()) {
    toast.error("请填写作品标题");
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
    toast.success("已存为草稿，可继续编辑后送审");
    await loadWorks();
    if (profile.value) profile.value = await api.get<CreatorProfileDto>("/crc/user/info");
  });
}

async function changeStatus(work: CreatorWorkDto, action: "submit" | "resubmit" | "offline" | "approve" | "reject") {
  if (action === "reject" && !rejectNote.value.trim()) {
    toast.error("驳回请填写原因（作者要据此修改）");
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
        ? "已送审，等审核通过后才会出现在公开列表"
        : action === "approve"
          ? "已通过，作品已公开"
          : action === "reject"
            ? "已驳回并留下原因"
            : "已下架",
    );
    await loadWorks();
    await loadSquare();
  });
}

async function removeWork(work: CreatorWorkDto, mode: "delete" | "audit-fail") {
  const hint =
    mode === "audit-fail"
      ? `删除被驳回的作品「${work.title}」？删除后不可恢复。`
      : `删除作品「${work.title}」？删除后不可恢复。`;
  if (!window.confirm(hint)) return;
  await withBusy(`del:${work.id}`, async () => {
    await api.post(mode === "audit-fail" ? "/crc/assets/audit-fail/del" : "/crc/assets/delete", {
      asset_id: work.id,
    });
    toast.success("已删除");
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
    if (!res.liked && res.like_count === 0) toast.info("已取消点赞");
  });
}

async function toggleFollow(row: CreatorFollowRowDto, following: boolean) {
  await withBusy(`follow:${row.user_id}`, async () => {
    const res = await api.post<{ following: boolean; follower_count: number }>("/crc/user/follows/action", {
      creator_user_id: row.user_id,
      action: following ? "unfollow" : "follow",
    });
    toast.success(res.following ? `已关注 ${row.nickname ?? row.user_id}` : "已取消关注");
    await loadFans();
  });
}

async function saveProfile() {
  if (!profileForm.nickname.trim()) {
    toast.error("昵称不能为空");
    return;
  }
  await withBusy("profile", async () => {
    profile.value = await api.post<CreatorProfileDto>("/crc/user/update", {
      nickname: profileForm.nickname.trim(),
      bio: profileForm.bio.trim(),
    });
    toast.success("资料已更新");
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
        <h1 class="cc-title">创作者中心</h1>
        <p class="cc-sub">
          <template v-if="profile">
            {{ profile.nickname }} · 作品 {{ profile.works.approved }}/{{ profile.works.total }} 已通过 ·
            粉丝 {{ profile.follower_count }}
          </template>
          <template v-else>投稿、涨粉与激励</template>
        </p>
      </div>
      <button type="button" class="cc-btn" :disabled="loading" @click="loadAll">刷新</button>
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
      <button type="button" class="cc-link" @click="loadAll">重试</button>
    </p>

    <div v-if="loading" class="cc-skeleton">加载中…</div>

    <template v-else>
      <!-- ── 我的作品 ───────────────────────────────── -->
      <section v-if="tab === 'works'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">投稿新作品</h2>
          <p class="cc-hint">
            先存草稿，再点「送审」进入人工审核；<strong>只有审核通过（状态=已通过）的作品才会出现在公开列表</strong>。
          </p>
          <div class="cc-form">
            <input v-model="draft.title" class="cc-input" maxlength="80" placeholder="作品标题（必填）" />
            <input v-model="draft.uri" class="cc-input" maxlength="500" placeholder="素材地址（如 s3://bucket/clip.mp4）" />
            <input v-model="draft.summary" class="cc-input" maxlength="200" placeholder="一句话简介（可选）" />
            <button type="button" class="cc-btn primary" :disabled="busy === 'create'" @click="createWork">
              {{ busy === "create" ? "创建中…" : "创建草稿" }}
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

        <p v-if="works.length === 0" class="cc-empty">
          还没有作品。上面填个标题点「创建草稿」就能开始投稿。
        </p>
        <ul v-else class="cc-list">
          <li v-for="w in works" :key="w.id" class="cc-item">
            <div class="cc-item-main">
              <div class="cc-item-title">
                {{ w.title }}
                <span class="cc-tag" :class="`s${w.status}`">{{ w.status_label }}</span>
                <span class="cc-tag ghost">{{ w.kind_label }}</span>
              </div>
              <p class="cc-item-meta">
                浏览 {{ w.view_count }} · 点赞 {{ w.like_count }} · 更新 {{ fmtTime(w.updated_at) }}
              </p>
              <p v-if="w.review_note" class="cc-item-note">审核意见：{{ w.review_note }}</p>
            </div>
            <div class="cc-item-actions">
              <button
                v-if="w.status === 1 || w.status === 4"
                type="button"
                class="cc-btn primary sm"
                :disabled="busy === `submit:${w.id}`"
                @click="changeStatus(w, 'submit')"
              >
                送审
              </button>
              <button
                v-if="w.status === 5"
                type="button"
                class="cc-btn primary sm"
                :disabled="busy === `resubmit:${w.id}`"
                @click="changeStatus(w, 'resubmit')"
              >
                重新送审
              </button>
              <template v-if="w.status === 2 && canReview">
                <button
                  type="button"
                  class="cc-btn sm"
                  :disabled="busy === `approve:${w.id}`"
                  @click="changeStatus(w, 'approve')"
                >
                  通过
                </button>
                <input v-model="rejectNote" class="cc-input sm" maxlength="200" placeholder="驳回原因" />
                <button
                  type="button"
                  class="cc-btn danger sm"
                  :disabled="busy === `reject:${w.id}`"
                  @click="changeStatus(w, 'reject')"
                >
                  驳回
                </button>
              </template>
              <button
                v-if="w.status === 3"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `offline:${w.id}`"
                @click="changeStatus(w, 'offline')"
              >
                下架
              </button>
              <button
                v-if="w.status === 4"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `del:${w.id}`"
                @click="removeWork(w, 'audit-fail')"
              >
                删除
              </button>
              <button
                v-if="w.status === 1 || w.status === 5"
                type="button"
                class="cc-btn danger sm"
                :disabled="busy === `del:${w.id}`"
                @click="removeWork(w, 'delete')"
              >
                删除
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── 作品广场（点赞 / 关注） ──────────────────── -->
      <section v-else-if="tab === 'square'" class="cc-panel">
        <p class="cc-hint">
          这里只显示<strong>审核通过</strong>的作品。点赞与关注都是幂等接口：重复点不会重复计数。
        </p>
        <p v-if="square.length === 0" class="cc-empty">还没有公开作品。等你的作品审核通过后就会出现在这里。</p>
        <ul v-else class="cc-grid">
          <li v-for="w in square" :key="w.id" class="cc-tile">
            <div class="cc-tile-title">{{ w.title }}</div>
            <p class="cc-tile-meta">
              {{ w.creator?.nickname || w.kind_label }} · 浏览 {{ w.view_count }}
            </p>
            <div class="cc-tile-actions">
              <button type="button" class="cc-btn sm" :disabled="busy === `like:${w.id}`" @click="toggleLike(w)">
                {{ w.liked ? "已赞" : "点赞" }} {{ w.like_count }}
              </button>
              <button
                v-if="w.creator_user_id !== profile?.user_id"
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${w.creator_user_id}`"
                @click="toggleFollow({ user_id: w.creator_user_id, nickname: w.creator?.nickname ?? null }, false)"
              >
                关注作者
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── 资料 ──────────────────────────────────── -->
      <section v-else-if="tab === 'profile'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">对外资料</h2>
          <p class="cc-hint">昵称与简介会显示在作品广场与粉丝列表里。</p>
          <div class="cc-form">
            <input v-model="profileForm.nickname" class="cc-input" maxlength="30" placeholder="昵称" />
            <textarea v-model="profileForm.bio" class="cc-input" rows="3" maxlength="500" placeholder="简介" />
            <button type="button" class="cc-btn primary" :disabled="busy === 'profile'" @click="saveProfile">
              {{ busy === "profile" ? "保存中…" : "保存资料" }}
            </button>
          </div>
          <dl v-if="profile" class="cc-kv">
            <div><dt>作品总数</dt><dd>{{ profile.works.total }}</dd></div>
            <div><dt>已通过</dt><dd>{{ profile.works.approved }}</dd></div>
            <div><dt>待审</dt><dd>{{ profile.works.pending }}</dd></div>
            <div><dt>已驳回</dt><dd>{{ profile.works.rejected }}</dd></div>
            <div><dt>总浏览</dt><dd>{{ profile.view_count }}</dd></div>
            <div><dt>总获赞</dt><dd>{{ profile.like_count }}</dd></div>
          </dl>
        </div>
      </section>

      <!-- ── 粉丝 / 关注 ────────────────────────────── -->
      <section v-else-if="tab === 'fans'" class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">我的粉丝（{{ fans.length }}）</h2>
          <p v-if="fans.length === 0" class="cc-empty">还没有粉丝。公开作品被点赞/关注后会出现在这里。</p>
          <ul v-else class="cc-list">
            <li v-for="f in fans" :key="f.user_id" class="cc-item">
              <span class="cc-item-title">{{ f.nickname || f.user_id }}</span>
              <button
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${f.user_id}`"
                @click="toggleFollow(f, false)"
              >
                回关
              </button>
            </li>
          </ul>
        </div>
        <div class="cc-card">
          <h2 class="cc-card-title">我关注的人（{{ follows.length }}）</h2>
          <p v-if="follows.length === 0" class="cc-empty">还没关注任何人。去「作品广场」看到喜欢的作者就关注吧。</p>
          <ul v-else class="cc-list">
            <li v-for="f in follows" :key="f.user_id" class="cc-item">
              <span class="cc-item-title">{{ f.nickname || f.user_id }}</span>
              <span class="cc-item-meta">粉丝 {{ f.follower_count ?? 0 }}</span>
              <button
                type="button"
                class="cc-btn sm"
                :disabled="busy === `follow:${f.user_id}`"
                @click="toggleFollow(f, true)"
              >
                取消关注
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- ── 激励 ──────────────────────────────────── -->
      <section v-else class="cc-panel">
        <div class="cc-card">
          <h2 class="cc-card-title">我的激励</h2>
          <p class="cc-hint">
            激励是**只读视图**：数据来自账本的 gift 流入（活动奖励、每日奖励、兑换码、邀请奖励），
            发放动作在各自模块走账本，这里只做汇总。
          </p>
          <div v-if="incentive" class="cc-kpis">
            <div class="cc-kpi"><span>累计获得</span><strong>{{ incentive.total_credits }}</strong></div>
            <div class="cc-kpi"><span>记录条数</span><strong>{{ incentive.record_count }}</strong></div>
            <div class="cc-kpi">
              <span>活动奖励</span><strong>{{ incentive.by_category.campaign ?? 0 }}</strong>
            </div>
            <div class="cc-kpi">
              <span>每日奖励</span><strong>{{ incentive.by_category.daily_reward ?? 0 }}</strong>
            </div>
          </div>
          <p v-if="incentive && incentive.list.length === 0" class="cc-empty">还没有激励记录。</p>
          <table v-else-if="incentive" class="cc-table">
            <thead>
              <tr><th>时间</th><th>来源</th><th>积分</th><th>备注</th></tr>
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
