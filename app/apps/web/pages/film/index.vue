<script setup lang="ts">
import type { FilmFuncWhitelistDto, FilmProjectRowDto, FilmRecentOpenDto } from "~/types/api";

/**
 * 影视版项目列表（`/film`）—— 对照竞品 `/web/v1/film/projects/*` 的入口页。
 *
 * 两层门槛：
 * 1. **功能准入（L0）**：`GET /func-whitelist?scene=ai_film` → `{check}`。
 *    未开通时不渲染列表，只显示「联系商务开通」——这是商务开通制，不是自助订阅（契约 §6.4）。
 * 2. **空间**：`useActiveSpaceId()` 决定 X-Space-Id（团队场景）；没有团队空间时提示去建团队。
 *
 * 「项目」在本期是**任务表的容器**：film 项目本体表尚未建（契约 §7 A2 未取证），
 * 所以新建项目 = 用项目名建第一张任务表 + 补齐预置表；列表标题取该项目最早那张表名
 * （后端 `listProjects` 的聚合口径）。
 */

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

const api = useApi();
const toast = useToast();
const activeSpace = useActiveSpaceId();

const loading = ref(true);
const errorMsg = ref("");
const authorized = ref<boolean | null>(null);
const projects = ref<FilmProjectRowDto[]>([]);
const recent = ref<FilmRecentOpenDto[]>([]);

const creating = ref(false);
const newName = ref("");
const showCreate = ref(false);

const spaceId = computed(() => activeSpace.value ?? "");

async function loadWhitelist() {
  const res = await api.get<FilmFuncWhitelistDto>("/func-whitelist?scene=ai_film");
  authorized.value = res.check;
}

async function load() {
  if (!spaceId.value) {
    loading.value = false;
    errorMsg.value = "请先在「团队」里选择或创建一个团队空间（影视版按团队开通）";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    await loadWhitelist();
    if (!authorized.value) {
      projects.value = [];
      return;
    }
    const list = await api.get<{ list: FilmProjectRowDto[]; recent: FilmRecentOpenDto[] }>("/film/projects");
    projects.value = list.list;
    recent.value = list.recent ?? [];
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载失败";
  } finally {
    loading.value = false;
  }
}

/** 项目 id 由客户端生成（服务端项目本体表未建，project_id 是不透明指针） */
function generateProjectId(): string {
  return String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999)));
}

