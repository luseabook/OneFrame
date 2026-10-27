<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "~/composables/useApi";
import type { AgentSkill, AgentSkillPage } from "~/types/api";

/**
 * Skill 卡选择抽屉（竞品「技能广场」：`routes.txt:379-385`）。
 *
 * 三个 tab 对应后端三个列表端点（plaza / mine / favorites），共用同一份卡片形状。
 * 为什么抽屉自带新建与删除：`POST /agent-skills`、`DELETE /agent-skills/:id` 是 8 端点之一，
 * 只做「选择」会让"我的卡"永远为空、端点在 UI 上无处可点（任务书要求页面可点）。
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "pick", skill: AgentSkill): void;
}>();

const api = useApi();

type TabKey = "plaza" | "mine" | "favorites";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "plaza", label: "广场" },
  { key: "mine", label: "我的" },
  { key: "favorites", label: "收藏" },
];
/** 分类枚举与后端 `SKILL_CATEGORIES` 一致（竞品 tag 1..5） */
const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "batch_image", label: "批量生图" },
  { key: "video", label: "视频制作" },
  { key: "script", label: "剧本创作" },
  { key: "skill", label: "技能" },
  { key: "custom", label: "自定义" },
];

const tab = ref<TabKey>("plaza");
const category = ref("");
const keyword = ref("");
const list = ref<AgentSkill[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 12;
const loading = ref(false);
const error = ref("");
const busyId = ref("");

const creating = ref(false);
const createError = ref("");
const form = ref({ name: "", summary: "", prompt_template: "", category: "custom", publish: false });

let searchTimer: ReturnType<typeof setTimeout> | null = null;

const hasMore = computed(() => list.value.length < total.value);
const empty = computed(() => !loading.value && list.value.length === 0);

async function load(reset = true): Promise<void> {
  if (reset) {
    page.value = 1;
    list.value = [];
  }
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: String(pageSize) });
    if (category.value) params.set("category", category.value);
    if (keyword.value.trim()) params.set("q", keyword.value.trim());
    const res = await api.get<AgentSkillPage>(`/agent-skills/${tab.value}?${params.toString()}`);
    const incoming = res.list ?? [];
    // 去重：分类/搜索切换太快时两次响应可能乱序到达，按 skill_id 合并避免重复卡
    const seen = new Set(list.value.map((item) => item.skill_id));
    list.value = [...list.value, ...incoming.filter((item) => !seen.has(item.skill_id))];
    total.value = res.total ?? incoming.length;
  } catch (e) {
    error.value = (e as Error).message || "读取 Skill 卡失败";
  } finally {
    loading.value = false;
  }
}

function switchTab(next: TabKey): void {
  if (tab.value === next) return;
  tab.value = next;
  void load();
}

function switchCategory(next: string): void {
  if (category.value === next) return;
  category.value = next;
  void load();
}

watch(keyword, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});

function loadMore(): void {
  if (loading.value || !hasMore.value) return;
  page.value += 1;
  void load(false);
}

async function toggleFavorite(skill: AgentSkill): Promise<void> {
  if (busyId.value) return;
  busyId.value = skill.skill_id;
  const before = { favorite: skill.is_favorite, count: skill.favorite_count };
  // 乐观翻转：收藏是高频轻动作，等一个 RTT 才亮心形很别扭；失败回滚
  skill.is_favorite = !skill.is_favorite;
  skill.favorite_count = Math.max(0, skill.favorite_count + (skill.is_favorite ? 1 : -1));
  try {
    const res = await api.post<{ favorited: boolean; favorite_count: number }>(
      `/agent-skills/${encodeURIComponent(skill.skill_id)}/favorite`,
      { favorite: skill.is_favorite },
    );
    skill.is_favorite = res.favorited;
    skill.favorite_count = res.favorite_count;
    // 在"收藏"tab 取消收藏后，这张卡应该立刻消失（否则用户以为没生效）
    if (tab.value === "favorites" && !res.favorited) {
      list.value = list.value.filter((item) => item.skill_id !== skill.skill_id);
      total.value = Math.max(0, total.value - 1);
    }
  } catch (e) {
    skill.is_favorite = before.favorite;
    skill.favorite_count = before.count;
    error.value = (e as Error).message || "收藏失败";
  } finally {
    busyId.value = "";
  }
}

