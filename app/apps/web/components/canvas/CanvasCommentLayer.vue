<script setup lang="ts">
import type { CanvasEditor } from "~/composables/useCanvasEditor";

/**
 * 批注图层（画布坐标上的飘点 + 侧栏对话）
 *
 * 为什么单独一层而不是塞进节点：
 * 批注既能挂在节点上，也能落在画布任意位置（"这里空一块要不要补个镜头"）。
 * 塞进节点就没法表达"画布级"意见。所以锚点存的是**世界坐标**，
 * 跟着视口 transform 一起缩放——直接用屏幕坐标的话，平移后批注就跑偏了。
 */
const props = defineProps<{
  editor: CanvasEditor;
  /** 世界坐标 → 屏幕坐标的换算（由页面提供，保证与画布视口一致） */
  worldToScreen: (x: number, y: number) => { x: number; y: number };
}>();

const emit = defineEmits<{ "request-anchor": [p: { clientX: number; clientY: number }] }>();

const ed = props.editor;
const toast = useToast();

const draftText = ref("");
const replyText = ref("");
const openId = ref<string | null>(null);

const activeComments = computed(() => ed.activeComments.value);

/** 每个批注点的屏幕位置（跟随视口） */
function pinStyle(anchor: { x: number; y: number }): Record<string, string> {
  const p = props.worldToScreen(anchor.x, anchor.y);
  return { left: `${p.x}px`, top: `${p.y}px` };
}

function openThread(id: string): void {
  openId.value = id;
  void ed.loadComments(id);
}

async function submitDraft(): Promise<void> {
  // 批注模式下的输入框：内容在下方输入区，位置由页面在点击画布时记录
  const text = draftText.value.trim();
  if (!text) {
    toast.error("先写点什么再发");
    return;
  }
  const at = pendingAnchor.value;
  if (!at) {
    toast.error("先在画布上点一个位置");
    return;
  }
  const ok = await ed.createComment(at, text);
  if (ok) {
    draftText.value = "";
    pendingAnchor.value = null;
    ed.commentMode.value = false;
  }
}

const pendingAnchor = ref<{ x: number; y: number } | null>(null);

/** 页面在批注模式下点画布时会调它（通过 expose 暴露） */
function setPendingAnchor(anchor: { x: number; y: number }): void {
  pendingAnchor.value = anchor;
}

/**
 * 兜底：若事件真的落到本层（例如未来把锚点层改为可点），也走同一套落点逻辑。
 * 正常情况下事件的 target 是 .canvas-stage，由页面处理。
 */
function onLayerClick(ev: MouseEvent): void {
  if (!ed.commentMode.value) return;
  // 交给页面统一换算世界坐标（这里没有视口），只做语义占位避免静默失败
  emit("request-anchor", { clientX: ev.clientX, clientY: ev.clientY });
}

async function submitReply(): Promise<void> {
  const id = openId.value;
  if (!id) return;
  const text = replyText.value.trim();
  if (!text) return;
  const ok = await ed.replyComment(id, text);
  if (ok) replyText.value = "";
}

async function toggleResolved(id: string, cur: boolean): Promise<void> {
  await ed.toggleCommentResolved(id, !cur);
}

