<script setup lang="ts">

const { t } = useI18n();
import type { CanvasEditor } from "~/composables/useCanvasEditor";
import type { CanvasMaterialDto } from "~/types/canvas";

/**
 * 素材库抽屉
 *
 * 只展示 object_key 派生的稳定标识，不拼 URL：
 * 直链会过期，且换存储驱动（local/S3/OSS）就洗库。
 * 真实预览需要存储层签 URL —— 本期画布素材以"登记 + 复用"为主，
 * 预览留到接入 files 域签名接口后补（不在此处造假图）。
 */
const props = defineProps<{ editor: CanvasEditor }>();
const emit = defineEmits<{ close: [] }>();

const ed = props.editor;
const toast = useToast();

const typeFilter = ref<"" | "image" | "video" | "audio" | "file">("");
const selected = ref<string[]>([]);
const busy = ref(false);

const filtered = computed(() => {
  const list = ed.materials.value;
  return typeFilter.value ? list.filter((m) => m.material_type === typeFilter.value) : list;
});

function sourceLabel(src: number): string {
  return src === 1
    ? t("canvasUi.matSrcUpload")
    : src === 2
      ? t("canvasUi.matSrcNode")
      : t("canvasUi.matSrcLibrary");
}

function typeLabel(materialType: string): string {
  // 参数原本叫 `t`，会遮蔽 i18n 的 t()（本项目第 7 次踩同类）→ 改名 materialType
  return materialType === "image"
    ? t("canvasUi.matTypeImage")
    : materialType === "video"
      ? t("canvasUi.matTypeVideo")
      : materialType === "audio"
        ? t("canvasUi.matTypeAudio")
        : t("canvasUi.matTypeFile");
}

function toggleSelect(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}

async function removeSelected(): Promise<void> {
  if (selected.value.length === 0) return;
  if (!confirm(t("canvasUi.matRemoveConfirm", { n: selected.value.length }))) return;
  busy.value = true;
  try {
    await ed.removeMaterials([...selected.value]);
    selected.value = [];
  } finally {
    busy.value = false;
  }
}

/** 从当前选中节点把生成结果沉淀为素材 */
async function saveFromSelection(): Promise<void> {
  const n = ed.selectedNode.value;
  if (!n) {
    toast.error(t("canvasUi.matSelectNodeFirst"));
    return;
  }
  busy.value = true;
  try {
    await ed.saveNodeResultAsMaterial(n.id);
  } finally {
    busy.value = false;
  }
}

/** 复制 object_key 便于排查（运营/开发常用） */
async function copyKey(m: CanvasMaterialDto): Promise<void> {
  try {
    await navigator.clipboard.writeText(m.object_key ?? "");
    toast.success(t("canvasUi.matKeyCopied"));
  } catch {
    toast.error(t("canvasUi.matCopyFailed"));
  }
}

onMounted(() => void ed.loadMaterials());
</script>

<template>
  <div class="canvas-materials" role="dialog" :aria-label="t('canvasUi.matDialogAria')">
    <div class="canvas-materials__panel cv-chrome">
      <header class="canvas-materials__head">
        <span>{{ t("canvasUi.matTitle") }}</span>
        <button class="cv-glass-btn" :aria-label="t('canvasUi.close')" @click="emit('close')">
          <CanvasIcon name="close" :size="16" />
        </button>
      </header>

      <div class="canvas-materials__bar">
        <div class="cv-seg mat-filter">
          <button type="button" :class="{ 'is-active': typeFilter === '' }" @click="typeFilter = ''">{{ t("canvasUi.matAll") }}</button>
          <button type="button" :class="{ 'is-active': typeFilter === 'image' }" class="mat-filter-image" @click="typeFilter = 'image'">
            {{ t("canvasUi.matTypeImage") }}
          </button>
          <button type="button" :class="{ 'is-active': typeFilter === 'video' }" class="mat-filter-video" @click="typeFilter = 'video'">
            {{ t("canvasUi.matTypeVideo") }}
          </button>
          <button type="button" :class="{ 'is-active': typeFilter === 'audio' }" class="mat-filter-audio" @click="typeFilter = 'audio'">
            {{ t("canvasUi.matTypeAudio") }}
          </button>
        </div>
        <Button size="sm" variant="ghost" class="mat-save-from-node" :loading="busy" @click="saveFromSelection">
           {{ t("canvasUi.matStoreBtn") }}
        </Button>
      </div>

      <p v-if="ed.materialsLoading.value" class="cv-hint">{{ t("canvasUi.reading") }}</p>
      <p v-else-if="filtered.length === 0" class="cv-hint canvas-materials__empty">
         {{ t("canvasUi.matEmpty") }}
      </p>

      <ul v-else class="canvas-materials__list">
        <li
          v-for="m in filtered"
          :key="m.id"
          class="mat-card"
          :class="{ 'is-selected': selected.includes(m.id) }"
          @click="toggleSelect(m.id)"
        >
          <div class="mat-card__icon" :data-type="m.material_type">
            <CanvasIcon :name="m.material_type === 'image' ? 'node-image' : m.material_type === 'video' ? 'node-video' : m.material_type === 'audio' ? 'node-audio' : 'node-asset'" :size="18" />
          </div>
          <div class="mat-card__info">
            <p class="mat-card__name" :title="m.name">{{ m.name || t("canvasUi.matUnnamed") }}</p>
            <p class="mat-card__meta">
              <span class="cv-tag">{{ typeLabel(m.material_type) }}</span>
              <span class="cv-tag">{{ sourceLabel(m.source) }}</span>
              <button class="mat-card__key" type="button" :title="m.object_key ?? ''" @click.stop="copyKey(m)">
                {{ (m.object_key ?? "").split("/").pop() || "—" }}
              </button>
            </p>
          </div>
        </li>
      </ul>

      <footer v-if="selected.length > 0" class="canvas-materials__foot">
        <span class="cv-hint">{{ t("canvasUi.matSelectedN", { n: selected.length }) }}</span>
        <Button size="sm" variant="danger" :loading="busy" @click="removeSelected">{{ t("canvasUi.matRemove") }}</Button>
      </footer>
      <p v-else class="cv-hint canvas-materials__hint">
         {{ t("canvasUi.matFooterHint") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.canvas-materials {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: #000000a6;
}
.canvas-materials__panel {
  width: min(560px, 94vw);
  max-height: 76vh;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.canvas-materials__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.canvas-materials__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.canvas-materials__empty {
  padding: var(--space-4) 0;
  text-align: center;
}
.canvas-materials__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mat-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.mat-card:hover {
  background: #ffffff0a;
}
.mat-card.is-selected {
  border-color: var(--brand-border);
  background: var(--brand-soft);
}
.mat-card__icon {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: #ffffff14;
  color: var(--text-2);
}
.mat-card__info {
  flex: 1;
  min-width: 0;
}
.mat-card__name {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mat-card__meta {
  margin: 3px 0 0;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-3);
  min-width: 0;
}
.mat-card__key {
  background: none;
  border: 0;
  padding: 0;
  font-size: 11px;
  color: var(--text-4);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}
.mat-card__key:hover {
  color: var(--brand-on-soft);
}
.canvas-materials__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--cv-panel-border);
  padding-top: var(--space-2);
}
.canvas-materials__hint {
  border-top: 1px solid var(--cv-panel-border);
  padding-top: var(--space-2);
}
</style>
