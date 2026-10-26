import JSZip from "jszip";
import { AppError, ErrorCode } from "@app/shared";

/**
 * 画布「表格节点」的 xlsx 读取器。
 *
 * 为什么不复用剧本域的 `parseScriptFile`：那个函数的产物是**扁平的制表符文本**
 * （它服务"把整本小说读成一段文本"），而表格节点要的是**按工作表、按行列的结构**
 * 以及"先列 Sheet、再显式选哪一个"的两步式交互（参照站实测：不自动选第一个）。
 * 两者的输出契约根本不同，硬合并会让其中一方变形。
 *
 * 只解析字节，不落盘、不执行；解压后按白名单路径读取，单条目与总量都有上限
 * （zip 炸弹防护与剧本域一致）。
 */

/** 单个 XML 解压上限（与剧本域同口径） */
const MAX_ENTRY_CHARS = 20 * 1024 * 1024;

/**
 * 容量上限：表格节点是"排期/台词/分镜清单"，不是数据仓库。
 * 不设上限时，一个 20 万行的 xlsx 会把 JSONB 参数撑到几十 MB，
 * 之后每次整图 commit 都要搬这部分数据——那是拿画布主路径给导入擦屁股。
 */
export const TABLE_LIMITS = {
  max_sheets: 20,
  max_rows_per_sheet: 2000,
  max_cols: 60,
  max_cell_chars: 500,
  /** 全工作簿合计单元格上限（跨表共享预算） */
  max_total_cells: 60_000,
} as const;

export interface SheetData {
  /** 稳定 id：优先用 workbook.xml 的 sheetId，退化到序号；confirm-sheet 按它回查 */
  sheet_id: string;
  name: string;
  rows: string[][];
  row_count: number;
  col_count: number;
  /** 是否因上限被裁剪（前端要如实提示，不能让用户以为导全了） */
  truncated: boolean;
}

export interface ParsedWorkbook {
  sheets: SheetData[];
  warnings: string[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** "AB12" → 27（0 基列号） */
function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? "A").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

async function readEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new AppError(ErrorCode.INVALID_PARAM, `文件结构缺少 ${path}`);
  const text = await entry.async("string");
  if (text.length > MAX_ENTRY_CHARS) {
    throw new AppError(ErrorCode.INVALID_PARAM, "文件内容过大，无法解析");
  }
  return text;
}

/** sharedStrings：<si> 里可能有多段 <t>（富文本），全部拼接 */
async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const out: string[] = [];
  if (!zip.file("xl/sharedStrings.xml")) return out;
  const xml = await readEntry(zip, "xl/sharedStrings.xml");
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const texts = [...(m[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) =>
      decodeEntities(x[1] ?? ""),
    );
    out.push(texts.join(""));
  }
  return out;
}

interface SheetRef {
  sheet_id: string;
  name: string;
  /** zip 内路径 */
  path: string;
}

/**
 * 工作表清单：优先按 workbook.xml 的声明顺序与名字，
 * 并用 rels 把 r:id 映射到真实路径（Excel 存出来的路径不保证是 sheetN.xml）。
 * 两者缺失时（手工构造的最小 xlsx）退化到按文件名序号排。
 */
async function listSheets(zip: JSZip): Promise<SheetRef[]> {
  const sheetFiles = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/[^/]+\.xml$/.test(path))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  const fallback = (): SheetRef[] =>
    sheetFiles.map((path, index) => ({
      sheet_id: String(index + 1),
      name: `Sheet${index + 1}`,
      path,
    }));

  if (!zip.file("xl/workbook.xml")) return fallback();

  const rels = new Map<string, string>();
  if (zip.file("xl/_rels/workbook.xml.rels")) {
    const relXml = await readEntry(zip, "xl/_rels/workbook.xml.rels");
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(relXml)) !== null) {
      const attrs = m[1] ?? "";
      const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
      if (id && target) rels.set(id, target);
    }
  }

  const workbookXml = await readEntry(zip, "xl/workbook.xml");
  const sheets: SheetRef[] = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = sheetRe.exec(workbookXml)) !== null) {
    const attrs = match[1] ?? "";
    const name = decodeEntities(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? "");
    const sheetId = /\bsheetId="([^"]+)"/.exec(attrs)?.[1] ?? String(sheets.length + 1);
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = rid ? rels.get(rid) : undefined;
    if (!target) continue;
    const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (!zip.file(normalized)) continue;
    sheets.push({ sheet_id: sheetId, name: name || `Sheet${sheets.length + 1}`, path: normalized });
  }
  // workbook.xml 存在但没解出可用条目（结构异常）→ 退回按文件排，至少不整单失败
  return sheets.length > 0 ? sheets : fallback();
}

