import type { CliOutput } from "./envelope";
import { redact } from "./redact";

/**
 * 人类可读渲染 —— **只写 stderr**。
 *
 * 依据 `SKILL.md:43`「stdout 只消费业务数据，进度从 stderr 读取」。所以：
 * - stdout 永远是 envelope JSON（`--json` 单行、默认缩进两格，两者都可 parse）；
 * - 表格/摘要/进度都走 stderr，`--json` 时静默。
 */
const MAX_CELL = 40;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 1)}…` : text;
}

/** 极简等宽表格（真终端里对齐；管道里也不破坏语义） */
export function renderTable(rows: readonly Record<string, unknown>[], maxColumns = 8): string {
  if (rows.length === 0) return "（空列表）\n";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, maxColumns);
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((row) => cell(row[col]).length)),
  );
  const header = columns.map((col, i) => col.toUpperCase().padEnd(widths[i])).join("  ");
  const body = rows.map((row) =>
    columns.map((col, i) => cell(row[col]).padEnd(widths[i])).join("  "),
  );
  return `${[header, ...body].join("\n")}\n`;
}

function renderObject(record: Record<string, unknown>, indent = ""): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}: ${value.length} 条`);
    } else if (value !== null && typeof value === "object") {
      lines.push(`${indent}${key}:`);
      lines.push(renderObject(value as Record<string, unknown>, `${indent}  `));
    } else {
      lines.push(`${indent}${key}: ${cell(value)}`);
    }
  }
  return lines.join("\n");
}

export function renderHuman(output: CliOutput): string {
  if (!output.ok) {
    const raw = output.error.raw === undefined ? "" : `\n  raw: ${JSON.stringify(redact(output.error.raw))}`;
    const retry = output.error.retryable === undefined ? "" : `\n  retryable: ${output.error.retryable}`;
    return `✗ [${output.error.kind}] ${output.error.message}${retry}${raw}\n`;
  }
  const data = output.data;
  if (Array.isArray(data)) return renderTable(data as Record<string, unknown>[]);
  if (data !== null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.list)) return renderTable(record.list as Record<string, unknown>[]);
    if (Array.isArray(record.entries)) return renderTable(record.entries as Record<string, unknown>[]);
    return `${renderObject(record)}\n`;
  }
  return `${String(data)}\n`;
}
