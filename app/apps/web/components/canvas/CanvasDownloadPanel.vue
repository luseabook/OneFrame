<script setup lang="ts">
import type { CanvasEditor } from "~/composables/useCanvasEditor";
import type { DownloadListDto } from "~/composables/useCanvasApi";

/**
 * 下载记录抽屉（C13 批量下载的可复用凭证）
 *
 * 为什么它必须存在、而不是"打包完直接给一条链接"：
 * 签名链接 24h 就过期，而用户可能明天才想起来下载同一批文件。
 * 下载单落库 + 每次现签，才是"同一批产物可以反复取"的唯一做法。
 */
const props = defineProps<{ editor: CanvasEditor; highlightId?: string | null }>();
const emit = defineEmits<{ close: [] }>();

const ed = props.editor;
const api = useCanvasApi();
const toast = useToast();

const rows = ref<DownloadListDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadError = ref("");
/** 已取到的链接按下载单 id 存：同一条可以取多次，不互相覆盖 */
const links = ref<Record<string, { url: string; filename: string }>>({});
const fetching = ref("");

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await api.listDownloadLists(ed.canvasId.value, 1, 30);
    rows.value = res.list;
    total.value = res.total;
  } catch (err) {
    loadError.value = (err as { message?: string }).message || "读取失败";
  } finally {
    loading.value = false;
  }
}

async function fetchUrl(row: DownloadListDto): Promise<void> {
  if (fetching.value) return;
  fetching.value = row.download_list_id;
  try {
    const res = await api.downloadListUrl(ed.canvasId.value, row.download_list_id);
    links.value = { ...links.value, [row.download_list_id]: { url: res.url, filename: res.filename } };
    toast.success("链接已生成（24 小时内有效）");
  } catch (err) {
    toast.error((err as { message?: string }).message || "取链接失败");
  } finally {
    fetching.value = "";
  }
}

function timeText(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

onMounted(() => void load());
</script>

<template>
  <div class="canvas-downloads" role="dialog" aria-label="下载记录">
    <div class="canvas-downloads__panel cv-chrome">
      <header class="canvas-downloads__head">
        <span>下载记录</span>
        <button class="cv-glass-btn" aria-label="关闭" @click="emit('close')">
          <CanvasIcon name="close" :size="16" />
        </button>
      </header>

      <p v-if="loading" class="cv-hint">读取中…</p>
      <p v-else-if="loadError" class="cv-hint canvas-downloads__error">{{ loadError }}</p>
      <p v-else-if="rows.length === 0" class="cv-hint canvas-downloads__empty">
        还没有打包记录。多选带产物的节点后点检查器里的「打包选中节点的产物」。
      </p>

      <ul v-else class="canvas-downloads__list">
        <li
          v-for="row in rows"
          :key="row.download_list_id"
          class="dl-row"
          :class="{ 'is-fresh': highlightId === row.download_list_id }"
        >
          <div class="dl-row__info">
            <p class="dl-row__name" :title="row.filename">{{ row.filename }}</p>
            <p class="dl-row__meta">
              <span class="cv-tag">{{ row.node_count }} 节点</span>
              <span class="cv-tag">{{ row.file_count }} 文件</span>
              <span class="cv-tag">{{ timeText(row.created_at) }}</span>
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            class="dl-row__get"
            :loading="fetching === row.download_list_id"
            @click="fetchUrl(row)"
          >
            取链接
          </Button>
          <a
            v-if="links[row.download_list_id]"
            class="dl-row__link"
            :href="links[row.download_list_id]!.url"
            :download="links[row.download_list_id]!.filename"
            target="_blank"
            rel="noopener"
          >
            下载
          </a>
        </li>
      </ul>

      <p v-if="total > rows.length" class="cv-hint">共 {{ total }} 条，仅显示最近 {{ rows.length }} 条。</p>
    </div>
  </div>
</template>

<style scoped>
.canvas-downloads {
  position: absolute;
  top: 64px;
  right: 16px;
  bottom: 16px;
  z-index: 26;
  display: flex;
}
.canvas-downloads__panel {
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-lg);
  overflow-y: auto;
}
.canvas-downloads__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-1);
}
.canvas-downloads__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
}
/* 刚打包出来的那条高亮一下：用户点完按钮后视线应该立刻落到它上面 */
.dl-row.is-fresh {
  border-color: var(--brand-400);
}
.dl-row__info {
  flex: 1;
  min-width: 0;
}
.dl-row__name {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-row__meta {
  margin: 0;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.dl-row__link {
  font-size: 12px;
  color: var(--brand-400);
  text-decoration: underline;
  white-space: nowrap;
}
</style>