async function removeComment(id: string): Promise<void> {
  if (!confirm("删除这条批注及其全部消息？")) return;
  await ed.deleteComment(id);
  if (openId.value === id) openId.value = null;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

defineExpose({ setPendingAnchor });
onMounted(() => void ed.loadCommentNodes());
</script>

<template>
  <!-- 飘点层：pointer-events 只开在飘点自身，不挡住画布拖拽 -->
  <div
    class="canvas-comments"
    :class="{ 'is-placing': ed.commentMode.value }"
    data-comment-layer
    @click.self="onLayerClick"
  >
    <button
      v-for="cn in ed.commentNodes.value"
      :key="cn.id"
      class="comment-pin"
      :class="{ 'is-resolved': cn.resolved, 'is-active': openId === cn.id }"
      :style="pinStyle(cn.anchor)"
      :aria-label="`批注 ${cn.comment_count ?? 0} 条${cn.resolved ? '（已解决）' : ''}`"
      :data-comment-id="cn.id"
      @click.stop="openThread(cn.id)"
    >
      <span class="comment-pin__dot" />
      <span class="comment-pin__count">{{ cn.comment_count ?? 0 }}</span>
    </button>

    <!-- 放置中的提示：告诉用户"现在点画布会落批注点" -->
    <div v-if="ed.commentMode.value" class="comment-hint">
      {{ pendingAnchor ? "写好内容后点「发送」" : "点击画布任意位置放置批注点" }}
    </div>

    <!-- 编辑区（放置中 或 已选中某条批注） -->
    <aside v-if="ed.commentMode.value || openId" class="comment-panel cv-chrome">
      <!-- 新建 -->
      <template v-if="ed.commentMode.value">
        <div class="comment-panel__head">
          <span>新建批注</span>
          <button class="cv-glass-btn" aria-label="取消" @click="ed.commentMode.value = false; pendingAnchor = null">
            <CanvasIcon name="close" :size="14" />
          </button>
        </div>
        <p v-if="!pendingAnchor" class="cv-hint">先点击画布上的位置</p>
        <textarea
          v-model="draftText"
          class="cv-textarea comment-draft"
          placeholder="写下你的意见，例如「这里的镜头再长一点」"
          :disabled="!pendingAnchor"
          @keydown.ctrl.enter="submitDraft"
        />
        <Button size="sm" block class="comment-send" :disabled="!pendingAnchor || !draftText.trim()" @click="submitDraft">
          发送
        </Button>
      </template>

      <!-- 已有批注的对话 -->
      <template v-else-if="openId">
        <div class="comment-panel__head">
          <span>
            批注
            <span v-if="ed.commentNodes.value.find((c) => c.id === openId)?.resolved" class="cv-tag cv-tag--success">已解决</span>
          </span>
          <button class="cv-glass-btn" aria-label="关闭" @click="openId = null">
            <CanvasIcon name="close" :size="14" />
          </button>
        </div>

        <ul class="comment-thread">
          <li v-for="c in activeComments" :key="c.id" class="comment-item">
            <p class="comment-item__text">{{ c.content }}</p>
            <p class="comment-item__meta">{{ fmtTime(c.created_at) }}</p>
          </li>
        </ul>
        <p v-if="activeComments.length === 0" class="cv-hint">没有消息</p>

        <textarea
          v-model="replyText"
          class="cv-textarea comment-reply"
          placeholder="回复…（Ctrl+Enter 发送）"
          @keydown.ctrl.enter="submitReply"
        />
        <div class="comment-panel__acts">
          <Button size="sm" class="comment-send-reply" :disabled="!replyText.trim()" @click="submitReply">回复</Button>
          <Button
            size="sm"
            variant="ghost"
            class="comment-toggle-resolve"
            @click="toggleResolved(openId, !!ed.commentNodes.value.find((c) => c.id === openId)?.resolved)"
          >
            {{ ed.commentNodes.value.find((c) => c.id === openId)?.resolved ? "重新打开" : "标记已解决" }}
          </Button>
          <Button size="sm" variant="ghost" class="comment-delete" @click="removeComment(openId)">删除</Button>
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.canvas-comments {
  position: absolute;
  inset: 0;
  /* 必须高于检查器（aside 是 z-index:20）与顶栏，否则批注面板会被检查器盖住、
     按钮点不动（实测：`.comment-send` 被 `.insp-typecount__row` 拦截）。
     又必须低于模板/素材抽屉（z-index:30）——它们是模态，应压在最上层。 */
  z-index: 25;
  /* 整层永远不吃事件：否则它会盖住 .canvas-stage，画布的 pointerdown 收不到，
     批注模式的"点哪落哪"就永远触发不了（实测：输入框一直是 disabled）。
     落点逻辑放在页面的 onStagePointerDown 里，飘点自己开 pointer-events。 */
  pointer-events: none;
}
.canvas-comments.is-placing {
  cursor: crosshair;
}

.comment-pin {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px 2px 3px;
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-full) var(--radius-full) var(--radius-full) 2px;
  background: #191a21f2;
  color: var(--text-1);
  font-size: 10px;
  cursor: pointer;
  transform: translate(-2px, -100%);
  pointer-events: auto;
  box-shadow: 0 2px 8px -2px #000000cc;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.comment-pin:hover {
  border-color: var(--brand-400);
}
.comment-pin.is-active {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px #9b46ff40;
}
.comment-pin.is-resolved {
  opacity: 0.5;
  border-color: var(--cv-node-border);
}
.comment-pin__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--brand-400);
}
.comment-pin.is-resolved .comment-pin__dot {
  background: var(--text-4);
}
.comment-pin__count {
  line-height: 1.4;
}

.comment-hint {
  position: absolute;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: #000000cc;
  color: var(--text-1);
  font-size: 11px;
  pointer-events: none;
}

.comment-panel {
  position: absolute;
  right: 16px;
  top: 76px;
  width: 260px;
  max-height: 60vh;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: auto;
}
.comment-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
}
.comment-thread {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 32vh;
}
.comment-item {
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: #ffffff0a;
}
.comment-item__text {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
  line-height: 1.5;
  word-break: break-word;
}
.comment-item__meta {
  margin: 3px 0 0;
  font-size: 10px;
  color: var(--text-4);
}
.comment-panel__acts {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
</style>