async function createProject() {
  const name = newName.value.trim();
  if (name.length === 0) {
    toast.error("请填项目名称");
    return;
  }
  creating.value = true;
  const projectId = generateProjectId();
  try {
    // 第一张表用项目名 → 列表标题就是项目名；随后补齐预置表（幂等）
    await api.post(`/film/projects/${projectId}/task-tables`, { name });
    await api.post(`/film/projects/${projectId}/task-tables/ensure-presets`);
    toast.success("项目已创建");
    showCreate.value = false;
    newName.value = "";
    await load();
  } catch (e) {
    toast.error((e as Error).message || "创建失败");
  } finally {
    creating.value = false;
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

onMounted(load);
</script>

<template>
  <div class="fl-page">
    <header class="fl-head">
      <div>
        <h1 class="fl-title">影视版</h1>
        <p class="fl-sub">任务表 · 审核版本链 · 画布协同（对照 ReelMate 影视版 film 域）</p>
      </div>
      <div class="fl-head-actions">
        <button type="button" class="fl-btn" :disabled="loading" @click="load">刷新</button>
        <button
          v-if="authorized"
          type="button"
          class="fl-btn fl-btn-primary"
          @click="showCreate = true"
        >
          ＋ 新建项目
        </button>
      </div>
    </header>

    <p v-if="errorMsg" class="fl-alert">{{ errorMsg }}</p>

    <div v-if="loading" class="fl-skeleton">加载中…</div>

    <!-- 未开通：商务开通制引导（L0） -->
    <section v-else-if="authorized === false" class="fl-gate">
      <h2 class="fl-gate-title">影视版尚未开通</h2>
      <p class="fl-gate-text">
        影视版是团队级功能（任务表 / 审核版本链 / 画布协同），需要商务开通后使用。
        当前团队空间未开通，请联系商务或团队管理员开通。
      </p>
      <p class="fl-gate-hint">
        已开通但仍看到此页？请确认右上角的当前空间是「团队空间」而不是个人空间。
      </p>
    </section>

    <template v-else>
      <section v-if="recent.length > 0" class="fl-recent">
        <h2 class="fl-section-title">最近打开</h2>
        <div class="fl-recent-list">
          <NuxtLink
            v-for="r in recent.slice(0, 5)"
            :key="`${r.project_id}-${r.opened_at}`"
            :to="`/film/${r.project_id}`"
            class="fl-recent-item"
          >
            <span class="fl-recent-id">项目 {{ r.project_id.slice(-6) }}</span>
            <span class="fl-recent-time">{{ fmtTime(r.opened_at) }}</span>
          </NuxtLink>
        </div>
      </section>

      <section class="fl-projects">
        <h2 class="fl-section-title">全部项目</h2>
        <p v-if="projects.length === 0" class="fl-empty">
          还没有影视项目。点右上「新建项目」创建一个：会同时生成分镜任务表与资产需求表。
        </p>
        <ul v-else class="fl-project-grid">
          <li v-for="p in projects" :key="p.project_id" class="fl-project-card">
            <NuxtLink :to="`/film/${p.project_id}`" class="fl-project-link">
              <h3 class="fl-project-name">{{ p.title }}</h3>
              <p class="fl-project-meta">
                {{ p.table_count }} 张表 · {{ p.task_count }} 条任务
              </p>
              <p class="fl-project-time">
                更新 {{ fmtTime(p.updated_at) }}
                <template v-if="p.last_opened_at"> · 打开 {{ fmtTime(p.last_opened_at) }}</template>
              </p>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>

    <!-- 新建项目 -->
    <div v-if="showCreate" class="fl-modal-mask" @click.self="showCreate = false">
      <div class="fl-modal">
        <h2 class="fl-modal-title">新建影视项目</h2>
        <label class="fl-label" for="fl-project-name">项目名称</label>
        <input id="fl-project-name" v-model="newName" class="fl-input" placeholder="例如：短剧《归途》第一季" />
        <p class="fl-hint">创建后会同时补齐两张预置任务表（分镜任务表 / 资产需求表）。</p>
        <div class="fl-modal-actions">
          <button type="button" class="fl-btn" @click="showCreate = false">取消</button>
          <button type="button" class="fl-btn fl-btn-primary" :disabled="creating" @click="createProject">
            {{ creating ? "创建中…" : "创建" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fl-page {
  padding: 20px 24px 40px;
  max-width: 1120px;
  margin: 0 auto;
  /* 深色壳层里本页是浅色内容：显式给深色文字，避免白底浅字 */
  color: #2a2f3a;
}
.fl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.fl-title {
  margin: 0;
  font-size: 22px;
}
.fl-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7280;
}
.fl-head-actions {
  display: flex;
  gap: 8px;
}
.fl-btn {
  border: 1px solid #e3e6ee;
  background: #fff;
  color: #2a2f3a;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
.fl-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.fl-btn-primary {
  background: #2f5bd7;
  border-color: #2f5bd7;
  color: #fff;
}
.fl-alert {
  color: #c53030;
  font-size: 13px;
}
.fl-skeleton {
  padding: 40px 0;
  text-align: center;
  color: #8a90a6;
}
.fl-gate {
  border: 1px dashed #cfd5e6;
  border-radius: 12px;
  padding: 32px 24px;
  background: #fafbff;
}
.fl-gate-title {
  margin: 0 0 8px;
  font-size: 17px;
}
.fl-gate-text {
  margin: 0 0 10px;
  font-size: 13px;
  color: #4b5266;
  line-height: 1.7;
}
.fl-gate-hint {
  margin: 0;
  font-size: 12px;
  color: #8a90a6;
}
.fl-section-title {
  font-size: 14px;
  margin: 0 0 10px;
  color: #4b5266;
}
.fl-recent {
  margin-bottom: 22px;
}
.fl-recent-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.fl-recent-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid #eceef5;
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  font-size: 12px;
  background: #fff;
}
.fl-recent-id {
  font-weight: 600;
}
.fl-recent-time {
  color: #8a90a6;
}
.fl-empty {
  font-size: 13px;
  color: #8a90a6;
}
.fl-project-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.fl-project-card {
  border: 1px solid #eceef5;
  border-radius: 12px;
  background: #fff;
  transition: box-shadow 0.15s ease;
}
.fl-project-card:hover {
  box-shadow: 0 4px 16px rgba(16, 20, 32, 0.08);
}
.fl-project-link {
  display: block;
  padding: 14px 16px;
  text-decoration: none;
  color: inherit;
}
.fl-project-name {
  margin: 0 0 6px;
  font-size: 15px;
}
.fl-project-meta {
  margin: 0 0 4px;
  font-size: 12px;
  color: #4b5266;
}
.fl-project-time {
  margin: 0;
  font-size: 12px;
  color: #9aa0b4;
}
.fl-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 20, 32, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.fl-modal {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 20px;
}
.fl-modal-title {
  margin: 0 0 12px;
  font-size: 16px;
}
.fl-label {
  display: block;
  font-size: 12px;
  color: #5b6178;
  margin-bottom: 4px;
}
.fl-input {
  width: 100%;
  border: 1px solid #e3e6ee;
  border-radius: 8px;
  padding: 8px;
  background: #fff;
  color: #2a2f3a;
  font-size: 13px;
}
.fl-input::placeholder {
  color: #9aa0b4;
}
.fl-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8a90a6;
}
.fl-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
