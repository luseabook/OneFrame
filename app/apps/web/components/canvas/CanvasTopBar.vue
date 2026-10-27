<script setup lang="ts">
/**
 * 画布浮层顶栏
 *
 * 为什么是"绝对定位浮在画布上"而不是布局里的 64px 行：
 * 参照站 `_acceptance/ref-authed/canvas.html` 里 header 挂在
 * `.canvas-topbar-shell{position:absolute;top:0;left:0;right:0;z-index:30;pointer-events:none}`
 * 上，画布世界坐标从 (0,0) 起算、与顶栏无关。若改成占流的一行，
 * 视口原点会被顶栏高度顶下去，缩放/框选的换算全部要加偏移量——不值得。
 * 同理 shell 本身 pointer-events:none，只有真正可点的胶囊才收事件，
 * 否则顶栏横条会挡住画布上半屏的拖拽。
 *
 * 尺寸全部来自参照站实测：header 高 64（`h-16`，py-[11px] pl-4 pr-6）；
 * 胶囊 `.canvas-header__chip` 高 40 / 圆角 14 / padding 0 4px；
 * 胶囊内按钮 `.canvas-header__chip-btn` 高 32 / 圆角 10 / gap 6 / padding 6 / 14px 字号。
 */
const props = defineProps<{
  title: string;
  version: number;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
}>();

const emit = defineEmits<{
  back: [];
  /** 失焦/回车提交；Esc 取消。空标题不提交（避免把画布改成无名） */
  rename: [title: string];
  save: [];
  reload: [];
  undo: [];
  redo: [];
  history: [];
}>();

const titleInput = ref<HTMLInputElement | null>(null);
const editing = ref(false);
const draft = ref("");

/** 后端可能给空标题（新建画布时 title 就是空串），展示层兜底但**不回写**，  */
/** 否则用户一进来就被改成"未命名画布"，脏标记无端亮起。 */
const { t } = useI18n();
const displayTitle = computed(() => props.title.trim() || t("canvasUi.untitled"));

function startEdit(): void {
  draft.value = props.title;
  editing.value = true;
  // 下一帧才有 input 节点，同时选中全部文本：改名场景几乎总是整体替换
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
}

function commitEdit(): void {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value.trim();
  if (next && next !== props.title) emit("rename", next);
}

function cancelEdit(): void {
  editing.value = false;
}

/** 保存中禁用整个动作组：并发提交会撞 version 冲突（746002），没必要让用户点第二次 */
const busy = computed(() => props.saving);
</script>

