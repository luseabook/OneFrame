<script setup lang="ts">

const { t } = useI18n();
import type { CanvasEditor } from "~/composables/useCanvasEditor";
import type { CanvasTemplateDto } from "~/composables/useCanvasApi";

/**
 * 模板库抽屉
 *
 * 两个动作都是"改本地、不落库"：套用后仍需点保存（走 commit 乐观锁），
 * 存为模板前会先强制保存（模板取自库里的画布快照）。
 * 这条约束不能松：画布编辑的并发安全完全依赖 commit 的版本校验，
 * 任何"直接写库"的捷径都会让乐观锁形同虚设。
 */
const props = defineProps<{ editor: CanvasEditor }>();
const emit = defineEmits<{ close: [] }>();

const ed = props.editor;
const toast = useToast();

type Tab = "all" | "mine";
const tab = ref<Tab>("all");
const loading = ref(false);
const list = ref<CanvasTemplateDto[]>([]);
const error = ref("");
const searchQuery = ref("");
const saveName = ref("");
const saving = ref(false);
const applying = ref<string | null>(null);

/** 模板预览：按 payload 里的节点坐标画一个极简示意（真实数据，不造假图） */
function previewRects(tpl: CanvasTemplateDto): Array<{ x: number; y: number; w: number; h: number; color: string }> {
  const nodes = (tpl.payload?.nodes ?? []) as Array<Record<string, unknown>>;
  if (nodes.length === 0) return [];
  const xs = nodes.map((n) => Number(n.x ?? 0));
  const ys = nodes.map((n) => Number(n.y ?? 0));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs.map((v, i) => v + (Number(nodes[i]!.width) || 180)));
  const maxY = Math.max(...ys.map((v, i) => v + (Number(nodes[i]!.height) || 70)));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  // 缩放进 100×56 的预览区（留 4px 边距）
  const sx = (v: number): number => ((v - minX) / spanX) * 92 + 4;
  const sy = (v: number): number => ((v - minY) / spanY) * 48 + 4;
  return nodes.slice(0, 24).map((n, i) => ({
    x: sx(Number(n.x ?? 0)),
    y: sy(Number(n.y ?? 0)),
    w: Math.max(6, (Number(nodes[i]!.width) || 180) / spanX * 92),
    h: Math.max(5, (Number(nodes[i]!.height) || 70) / spanY * 48),
    color: colorOf(String(n.node_type ?? "text")),
  }));
}

/** 节点类型色（与 NODE_TYPE_META 保持一致，抽成函数避免模板里重复查表） */
function colorOf(type: string): string {
  const map: Record<string, string> = {
    text: "#7aa2ff",
    table: "#5fd08a",
    image: "#c99bff",
    video: "#ff9f6b",
    audio: "#6bd5d0",
    clip: "#f5b544",
    script: "#b8afff",
    asset: "#f56767",
    director: "#63b3ff",
    threeDWorld: "#8f7bff",
    group: "#8b93a7",
  };
  return map[type] ?? "#8b93a7";
}

function scopeLabel(scope: number): string {
  return scope === 1
    ? t("canvasUi.tplScopeOfficial")
    : scope === 2
      ? t("canvasUi.tplScopeTeam")
      : t("canvasUi.tplScopeMine");
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  const api = useCanvasApi();
  try {
    const res =
      tab.value === "mine" && searchQuery.value.trim()
        ? await api.searchPersonalTemplates(searchQuery.value.trim(), 1, 50)
        : await api.listTemplates({ page: 1, page_size: 50, mine: tab.value === "mine" });
    list.value = res.list;
  } catch (e) {
    error.value = (e as Error).message || t("canvasUi.tplReadFailed");
  } finally {
    loading.value = false;
  }
}

function switchTab(next: Tab): void {
  tab.value = next;
  void load();
}

async function doSave(): Promise<void> {
  const name = saveName.value.trim();
  if (!name) {
    toast.error(t("canvasUi.tplNeedName"));
    return;
  }
  saving.value = true;
  try {
    const ok = await ed.saveAsTemplate(name, 3);
    if (ok) {
      saveName.value = "";
      await load();
    }
  } finally {
    saving.value = false;
  }
}

async function doApply(tpl: CanvasTemplateDto): Promise<void> {
  applying.value = tpl.id;
  try {
    const n = await ed.applyTemplate(tpl.id);
    if (n > 0) emit("close");
  } finally {
    applying.value = null;
  }
}

async function doDelete(tpl: CanvasTemplateDto): Promise<void> {
  if (!confirm(t("canvasUi.tplDeleteConfirm", { name: tpl.name }))) return;
  const api = useCanvasApi();
  try {
    await api.deleteTemplate(tpl.id);
    toast.success(t("canvasUi.tplDeleted"));
    await load();
  } catch (e) {
    toast.error((e as Error).message || t("canvasUi.tplDeleteFailed"));
  }
}

onMounted(load);
</script>

