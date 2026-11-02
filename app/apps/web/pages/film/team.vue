<script setup lang="ts">
/**
 * 影视团队（竞品 /film/team 的对应页）
 *
 * 范围：影视版按团队空间开通（D6 方案 A）。本页只读展示 + 指路，不重复造团队管理：
 *   GET /cam/team/info      → 团队名/席位/影视开通
 *   GET /cam/team/members   → 成员（昵称/角色/状态/额度）
 * 邀请/角色分配仍走 /team（团队管理页），避免两套权限源。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const { t } = useI18n();
useHead({ title: () => t("filmTeam.metaTitle") });

interface TeamInfo {
  space_id: string;
  name: string;
  type: number;
  max_seats: number;
  used_seats: number;
  film_enabled: boolean;
}
interface MemberRow {
  user_id: string;
  role: number;
  role_code: string | null;
  role_level: number | null;
  nickname: string | null;
  status: number;
  credits_quota: number;
  joined_at: string | null;
}

const team = ref<TeamInfo | null>(null);
const members = ref<MemberRow[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    team.value = await api.get<TeamInfo>("/cam/team/info");
    const data = await api.get<{ list: MemberRow[]; total: number }>("/cam/team/members?page=1&page_size=50");
    members.value = data.list ?? [];
    total.value = data.total ?? members.value.length;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("filmTeam.loadFailed");
    team.value = null;
    members.value = [];
  } finally {
    loading.value = false;
  }
}

function roleLabel(m: MemberRow): string {
  if (m.role_code) return m.role_code;
  return m.role === 1 ? t("filmTeam.roleOwner") : t("filmTeam.roleMember");
}

onMounted(() => void load());
</script>

<template>
  <div class="ft">
    <header class="ft-head">
      <NuxtLink to="/film" class="ft-back">← {{ t("filmTeam.back") }}</NuxtLink>
      <h1>{{ t("filmTeam.title") }}</h1>
      <p class="ft-sub">{{ t("filmTeam.sub") }}</p>
    </header>

    <p v-if="loading" class="ft-state">{{ t("common.loading") }}</p>
    <div v-else-if="error" class="ft-state ft-state--err" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="ft-btn" @click="load">{{ t("common.retry") }}</button>
    </div>
    <div v-else-if="!team" class="ft-empty">
      <p>{{ t("filmTeam.noTeam") }}</p>
      <NuxtLink to="/team" class="ft-btn ft-btn--primary">{{ t("filmTeam.goTeam") }}</NuxtLink>
    </div>
    <template v-else>
      <section class="ft-card">
        <h2>{{ team.name }}</h2>
        <p class="ft-meta">
          {{ t("filmTeam.seats", { used: team.used_seats, max: team.max_seats }) }}
          <span class="sep">·</span>
          {{ team.film_enabled ? t("filmTeam.filmOn") : t("filmTeam.filmOff") }}
        </p>
        <NuxtLink to="/team" class="ft-btn">{{ t("filmTeam.manage") }}</NuxtLink>
      </section>

      <table class="ft-table">
        <thead>
          <tr>
            <th>{{ t("filmTeam.colMember") }}</th>
            <th>{{ t("filmTeam.colRole") }}</th>
            <th class="num">{{ t("filmTeam.colQuota") }}</th>
            <th>{{ t("filmTeam.colStatus") }}</th>
            <th>{{ t("filmTeam.colJoined") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.user_id">
            <td>{{ m.nickname || m.user_id.slice(-6) }}</td>
            <td>{{ roleLabel(m) }}</td>
            <td class="num">{{ m.credits_quota }}</td>
            <td>{{ m.status === 1 ? t("filmTeam.statusActive") : t("filmTeam.statusDisabled") }}</td>
            <td>{{ m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—" }}</td>
          </tr>
        </tbody>
      </table>
      <p class="ft-hint">{{ t("filmTeam.total", { n: total }) }}</p>
    </template>
  </div>
</template>

<style scoped>
.ft {
  padding: 20px 24px 48px;
  max-width: 1120px;
  margin: 0 auto;
  color: #2a2f3a;
}
.ft-back {
  display: inline-block;
  margin-bottom: 8px;
  color: #6b7280;
  text-decoration: none;
  font-size: 13px;
}
.ft-head h1 {
  font-size: 22px;
  font-weight: 600;
}
.ft-sub {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}
.ft-state {
  padding: 40px 0;
  text-align: center;
  color: #6b7280;
  font-size: 13px;
}
.ft-state--err {
  color: #b91c1c;
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}
.ft-empty,
.ft-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ft-card h2 {
  font-size: 16px;
  font-weight: 600;
}
.ft-meta {
  color: #6b7280;
  font-size: 13px;
}
.ft-sep {
  margin: 0 6px;
}
.ft-btn {
  align-self: flex-start;
  height: 30px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.ft-btn--primary {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
}
.ft-table {
  width: 100%;
  margin-top: 14px;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  font-size: 13px;
}
.ft-table th,
.ft-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f2f4;
  text-align: left;
}
.ft-table th {
  background: #f9fafb;
  font-weight: 600;
}
.ft-table .num {
  text-align: right;
}
.ft-hint {
  margin-top: 8px;
  color: #9ca3af;
  font-size: 12px;
}
</style>
