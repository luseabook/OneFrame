import JSZip from "jszip";

/**
 * 最小可用 **XLSX（OOXML）写入器** —— 不引第三方库，用已有的 `jszip` 拼 SpreadsheetML。
 *
 * 为什么自己写而不是引 `exceljs`/`sheetjs`：
 * 1. Lead 明确要求**本轮不引新依赖**（供应链与体积考量）；
 * 2. 我们只需要"多 sheet + 文本/数字/布尔单元格"这三件事，`exceljs` 的样式/公式/图表能力用不上；
 * 3. 这份实现只有 ~120 行，行为可被单测逐条钉住（见 `test/film-xlsx.spec.ts`）。
 *
 * 覆盖范围与已知限制（写出来而不是假装完整）：
 * - 支持：多 worksheet、inlineStr 文本、数字、布尔、空单元格、列宽不做（Excel 自适应）；
 * - **不支持**：公式、合并单元格、图片、共享字符串表（为了少一张表与一层转义）、样式（除表头加粗）；
 * - 文本一律走 `inlineStr`：省掉 `sharedStrings.xml`，代价是重复字符串不共享（文件略大，
 *   但对"每次导出几百行"的量级无感）。
 *
 * 安全：Excel 会把以 `= + - @` 开头的文本当公式执行（CSV 注入同源风险）。
 * 这里的处置与 CSV 侧一致——**写进单元格时前置单引号**，Excel 打开会显示原文而不是执行。
 */

/** 工作表入参：名称 + 二维数据（第一行视为表头，导出时加粗） */
export interface XlsxSheet {
  name: string;
  rows: unknown[][];
}

/** Excel 单表名限制 31 字符，且不能含 `[ ] : * ? / \`；非法字符一律替换为 `_` */
export function sanitizeSheetName(raw: string, index: number): string {
  const cleaned = String(raw ?? "")
    .replace(/[[\]:*?/\\]/g, "_")
    .trim()
    .slice(0, 31);
  return cleaned.length > 0 ? cleaned : `Sheet${index + 1}`;
}

/** 0 → A, 25 → Z, 26 → AA …（Excel 列号是 26 进制、无 0 位） */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 不允许的控制字符：Excel 打开会报"文件损坏"，必须剥掉
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** 公式注入防护：与 CSV 侧 `csvEscape` 同口径 */
function guardFormula(text: string): string {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function cellXml(ref: string, value: unknown, isHeader: boolean): string {
  const style = isHeader ? ' s="1"' : "";
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  let text: string;
  if (Array.isArray(value)) text = value.map((v) => String(v)).join(", ");
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (text === "") return "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(guardFormula(text))}</t></is></c>`;
}

function sheetXml(rows: unknown[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => cellXml(`${columnLetter(colIndex)}${rowIndex + 1}`, value, rowIndex === 0))
        .join("");
      // 空行也必须占位：否则 Excel 里行号会跳（用户按行号对账会错位）
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from(
  { length: sheetCount },
  (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
).join("\n")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = (names: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names
  .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
  .join("")}</sheets></workbook>`;

const WORKBOOK_RELS = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${Array.from(
  { length: sheetCount },
  (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
).join("\n")}
<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** 仅一种加粗字体（表头）——多一层样式就多一处可能被 Excel 判"文件损坏"的兼容点 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

/**
 * 生成 xlsx。返回 Buffer（以 `PK\x03\x04` 开头），可直接 put 到对象存储。
 * `sheetNames` 会做 Excel 合法性清洗（超长/非法字符/重名），重名追加 `(2)`、`(3)`。
 */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  if (sheets.length === 0) throw new Error("buildXlsx: at least one sheet is required");
  const used = new Set<string>();
  const names = sheets.map((sheet, index) => {
    const base = sanitizeSheetName(sheet.name, index);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      const suffix = `(${n})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      n += 1;
    }
    used.add(name);
    return name;
  });

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES(sheets.length));
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("xl/workbook.xml", WORKBOOK_XML(names));
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS(sheets.length));
  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows));
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) as Promise<Buffer>;
}
