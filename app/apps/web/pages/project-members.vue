<script setup lang="ts">
import type { ProjectDto } from "~/types/api";

/**
 * 项目成员（对齐竞品 `/project-members`，第 132 批）。
 *
 * 竞品把「团队成员」与「成员↔项目绑定」拆成两处：团队页管人，本页管"谁在这个项目里"。
 * 我方后端早已有这三条端点（`GET /cam/project/:project_id/members`、
 * `POST .../members/bind`、`POST .../members/delete`），此前只有接口没有页面。
 *
 * 口径说明（照后端注释，不自行发明）：
 * - `project_kind`：1 脚本项目、2 影视版；本页只处理脚本项目（列表来自 `/projects`）；
 * - `GET .../members` 实际返回**本空间全量绑定**，由前端按 `project_id` 过滤
 *   （cam 模块不依赖 script/film 表，后端无法按项目 join）；
 * - 绑定是幂等的（唯一索引 + onConflictDoUpdate），重复点不会生成两行。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("projectMembers.metaTitle") });

const api = useApi();
const route = useRoute();

interface MemberDto {
  user_id: string;
  nickname: string | null;
  account: string | null;
  role_code: string | null;
  status: number;
}
interface BindingDto {
  user_id: string;
  project_kind: number;
  project_id: string;
  participation_type: number;
}

const projects = ref<ProjectDto[]>([]);
const members = ref<MemberDto[]>([]);
const bindings = ref<BindingDto[]>([]);
const selectedProjectId = ref(String(route.query.project ?? ""));
const keyword = ref("");
const loading = ref(true);
const bindingsLoading = ref(false);
const error = ref("");
const notice = ref("");
const busyUserId = ref("");

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [projectRes, memberRes] = await Promise.all([
      api.get<{ list: ProjectDto[]; total: number }>("/projects?page=1&page_size=100"),
      api.get<{ list: MemberDto[]; total: number }>("/cam/team/members?page=1&page_size=200"),
    ]);
    projects.value = projectRes.list;
    members.value = memberRes.list;
    if (!selectedProjectId.value || !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = projects.value[0]?.id ?? "";
    }
    await loadBindings();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectMembers.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function loadBindings(): Promise<void> {
  if (!selectedProjectId.value) {
    bindings.value = [];
    return;
  }
  bindingsLoading.value = true;
  try {
    const res = await api.get<{ list: BindingDto[] }>(`/cam/project/${selectedProjectId.value}/members`);
    bindings.value = res.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectMembers.loadFailed");
    bindings.value = [];
  } finally {
    bindingsLoading.value = false;
  }
}

watch(selectedProjectId, () => {
  notice.value = "";
  void loadBindings();
});

const boundIds = computed(() => {
  const ids = new Set<string>();
  for (const b of bindings.value) {
    if (b.project_id === selectedProjectId.value && b.project_kind === 1) ids.add(b.user_id);
  }
  return ids;
});

const visibleMembers = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return members.value;
  return members.value.filter((m) =>
    `${m.nickname ?? ""} ${m.account ?? ""} ${m.role_code ?? ""}`.toLowerCase().includes(k),
  );
});

const boundCount = computed(() => members.value.filter((m) => boundIds.value.has(m.user_id)).length);

async function bind(member: MemberDto): Promise<void> {
  if (!selectedProjectId.value || busyUserId.value) return;
  busyUserId.value = member.user_id;
  error.value = "";
  try {
    await api.post(`/cam/project/${selectedProjectId.value}/members/bind`, {
      user_id: member.user_id,
      project_kind: 1,
      participation_type: 1,
    });
    notice.value = t("projectMembers.saved");
    await loadBindings();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectMembers.actionFailed");
  } finally {
    busyUserId.value = "";
  }
}

async function unbind(member: MemberDto): Promise<void> {
  if (!selectedProjectId.value || busyUserId.value) return;
  busyUserId.value = member.user_id;
  error.value = "";
  try {
    await api.post(`/cam/project/${selectedProjectId.value}/members/delete`, {
      user_id: member.user_id,
      project_kind: 1,
    });
    notice.value = t("projectMembers.saved");
    await loadBindings();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectMembers.actionFailed");
  } finally {
    busyUserId.value = "";
  }
}

onMounted(() => void loadAll());
</script>

<template>
  <div class="pm">
    <header class="pm-head">
      <div>
        <h1 class="pm-title">{{ t("projectMembers.title") }}</h1>
        <p class="pm-sub">{{ t("projectMembers.sub") }}</p>
      </div>
      <div class="pm-actions">
        <SelectField
          class="pm-project"
          label=""
          :options="projects.map((p) => ({ value: p.id, label: p.title }))"
          :model-value="selectedProjectId"
          @update:model-value="selectedProjectId = String($event)"
        />
        <Button variant="secondary" size="sm" :disabled="loading" @click="loadAll">
          {{ t("projectMembers.retry") }}
        </Button>
      </div>
    </header>

    <p v-if="error" class="pm-alert pm-alert--err" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="pm-alert pm-alert--ok">{{ notice }}</p>

    <div v-if="loading" class="pm-skel" aria-busy="true">
      <div class="pm-skel__bar" />
      <div class="pm-skel__block" />
    </div>

    <EmptyState
      v-else-if="projects.length === 0"
      :title="t('projectMembers.emptyProjects')"
      :description="t('projectMembers.emptyProjectsDesc')"
    />

    <section v-else class="pm-panel">
      <div class="pm-toolbar">
        <input v-model="keyword" class="pm-search" type="search" :placeholder="t('projectMembers.search')" />
        <span class="pm-count">{{ t("projectMembers.boundCount", { bound: boundCount, total: members.length }) }}</span>
      </div>

      <EmptyState v-if="members.length === 0" :title="t('projectMembers.emptyMembers')" />
      <table v-else class="pm-table">
        <thead>
          <tr>
            <th>{{ t("projectMembers.colMember") }}</th>
            <th>{{ t("projectMembers.colRole") }}</th>
            <th>{{ t("projectMembers.colStatus") }}</th>
            <th class="pm-col-action">{{ t("projectMembers.colAction") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in visibleMembers" :key="m.user_id">
            <td>
              <div class="pm-member">
                <span class="pm-member__name">{{ m.nickname || t("projectMembers.unnamed") }}</span>
                <span v-if="m.account" class="pm-member__account">{{ m.account }}</span>
              </div>
            </td>
            <td>{{ m.role_code || "—" }}</td>
            <td>
              <span class="pm-status" :class="{ 'pm-status--off': m.status !== 1 }">
                {{ m.status === 1 ? t("projectMembers.statusActive") : t("projectMembers.statusDisabled") }}
              </span>
            </td>
            <td class="pm-col-action">
              <span v-if="bindingsLoading" class="pm-loading">{{ t("projectMembers.loading") }}</span>
              <template v-else-if="boundIds.has(m.user_id)">
                <span class="pm-bound">{{ t("projectMembers.bound") }}</span>
                <Button
                  variant="text"
                  size="sm"
                  :disabled="busyUserId === m.user_id"
                  @click="unbind(m)"
                >
                  {{ t("projectMembers.unbind") }}
                </Button>
              </template>
              <Button
                v-else
                variant="secondary"
                size="sm"
                :disabled="busyUserId === m.user_id"
                @click="bind(m)"
              >
                {{ t("projectMembers.bind") }}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.pm {
  padding: 8px 24px 40px;
  color: var(--text-1);
}
.pm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  max-width: 1126px;
  margin: 8px auto 16px;
}
.pm-title {
  margin: 0 0 4px;
  font-size: 22px;
  line-height: 1.3;
  font-weight: 600;
}
.pm-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.pm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pm-project {
  min-width: 220px;
}
.pm-alert {
  max-width: 1126px;
  margin: 0 auto 12px;
  padding: 10px 14px;
  border-radius: var(--radius-control);
  font-size: 13px;
}
.pm-alert--err {
  border: 1px solid var(--danger, #f56c6c);
  color: var(--danger, #f56c6c);
}
.pm-alert--ok {
  border: 1px solid var(--success, #67c23a);
  color: var(--success, #67c23a);
}
.pm-skel {
  max-width: 1126px;
  margin: 0 auto;
  display: grid;
  gap: 12px;
}
.pm-skel__bar,
.pm-skel__block {
  border-radius: var(--radius-control);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  animation: pm-pulse 1.4s ease-in-out infinite;
}
.pm-skel__bar {
  height: 18px;
  width: 30%;
}
.pm-skel__block {
  height: 320px;
}
@keyframes pm-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
.pm-panel {
  max-width: 1126px;
  margin: 0 auto;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  padding: 12px 16px 16px;
}
.pm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.pm-search {
  height: 32px;
  width: 260px;
  padding: 0 10px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.pm-search::placeholder {
  color: var(--text-4);
}
.pm-count {
  color: var(--text-3);
  font-size: 12px;
}
.pm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.pm-table th,
.pm-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--panel-line);
  text-align: left;
}
.pm-table th {
  color: var(--text-3);
  font-weight: 500;
  font-size: 12px;
}
.pm-col-action {
  text-align: right;
  white-space: nowrap;
}
.pm-member {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pm-member__name {
  color: var(--text-1);
}
.pm-member__account {
  color: var(--text-3);
  font-size: 12px;
}
.pm-status {
  color: var(--success, #67c23a);
  font-size: 12px;
}
.pm-status--off {
  color: var(--text-3);
}
.pm-bound {
  margin-right: 8px;
  color: var(--text-3);
  font-size: 12px;
}
.pm-loading {
  color: var(--text-3);
  font-size: 12px;
}
@media (max-width: 900px) {
  .pm-head {
    flex-direction: column;
  }
  .pm-search {
    width: 100%;
  }
  .pm-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>