async function createCard(): Promise<void> {
  if (creating.value) return;
  const name = form.value.name.trim();
  if (!name) {
    createError.value = "请填写卡片名称";
    return;
  }
  creating.value = true;
  createError.value = "";
  try {
    await api.post<AgentSkill>("/agent-skills", {
      name,
      summary: form.value.summary.trim(),
      prompt_template: form.value.prompt_template.trim(),
      category: form.value.category,
      visibility: form.value.publish ? 2 : 1,
    });
    form.value = { name: "", summary: "", prompt_template: "", category: "custom", publish: false };
    // 建完直接看"我的"，否则用户以为没成功
    tab.value = "mine";
    await load();
  } catch (e) {
    createError.value = (e as Error).message || "新建卡片失败";
  } finally {
    creating.value = false;
  }
}

async function removeCard(skill: AgentSkill): Promise<void> {
  if (busyId.value) return;
  if (!window.confirm(`删除卡片「${skill.name}」？已产生的内容不受影响。`)) return;
  busyId.value = skill.skill_id;
  try {
    await api.delete<{ ok: boolean }>(`/agent-skills/${encodeURIComponent(skill.skill_id)}`);
    list.value = list.value.filter((item) => item.skill_id !== skill.skill_id);
    total.value = Math.max(0, total.value - 1);
  } catch (e) {
    error.value = (e as Error).message || "删除失败";
  } finally {
    busyId.value = "";
  }
}

/** 点卡片：把预置 prompt 交给父组件填进输入框（父组件负责聚焦与是否直接发送） */
function pick(skill: AgentSkill): void {
  emit("pick", skill);
}

onMounted(() => {
  if (props.open) void load();
});
watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
);
</script>

