<script setup lang="ts">
import type { FilmFieldDto } from "~/types/api";

/**
 * film 单元格编辑器 —— 按 `field_type` 渲染对应控件，并在提交前做**与后端同口径**的本地校验。
 *
 * 为什么前端也要校验一遍：后端返回 `400101 + {field: field_id}`，但用户已经把注意力移到
 * 下一格了。本地先拦住"日期填了文本""数字填了字母"，只把"版本冲突(746002)"留给服务端
 * （那是并发状态，前端无法预知）。
 *
 * 只读三列（task_status / review_ref / points_ro）在这里**没有输入控件**：
 * 它们的值由服务端产生（行状态、审核版本、积分结算），前端只展示。
 */

const props = defineProps<{
  field: FilmFieldDto;
  value: unknown;
  disabled?: boolean;
  /** 行状态（task_status 列展示用；值来自行而非单元格） */
  rowStatus?: number;
}>();

const emit = defineEmits<{ commit: [value: unknown] }>();

const STATUS_LABEL: Record<number, string> = {
  1: "未开始",
  2: "制作中",
  3: "提交审核",
  4: "驳回修改",
  5: "定稿完成",
};

const options = computed<Array<{ id: string; name: string }>>(() => {
  const raw = props.field.config_json?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      const item = o as Record<string, unknown>;
      if (typeof item.id !== "string") return null;
      return { id: item.id, name: typeof item.name === "string" ? item.name : item.id };
    })
    .filter((v): v is { id: string; name: string } => v !== null);
});

/** 本地校验错误（只影响提示，不阻断父级数据） */
const errorMsg = ref("");

/**
 * 受控显示值：**直接由 props 派生，不做本地草稿**。
 *
 * 为什么不用 `ref` + `watch(props.value)` 那份"草稿"写法：行数据刷新（保存成功后
 * `loadTable()` 会整页替换 tasks）时，草稿与 props 很容易不同步，表现为"值存进去了
 * 但输入框还是空的"。派生写法让显示永远等于服务端返回的值，改动只在 `@change` 时向上抛。
 */
const shown = computed(() => toDraft(props.value));

function toDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(",");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    return JSON.stringify(value);
  }
  return String(value);
}

const readonlyType = computed(() =>
  ["task_status", "review_ref", "points_ro"].includes(props.field.field_type),
);

const displayValue = computed(() => {
  if (props.field.field_type === "task_status") {
    const s = typeof props.rowStatus === "number" ? props.rowStatus : Number(props.value ?? 0);
    return STATUS_LABEL[s] ?? "—";
  }
  if (props.field.field_type === "review_ref") {
    return typeof props.value === "string" && props.value.length > 0 ? String(props.value) : "未提交";
  }
  if (props.field.field_type === "points_ro") {
    // 后端未结算时返回 null（不返回假 0，api-spec 口径）
    return props.value === null || props.value === undefined ? "未结算" : String(props.value);
  }
  return "";
});

/** 提交：null 表示清空（后端落库是 DELETE 行，不是写 null） */
function commit(rawInput: string) {
  if (props.disabled || readonlyType.value) return;
  const raw = rawInput.trim();
  if (raw === "") {
    errorMsg.value = "";
    emit("commit", null);
    return;
  }
  const parsed = parseValue(props.field, raw);
  if (parsed instanceof Error) {
    errorMsg.value = parsed.message;
    return;
  }
  errorMsg.value = "";
  emit("commit", parsed);
}

function onChange(event: Event) {
  commit((event.target as HTMLInputElement | HTMLSelectElement).value);
}

function parseValue(field: FilmFieldDto, raw: string): unknown | Error {
  switch (field.field_type) {
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return new Error("请填数字");
      const cfg = field.config_json ?? {};
      if (typeof cfg.min === "number" && n < cfg.min) return new Error(`不能小于 ${cfg.min}`);
      if (typeof cfg.max === "number" && n > cfg.max) return new Error(`不能大于 ${cfg.max}`);
      return n;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Error("格式 YYYY-MM-DD");
      if (Number.isNaN(Date.parse(raw))) return new Error("日期非法");
      return raw;
    }
    case "user":
    case "canvas_ref":
    case "asset_ref": {
      const ids = raw
        .split(/[,;、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) return null;
      if (ids.some((id) => !/^\d+$/.test(id))) return new Error("请填 ID（数字）");
      // 多值列保留数组形状；单值列保持字符串，避免后端归一化后前端出现多余逗号
      return ids.length === 1 ? ids[0] : ids;
    }
    case "multi_select": {
      const ids = raw
        .split(/[,;、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return ids;
    }
    case "select": {
      if (options.value.length > 0 && !options.value.some((o) => o.id === raw || o.name === raw)) {
        return new Error("不在可选项内");
      }
      return raw;
    }
    case "link": {
      if (!/^https?:\/\/\S+$/i.test(raw) && !/^\/\S*$/.test(raw)) return new Error("请填 http(s) 链接");
      return raw;
    }
    default:
      return raw;
  }
}
</script>

<template>
  <div class="fl-cell">
    <template v-if="readonlyType">
      <span class="fl-cell-ro" :class="`fl-cell-ro-${field.field_type}`">{{ displayValue }}</span>
    </template>

    <select
      v-else-if="field.field_type === 'select' && options.length > 0"
      class="fl-input"
      :value="shown"
      :disabled="disabled"
      @change="onChange"
    >
      <option value="">（空）</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option>
    </select>

    <input
      v-else
      class="fl-input"
      :value="shown"
      :type="field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'"
      :placeholder="field.field_type === 'user' ? '成员ID' : field.field_type === 'asset_ref' ? '资产ID' : ''"
      :disabled="disabled"
      @change="onChange"
    />
    <p v-if="errorMsg" class="fl-cell-err">{{ errorMsg }}</p>
  </div>
</template>

<style scoped>
.fl-cell {
  min-width: 88px;
  color: #2a2f3a;
}
.fl-input {
  width: 100%;
  min-width: 72px;
  padding: 4px 6px;
  border: 1px solid var(--of-border, #e3e6ee);
  border-radius: 6px;
  background: #fff;
  /* 深色壳层里表格是白底：文字色必须显式给，否则继承浅色文字后"输入框看着是空的" */
  color: #2a2f3a;
  font-size: 13px;
}
.fl-input::placeholder {
  color: #9aa0b4;
}
.fl-input:disabled {
  background: #f6f7fb;
  color: #9aa0b4;
}
.fl-cell-ro {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f2f4f9;
  color: #5b6178;
  font-size: 12px;
}
.fl-cell-ro-task_status {
  background: #eef4ff;
  color: #2f5bd7;
}
.fl-cell-ro-points_ro {
  background: #fff6ec;
  color: #a8621b;
}
.fl-cell-ro-review_ref {
  background: #eefaf1;
  color: #23824a;
}
.fl-cell-err {
  margin: 2px 0 0;
  font-size: 11px;
  color: #d64545;
}
</style>
