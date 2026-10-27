import { sql, type SQL } from "drizzle-orm";
import { filmTasks } from "@app/db";
import { AppError, ErrorCode, FILM_LIMITS } from "@app/shared";

/**
 * film 字段类型系统 —— 11 种 field_type 的**写入校验 + 过滤算子 + 排序表达式**。
 *
 * 为什么单独一个文件而不是散在 service 里：这 11 种的规则是"契约"，不是"实现细节"。
 * 单元格写入、批量查询的筛选、排序、导出四处的判定必须**完全一致**，否则会出现
 * "能写进去但筛不出来""导出里多一列空值"这类只在深夜暴露的问题。
 *
 * 证据与偏离：
 * - 9 种来自竞品 bundle 实证（text/asset_ref/link/user/date/canvas_ref/task_status/
 *   review_ref/points_ro），我方另加 select/multi_select/number（`schemas/film.ts` 注释）。
 * - `points_ro` 在竞品源码里 encodeCell 直接抛错（"积分由画布消耗结算，禁止前端写 cell"），
 *   故本文件对它和 review_ref / task_status 一律拒绝写入（400101 + field）。
 * - `is_unique_type` 语义是「该 field_type 每表至多一个」，**不是值唯一**，
 *   与单元格值无关，故不放这里（在字段 service 里判）。
 */

export interface FilmFieldLike {
  id: bigint;
  key: string;
  fieldType: string;
  configJson: unknown;
  isSystem: boolean;
}

/** 只读字段类型：写入一律 400101（`field=<field_id>`），值只能由服务端聚合/审核流产生 */
export const FILM_READONLY_TYPES: ReadonlySet<string> = new Set(["review_ref", "points_ro", "task_status"]);

/**
 * 过滤算子词表（按字段类型）。实测来源：竞品 `filterOps`（contract §3.5 注）。
 * 超出词表 → 400101 `field="filter[i].op"`，不能静默忽略（静默忽略等于筛选条件失效）。
 */
const COMMON_OPS = ["eq", "neq", "empty", "notEmpty"] as const;
const TEXT_OPS = [...COMMON_OPS, "contains", "notContains"] as const;
const ORDER_OPS = ["lt", "gt", "lte", "gte"] as const;

const OPS_BY_TYPE: Record<string, readonly string[]> = {
  text: TEXT_OPS,
  link: TEXT_OPS,
  select: TEXT_OPS,
  multi_select: TEXT_OPS,
  user: TEXT_OPS,
  canvas_ref: TEXT_OPS,
  asset_ref: TEXT_OPS,
  date: [...COMMON_OPS, ...ORDER_OPS],
  number: [...COMMON_OPS, ...ORDER_OPS],
  points_ro: [...COMMON_OPS, ...ORDER_OPS],
  task_status: COMMON_OPS,
  review_ref: COMMON_OPS,
};

export function allowedOps(fieldType: string): readonly string[] {
  return OPS_BY_TYPE[fieldType] ?? COMMON_OPS;
}

export function isReadonlyType(fieldType: string): boolean {
  return FILM_READONLY_TYPES.has(fieldType);
}

/**
 * 单元格值是否为"清空"指令。
 *
 * 三种等价写法都接受（前端三种历史写法都在用）：`null` / `{clear:true}` / 字段值缺失时
 * 由调用方跳过。**清空的落库动作是 DELETE 行**，不是写 null——稀疏表一旦写 null
 * 就会退化成"每行 × 每列"的稠密表（schema.ts film_cells 注释）。
 */
export function isClearValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.clear === true) return true;
    // 只有 {clear:false} 这一种"非清空"的畸形输入；正常值不会带 clear 键
    return Object.keys(obj).length === 1 && obj.clear === false;
  }
  return false;
}

function configOf(field: FilmFieldLike): Record<string, unknown> {
  const cfg = field.configJson;
  return typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)
    ? (cfg as Record<string, unknown>)
    : {};
}

