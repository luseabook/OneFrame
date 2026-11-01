import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgTable, uniqueKeyName, type IndexedColumn, type PgColumn } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

/**
 * 迁移链 lockstep：schema.ts ↔ 最新快照 ↔ 迁移日志 ↔ .sql 文件必须四处对齐。
 *
 * ## 为什么需要它
 * drizzle-kit 的 `check` / `generate` 只拿 schema.ts 和**快照**比，压根不看 .sql 里写了什么。
 * 于是「改了 schema 却没 generate」「generate 了却没提交」「快照提交了但 .sql 丢了」
 * 「只补了快照忘了补日志」这几种断法，在 dev 库上完全不会报错——只有全新环境重建时才炸。
 * schema.spec.ts 里那句「断掉的迁移在 dev 库上不会报错（drizzle 只比对快照），只有新环境重建时才炸」
 * 说的就是这件事；在此之前没有任何测试覆盖它。
 *
 * ## 断什么
 * 1. 日志 idx 从 0 连续、每个条目都有同名 .sql 与快照、meta 里没有孤儿快照、prevId 链首尾相接；
 * 2. schema.ts 导出的表集合与最新快照双向相等；
 * 3. 每一列的类型 / 可空 / 主键 / 默认值（含值本身）与快照一致；
 * 4. 索引（名字、唯一性、列的次序与升降序）、唯一约束（含列级 `.unique()`）、复合主键；
 * 5. 外键的目标表、两端列、onDelete / onUpdate；
 * 6. CHECK 约束的名字。
 *
 * ## 不做什么（诚实边界）
 * - 不连数据库。第 118 批另用一次性库 `wf_d118` 做过实库重放校验（50 条迁移 → 115 表 / 1204 列 /
 *   186 索引 / 256 外键，差异 0），本文件只固化「四处文件对齐」这一层，CI 无需 PG；
 *   「重放结果 = 快照」仍由集成测试环境负责。
 * - 不解析 .sql 内容。三者同时存在且链条完整，才使「重放 = 快照」这个前提成立，内容正确性不在本文件。
 * - 不比对 CHECK 的表达式文本、索引的 where 条件 / operator class / WITH 参数、sequences / policies。
 * - 默认值只覆盖 schema 里实际用到的形态（字符串、数字、布尔、SQL 片段、空数组、普通对象）；
 *   以后若出现非空数组等新形态，这里会先红一次，提醒补归一规则而不是悄悄放过。
 */
const REPO_MARKER = join("apps", "api", "drizzle", "meta", "_journal.json");
const EMPTY_PREV_ID = "00000000-0000-0000-0000-000000000000";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface SnapshotColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  default?: string | number | boolean | null;
}

interface SnapshotIndexColumn {
  expression: string;
  isExpression: boolean;
  asc: boolean;
  nulls?: string;
}

interface SnapshotIndex {
  name: string;
  columns: SnapshotIndexColumn[];
  isUnique: boolean;
}

interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
}

interface SnapshotUniqueConstraint {
  name: string;
  columns: string[];
}

interface SnapshotPrimaryKey {
  name: string;
  columns: string[];
}

interface SnapshotCheck {
  name: string;
  value: string;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  compositePrimaryKeys: Record<string, SnapshotPrimaryKey>;
  uniqueConstraints: Record<string, SnapshotUniqueConstraint>;
  checkConstraints: Record<string, SnapshotCheck>;
}

interface Snapshot {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, SnapshotTable>;
}

const pad = (idx: number): string => String(idx).padStart(4, "0");

/** 从当前工作目录向上找仓库根（monorepo 下 vitest 的 cwd 是 packages/*）。 */
function drizzleDir(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, REPO_MARKER))) return join(dir, "apps", "api", "drizzle");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `找不到 apps/api/drizzle/meta/_journal.json（从 ${process.cwd()} 向上 8 层）；` +
      "本用例必须在 app/ 目录树内运行（pnpm test / pnpm vitest 均可）。",
  );
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const journal = (): Journal => readJson<Journal>(join(drizzleDir(), "meta", "_journal.json"));

const snapshotPath = (idx: number): string => join(drizzleDir(), "meta", `${pad(idx)}_snapshot.json`);

