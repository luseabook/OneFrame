import { AppError, ErrorCode, LIMITS } from "@app/shared";
import JSZip from "jszip";

/**
 * 剧本文件解析（新建项目「上传剧本」）：
 * 支持 txt / md / csv（纯文本）、docx（OOXML）、xlsx（OOXML）；
 * 旧版 .doc 为二进制格式，明确拒绝并提示另存为 .docx。
 *
 * 安全约束：
 * - 只解析字节，不落盘、不执行；
 * - 解压后只读取白名单内 XML 路径（防 zip 炸弹：由调用方限制原始字节大小，且仅按名读取）；
 * - 输出纯文本，交由上游做敏感词审核后再入库。
 */

export interface ParsedScript {
  text: string;
  format: "txt" | "md" | "csv" | "docx" | "xlsx";
  warnings: string[];
}

const MAX_ENTRY_BYTES = 20 * 1024 * 1024; // 单个 XML 解压上限

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/** docx：word/document.xml → 按段落取 <w:t> 文本 */
function docxXmlToText(xml: string): string {
  const paragraphs = xml.split(/<w:p[ >]/).slice(1);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const texts: string[] = [];
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(para)) !== null) {
      texts.push(decodeEntities(m[1] ?? ""));
    }
    const line = texts.join("");
    lines.push(line);
  }
  return lines.join("\n");
}

/** xlsx：sharedStrings + worksheet 单元格 → 行（制表符分隔） */
function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/)?.[0] ?? "A").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function xlsxSheetToRows(xml: string, shared: string[]): string[] {
  const rows: string[] = [];
  const rowRe = /<row[\s\S]*?<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowXml = rowMatch[0];
    const cells = new Map<number, string>();
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? "A";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        const texts = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? ""));
        value = texts.join("");
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") {
          const idx = Number(raw);
          value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
        } else {
          value = decodeEntities(raw);
        }
      }
      if (value !== "") cells.set(columnIndex(ref), value);
    }
    if (cells.size === 0) continue;
    const max = Math.max(...cells.keys());
    const cols: string[] = [];
    for (let i = 0; i <= max; i += 1) cols.push(cells.get(i) ?? "");
    const line = cols.join("\t").replace(/\t+$/, "");
    if (line.trim() !== "") rows.push(line);
  }
  return rows;
}

async function readEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new AppError(ErrorCode.INVALID_PARAM, `文件结构缺少 ${path}`);
  const text = await entry.async("string");
  if (text.length > MAX_ENTRY_BYTES) {
    throw new AppError(ErrorCode.INVALID_PARAM, "文件内容过大，无法解析");
  }
  return text;
}

export async function parseScriptFile(fileName: string, buffer: Buffer): Promise<ParsedScript> {
  const ext = extensionOf(fileName);

  if (ext === "txt" || ext === "md" || ext === "csv") {
    const text = normalize(new TextDecoder("utf-8", { fatal: false }).decode(buffer));
    if (!text) throw new AppError(ErrorCode.INVALID_PARAM, "文件内容为空");
    return { text, format: ext, warnings: [] };
  }

  if (ext === "docx") {
    const zip = await JSZip.loadAsync(buffer).catch(() => {
      throw new AppError(ErrorCode.INVALID_PARAM, "docx 解析失败（文件损坏或不是有效 docx）");
    });
    const xml = await readEntry(zip, "word/document.xml");
    const text = normalize(docxXmlToText(xml));
    if (!text) throw new AppError(ErrorCode.INVALID_PARAM, "docx 中没有可提取的文本");
    return { text, format: "docx", warnings: [] };
  }

  if (ext === "xlsx") {
    const zip = await JSZip.loadAsync(buffer).catch(() => {
      throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 解析失败（文件损坏或不是有效 xlsx）");
    });
    const warnings: string[] = [];

    const shared: string[] = [];
    const sharedEntry = zip.file("xl/sharedStrings.xml");
    if (sharedEntry) {
      const sharedXml = await readEntry(zip, "xl/sharedStrings.xml");
      const siRe = /<si>([\s\S]*?)<\/si>/g;
      let m: RegExpExecArray | null;
      while ((m = siRe.exec(sharedXml)) !== null) {
        const texts = [...(m[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) =>
          decodeEntities(x[1] ?? ""),
        );
        shared.push(texts.join(""));
      }
    }

    const sheets = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
        const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
        return na - nb;
      });
    if (sheets.length === 0) throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 中没有工作表");
    if (sheets.length > 1) warnings.push(`文件含 ${sheets.length} 个工作表，已按顺序合并解析`);

    const blocks: string[] = [];
    for (const [i, path] of sheets.entries()) {
      const sheetXml = await readEntry(zip, path);
      const rows = xlsxSheetToRows(sheetXml, shared);
      if (rows.length === 0) continue;
      if (sheets.length > 1) blocks.push(`【工作表 ${i + 1}】`);
      blocks.push(rows.join("\n"));
    }
    const text = normalize(blocks.join("\n"));
    if (!text) throw new AppError(ErrorCode.INVALID_PARAM, "xlsx 中没有可提取的文本");
    return { text, format: "xlsx", warnings };
  }

  if (ext === "doc") {
    throw new AppError(
      ErrorCode.INVALID_PARAM,
      "旧版 .doc 暂不支持解析，请另存为 .docx，或直接粘贴剧本文本",
    );
  }
  throw new AppError(ErrorCode.INVALID_PARAM, `不支持的文件格式：.${ext || "unknown"}`);
}

/** base64 → Buffer，并限制解码后大小（默认 8MB） */
export function decodeBase64Upload(fileBase64: string, maxBytes = 8 * 1024 * 1024): Buffer {
  const raw = fileBase64.includes(",") ? fileBase64.slice(fileBase64.indexOf(",") + 1) : fileBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, "文件内容不是有效的 base64");
  }
  if (buffer.length === 0) throw new AppError(ErrorCode.INVALID_PARAM, "文件内容为空");
  if (buffer.length > maxBytes) {
    throw new AppError(ErrorCode.INVALID_PARAM, `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
  }
  return buffer;
}

/** 解析结果统一裁剪到小说上限（与 createProjectSchema 的 source_text 限制一致） */
export function clampToNovelLimit(text: string): { text: string; truncated: boolean } {
  if (text.length <= LIMITS.NOVEL_MAX) return { text, truncated: false };
  return { text: text.slice(0, LIMITS.NOVEL_MAX), truncated: true };
}