function fail(field: FilmFieldLike, message: string, reason: string): never {
  throw new AppError(ErrorCode.INVALID_PARAM, message, {
    field: String(field.id),
    reason,
  });
}

const DIGITS_RE = /^\d+$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function assertDigitId(field: FilmFieldLike, value: unknown, label: string): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== "string" || !DIGITS_RE.test(value.trim())) {
    fail(field, `${label} must be an id string`, "invalid_ref");
  }
  return value.trim();
}

function assertDigitIdList(field: FilmFieldLike, value: unknown, label: string): string[] {
  const arr = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of arr) {
    const id = assertDigitId(field, item, label);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function optionValues(field: FilmFieldLike): string[] {
  const options = configOf(field).options;
  if (!Array.isArray(options)) return [];
  const out: string[] = [];
  for (const opt of options) {
    if (typeof opt === "object" && opt !== null) {
      const o = opt as Record<string, unknown>;
      if (typeof o.id === "string") out.push(o.id);
      if (typeof o.name === "string") out.push(o.name);
    }
  }
  return out;
}

/**
 * 按 field_type 归一化一个单元格值（已通过"是否清空"判定之后调用）。
 *
 * 返回 JSONB 可存的**规范形**；非法输入抛 400101（带 `field`，前端能精确高亮那一格）。
 * 归一化的目的是让筛选/排序在同一形状上比较：例如 user 一律转成数字 id 字符串，
 * 避免 "123" 与 123 在 JSONB 里变成两种值而 eq 筛不到。
 */
export function normalizeCellValue(field: FilmFieldLike, raw: unknown): unknown {
  if (isReadonlyType(field.fieldType)) {
    const hint =
      field.fieldType === "points_ro"
        ? "积分由画布消耗结算，禁止写入 cell"
        : "该列由服务端维护，禁止写入 cell";
    fail(field, `field is read-only: ${field.fieldType}`, "readonly_field", );
    // 上面必抛；这行让类型收窄可读
    void hint;
  }
  const cfg = configOf(field);
  switch (field.fieldType) {
    case "text": {
      if (typeof raw !== "string") fail(field, "text cell must be a string", "invalid_type");
      const max = typeof cfg.max_length === "number" ? cfg.max_length : FILM_LIMITS.CELL_TEXT_MAX;
      if (raw.length > max) fail(field, `text cell exceeds ${max} chars`, "too_long");
      return raw;
    }
    case "date": {
      if (typeof raw !== "string") fail(field, "date cell must be a string", "invalid_type");
      const v = raw.trim();
      if (!DATE_ONLY_RE.test(v) && !DATE_TIME_RE.test(v)) {
        fail(field, "date cell must be YYYY-MM-DD or ISO8601 datetime", "invalid_date");
      }
      if (Number.isNaN(Date.parse(v))) fail(field, "date cell is not a valid date", "invalid_date");
      return v;
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        fail(field, "number cell must be a finite number", "invalid_type");
      }
      if (typeof cfg.min === "number" && raw < cfg.min) fail(field, `number cell < min(${cfg.min})`, "out_of_range");
      if (typeof cfg.max === "number" && raw > cfg.max) fail(field, `number cell > max(${cfg.max})`, "out_of_range");
      const precision = typeof cfg.precision === "number" ? cfg.precision : undefined;
      if (precision === undefined) return raw;
      const factor = 10 ** precision;
      return Math.round(raw * factor) / factor;
    }
    case "user": {
      // 单值/多值都合法：竞品 assignees 是多值，而普通"负责人"列常是单值。
      // 归一化时保留客户端给的形状（单值不回写成数组），避免前端渲染错位。
      if (Array.isArray(raw)) return assertDigitIdList(field, raw, "user cell");
      return assertDigitId(field, raw, "user cell");
    }
    case "select": {
      if (typeof raw !== "string") fail(field, "select cell must be a string", "invalid_type");
      const options = optionValues(field);
      if (options.length > 0 && !options.includes(raw)) {
        fail(field, "select cell is not one of the configured options", "invalid_option");
      }
      if (raw.length > 64) fail(field, "select cell too long", "too_long");
      return raw;
    }
    case "multi_select": {
      if (!Array.isArray(raw)) fail(field, "multi_select cell must be an array", "invalid_type");
      const options = optionValues(field);
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") fail(field, "multi_select items must be strings", "invalid_type");
        if (options.length > 0 && !options.includes(item)) {
          fail(field, "multi_select item is not one of the configured options", "invalid_option");
        }
        if (!out.includes(item)) out.push(item);
      }
      if (out.length > FILM_LIMITS.OPTION_MAX) fail(field, "multi_select too many items", "too_long");
      return out;
    }
    case "link": {
      // 兼容两种写法：裸 URL 字符串，或 {url, text}（竞品 link 单元格带展示文案）
      let url: string;
      let text: string | undefined;
      if (typeof raw === "string") {
        url = raw.trim();
      } else if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.url !== "string") fail(field, "link cell needs {url}", "invalid_type");
        url = obj.url.trim();
        if (typeof obj.text === "string") text = obj.text.slice(0, 200);
      } else {
        fail(field, "link cell must be a string or {url,text}", "invalid_type");
      }
      if (url.length === 0 || url.length > 2048) fail(field, "link cell url length invalid", "invalid_url");
      if (!/^https?:\/\/\S+$/i.test(url) && !/^\/\S*$/.test(url)) {
        fail(field, "link cell must be http(s) URL or site-relative path", "invalid_url");
      }
      return text === undefined ? url : { url, text };
    }
    case "canvas_ref": {
      const ids = assertDigitIdList(field, raw, "canvas_ref cell");
      return Array.isArray(raw) ? ids : ids[0];
    }
    case "asset_ref": {
      const ids = assertDigitIdList(field, raw, "asset_ref cell");
      return Array.isArray(raw) ? ids : ids[0];
    }
    default:
      // 未知类型只可能是历史脏数据：拒绝写入，避免把无法解释的值塞进 JSONB
      fail(field, `unsupported field_type: ${field.fieldType}`, "unsupported_type");
  }
}