<template>
  <!--
    @pointerdown.stop 必须加：本组件挂在 .canvas-stage 内，stage 的 pointerdown
    会对自己 setPointerCapture，之后 click 会被派发到 stage 而非本组件
    （详见 CanvasEmptyGuide.vue 同一处注释）。不加就等于"顶栏按钮点不动"。
  -->
  <div class="canvas-topbar" @pointerdown.stop @dblclick.stop>
    <div class="canvas-topbar__left">
      <!-- 返回胶囊 -->
      <div class="topbar-chip cv-chrome">
        <button
          type="button"
          class="topbar-chip__btn topbar-back"
          :aria-label="t('canvasUi.backToList')"
          @click="emit('back')"
        >
          <CanvasIcon name="back" :size="18" />
          <span>{{ t("canvasUi.back") }}</span>
        </button>
      </div>

      <!-- 标题胶囊：点击进入 inline 改名，回车/失焦提交，Esc 撤销 -->
      <div class="topbar-chip cv-chrome topbar-title">
        <button
          v-if="!editing"
          type="button"
          class="topbar-chip__btn topbar-title__btn"
          :title="t('canvasUi.renameTip')"
          @click="startEdit"
        >
          <CanvasIcon name="map" :size="18" />
          <span class="topbar-title__text">{{ displayTitle }}</span>
        </button>
        <input
          v-else
          ref="titleInput"
          v-model="draft"
          class="topbar-title__input"
          type="text"
          maxlength="60"
          :aria-label="t('canvasUi.titleAria')"
          @keydown.enter.prevent="commitEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="commitEdit"
        />
        <span class="topbar-chip__divider" aria-hidden="true" />
        <span class="topbar-meta">
          <span v-if="version > 0" class="topbar-version" :title="t('canvasUi.versionTip')">v{{ version }}</span>
          <!-- 未保存标记：参照站没有，但契约给了 dirty 就必须可见，否则用户不知道要不要保存 -->
          <span v-if="dirty" class="topbar-dirty" :title="t('canvasUi.dirtyTip')" :aria-label="t('canvasUi.dirtyTip')" />
          <span v-if="saving" class="topbar-saving">{{ t("canvasUi.saving") }}</span>
        </span>
      </div>
    </div>

    <div class="canvas-topbar__right">
      <div class="topbar-actions cv-chrome">
        <button
          type="button"
          class="cv-glass-btn topbar-undo cv-tip"
          :data-tip="t('canvasUi.undoTip')"
          :aria-label="t('canvasUi.undo')"
          :disabled="!canUndo || busy"
          @click="emit('undo')"
        >
          <CanvasIcon name="undo" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn topbar-redo cv-tip"
          :data-tip="t('canvasUi.redoTip')"
          :aria-label="t('canvasUi.redo')"
          :disabled="!canRedo || busy"
          @click="emit('redo')"
        >
          <CanvasIcon name="redo" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn topbar-reload cv-tip"
          :data-tip="t('canvasUi.reloadTip')"
          :aria-label="t('canvasUi.reload')"
          :disabled="busy"
          @click="emit('reload')"
        >
          <CanvasIcon name="reload" :size="18" />
        </button>
        <button
          type="button"
          class="cv-glass-btn topbar-history cv-tip"
          :data-tip="t('canvasUi.historyAria')"
          :aria-label="t('canvasUi.historyAria')"
          :disabled="busy"
          @click="emit('history')"
        >
          <CanvasIcon name="history" :size="18" />
        </button>
        <span class="topbar-actions__divider" aria-hidden="true" />
        <button
          type="button"
          class="topbar-save"
          :disabled="busy"
          :aria-busy="saving ? 'true' : 'false'"
          @click="emit('save')"
        >
          <CanvasIcon name="save" :size="16" />
          <span>{{ saving ? t("canvasUi.saving") : t("canvasUi.save") }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* shell：只负责定位与事件穿透，参照站同款 */
.canvas-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: var(--header-h); /* 64px，tokens.css 已有 */
  padding: 11px 24px 11px 16px;
  pointer-events: none;
}
.canvas-topbar__left,
.canvas-topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  pointer-events: auto;
}

/* 胶囊：参照站 .canvas-header__chip 的 40/14/0 4px，玻璃用 .cv-chrome 但圆角要改 */
.topbar-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 4px;
  border-radius: 14px;
  min-width: 0;
}
.topbar-chip__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
.topbar-chip__btn:hover {
  background: var(--panel-tint);
  color: var(--text-1);
}
.topbar-chip__divider {
  flex: none;
  width: 1px;
  height: 8px;
  border-radius: 2px;
  background: var(--panel-tint-strong);
}

.topbar-title {
  max-width: 420px;
}
.topbar-title__btn {
  min-width: 0;
}
.topbar-title__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.topbar-title__input {
  width: 200px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--brand-border);
  border-radius: 10px;
  background: var(--bg-sunken);
  color: var(--text-1);
  font-size: 14px;
  line-height: 20px;
  outline: none;
}

.topbar-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 2px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.topbar-version {
  color: var(--brand-on-soft);
}
/* 小圆点比"未保存"三个字省空间，hover 有 title 说明 */
.topbar-dirty {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--warning);
}
.topbar-saving {
  color: var(--text-4);
}

/* 右侧动作组：整组一块玻璃，比 4 个独立按钮更像"一条工具栏" */
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 40px;
  padding: 4px;
  border-radius: 14px;
}
.topbar-actions__divider {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--panel-tint-strong);
}

.topbar-save {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--brand-500);
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
}
.topbar-save:hover:not(:disabled) {
  background: var(--brand-400);
}
.topbar-save:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 1280px) {
  /* 窄屏先让标题让位，动作组不能挤掉保存 */
  .topbar-title__text {
    max-width: 140px;
  }
}
</style>
