<script setup lang="ts">

const { t } = useI18n();
import type { CanvasEditor } from "~/composables/useCanvasEditor";

/**
 * 固定组栏（画布顶部那排"一键跳转分组"）
 *
 * 参照站语义（契约 §14.4）：每画布 **7 个槽位**，成员整体替换。
 * 核心价值是「点一下就选中并把视口带到这组节点」——不是"标签"，是导航。
 *
 * 为什么不做成普通分组（canvas_groups）：
 * 普通分组是层级/归类，固定组是"快速跳转的工作台"。
 * 两者载体不同（后者有 slot 唯一约束），不能合并。
 */
const props = defineProps<{ editor: CanvasEditor }>();
const ed = props.editor;
const toast = useToast();

const openSlot = ref<number | null>(null);

const groups = computed(() => ed.pinGroups.value);
const maxSlots = computed(() => ed.pinGroupsMaxSlots.value);
const selectedCount = computed(() => ed.selectedIds.value.length);

/** 已占用的槽位号 */
const usedSlots = computed(() => new Set(groups.value.map((g) => g.slot)));
/** 第一个空槽（用于"加入新槽位"） */
const firstFreeSlot = computed(() => {
  for (let s = 1; s <= maxSlots.value; s++) if (!usedSlots.value.has(s)) return s;
  return null;
});

async function addToFirstFree(): Promise<void> {
  const slot = firstFreeSlot.value;
  if (!slot) {
    toast.error(t("canvasUi.pinMaxSlots", { n: maxSlots.value }));
    return;
  }
  await ed.assignSelectionToPinSlot(slot);
}

async function overwrite(slot: number): Promise<void> {
  if (selectedCount.value === 0) {
    toast.error(t("canvasUi.pinSelectNodesFirst"));
    return;
  }
  await ed.assignSelectionToPinSlot(slot);
  openSlot.value = null;
}

async function clearSlot(slot: number): Promise<void> {
  if (!confirm(t("canvasUi.pinClearConfirm", { slot: slot }))) return;
  await ed.clearPinSlot(slot);
  openSlot.value = null;
}

async function removeSlot(slot: number): Promise<void> {
  if (!confirm(t("canvasUi.pinDeleteConfirm", { slot: slot }))) return;
  await ed.removePinSlot(slot);
  openSlot.value = null;
}

onMounted(() => void ed.loadPinGroups());
defineExpose({ reload: () => ed.loadPinGroups() });
</script>

<template>
  <div class="canvas-pins" data-no-pan>
    <div class="canvas-pins__row">
      <button
        v-for="g in groups"
        :key="g.group_id"
        class="pin-chip"
        :class="{ 'is-empty': g.node_ids.length === 0 }"
        :style="{ '--pin-color': g.color ?? '#8b93a7' }"
        :title="g.node_ids.length ? t('canvasUi.pinSlotTitle', { n: g.node_ids.length }) : t('canvasUi.pinSlotEmpty')"
        @click="ed.focusPinGroup(g)"
        @contextmenu.prevent="openSlot = openSlot === g.slot ? null : g.slot"
      >
        <span class="pin-chip__dot" />
        <span class="pin-chip__name">{{ g.name || t("canvasUi.pinGroupN", { n: g.slot }) }}</span>
        <span class="pin-chip__count">{{ g.node_ids.length }}</span>
      </button>

      <!-- 加入新槽位 -->
      <button
        v-if="firstFreeSlot"
        class="pin-add"
        :disabled="selectedCount === 0"
        :title="selectedCount === 0 ? t('canvasUi.pinSaveTitleEmpty') : t('canvasUi.pinSaveTitle', { n: selectedCount })"
        @click="addToFirstFree"
      >
        <CanvasIcon name="plus" :size="14" />
        <span>{{ t("canvasUi.pinSaveAsGroup") }}</span>
      </button>

      <!-- 槽位已满 -->
      <span v-else class="cv-hint pin-full">{{ t("canvasUi.pinFull", { n: maxSlots }) }}</span>
    </div>

    <!-- 槽位操作浮层（右键已有分组打开） -->
    <div v-if="openSlot !== null" class="pin-menu cv-chrome" role="menu" :aria-label="t('canvasUi.pinMenuAria')">
      <p class="pin-menu__head">{{ t("canvasUi.pinSlotHead", { n: openSlot }) }}</p>
      <button type="button" class="pin-menu__item pin-overwrite" @click="overwrite(openSlot)">
        {{ t("canvasUi.pinReplace") }}
      </button>
      <button type="button" class="pin-menu__item pin-clear" @click="clearSlot(openSlot)">{{ t("canvasUi.pinClear") }}</button>
      <button type="button" class="pin-menu__item pin-remove is-danger" @click="removeSlot(openSlot)">
        {{ t("canvasUi.pinDelete") }}
      </button>
      <button type="button" class="pin-menu__item pin-cancel" @click="openSlot = null">{{ t("canvasUi.cancel") }}</button>
    </div>
  </div>
</template>

<style scoped>
.canvas-pins {
  position: absolute;
  /* 顶栏高 64，留 8 间距；水平居中，右移让开右侧检查器 */
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 22;
  pointer-events: auto;
}
.canvas-pins__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: center;
  max-width: min(720px, 80vw);
}
.pin-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--cv-chrome-border);
  border-radius: var(--radius-full);
  background: var(--cv-chrome-bg);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  backdrop-filter: blur(10px);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.pin-chip:hover {
  border-color: var(--pin-color);
  color: var(--text-1);
}
.pin-chip.is-empty {
  opacity: 0.6;
}
.pin-chip__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--pin-color);
  flex: none;
}
.pin-chip__name {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pin-chip__count {
  font-size: 10px;
  color: var(--text-4);
}
.pin-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 1px dashed var(--cv-chrome-border);
  border-radius: var(--radius-full);
  background: #191a2199;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
}
.pin-add:hover:not(:disabled) {
  border-color: var(--brand-border);
  color: var(--brand-on-soft);
}
.pin-add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pin-full {
  padding: 4px 8px;
}

.pin-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 150px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pin-menu__head {
  margin: 0;
  padding: 3px 8px 5px;
  font-size: 10px;
  color: var(--text-4);
}
.pin-menu__item {
  text-align: left;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.pin-menu__item:hover {
  background: #ffffff14;
  color: var(--text-1);
}
.pin-menu__item.is-danger {
  color: var(--danger);
}
</style>
