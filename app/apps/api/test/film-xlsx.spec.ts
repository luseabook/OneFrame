import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnLetter, sanitizeSheetName } from "../src/modules/film/xlsx-writer";

/**
 * XLSX 写入器单测（模块 #8 收尾）。
 *
 * 为什么单测要真的**解压并读 XML**：xlsx 是 zip 包，最容易出的错不是"函数返回了 Buffer"，
 * 而是包内缺 `[Content_Types].xml`/关系文件、或 XML 非法——Excel 打开时才会报"文件损坏"。
 * 所以这里用 `jszip` 解回来逐项断言结构，而不是只断言 `PK` 头。
 *
 * 集成侧（真实 HTTP 导出）由 `_acceptance` 脚本覆盖，避免把 API/DB 依赖塞进这个纯函数测试。
 */

describe("xlsx-writer", () => {
  it("返回合法的 zip（PK\\x03\\x04 头）且含 6 个必需部件", async () => {
    const buffer = await buildXlsx([{ name: "表1", rows: [["列A", "列B"], [1, 2]] }]);
    expect(buffer.subarray(0, 4).toString("hex")).toBe("504b0304");

    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("_rels/.rels");
    expect(names).toContain("xl/workbook.xml");
    expect(names).toContain("xl/_rels/workbook.xml.rels");
    expect(names).toContain("xl/styles.xml");
    expect(names).toContain("xl/worksheets/sheet1.xml");
  });

  it("多 sheet：workbook 列出全部表名，每个表一个 worksheet 部件", async () => {
    const buffer = await buildXlsx([
      { name: "分镜表", rows: [["镜头", "时长"], [1, 3]] },
      { name: "资产表", rows: [["名称"], ["角色A"]] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain('name="分镜表"');
    expect(workbook).toContain('name="资产表"');
    expect(Object.keys(zip.files)).toContain("xl/worksheets/sheet2.xml");
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    expect(rels).toContain("worksheets/sheet2.xml");
  });

  it("单元格：文本走 inlineStr、数字走 <v>、布尔走 t=b", async () => {
    const buffer = await buildXlsx([
      { name: "S", rows: [["标题"], ["纯文本"], [42], [true], [""], [null]] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    // 表头（第 1 行）加粗样式 s="1"
    expect(sheet).toMatch(/<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">标题<\/t>/);
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">纯文本</t></is></c>');
    expect(sheet).toContain('<c r="A3"><v>42</v></c>');
    expect(sheet).toContain('<c r="A4" t="b"><v>1</v></c>');
    // 空字符串/null 不产出单元格（但行本身保留，避免行号跳号）
    expect(sheet).toContain('<row r="5"></row>');
    expect(sheet).toContain('<row r="6"></row>');
  });

  it("公式注入防护：= + - @ 开头的文本前置单引号（与 CSV 侧同口径）", async () => {
    const buffer = await buildXlsx([
      { name: "S", rows: [["值"], ["=1+1"], ["+86"], ["-5"], ["@user"]] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("&apos;=1+1");
    expect(sheet).toContain("&apos;+86");
    expect(sheet).toContain("&apos;-5");
    expect(sheet).toContain("&apos;@user");
  });

  it("XML 转义与非法控制字符剥离（否则 Excel 报文件损坏）", async () => {
    const buffer = await buildXlsx([
      { name: "S", rows: [["a<b>&\"c"], ["含\u0000控制\u001F字符"]] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("a&lt;b&gt;&amp;&quot;c");
    expect(sheet).not.toContain("\u0000");
    expect(sheet).toContain("含控制字符");
  });

  it("表名清洗：非法字符替换、超长截断、重名加后缀", () => {
    expect(sanitizeSheetName("a/b:c*d?e[f]g\\h", 0)).toBe("a_b_c_d_e_f_g_h");
    expect(sanitizeSheetName("x".repeat(40), 0)).toHaveLength(31);
    expect(sanitizeSheetName("   ", 2)).toBe("Sheet3");
  });

  it("重名表会自动加 (2) 且仍满足 31 字符限制", async () => {
    const buffer = await buildXlsx([
      { name: "同名", rows: [["a"]] },
      { name: "同名", rows: [["b"]] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    expect(workbook).toContain('name="同名"');
    expect(workbook).toContain('name="同名(2)"');
  });

  it("列号：0→A、25→Z、26→AA、51→AZ、52→BA", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
  });

  it("空表列表直接拒绝（不返回空 zip 让调用方写出坏文件）", async () => {
    await expect(buildXlsx([])).rejects.toThrow(/at least one sheet/);
  });
});