let latestCache: Snapshot | undefined;
function latestSnapshot(): Snapshot {
  if (!latestCache) {
    const entries = journal().entries;
    if (entries.length === 0) throw new Error("迁移日志为空：apps/api/drizzle/meta/_journal.json 没有任何条目");
    latestCache = readJson<Snapshot>(snapshotPath(entries[entries.length - 1].idx));
  }
  return latestCache;
}

/** Postgres 标识符上限 63 字节，超长名会被静默截断；两侧都归一后再比。 */
function pgName(name: string): string {
  const buf = Buffer.from(name, "utf8");
  if (buf.length <= 63) return name;
  let cut = 63;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return buf.subarray(0, cut).toString("utf8");
}

/** 取出 SQL 片段里的字面量文本（`sql` 模板只由字符串块与参数组成）。 */
function sqlText(chunk: unknown): string {
  const parts = (chunk as { queryChunks?: unknown[] }).queryChunks ?? [];
  return parts
    .map((part) => {
      const value = (part as { value?: unknown } | null)?.value;
      if (Array.isArray(value)) return value.join("");
      if (typeof value === "string") return value;
      return "";
    })
    .join("");
}

/**
 * 把 schema.ts 里的默认值归一成 drizzle-kit 快照里的写法：
 * 字符串/数字/布尔原样，SQL 片段取原文，空数组按列类型写 `'{}'` 或 `'[]'`，
 * 普通对象按 JSON 文本 + 类型转换。
 */
function defaultText(col: PgColumn): string | number | boolean | undefined {
  if (!col.hasDefault) return undefined;
  const value: unknown = col.default;
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (is(value, SQL)) return sqlText(value);
  if (Array.isArray(value)) {
    return col.getSQLType().endsWith("[]")
      ? `'{}'::${col.getSQLType()}`
      : `'${JSON.stringify(value)}'::${col.getSQLType()}`;
  }
  if (value && typeof value === "object") return `'${JSON.stringify(value)}'::${col.getSQLType()}`;
  return String(value);
}

/** schema.ts 导出的全部表，按表名索引；同名表直接报错而不是静默覆盖。 */
function schemaTables(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const table = value as PgTable;
    const cfg = getTableConfig(table);
    if (tables.has(cfg.name)) throw new Error(`schema.ts 导出了两张同名表：${cfg.name}`);
    tables.set(cfg.name, table);
  }
  return tables;
}

const snapshotTable = (name: string): SnapshotTable => latestSnapshot().tables[`public.${name}`];

