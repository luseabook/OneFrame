<script setup lang="ts">
/**
 * 新建影视项目（竞品 /film-creation 的对应页）
 *
 * 范围：影视版挂团队空间（D6，方案 A）。创建流程复用既有接口：
 *   POST /film/projects/:id/task-tables      ← 第一张表用项目名
 *   POST /film/projects/:id/task-tables/ensure-presets ← 补预置表（分镜任务表 / 资产需求表，幂等）
 * project_id 由客户端生成（服务端项目本体表未建，是不透明指针，与 /film 列表页同一做法）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const toast = useToast();
const router = useRouter();
const { t } = useI18n();
useHead({ title: () => t("filmCreate.metaTitle") });

interface TeamInfo {
  space_id: string;
  name: string;
  type: number;
  film_enabled: boolean;
}
const team = ref<TeamInfo | null>(null);
const teamLoading = ref(true);
/** 影视版是商务开通制（与竞品 func-whitelist?scene=ai_film 同一判据），未开通时不给建，避免提交后 403 */
const filmWhitelisted = ref(false);

const name = ref("");
const creating = ref(false);
const error = ref("");
const teamsEnabled = computed(() => Boolean(team.value && team.value.type === 2));

function generateProjectId(): string {
  return String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999)));
}

async function loadTeam(): Promise<void> {
  teamLoading.value = true;
  try {
    team.value = await api.get<TeamInfo>("/cam/team/info");
    const wl = await api.get<{ check: boolean }>("/func-whitelist?scene=ai_film");
    filmWhitelisted.value = Boolean(wl.check);
  } catch {
    team.value = null;
    filmWhitelisted.value = false;
  } finally {
    teamLoading.value = false;
  }
}

async function create(): Promise<void> {
  const title = name.value.trim();
  if (!title) {
    error.value = t("filmCreate.nameRequired");
    return;
  }
  if (title.length > 50) {
    error.value = t("filmCreate.nameTooLong");
    return;
  }
  if (!teamsEnabled.value) {
    error.value = t("filmCreate.needTeam");
    return;
  }
  creating.value = true;
  error.value = "";
  const projectId = generateProjectId();
  try {
    await api.post(`/film/projects/${projectId}/task-tables`, { name: title });
    await api.post(`/film/projects/${projectId}/task-tables/ensure-presets`);
    toast.success(t("filmCreate.created"));
    await router.push(`/film/${projectId}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("filmCreate.failed");
  } finally {
    creating.value = false;
  }
}

onMounted(() => void loadTeam());
</script>

<template>
  <div class="fc">
    <header class="fc-head">
      <NuxtLink to="/film" class="fc-back">← {{ t("filmCreate.back") }}</NuxtLink>
      <h1>{{ t("filmCreate.title") }}</h1>
      <p class="fc-sub">{{ t("filmCreate.sub") }}</p>
    </header>

    <p v-if="teamLoading" class="fc-hint">{{ t("common.loading") }}</p>
    <div v-else-if="!teamsEnabled" class="fc-block" role="alert">
      <p>{{ t("filmCreate.needTeam") }}</p>
      <NuxtLink to="/team" class="fc-btn">{{ t("filmCreate.goTeam") }}</NuxtLink>
    </div>
    <div v-else-if="!filmWhitelisted" class="fc-block" role="alert">
      <p>{{ t("filmCreate.notWhitelisted") }}</p>
      <NuxtLink to="/film" class="fc-btn">{{ t("filmCreate.back") }}</NuxtLink>
    </div>

    <form v-else class="fc-form" @submit.prevent="create">
      <label class="fc-label" for="fc-name">{{ t("filmCreate.nameLabel") }}</label>
      <input
        id="fc-name"
        v-model="name"
        class="fc-input"
        maxlength="50"
        :placeholder="t('filmCreate.namePlaceholder')"
      />
      <p class="fc-count">{{ name.length }}/50</p>

      <fieldset class="fc-preset">
        <legend>{{ t("filmCreate.presetsTitle") }}</legend>
        <ul>
          <li>▤ {{ t("filmCreate.presetStoryboard") }}</li>
          <li>▤ {{ t("filmCreate.presetAssets") }}</li>
        </ul>
        <p class="fc-hint">{{ t("filmCreate.presetsHint") }}</p>
      </fieldset>

      <p v-if="error" class="fc-error" role="alert">{{ error }}</p>

      <div class="fc-actions">
        <NuxtLink to="/film" class="fc-btn">{{ t("common.cancel") }}</NuxtLink>
        <button type="submit" class="fc-btn fc-btn--primary" :disabled="creating || !name.trim()">
          {{ creating ? t("filmCreate.creating") : t("filmCreate.create") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.fc {
  padding: 20px 24px 48px;
  max-width: 720px;
  margin: 0 auto;
  color: #2a2f3a;
}
.fc-head {
  margin-bottom: 18px;
}
.fc-back {
  display: inline-block;
  margin-bottom: 8px;
  color: #6b7280;
  text-decoration: none;
  font-size: 13px;
}
.fc-head h1 {
  font-size: 22px;
  font-weight: 600;
}
.fc-sub {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
.fc-form,
.fc-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
}
.fc-label {
  font-size: 13px;
  font-weight: 600;
}
.fc-input {
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 14px;
}
.fc-count {
  align-self: flex-end;
  color: #9ca3af;
  font-size: 12px;
}
.fc-preset {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.fc-preset legend {
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
}
.fc-preset ul {
  margin: 6px 0;
  padding-left: 0;
  list-style: none;
  color: #374151;
  font-size: 13px;
}
.fc-hint {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.fc-error {
  color: #b91c1c;
  font-size: 13px;
}
.fc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.fc-btn {
  height: 36px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}
.fc-btn--primary {
  background: #7c3aed;
  border-color: #7c3aed;
  color: #fff;
}
.fc-btn[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