/** 单个工作表 → 二维字符串数组（保留单元格缺失造成的空列） */
function parseSheet(xml: string, shared: string[], budget: { cells: number }): {
  rows: string[][];
  truncated: boolean;
} {
  const rows: string[][] = [];
  let truncated = false;
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    if (rows.length >= TABLE_LIMITS.max_rows_per_sheet) {
      truncated = true;
      break;
    }
    const rowXml = rowMatch[1] ?? "";
    const cells = new Map<number, string>();
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? "";
      const col = ref ? columnIndex(ref) : cells.size;
      if (col >= TABLE_LIMITS.max_cols) {
        truncated = true;
        continue;
      }
      if (budget.cells <= 0) {
        truncated = true;
        break;
      }
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((m) => decodeEntities(m[1] ?? ""))
          .join("");
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") {
          const index = Number(raw);
          value = Number.isInteger(index) ? (shared[index] ?? "") : "";
        } else {
          // t="d"（ISO 日期）与普通数值都原样保留：
          // 做日期反序列化需要 numFmt 表，那是"渲染表格"的职责，不该塞进导入器
          value = decodeEntities(raw);
        }
      }
      if (value.length > TABLE_LIMITS.max_cell_chars) {
        value = value.slice(0, TABLE_LIMITS.max_cell_chars);
        truncated = true;
      }
      if (value !== "") {
        cells.set(col, value);
        budget.cells -= 1;
      }
    }
    if (cells.size === 0) continue;
    const width = Math.min(Math.max(...cells.keys()) + 1, TABLE_LIMITS.max_cols);
    const row: string[] = [];
    for (let i = 0; i < width; i += 1) row.push(cells.get(i) ?? "");
    rows.push(row);
  }
  return { rows, truncated };
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const zip = await JSZip.loadAsync(buffer).catch(() => {
    throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 解析失败（文件损坏或不是有效 xlsx）");
  });
  const warnings: string[] = [];
  const listed = await listSheets(zip);
  if (listed.length === 0) throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 中没有工作表");
  if (listed.length > TABLE_LIMITS.max_sheets) {
    warnings.push(`文件含 ${listed.length} 个工作表，仅读取前 ${TABLE_LIMITS.max_sheets} 个`);
  }

  const shared = await readSharedStrings(zip);
  const budget = { cells: TABLE_LIMITS.max_total_cells };
  const sheets: SheetData[] = [];
  for (const ref of listed.slice(0, TABLE_LIMITS.max_sheets)) {
    const xml = await readEntry(zip, ref.path);
    const { rows, truncated } = parseSheet(xml, shared, budget);
    if (rows.length === 0) continue; // 空表不列出来，否则用户点了会拿到空节点
    const colCount = Math.max(...rows.map((row) => row.length));
    if (truncated) warnings.push(`工作表「${ref.name}」超出上限，已裁剪`);
    sheets.push({
      sheet_id: ref.sheet_id,
      name: ref.name,
      rows,
      row_count: rows.length,
      col_count: colCount,
      truncated,
    });
    if (budget.cells <= 0) {
      warnings.push("工作簿单元格总量超限，后续工作表已跳过");
      break;
    }
  }
  if (sheets.length === 0) throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 中没有可用的表格内容");
  return { sheets, warnings };
}