<template>
  <div v-if="open" class="drawer" role="dialog" aria-label="Skill 卡市场">
    <div class="drawer__mask" @click="emit('close')" />
    <section class="drawer__panel">
      <header class="drawer__head">
        <h2 class="drawer__title">Skill 卡</h2>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <nav class="tabs" role="tablist">
        <button
          v-for="item in TABS"
          :key="item.key"
          class="tabs__item"
          :class="{ 'tabs__item--active': tab === item.key }"
          type="button"
          role="tab"
          :aria-selected="tab === item.key"
          @click="switchTab(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="drawer__filters">
        <input v-model="keyword" class="input" type="search" placeholder="搜索卡片名称 / 指令" />
        <div class="chips">
          <button
            v-for="item in CATEGORIES"
            :key="item.key || 'all'"
            class="chip"
            :class="{ 'chip--active': category === item.key }"
            type="button"
            @click="switchCategory(item.key)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <p v-if="error" class="drawer__error">{{ error }}</p>

      <div class="drawer__list">
        <article v-for="skill in list" :key="skill.skill_id" class="card">
          <header class="card__head">
            <h3 class="card__name">{{ skill.name }}</h3>
            <span class="card__cat">{{ skill.category_label }}</span>
          </header>
          <p class="card__summary">{{ skill.summary || "（无摘要）" }}</p>
          <p class="card__slug"><code>{{ skill.prompt_template ? "/" + skill.name_en : skill.name_en }}</code></p>
          <footer class="card__foot">
            <span class="card__stat">用 {{ skill.use_count }} · 藏 {{ skill.favorite_count }}</span>
            <span class="card__actions">
              <button
                class="icon-btn"
                type="button"
                :aria-label="skill.is_favorite ? '取消收藏' : '收藏'"
                :disabled="busyId === skill.skill_id"
                @click="toggleFavorite(skill)"
              >
                {{ skill.is_favorite ? "★" : "☆" }}
              </button>
              <button v-if="skill.is_mine" class="btn btn--danger" type="button" @click="removeCard(skill)">
                删除
              </button>
              <button class="btn btn--primary" type="button" @click="pick(skill)">使用</button>
            </span>
          </footer>
        </article>

        <p v-if="loading" class="drawer__hint">加载中…</p>
        <p v-else-if="empty" class="drawer__hint">
          {{ tab === "favorites" ? "还没有收藏任何卡片，去广场挑一张。" : tab === "mine" ? "本空间还没有自建卡，可在下方新建。" : "没有匹配的卡片。" }}
        </p>
        <button v-if="hasMore && !loading" class="btn btn--ghost drawer__more" type="button" @click="loadMore">
          加载更多（{{ list.length }}/{{ total }}）
        </button>
      </div>

      <details class="create">
        <summary class="create__summary">新建 Skill 卡</summary>
        <div class="create__form">
          <input v-model="form.name" class="input" maxlength="40" placeholder="卡片名称（≤40 字）" />
          <input v-model="form.summary" class="input" maxlength="200" placeholder="一句话说明" />
          <textarea
            v-model="form.prompt_template"
            class="input create__prompt"
            rows="3"
            maxlength="4000"
            placeholder="预置 prompt（建议以 /英文指令名 开头）"
          />
          <div class="create__row">
            <select v-model="form.category" class="input create__select">
              <option v-for="item in CATEGORIES.filter((c) => c.key)" :key="item.key" :value="item.key">
                {{ item.label }}
              </option>
            </select>
            <label class="create__check">
              <input v-model="form.publish" type="checkbox" />
              发布到广场
            </label>
            <button class="btn btn--primary" type="button" :disabled="creating" @click="createCard">
              {{ creating ? "创建中…" : "创建" }}
            </button>
          </div>
          <p v-if="createError" class="drawer__error">{{ createError }}</p>
        </div>
      </details>
    </section>
  </div>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  /* 必须用层二令牌：硬编码 60 会被 `--z-header`(100) 的站点抬头盖住，
     表现为"抽屉右上角关不掉"（E2E 实测 click 被 header 拦截） */
  z-index: var(--z-drawer);
  display: flex;
  justify-content: flex-end;
}
.drawer__mask {
  position: absolute;
  inset: 0;
  background: #000000a6;
}
.drawer__panel {
  position: relative;
  width: min(520px, 96vw);
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-2);
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  gap: var(--space-3);
  overflow: hidden;
}
.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.drawer__title {
  margin: 0;
  color: var(--text-1);
  font-size: var(--text-lg);
  font-weight: 600;
}
.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-1);
}
.tabs__item {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  cursor: pointer;
}
.tabs__item--active {
  color: var(--text-1);
  border-bottom-color: var(--brand-500);
}
.drawer__filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.input {
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--border-2);
  border-radius: 10px;
  color: var(--text-2);
  padding: 0 var(--space-3);
  height: var(--control-h);
  font-size: var(--text-sm);
  font-family: inherit;
}
.input:focus {
  outline: 1px solid var(--brand-border);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.chip {
  background: transparent;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-full);
  color: var(--text-3);
  font-size: var(--text-xs);
  padding: 4px 10px;
  cursor: pointer;
}
.chip--active {
  background: var(--brand-soft);
  border-color: var(--brand-border);
  color: var(--text-1);
}
.drawer__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.drawer__list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-right: var(--space-1);
}
.card {
  border: 1px solid var(--border-2);
  border-radius: 14px;
  background: var(--bg-raised);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.card__name {
  margin: 0;
  color: var(--text-1);
  font-size: var(--text-sm);
  font-weight: 600;
}
.card__cat {
  color: var(--brand-on-soft);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  padding: 1px 8px;
  white-space: nowrap;
}
.card__summary {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.card__slug {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.card__stat {
  color: var(--text-4);
  font-size: var(--text-xs);
}
.card__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.btn {
  height: 30px;
  padding: 0 var(--space-3);
  border-radius: 9px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
}
.btn--primary {
  background: var(--brand-500);
  border-color: var(--brand-500);
  color: #fff;
}
.btn--danger {
  color: var(--danger);
  border-color: var(--danger);
}
.btn--ghost:hover {
  background: var(--bg-hover);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: var(--text-sm);
}
.icon-btn:hover {
  background: var(--bg-hover);
}
.drawer__hint {
  margin: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  text-align: center;
  padding: var(--space-4) 0;
}
.drawer__more {
  align-self: center;
}
.create {
  border-top: 1px solid var(--border-1);
  padding-top: var(--space-2);
}
.create__summary {
  color: var(--text-3);
  font-size: var(--text-xs);
  cursor: pointer;
}
.create__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.create__prompt {
  height: auto;
  padding: var(--space-2) var(--space-3);
  line-height: 1.5;
  resize: vertical;
}
.create__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.create__select {
  width: 120px;
}
.create__check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-3);
  font-size: var(--text-xs);
  white-space: nowrap;
}
</style>