// ── 查询侧：过滤条件 / 排序表达式（SQL 片段）──────────────────────────────

function jsonText(): SQL {
  // JSONB 标量的文本形：'"abc"'::jsonb #>> '{}' → 'abc'
  return sql`(c.value_json #>> '{}')`;
}

function jsonArrayHas(value: string): SQL {
  return sql`c.value_json @> ${JSON.stringify([value])}::jsonb`;
}

function jsonEquals(value: string): SQL {
  return sql`(c.value_json = ${JSON.stringify(value)}::jsonb or ${jsonArrayHas(value)})`;
}

/**
 * 把一个筛选条件编译成 SQL。
 *
 * 用 **correlated EXISTS 子查询** 而不是 join：
 * 一个条件命中多行 cell 时会因 join 放大行数（再去重很贵），EXISTS 天然是布尔语义，
 * 且多个条件之间可以直接 and 起来，不需要 distinct。
 */
export function buildFilterCondition(field: FilmFieldLike, op: string, value: unknown): SQL {
  const fieldId = field.id;
  const ops = allowedOps(field.fieldType);
  if (!ops.includes(op)) {
    throw new AppError(ErrorCode.INVALID_PARAM, `op "${op}" is not allowed for ${field.fieldType}`, {
      field: "filter.op",
      reason: "unsupported_op",
    });
  }
  const nonEmpty = sql`c.value_json is not null and c.value_json <> 'null'::jsonb`;
  const exists = (inner: SQL): SQL =>
    sql`exists (select 1 from film_cells c where c.task_id = ${filmTasks.id} and c.field_id = ${fieldId} and ${inner})`;

  if (op === "empty") return sql`not ${exists(nonEmpty)}`;
  if (op === "notEmpty") return exists(nonEmpty);

  const isNumeric =
    field.fieldType === "number" || field.fieldType === "points_ro" || field.fieldType === "task_status";
  const isDate = field.fieldType === "date";

  if (isNumeric) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "numeric filter needs a number", {
        field: "filter.value",
        reason: "invalid_type",
      });
    }
    const num = sql`(${jsonText()})::numeric`;
    const guarded = sql`jsonb_typeof(c.value_json) = 'number'`;
    switch (op) {
      case "eq":
        return exists(sql`${guarded} and ${num} = ${value}`);
      case "neq":
        return sql`not ${exists(sql`${guarded} and ${num} = ${value}`)}`;
      case "gt":
        return exists(sql`${guarded} and ${num} > ${value}`);
      case "gte":
        return exists(sql`${guarded} and ${num} >= ${value}`);
      case "lt":
        return exists(sql`${guarded} and ${num} < ${value}`);
      case "lte":
        return exists(sql`${guarded} and ${num} <= ${value}`);
      default:
        return sql`false`;
    }
  }

  if (isDate) {
    if (typeof value !== "string") {
      throw new AppError(ErrorCode.INVALID_PARAM, "date filter needs a string", {
        field: "filter.value",
        reason: "invalid_type",
      });
    }
    const dt = sql`(${jsonText()})::timestamptz`;
    const guarded = sql`jsonb_typeof(c.value_json) = 'string'`;
    switch (op) {
      case "eq":
        return exists(sql`${guarded} and ${dt} = ${value}::timestamptz`);
      case "neq":
        return sql`not ${exists(sql`${guarded} and ${dt} = ${value}::timestamptz`)}`;
      case "gt":
        return exists(sql`${guarded} and ${dt} > ${value}::timestamptz`);
      case "gte":
        return exists(sql`${guarded} and ${dt} >= ${value}::timestamptz`);
      case "lt":
        return exists(sql`${guarded} and ${dt} < ${value}::timestamptz`);
      case "lte":
        return exists(sql`${guarded} and ${dt} <= ${value}::timestamptz`);
      default:
        return sql`false`;
    }
  }

  // 文本族（含 select / multi_select / user / ref）
  if (typeof value !== "string") {
    throw new AppError(ErrorCode.INVALID_PARAM, "text filter needs a string", {
      field: "filter.value",
      reason: "invalid_type",
    });
  }
  const text = jsonText();
  switch (op) {
    case "eq":
      return exists(jsonEquals(value));
    case "neq":
      return sql`not ${exists(jsonEquals(value))}`;
    case "contains":
      return exists(sql`(${text} ilike ${"%" + value + "%"} or ${jsonArrayHas(value)})`);
    case "notContains":
      return sql`not ${exists(sql`(${text} ilike ${"%" + value + "%"} or ${jsonArrayHas(value)})`)}`;
    default:
      return sql`false`;
  }
}

/**
 * 按字段单元格排序的 SQL 表达式（null 一律 last）。
 *
 * 为什么不用 join：排序表达式用标量子查询即可，join 会让"一行多单元格"变成需要聚合，
 * 而聚合后的排序语义（min? 首值?）我们无从取证，索性取"该行该列的值"这个唯一答案。
 */
export function buildSortExpression(field: FilmFieldLike, order: "asc" | "desc"): SQL {
  const dir = sql.raw(order === "desc" ? "desc" : "asc");
  const fieldId = field.id;
  const expr =
    field.fieldType === "number" || field.fieldType === "points_ro" || field.fieldType === "task_status"
      ? sql`(select case when jsonb_typeof(c.value_json) = 'number' then (c.value_json #>> '{}')::numeric end
             from film_cells c where c.task_id = ${filmTasks.id} and c.field_id = ${fieldId})`
      : sql`(select c.value_json #>> '{}' from film_cells c
             where c.task_id = ${filmTasks.id} and c.field_id = ${fieldId})`;
  return sql`${expr} ${dir} nulls last`;
}
