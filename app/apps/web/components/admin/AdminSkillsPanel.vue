<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { adminApi, isAdminAuthError } from "~/composables/useAdminApi";

/**
 * Skill 推荐位面板（`/v1/ops/agent-skills/*`，见 `agent-skills-admin.controller.ts`）。
 *
 * 为什么需要这个面板：`agent_skills.is_home_recommend` 此前**没有任何写入路径**，
 * 33 张平台卡该列永远是 false，C 端 `/agent-skills/plaza?is_home_recommend=1` 是死分支。
 * 本面板用 AdminGuard 提供唯一的编排入口（C 端 `PUT /agent-skills` 要求所有权，
 * 而平台卡 `space_id/owner_user_id` 都是 NULL，没人"拥有"它）。
 *
 * 两点与服务端对齐后才敢写的行为：
 * 1. 列表**只含平台卡**（`space_id IS NULL`）——所以没有"只看平台卡"这个筛选开关：
 *    接口本身就把范围钉死了，给一个恒真的复选框只会误导运营（唯一真实可用的筛选是
 *    `is_home_recommend` 与 `category`，两者都是控制器里真实存在的 query）。
 * 2. `PATCH :id` 只接受 `{is_home_recommend}`，返回 `{skill, changed}`，幂等；
 *    团队自建卡传进来会 400101（`only platform skills ... can be curated`）。
 */

const { t } = useI18n();

interface AgentSkillRow {
  skill_id: string;
  name: string;
  name_en: string;
  summary: string;
  cover_uri: string | null;
  category: string;
  category_label: string;
  prompt_template: string;
  config: Record<string, unknown>;
  visibility: number;
  use_count: number;
  favorite_count: number;
  status: number;
  is_favorite: boolean;
  is_mine: boolean;
  owner_type: 1 | 2;
  is_home_recommend: boolean;
  owner_user_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SkillPage {
  list: AgentSkillRow[];
  total: number;
  page: number;
  page_size: number;
}

const PAGE_SIZE = 20;

/** 分类枚举来自 `agent-skills.catalog.ts` 的 `SKILL_CATEGORIES`（key 是契约，label 走 i18n） */
const SKILL_CATEGORIES = [
  { key: "batch_image", labelKey: "adminSkills.catBatchImage" },
  { key: "video", labelKey: "adminSkills.catVideo" },
  { key: "script", labelKey: "adminSkills.catScript" },
  { key: "skill", labelKey: "adminSkills.catSkill" },
  { key: "custom", labelKey: "adminSkills.catCustom" },
] as const;

const rows = ref<AgentSkillRow[]>([]);
const total = ref(0);
const page = ref(1);
const onlyRecommend = ref(false);
const category = ref("");
const loading = ref(false);
const busy = ref("");
const error = ref("");

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

/** 分类 key → 本地文案（不直接用 DTO 的 `category_label`：那是中文常量投影，其它语言会漏中文） */
function categoryLabel(key: string): string {
  const found = SKILL_CATEGORIES.find((item) => item.key === key);
  return found ? t(found.labelKey) : key;
}

/**
 * 只有身份类错误才回登录页，其余就地显示（与契约 §4.3 一致）：
 * 一个列表接口 500 就把运营踢下线，等于把"刷新一次就好"变成"重新登录"。
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
 * `GET /ops/agent-skills?page&page_size&is_home_recommend&category`
 * `is_home_recommend` 在控制器里接受 `1/0/true/false`，这里用 `1` 走 query string。
 */
async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const query = new URLSearchParams({
      page: String(page.value),
      page_size: String(PAGE_SIZE),
    });
    if (onlyRecommend.value) query.set("is_home_recommend", "1");
    if (category.value) query.set("category", category.value);
    const data = await adminApi<SkillPage>(`/ops/agent-skills?${query.toString()}`);
    rows.value = data.list;
    total.value = data.total;
    page.value = data.page;
    // 取消推荐会让当前页最后一条"往下沉"到下一页，出现空页时回退一页，避免误判为没数据
    if (data.list.length === 0 && data.total > 0 && page.value > 1) {
      page.value -= 1;
      await load();
    }
  } catch (e) {
    rows.value = [];
    total.value = 0;
    await fail(e, "adminSkills.loadFailed");
  } finally {
    loading.value = false;
  }
}

function goPage(next: number): void {
  page.value = Math.min(Math.max(1, next), pages.value);
  void load();
}

/**
 * 切换推荐位（`PATCH /ops/agent-skills/:id {is_home_recommend}`）。
 * 写完后**重拉列表**而不是只改本行：列表排序是 `is_home_recommend desc, use_count desc`，
 * 只改本行会让"已经上了首页的卡"留在原位，运营看到的分组就是错的。
 */
