<script setup lang="ts">
/**
 * 资源目录筛选条（竞品 `df/resources/dir/list`，第 137 批）。
 *
 * 只做「筛选 + 新建」；移动/重命名/删除目录走 API（已实现），页面暂不铺全部操作。
 * 目录按项目隔离，切项目时重新拉取。
 */
const props = defineProps<{ projectId: string; modelValue: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "changed"): void;
}>();

const api = useApi();
const { t } = useI18n();

interface DirDto {
  id: string;
  name: string;
  parent_id: string | null;
  resource_count: number;
}

const dirs = ref<DirDto[]>([]);
const loading = ref(false);
const newOpen = ref(false);
const newName = ref("");
const busy = ref(false);
const error = ref("");

async function load(): Promise<void> {
  if (!props.projectId) {
    dirs.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await api.get<{ list: DirDto[] }>(`/df/resources/dir/list?sp_id=${props.projectId}`);
    dirs.value = res.list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("resourceDir.loadFailed");
  } finally {
    loading.value = false;
  }
}

watch(() => props.projectId, () => {
  emit("update:modelValue", "all");
  void load();
}, { immediate: true });

function select(value: string): void {
  emit("update:modelValue", value);
  emit("changed");
}

async function create(): Promise<void> {
  const name = newName.value.trim();
  if (!name || busy.value || !props.projectId) return;
  busy.value = true;
  error.value = "";
  try {
    await api.post("/df/resources/dir", { sp_id: props.projectId, name });
    newName.value = "";
    newOpen.value = false;
    await load();
    emit("changed");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("resourceDir.createFailed");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="rdb">
    <div class="rdb__chips">
      <button
        type="button"
        class="rdb__chip"
        :class="{ 'rdb__chip--active': modelValue === 'all' }"
        @click="select('all')"
      >
        {{ t("resourceDir.all") }}
      </button>
      <button
        type="button"
        class="rdb__chip"
        :class="{ 'rdb__chip--active': modelValue === 'none' }"
        @click="select('none')"
      >
        {{ t("resourceDir.unfiled") }}
      </button>
      <button
        v-for="dir in dirs"
        :key="dir.id"
        type="button"
        class="rdb__chip"
        :class="{ 'rdb__chip--active': modelValue === dir.id }"
        @click="select(dir.id)"
      >
        {{ dir.name }}<span class="rdb__count">{{ dir.resource_count }}</span>
      </button>
      <span v-if="loading" class="rdb__muted">{{ t("resourceDir.loading") }}</span>
    </div>

    <div class="rdb__new">
      <button v-if="!newOpen" type="button" class="rdb__chip rdb__chip--add" @click="newOpen = true">
        + {{ t("resourceDir.newDir") }}
      </button>
      <template v-else>
        <input
          v-model="newName"
          class="rdb__input"
          maxlength="50"
          :placeholder="t('resourceDir.namePlaceholder')"
          @keyup.enter="create"
          @keyup.esc="newOpen = false"
        />
        <button type="button" class="rdb__chip" :disabled="busy" @click="create">
          {{ t("resourceDir.create") }}
        </button>
        <button type="button" class="rdb__chip" @click="newOpen = false">{{ t("resourceDir.cancel") }}</button>
      </template>
    </div>
    <p v-if="error" class="rdb__err">{{ error }}</p>
  </div>
</template>

<style scoped>
.rdb {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.rdb__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.rdb__chip {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.rdb__chip:hover,
.rdb__chip--active {
  color: var(--text-1);
  border-color: var(--brand, #9b46ff);
}
.rdb__chip--add {
  color: var(--brand, #9b46ff);
}
.rdb__count {
  margin-left: 4px;
  color: var(--text-4);
  font-size: 10.5px;
}
.rdb__new {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rdb__input {
  height: 28px;
  width: 150px;
  padding: 0 8px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  outline: none;
}
.rdb__muted {
  color: var(--text-4);
  font-size: 11.5px;
}
.rdb__err {
  margin: 0;
  width: 100%;
  color: var(--danger, #f56c6c);
  font-size: 12px;
}
</style>