describe("迁移链 lockstep（第 118 批）", () => {
  it("迁移日志 idx 连续，每个条目都有 .sql 与快照，且 prevId 链不断", () => {
    const entries = journal().entries;
    const problems: string[] = [];
    if (entries.length === 0) problems.push("迁移日志为空");

    entries.forEach((entry, i) => {
      if (entry.idx !== i) problems.push(`日志第 ${i} 项的 idx=${entry.idx}，应为 ${i}`);
      if (!existsSync(join(drizzleDir(), `${entry.tag}.sql`))) {
        problems.push(`日志条目 ${entry.idx}（${entry.tag}）找不到同名 .sql`);
      }
      if (!existsSync(snapshotPath(entry.idx))) {
        problems.push(`日志条目 ${entry.idx}（${entry.tag}）找不到 ${pad(entry.idx)}_snapshot.json`);
      }
    });

    const known = new Set(entries.map((entry) => `${pad(entry.idx)}_snapshot.json`));
    const metaDir = join(drizzleDir(), "meta");
    for (const file of readdirSync(metaDir)) {
      if (/^\d{4}_snapshot\.json$/.test(file) && !known.has(file)) {
        problems.push(`快照 ${file} 不在迁移日志里（孤儿，通常意味着 generate 后忘了提交日志）`);
      }
    }

    let prevId = EMPTY_PREV_ID;
    for (const entry of entries) {
      const snapshot = readJson<Snapshot>(snapshotPath(entry.idx));
      if (snapshot.prevId !== prevId) {
        problems.push(`快照 ${pad(entry.idx)} 的 prevId=${snapshot.prevId}，应为上一份的 id=${prevId}`);
      }
      prevId = snapshot.id;
    }

    expect(problems, "迁移链证据见 apps/api/drizzle/meta").toEqual([]);
  });

  it("schema.ts 的表集合与最新快照双向相等", () => {
    const tables = schemaTables();
    const snapshotTables = latestSnapshot().tables;
    const problems: string[] = [];

    for (const name of tables.keys()) {
      if (!snapshotTables[`public.${name}`]) problems.push(`表 ${name} 在 schema.ts 里，但最新快照没有（漏 generate）`);
    }
    for (const key of Object.keys(snapshotTables)) {
      const name = key.replace(/^public\./, "");
      if (!tables.has(name)) problems.push(`表 ${name} 在最新快照里，但 schema.ts 没有（表被删却漏 generate）`);
    }

    expect(problems, "表集合以 packages/db/src/schema.ts 为准").toEqual([]);
  });

  it("每一列的类型 / 可空 / 主键 / 默认值与最新快照一致", () => {
    const problems: string[] = [];
    let columns = 0;

    for (const [name, table] of schemaTables()) {
      const snapshotTableEntry = snapshotTable(name);
      if (!snapshotTableEntry) continue; // 表缺失由上一个用例报，这里不重复刷屏
      const cfg = getTableConfig(table);

      const schemaColumns = new Map(cfg.columns.map((col) => [col.name, col]));
      for (const snapshotColumn of Object.values(snapshotTableEntry.columns)) {
        columns++;
        const col = schemaColumns.get(snapshotColumn.name);
        if (!col) {
          problems.push(`列 ${name}.${snapshotColumn.name} 在快照里，但 schema.ts 没有`);
          continue;
        }
        if (col.getSQLType() !== snapshotColumn.type) {
          problems.push(`${name}.${snapshotColumn.name} 类型：schema=${col.getSQLType()} 快照=${snapshotColumn.type}`);
        }
        if (col.notNull !== snapshotColumn.notNull) {
          problems.push(`${name}.${snapshotColumn.name} 可空：schema notNull=${col.notNull} 快照=${snapshotColumn.notNull}`);
        }
        if (col.primary !== snapshotColumn.primaryKey) {
          problems.push(`${name}.${snapshotColumn.name} 主键：schema=${col.primary} 快照=${snapshotColumn.primaryKey}`);
        }
        const actual = defaultText(col);
        if (JSON.stringify(actual) !== JSON.stringify(snapshotColumn.default)) {
          problems.push(
            `${name}.${snapshotColumn.name} 默认值：schema=${JSON.stringify(actual)} 快照=${JSON.stringify(snapshotColumn.default)}`,
          );
        }
      }
      for (const name2 of schemaColumns.keys()) {
        if (!snapshotTableEntry.columns[name2]) problems.push(`列 ${name}.${name2} 在 schema.ts 里，但快照没有`);
      }
    }

    expect(columns, "应至少检查到一份快照里的全部列").toBeGreaterThan(0);
    expect(problems, "列定义以 packages/db/src/schema.ts 为准").toEqual([]);
  });

  it("索引、唯一约束、复合主键与最新快照一致", () => {
    const problems: string[] = [];
    let indexes = 0;

    for (const [name, table] of schemaTables()) {
      const snapshotTableEntry = snapshotTable(name);
      if (!snapshotTableEntry) continue;
      const cfg = getTableConfig(table);

      const describeSchemaColumn = (column: Partial<IndexedColumn> | SQL): string => {
        if (is(column, SQL)) return "<expr>";
        const indexed = column as Partial<IndexedColumn>;
        return `${pgName(indexed.name ?? "")}:${indexed.indexConfig?.order ?? "asc"}:${indexed.indexConfig?.nulls ?? "last"}`;
      };
      const describeSnapshotColumn = (column: SnapshotIndexColumn): string =>
        column.isExpression
          ? "<expr>"
          : `${pgName(column.expression)}:${column.asc ? "asc" : "desc"}:${column.nulls ?? "last"}`;

      const schemaIndexes = new Map(
        cfg.indexes.map((index) => [pgName(index.config.name ?? ""), index.config] as const),
      );
      const snapshotIndexes = new Map(
        Object.values(snapshotTableEntry.indexes).map((index) => [pgName(index.name), index] as const),
      );
      if (schemaIndexes.size !== cfg.indexes.length) problems.push(`索引名截断后碰撞：${name}`);
      for (const [indexName, snapshotIndex] of snapshotIndexes) {
        indexes++;
        const config = schemaIndexes.get(indexName);
        if (!config) {
          problems.push(`索引 ${name}.${indexName} 在快照里，但 schema.ts 没有`);
          continue;
        }
        if (config.unique !== snapshotIndex.isUnique) {
          problems.push(`索引 ${name}.${indexName} 唯一性：schema=${config.unique} 快照=${snapshotIndex.isUnique}`);
        }
        const actual = config.columns.map(describeSchemaColumn).join(",");
        const expected = snapshotIndex.columns.map(describeSnapshotColumn).join(",");
        if (actual !== expected) {
          problems.push(`索引 ${name}.${indexName} 列：[${actual}] vs 快照 [${expected}]`);
        }
      }
      for (const indexName of schemaIndexes.keys()) {
        if (!snapshotIndexes.has(indexName)) problems.push(`索引 ${name}.${indexName} 在 schema.ts 里，但快照没有`);
      }

      // 唯一约束：表级 unique() 在 uniqueConstraints 里，列级 .unique() 只在列上，要补回来。
      const schemaUnique = new Map<string, string[]>();
      for (const constraint of cfg.uniqueConstraints) {
        const columns = constraint.columns.map((column) => column.name);
        schemaUnique.set(pgName(constraint.getName() ?? uniqueKeyName(table, columns)), columns);
      }
      for (const column of cfg.columns) {
        if (!column.isUnique) continue;
        const constraintName = pgName(column.uniqueName ?? uniqueKeyName(table, [column.name]));
        if (!schemaUnique.has(constraintName)) schemaUnique.set(constraintName, [column.name]);
      }
      const snapshotUnique = new Map(
        Object.values(snapshotTableEntry.uniqueConstraints).map(
          (constraint) => [pgName(constraint.name), constraint.columns] as const,
        ),
      );
      for (const [constraintName, columns] of snapshotUnique) {
        const actual = schemaUnique.get(constraintName);
        if (!actual) {
          problems.push(`唯一约束 ${name}.${constraintName} 在快照里，但 schema.ts 没有`);
        } else if (actual.join(",") !== columns.join(",")) {
          problems.push(`唯一约束 ${name}.${constraintName} 列：[${actual.join(",")}] vs 快照 [${columns.join(",")}]`);
        }
      }
      for (const constraintName of schemaUnique.keys()) {
        if (!snapshotUnique.has(constraintName)) {
          problems.push(`唯一约束 ${name}.${constraintName} 在 schema.ts 里，但快照没有`);
        }
      }

      const schemaPrimary = new Map(
        cfg.primaryKeys.map(
          (primaryKey) => [pgName(primaryKey.getName()), primaryKey.columns.map((column) => column.name)] as const,
        ),
      );
      const snapshotPrimary = new Map(
        Object.values(snapshotTableEntry.compositePrimaryKeys).map(
          (primaryKey) => [pgName(primaryKey.name), primaryKey.columns] as const,
        ),
      );
      for (const [primaryName, columns] of snapshotPrimary) {
        const actual = schemaPrimary.get(primaryName);
        if (!actual) {
          problems.push(`复合主键 ${name}.${primaryName} 在快照里，但 schema.ts 没有`);
        } else if (actual.join(",") !== columns.join(",")) {
          problems.push(`复合主键 ${name}.${primaryName} 列：[${actual.join(",")}] vs 快照 [${columns.join(",")}]`);
        }
      }
      for (const primaryName of schemaPrimary.keys()) {
        if (!snapshotPrimary.has(primaryName)) problems.push(`复合主键 ${name}.${primaryName} 在 schema.ts 里，但快照没有`);
      }
    }

    expect(indexes, "应至少检查到一份快照里的全部索引").toBeGreaterThan(0);
    expect(problems, "索引 / 唯一约束 / 复合主键以 packages/db/src/schema.ts 为准").toEqual([]);
  });

  it("外键的目标表 / 两端列 / 级联动作与最新快照一致", () => {
    const problems: string[] = [];
    let foreignKeys = 0;

    for (const [name, table] of schemaTables()) {
      const snapshotTableEntry = snapshotTable(name);
      if (!snapshotTableEntry) continue;
      const cfg = getTableConfig(table);

      const schemaForeignKeys = new Map(
        cfg.foreignKeys.map((foreignKey) => [pgName(foreignKey.getName()), foreignKey] as const),
      );
      if (schemaForeignKeys.size !== cfg.foreignKeys.length) problems.push(`外键名截断后碰撞：${name}`);

      const snapshotForeignKeys = new Map(
        Object.values(snapshotTableEntry.foreignKeys).map(
          (foreignKey) => [pgName(foreignKey.name), foreignKey] as const,
        ),
      );
      for (const [foreignKeyName, snapshotForeignKey] of snapshotForeignKeys) {
        foreignKeys++;
        const foreignKey = schemaForeignKeys.get(foreignKeyName);
        if (!foreignKey) {
          problems.push(`外键 ${name}.${foreignKeyName} 在快照里，但 schema.ts 没有`);
          continue;
        }
        const reference = foreignKey.reference();
        const targetTable = getTableConfig(reference.foreignTable).name;
        if (targetTable !== snapshotForeignKey.tableTo) {
          problems.push(`外键 ${name}.${foreignKeyName} 目标表：schema=${targetTable} 快照=${snapshotForeignKey.tableTo}`);
        }
        const from = reference.columns.map((column) => column.name).join(",");
        const to = reference.foreignColumns.map((column) => column.name).join(",");
        if (from !== snapshotForeignKey.columnsFrom.join(",")) {
          problems.push(`外键 ${name}.${foreignKeyName} 本端列：[${from}] vs 快照 [${snapshotForeignKey.columnsFrom.join(",")}]`);
        }
        if (to !== snapshotForeignKey.columnsTo.join(",")) {
          problems.push(`外键 ${name}.${foreignKeyName} 远端列：[${to}] vs 快照 [${snapshotForeignKey.columnsTo.join(",")}]`);
        }
        if ((foreignKey.onDelete ?? "no action") !== snapshotForeignKey.onDelete) {
          problems.push(`外键 ${name}.${foreignKeyName} onDelete：schema=${foreignKey.onDelete} 快照=${snapshotForeignKey.onDelete}`);
        }
        if ((foreignKey.onUpdate ?? "no action") !== snapshotForeignKey.onUpdate) {
          problems.push(`外键 ${name}.${foreignKeyName} onUpdate：schema=${foreignKey.onUpdate} 快照=${snapshotForeignKey.onUpdate}`);
        }
      }
      for (const foreignKeyName of schemaForeignKeys.keys()) {
        if (!snapshotForeignKeys.has(foreignKeyName)) {
          problems.push(`外键 ${name}.${foreignKeyName} 在 schema.ts 里，但快照没有`);
        }
      }
    }

    expect(foreignKeys, "应至少检查到一份快照里的全部外键").toBeGreaterThan(0);
    expect(problems, "外键以 packages/db/src/schema.ts 为准").toEqual([]);
  });

  it("CHECK 约束的名字与最新快照一致", () => {
    const problems: string[] = [];

    for (const [name, table] of schemaTables()) {
      const snapshotTableEntry = snapshotTable(name);
      if (!snapshotTableEntry) continue;
      const cfg = getTableConfig(table);

      const schemaChecks = new Set(cfg.checks.map((check) => pgName(check.name)));
      const snapshotChecks = new Set(Object.values(snapshotTableEntry.checkConstraints).map((check) => pgName(check.name)));
      for (const checkName of snapshotChecks) {
        if (!schemaChecks.has(checkName)) problems.push(`CHECK ${name}.${checkName} 在快照里，但 schema.ts 没有`);
      }
      for (const checkName of schemaChecks) {
        if (!snapshotChecks.has(checkName)) problems.push(`CHECK ${name}.${checkName} 在 schema.ts 里，但快照没有`);
      }
    }

    expect(problems, "CHECK 只比名字，表达式文本不在本用例范围").toEqual([]);
  });
});