async function toggleRecommend(row: AgentSkillRow): Promise<void> {
  busy.value = row.skill_id;
  error.value = "";
  try {
    await adminApi<{ skill: AgentSkillRow; changed: boolean }>(`/ops/agent-skills/${row.skill_id}`, {
      method: "PATCH",
      body: { is_home_recommend: !row.is_home_recommend },
    });
    await load();
  } catch (e) {
    await fail(e, "adminSkills.opFailed");
  } finally {
    busy.value = "";
  }
}

function resetFilters(): void {
  onlyRecommend.value = false;
  category.value = "";
  void goPage(1);
}

onMounted(() => void load());
</script>

<template>
  <section class="card skills">
    <header class="panel-head">
      <h2>{{ t("adminSkills.title") }}</h2>
      <p class="muted small">{{ t("adminSkills.hint") }}</p>
    </header>

    <p class="muted small">{{ t("adminSkills.platformOnly") }}</p>

    <div class="filters">
      <label class="check">
        <input v-model="onlyRecommend" type="checkbox" @change="goPage(1)" />
        <span>{{ t("adminSkills.onlyRecommend") }}</span>
      </label>
      <select v-model="category" class="input narrow" @change="goPage(1)">
        <option value="">{{ t("adminSkills.allCategories") }}</option>
        <option v-for="item in SKILL_CATEGORIES" :key="item.key" :value="item.key">
          {{ t(item.labelKey) }}
        </option>
      </select>
      <button type="button" class="mini" :disabled="loading" @click="goPage(1)">{{ t("adminSkills.refresh") }}</button>
      <button type="button" class="mini" :disabled="loading" @click="resetFilters()">{{ t("adminSkills.reset") }}</button>
      <span class="muted small">{{ t("adminSkills.totalN", { n: total }) }}</span>
    </div>

    <p v-if="error" class="err">
      {{ error }}
      <button type="button" class="mini" @click="load()">{{ t("adminSkills.retry") }}</button>
    </p>

    <p v-if="loading" class="muted">{{ t("adminSkills.loading") }}</p>
    <p v-else-if="rows.length === 0" class="muted">{{ t("adminSkills.empty") }}</p>
    <template v-else>
      <div class="row skill-row head-row">
        <span>{{ t("adminSkills.colName") }}</span>
        <span>{{ t("adminSkills.colNameEn") }}</span>
        <span>{{ t("adminSkills.colCategory") }}</span>
        <span>{{ t("adminSkills.colOwnerType") }}</span>
        <span>{{ t("adminSkills.colUseCount") }}</span>
        <span>{{ t("adminSkills.colStatus") }}</span>
        <span>{{ t("adminSkills.colRecommend") }}</span>
        <span>{{ t("adminSkills.colOps") }}</span>
      </div>
      <div v-for="row in rows" :key="row.skill_id" class="row skill-row">
        <span class="ellipsis" :title="row.summary">{{ row.name }}</span>
        <span class="mono ellipsis">{{ row.name_en || "-" }}</span>
        <span class="muted">{{ categoryLabel(row.category) }}</span>
        <span class="muted">{{ row.owner_type === 1 ? t("adminSkills.ownerPlatform") : t("adminSkills.ownerTeam") }}</span>
        <span class="muted">{{ row.use_count }}</span>
        <span :class="row.status === 1 ? 'state-on' : 'state-off'">
          {{ row.status === 1 ? t("adminSkills.statusOn") : t("adminSkills.statusOff") }}
        </span>
        <span :class="row.is_home_recommend ? 'state-on' : 'state-off'">
          {{ row.is_home_recommend ? t("adminSkills.recOn") : t("adminSkills.recOff") }}
        </span>
        <span class="ops">
          <!-- 状态机只有"已上/未上"两种取值，按当前值渲染相反动作，避免出现点了无效的按钮 -->
          <button
            type="button"
            class="mini"
            :class="{ danger: row.is_home_recommend }"
            :disabled="busy === row.skill_id || row.owner_type !== 1"
            @click="toggleRecommend(row)"
          >
            {{ row.is_home_recommend ? t("adminSkills.takeOff") : t("adminSkills.putOn") }}
          </button>
        </span>
      </div>
    </template>

    <div v-if="total > PAGE_SIZE" class="pager">
      <button type="button" class="mini" :disabled="page <= 1 || loading" @click="goPage(page - 1)">
        {{ t("adminSkills.pagePrev") }}
      </button>
      <span class="muted small">{{ t("adminSkills.pageInfo", { page: page, pages: pages }) }}</span>
      <button type="button" class="mini" :disabled="page >= pages || loading" @click="goPage(page + 1)">
        {{ t("adminSkills.pageNext") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 风格照 `pages/admin/index.vue` 的 .card/.row/.mini/.input 复制（scoped，不引全局新样式） */
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
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.check {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
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
  min-width: 110px;
  max-width: 150px;
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
.skill-row {
  grid-template-columns: 1.8fr 1.2fr 0.9fr 0.8fr 0.7fr 0.8fr 0.9fr 1.1fr;
}
.ops {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
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
  .skill-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
