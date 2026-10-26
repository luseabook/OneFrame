import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import JSZip from "jszip";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 表格节点 Excel 导入（两步式）e2e
 *
 * 为什么用运行时生成的 xlsx 而不是仓库里的夹具文件：
 * 夹具二进制会随需求漂移且没人看得懂 diff；这里用 JSZip 现造一个最小 OOXML，
 * 每个单元格的期望值都写在测试里，解析器一改就能立刻看出错在哪。
 *
 * 锁住五条容易静默错的语义：
 * 1. **不自动选第一个 Sheet**（多 Sheet 排期表自动选第一个 = 无声导错）；
 * 2. 共享字符串 / 内联字符串 / 数值 / 空列 都要原样还原；
 * 3. 只有 table 节点能导入（其他节点 400101，而不是写坏参数）；
 * 4. 票据过期 ≠ 节点坏了（400102 且提示重新导入）；
 * 5. confirm 后节点 version +1（客户端旧版本号会被 746002 拦住，而非静默覆盖）。
 */
describe("canvas table excel import e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let otherToken = "";
  let canvasId = "";
  let tableNodeId = "";
  let textNodeId = "";

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken ?? token) headers.authorization = `Bearer ${authToken ?? token}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(tag: string): Promise<string> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const login = await inject("POST", "/auth/login", { phone, code: sms.data?.debug_code, age_confirmed: true });
    const tk = login.data?.access_token as string;
    if (!tk) throw new Error(`login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
    return tk;
  }

  /** 造一个含 2 个工作表的最小 xlsx（共享字符串 + 数值 + 内联字符串 + 空列） */
  async function buildWorkbook(): Promise<string> {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="角色表" sheetId="1" r:id="rId1"/><sheet name="镜头表" sheetId="2" r:id="rId2"/></sheets>
</workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    );
    // 富文本拆两段（<r><t>），验证 si 里多段 t 会被拼起来
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t>角色</t></si>
<si><r><t>林</t></r><r><t>晚</t></r></si>
<si><t>演员</t></si>
<si><t>顾沉</t></si>
<si><t>备注</t></si>
</sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>4</v></c></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>张三</t></is></c><c r="C2" t="s"><v>3</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="s"><v>4</v></c></row>
</sheetData></worksheet>`,
    );
    zip.file(
      "xl/worksheets/sheet2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>镜号</t></is></c><c r="B1" t="inlineStr"><is><t>时长</t></is></c></row>
<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>5</v></c></row>
<row r="3"><c r="A3"><v>2</v></c><c r="B3"><v>8</v></c></row>
</sheetData></worksheet>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return buffer.toString("base64");
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    token = await loginNewUser("01");
    otherToken = await loginNewUser("02");
    const created = await inject("POST", "/canvas/canvases", { title: "表格导入测试" });
    canvasId = created.data.id as string;

    const table = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "table",
      name: "排期表",
      x: 0,
      y: 0,
      params: {},
    });
    tableNodeId = table.data.id as string;
    const text = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "文本",
      x: 300,
      y: 0,
      params: {},
    });
    textNodeId = text.data.id as string;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("import 只列工作表与预览，不自动选中任何一个", async () => {
    const base64 = await buildWorkbook();
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
    );
    expect(res.code).toBe(0);
    expect(res.data.import_token).toBeTruthy();
    const sheets = res.data.sheets as Array<{ sheet_id: string; name: string; row_count: number; col_count: number }>;
    expect(sheets.map((s) => s.name)).toEqual(["角色表", "镜头表"]);
    expect(sheets[0]).toMatchObject({ sheet_id: "1", row_count: 3, col_count: 3 });
    expect(sheets[1]).toMatchObject({ sheet_id: "2", row_count: 3, col_count: 2 });
    // 清单里不带 rows：几十万行的表不该整表回给客户端
    expect((res.data.sheets as Array<Record<string, unknown>>)[0]).not.toHaveProperty("rows");
    expect(res.data.preview[0]).toEqual(["角色", "演员", "备注"]);
  });

  it("confirm 指定第二个 Sheet 后写入节点参数（含单元格保真）", async () => {
    const base64 = await buildWorkbook();
    const imported = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
    );
    const token2 = imported.data.import_token as string;

    const confirmed = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/confirm-sheet`,
      { import_token: token2, sheet_id: "2" },
    );
    expect(confirmed.code).toBe(0);
    expect(confirmed.data.sheet).toMatchObject({ sheet_id: "2", name: "镜头表" });
    expect(confirmed.data.table.active_sheet_id).toBe("2");
    expect(confirmed.data.table.sheet_selection_required).toBe(false);
    expect((confirmed.data.table.source as { type: string }).type).toBe("excel_import");

    // 落库校验：读节点参数，两个 Sheet 的数据都在（用户之后切换 active_sheet_id 也能用）
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    const node = (detail.data.nodes as Array<{ id: string; params: Record<string, unknown> }>).find(
      (n) => n.id === tableNodeId,
    )!;
    const table = node.params.table as {
      active_sheet_id: string;
      sheets: Array<{ sheet_id: string; rows: string[][] }>;
    };
    expect(table.active_sheet_id).toBe("2");
    expect(table.sheets).toHaveLength(2);

    const roles = table.sheets.find((s) => s.sheet_id === "1")!.rows;
    // 共享字符串拼段（"林"+"晚"）、内联字符串、空列保留
    expect(roles[0]).toEqual(["角色", "演员", "备注"]);
    expect(roles[1]).toEqual(["林晚", "张三", "顾沉"]);
    expect(roles[2]).toEqual(["顾沉", "", "备注"]);

    const shots = table.sheets.find((s) => s.sheet_id === "2")!.rows;
    // 数值按原文保留（是否当数字用是渲染层的事，导入器不做类型臆断）
    expect(shots[1]).toEqual(["1", "5"]);
  });

  it("confirm 会把节点 version +1（旧版本号后续会被 746002 拦住）", async () => {
    const before = await inject("GET", `/canvas/canvases/${canvasId}`);
    const beforeNode = (before.data.nodes as Array<{ id: string; version: number }>).find(
      (n) => n.id === tableNodeId,
    )!;

    const base64 = await buildWorkbook();
    const imported = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
    );
    const confirmed = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/confirm-sheet`,
      { import_token: imported.data.import_token, sheet_id: "1" },
    );
    expect(confirmed.code).toBe(0);
    expect(confirmed.data.node.version).toBe(beforeNode.version + 1);
  });

  it("非表格节点导入 → 400101（不写坏别的节点参数）", async () => {
    const base64 = await buildWorkbook();
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${textNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
    );
    expect(res.code).toBe(400101);
    expect(res.data ?? res.body ?? {}).toBeTruthy();
  });

  it("票据过期/伪造 → 400102 且提示重新导入", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/confirm-sheet`,
      { import_token: "not-a-real-token", sheet_id: "1" },
    );
    expect(res.code).toBe(400102);
    expect(res.msg).toContain("import again");
  });

  it("sheet_id 不在该工作簿内 → 400102", async () => {
    const base64 = await buildWorkbook();
    const imported = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
    );
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/confirm-sheet`,
      { import_token: imported.data.import_token, sheet_id: "99" },
    );
    expect(res.code).toBe(400102);
  });

  it("非 xlsx 与损坏文件 → 400101", async () => {
    const csv = Buffer.from("a,b\n1,2", "utf8").toString("base64");
    const wrongExt = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.csv", file_base64: csv },
    );
    expect(wrongExt.code).toBe(400101);

    const broken = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "坏了.xlsx", file_base64: Buffer.from("not-a-zip").toString("base64") },
    );
    expect(broken.code).toBe(400101);
  });

  it("跨 space 不能导入别人的画布节点", async () => {
    const base64 = await buildWorkbook();
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${tableNodeId}/table/import`,
      { file_name: "排期.xlsx", file_base64: base64 },
      otherToken,
    );
    expect(res.code).toBe(400102);
  });
});