<template>
  <div class="canvas-templates" role="dialog" :aria-label="t('canvasUi.tplDialogAria')">
    <div class="canvas-templates__panel cv-chrome">
      <header class="canvas-templates__head">
        <span>{{ t("canvasUi.tplTitle") }}</span>
        <button class="cv-glass-btn" :aria-label="t('canvasUi.close')" @click="emit('close')">
          <CanvasIcon name="close" :size="16" />
        </button>
      </header>

      <!-- 存为模板：先保存画布快照，再命名 -->
      <section class="canvas-templates__save">
        <input
          v-model="saveName"
          class="cv-input tpl-save-name"
          :placeholder="t('canvasUi.tplNamePlaceholder')"
          maxlength="60"
          @keyup.enter="doSave"
        />
        <Button size="sm" class="tpl-save-btn" :loading="saving" @click="doSave">{{ t("canvasUi.tplSaveAs") }}</Button>
      </section>

      <!-- 全部 / 我的 -->
      <div class="cv-seg canvas-templates__tabs">
        <button type="button" :class="{ 'is-active': tab === 'all' }" class="tpl-tab-all" @click="switchTab('all')">
           {{ t("canvasUi.tplAll") }}
        </button>
        <button type="button" :class="{ 'is-active': tab === 'mine' }" class="tpl-tab-mine" @click="switchTab('mine')">
           {{ t("canvasUi.tplMine") }}
        </button>
      </div>

      <input
        v-if="tab === 'mine'"
        v-model="searchQuery"
        class="cv-input tpl-search"
        :placeholder="t('canvasUi.tplSearchMine')"
        @keyup.enter="load"
      />

      <p v-if="error" class="cv-hint canvas-templates__err">{{ error }}</p>
      <p v-else-if="loading" class="cv-hint">{{ t("canvasUi.reading") }}</p>
      <p v-else-if="list.length === 0" class="cv-hint canvas-templates__empty">
        {{
          tab === "mine" ? t("canvasUi.tplEmptyMine") : t("canvasUi.tplEmpty")
        }}
      </p>

      <ul v-else class="canvas-templates__list">
        <li v-for="tpl in list" :key="tpl.id" class="tpl-card">
          <div class="tpl-card__thumb" aria-hidden="true">
            <svg v-if="previewRects(tpl).length" viewBox="0 0 100 56" preserveAspectRatio="none">
              <rect
                v-for="(r, i) in previewRects(tpl)"
                :key="i"
                :x="r.x"
                :y="r.y"
                :width="r.w"
                :height="r.h"
                :fill="r.color"
                fill-opacity="0.55"
                rx="1.5"
              />
            </svg>
            <span v-else class="tpl-card__thumb-empty">{{ t("canvasUi.tplEmptyThumb") }}</span>
          </div>
          <div class="tpl-card__info">
            <p class="tpl-card__name" :title="tpl.name">{{ tpl.name }}</p>
            <p class="tpl-card__meta">
              <span class="cv-tag">{{ scopeLabel(tpl.tpl_scope) }}</span>
              <span>{{ t("canvasUi.tplNodes", { n: (tpl.payload?.nodes ?? []).length }) }}</span>
            </p>
          </div>
          <div class="tpl-card__acts">
            <Button
              size="sm"
              class="tpl-apply"
              :loading="applying === tpl.id"
              @click="doApply(tpl)"
            >
              {{ t("canvasUi.tplApply") }}
            </Button>
            <button
              v-if="tpl.tpl_scope === 3"
              class="tpl-delete"
              type="button"
              :aria-label="t('canvasUi.tplDeleteAria')"
              @click="doDelete(tpl)"
            >
              {{ t("canvasUi.tplDelete") }}
            </button>
          </div>
        </li>
      </ul>

      <p class="cv-hint canvas-templates__foot">
         {{ t("canvasUi.tplApplyHint") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.canvas-templates {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: #000000a6;
}
.canvas-templates__panel {
  width: min(560px, 94vw);
  max-height: 78vh;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.canvas-templates__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.canvas-templates__save {
  display: flex;
  gap: var(--space-2);
}
.canvas-templates__save .cv-input {
  flex: 1;
}
.canvas-templates__tabs {
  align-self: flex-start;
}
.canvas-templates__err {
  color: var(--danger);
}
.canvas-templates__empty {
  padding: var(--space-4) 0;
  text-align: center;
}
.canvas-templates__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tpl-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border: 1px solid var(--cv-panel-border);
  border-radius: var(--radius-md);
}
.tpl-card__thumb {
  width: 100px;
  height: 56px;
  flex: none;
  border-radius: var(--radius-sm);
  background: #0e0f14;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.tpl-card__thumb svg {
  width: 100%;
  height: 100%;
  display: block;
}
.tpl-card__thumb-empty {
  font-size: 10px;
  color: var(--text-5);
}
.tpl-card__info {
  flex: 1;
  min-width: 0;
}
.tpl-card__name {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-card__meta {
  margin: 3px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
}
.tpl-card__acts {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}
.tpl-delete {
  background: none;
  border: 0;
  padding: 0;
  font-size: 11px;
  color: var(--danger);
  cursor: pointer;
}
.canvas-templates__foot {
  border-top: 1px solid var(--cv-panel-border);
  padding-top: var(--space-2);
}
</style>
