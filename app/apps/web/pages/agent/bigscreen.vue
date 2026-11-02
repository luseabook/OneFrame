<script setup lang="ts">
import type { AgentRecommendCard } from "~/types/api";

/**
 * Agent 大屏（竞品 /agent/bigscreen 的对应页）
 *
 * 定位：把「我会用 Agent 做什么」做成可投屏的一屏展示——推荐场景卡 + 技能墙 + 会话活跃度。
 * 只读：不建会话、不发消息；Esc 退出回 /agent。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "blank" });

const api = useApi();
const { t } = useI18n();
useHead({ title: () => t("agentBigscreen.metaTitle") });

interface SkillRow {
  skill_id: string;
  name: string;
  description: string | null;
}
interface SessionRow {
  session_id: string;
  title: string;
  message_count: number;
  last_active_at: string | null;
}

const cards = ref<AgentRecommendCard[]>([]);
const skills = ref<SkillRow[]>([]);
const sessions = ref<SessionRow[]>([]);
const loading = ref(true);
const error = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [rec, sk, se] = await Promise.all([
      api.get<{ list: AgentRecommendCard[] }>("/agent-recommend-cards"),
      api.get<{ list: SkillRow[] }>("/agent-skills/plaza?page=1&page_size=8"),
      api.get<{ list: SessionRow[] }>("/agent/sessions?scope=1&page=1&page_size=6"),
    ]);
    cards.value = rec.list ?? [];
    skills.value = sk.list ?? [];
    sessions.value = se.list ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("agentBigscreen.loadFailed");
  } finally {
    loading.value = false;
  }
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape") void navigateTo("/agent");
}

onMounted(() => {
  void load();
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="ab">
    <header class="ab-head">
      <h1>{{ t("agentBigscreen.title") }}</h1>
      <p>{{ t("agentBigscreen.sub") }}</p>
      <NuxtLink to="/agent" class="ab-exit">{{ t("agentBigscreen.exit") }}</NuxtLink>
    </header>

    <p v-if="loading" class="ab-state">{{ t("common.loading") }}</p>
    <p v-else-if="error" class="ab-state ab-state--err" role="alert">{{ error }}</p>
    <template v-else>
      <section class="ab-block">
        <h2>{{ t("agentBigscreen.recommend") }}</h2>
        <div class="ab-cards">
          <article v-for="c in cards.slice(0, 4)" :key="c.recommend_id" class="ab-card">
            <span class="ab-tag">{{ c.tag_label }}</span>
            <b>{{ c.title }}</b>
            <p>{{ c.description }}</p>
          </article>
          <p v-if="!cards.length" class="ab-state">{{ t("agentBigscreen.empty") }}</p>
        </div>
      </section>

      <section class="ab-block">
        <h2>{{ t("agentBigscreen.skills") }}</h2>
        <ul class="ab-skills">
          <li v-for="s in skills" :key="s.skill_id">
            <b>{{ s.name }}</b>
            <span>{{ s.description }}</span>
          </li>
          <li v-if="!skills.length" class="ab-state">{{ t("agentBigscreen.empty") }}</li>
        </ul>
      </section>

      <section class="ab-block">
        <h2>{{ t("agentBigscreen.sessions") }}</h2>
        <div class="ab-sessions">
          <div v-for="s in sessions" :key="s.session_id" class="ab-session">
            <b>{{ s.title || t("agentBigscreen.untitled") }}</b>
            <em>{{ t("agentBigscreen.messages", { n: s.message_count }) }}</em>
          </div>
          <p v-if="!sessions.length" class="ab-state">{{ t("agentBigscreen.empty") }}</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ab {
  min-height: 100vh;
  padding: 40px 56px;
  background: radial-gradient(1200px 700px at 20% -10%, rgb(155 70 255 / 22%), transparent 60%), #0b0b10;
  color: #f3f4f6;
}
.ab-head {
  position: relative;
  margin-bottom: 28px;
}
.ab-head h1 {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 1px;
}
.ab-head p {
  margin-top: 8px;
  color: #9ca3af;
  font-size: 16px;
}
.ab-exit {
  position: absolute;
  right: 0;
  top: 0;
  height: 36px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  color: #e5e7eb;
  font-size: 13px;
  text-decoration: none;
}
.ab-block {
  margin-bottom: 28px;
}
.ab-block h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #cbb6ff;
}
.ab-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.ab-card {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgb(255 255 255 / 12%);
  background: rgb(255 255 255 / 4%);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ab-card b {
  font-size: 15px;
}
.ab-card p {
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.6;
}
.ab-tag {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(155 70 255 / 24%);
  color: #d8c4ff;
  font-size: 11px;
}
.ab-skills {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ab-skills li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgb(255 255 255 / 10%);
  font-size: 13px;
}
.ab-skills span {
  color: #9ca3af;
  font-size: 12px;
}
.ab-sessions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.ab-session {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgb(255 255 255 / 10%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
}
.ab-session em {
  color: #9ca3af;
  font-style: normal;
  font-size: 11px;
}
.ab-state {
  color: #9ca3af;
  font-size: 13px;
}
.ab-state--err {
  color: #fca5a5;
}
</style>
