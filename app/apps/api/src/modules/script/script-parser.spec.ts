import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { AppError, ErrorCode } from "@app/shared";
import { clampToNovelLimit, decodeBase64Upload, parseScriptFile } from "./script-parser";

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
  zip.file("word/document.xml", xml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  const shared: string[] = [];
  const indexOf = (value: string): number => {
    const idx = shared.indexOf(value);
    if (idx >= 0) return idx;
    shared.push(value);
    return shared.length - 1;
  };
  const sheetRows = rows
    .map((cells, r) => {
      const cols = cells
        .map((value, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          return `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cols}</row>`;
    })
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("script-parser", () => {
  it("parses txt/md/csv as UTF-8 text and normalizes line endings", async () => {
    const parsed = await parseScriptFile("剧本.txt", Buffer.from("\uFEFF第一集\r\n\r\n\r\n第二集", "utf8"));
    expect(parsed.format).toBe("txt");
    expect(parsed.text).toBe("第一集\n\n第二集");

    const md = await parseScriptFile("outline.md", Buffer.from("# 标题\n正文", "utf8"));
    expect(md.format).toBe("md");
    expect(md.text).toContain("# 标题");
  });

  it("extracts paragraphs from docx", async () => {
    const buffer = await makeDocx(["第一场 雨夜", "林晚：你来了。", "顾沉：我一直在。"]);
    const parsed = await parseScriptFile("script.docx", buffer);
    expect(parsed.format).toBe("docx");
    expect(parsed.text).toBe("第一场 雨夜\n林晚：你来了。\n顾沉：我一直在。");
  });

  it("extracts rows from xlsx including shared strings", async () => {
    const buffer = await makeXlsx([
      ["镜号", "画面", "台词"],
      ["1", "雨夜街道", "林晚：你来了。"],
      ["2", "老宅门口", "顾沉：小心。"],
    ]);
    const parsed = await parseScriptFile("分镜单.xlsx", buffer);
    expect(parsed.format).toBe("xlsx");
    expect(parsed.text).toContain("镜号\t画面\t台词");
    expect(parsed.text).toContain("雨夜街道");
    expect(parsed.warnings).toEqual([]);
  });

  it("rejects legacy .doc and unsupported extensions with actionable errors", async () => {
    await expect(parseScriptFile("old.doc", Buffer.from("x"))).rejects.toMatchObject({
      code: ErrorCode.INVALID_PARAM,
    });
    await expect(parseScriptFile("a.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(AppError);
    await expect(parseScriptFile("a.docx", Buffer.from("not a zip"))).rejects.toMatchObject({
      code: ErrorCode.INVALID_PARAM,
    });
  });

  it("decodes base64 uploads (with or without data-url prefix) and enforces limits", () => {
    const plain = Buffer.from("hello").toString("base64");
    expect(decodeBase64Upload(plain).toString("utf8")).toBe("hello");
    expect(decodeBase64Upload(`data:text/plain;base64,${plain}`).toString("utf8")).toBe("hello");
    expect(() => decodeBase64Upload(plain, 2)).toThrow(/限制/);
    expect(() => decodeBase64Upload("")).toThrow(/为空|base64/);
  });

  it("clamps parsed text to the novel limit", () => {
    const long = "字".repeat(50001);
    const clamped = clampToNovelLimit(long);
    expect(clamped.truncated).toBe(true);
    expect(clamped.text.length).toBe(50000);
    expect(clampToNovelLimit("短文本")).toEqual({ text: "短文本", truncated: false });
  });
});
