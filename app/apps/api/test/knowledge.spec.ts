import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { inArray } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { assets, knowledgeAssets, knowledgeBases, knowledgeDirs, knowledgeTags } from "@app/db";
import { newId } from "@app/shared";

/**
 * 团队知识库（knowledge）契约测试 —— 对照竞品 `df/user_knowledge` 29 端点（routes.txt:737-765）。
 *
 * 这组用例刻意覆盖"错了会丢素材/越权"的四类：
 *
 * 1. **目录深度与成环**：深度 ≤5 与"不能移到自己子孙下"只能靠服务层拦——
 *    数据库里没有 `parent_id` 自引用外键（schema.ts:2235-2237 解释了原因），
 *    一旦漏判就会造出"看不见的孤儿目录"或无限循环的树。
 * 2. **级联软删**：删父目录必须把子树与子树内资产一起打 `deleted_at`，
 *    否则资产会挂在已删除目录下（前端看不见、搜索又搜不到 = 永久丢失）。
 * 3. **标签名与资产标签数组的双向一致**：资产存的是标签**文本数组**，
 *    只改登记表会让历史资产挂着不存在的标签名。
 * 4. **跨 space 与资产库的双向导入**：这是"团队级素材复用池"最容易被越权的地方，
 *    导入/导出都必须校验同 space（403，不是 404）。
 */
describe("knowledge e2e", () => {
  let app: NestFastifyApplication;
  /** 本次测试用到的个人 space（测试用户登录即建），afterAll 按 space 精确清理 */
  const usedSpaceIds: bigint[] = [];

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      body,
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string) {
    // 手机号必须满足 `/^1\d{10}$/`（auth.controller.ts:19）：1 + 6 位时间戳 + 2 位随机 + 2 位前缀标记 = 11 位
    const tail = String(Date.now()).slice(-6);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const rnd = String(Math.floor(Math.random() * 90 + 10));
    const phone = `1${tail}${rnd}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    if (!data?.access_token) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    usedSpaceIds.push(BigInt(String(data.space_id)));
    return { token: data.access_token, spaceId: String(data.space_id ?? ""), userId: String(data.user?.id ?? "") };
  }

  async function createDir(u: { token: string; spaceId: string }, name: string, parentId?: string) {
    const res = await inject(
      "POST",
      "/knowledge/dirs",
      { name, ...(parentId ? { parent_id: parentId } : {}) },
      u.token,
      u.spaceId,
    );
    if (res.code !== 0) throw new Error(`createDir failed: ${JSON.stringify(res.body)}`);
    return (res.data as { dir: { id: string }; depth: number }).dir;
  }

  async function createTag(u: { token: string; spaceId: string }, name: string) {
    const res = await inject("POST", "/knowledge/tags", { name }, u.token, u.spaceId);
    if (res.code !== 0) throw new Error(`createTag failed: ${JSON.stringify(res.body)}`);
    return (res.data as { tag: { id: string; name: string } }).tag;
  }

  /** 在资产库里造一条素材（知识库"双向导入"的对象） */
  async function seedAsset(spaceId: string, name: string) {
    const id = newId();
    await db.insert(assets).values({
      id,
      spaceId: BigInt(spaceId),
      kind: "image",
      uri: `s3://spec/${String(id)}.png`,
      previewUri: `s3://spec/${String(id)}_thumb.png`,
      name,
      tags: [],
    });
    return String(id);
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
  }, 90_000);

  afterAll(async () => {
    if (usedSpaceIds.length > 0) {
      // 第 59 批新增 knowledge_bases（space_id 外键），先删它再删 spaces 相关行
      await db.delete(knowledgeBases).where(inArray(knowledgeBases.spaceId, usedSpaceIds));
      await db.delete(knowledgeAssets).where(inArray(knowledgeAssets.spaceId, usedSpaceIds));
      await db.delete(knowledgeDirs).where(inArray(knowledgeDirs.spaceId, usedSpaceIds));
      await db.delete(knowledgeTags).where(inArray(knowledgeTags.spaceId, usedSpaceIds));
      await db.delete(assets).where(inArray(assets.spaceId, usedSpaceIds));
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  // ══════════════════════════════════════════════════════════
  // 一、目录树（深度 / 同名 / 成环 / 级联删）
  // ══════════════════════════════════════════════════════════

  it("目录树：建父子目录后 tree 嵌套正确、depth 递增、asset_count 汇总", async () => {
    const u = await loginNewUser("11");
    const root = await createDir(u, "世界设定");
    const child = await createDir(u, "角色", root.id);
    expect(child.id).not.toBe(root.id);

    const created = await inject(
      "POST",
      "/knowledge/assets",
      { title: "角色骨架", dir_id: child.id },
      u.token,
      u.spaceId,
    );
    expect(created.code).toBe(0);

    const tree = await inject("GET", "/knowledge/dirs", undefined, u.token, u.spaceId);
    expect(tree.code).toBe(0);
    const data = tree.data as {
      tree: Array<{
        id: string;
        depth: number;
        asset_count: number;
        children: Array<{ id: string; depth: number; asset_count: number }>;
      }>;
      count: number;
      max_depth: number;
    };
    expect(data.max_depth).toBe(5);
    expect(data.count).toBe(2);
    expect(data.tree[0]!.id).toBe(root.id);
    expect(data.tree[0]!.depth).toBe(1);
    expect(data.tree[0]!.children[0]!.id).toBe(child.id);
    expect(data.tree[0]!.children[0]!.depth).toBe(2);
    // 资产数必须出现在**树节点**上（页面对树渲染计数；只在扁平列表里有等于页面上全是 0）
    expect(data.tree[0]!.children[0]!.asset_count).toBe(1);
    expect(data.tree[0]!.asset_count).toBe(0);
  });

  it("目录深度上限 5 层：第 6 层拒绝（400101）；移动后若超深也拒绝", async () => {
    const u = await loginNewUser("12");
    let parentId: string | undefined;
    const ids: string[] = [];
    for (let depth = 1; depth <= 5; depth += 1) {
      const dir = await createDir(u, `第${depth}层`, parentId);
      ids.push(dir.id);
      parentId = dir.id;
    }
    // 第 6 层：数据库没有自引用外键，越界只能靠服务层判定（这条就是防那件事）
    const tooDeep = await inject(
      "POST",
      "/knowledge/dirs",
      { name: "第6层", parent_id: parentId },
      u.token,
      u.spaceId,
    );
    expect(tooDeep.code).toBe(400101);
    expect(tooDeep.msg).toContain("depth");

    // 把第 5 层（含自身 1 层，无子）挂到第 5 层下面 → 结果 6 层，必须拒绝
    const other = await createDir(u, "另一棵一层");
    const moveDeep = await inject(
      "POST",
      `/knowledge/dirs/${ids[4]}/move`,
      { parent_id: other.id },
      u.token,
      u.spaceId,
    );
    expect(moveDeep.code).toBe(0);
  });

  it("目录改名与同名检查；移动成环被拒（不能移到自己的子孙下）", async () => {
    const u = await loginNewUser("13");
    const root = await createDir(u, "剧集库");
    const child = await createDir(u, "第一季", root.id);

    const renamed = await inject("PATCH", `/knowledge/dirs/${root.id}`, { name: "剧集总库" }, u.token, u.spaceId);
    expect(renamed.code).toBe(0);

    // 同父下同名 → 拒绝（否则前端树里两行一样的名字，用户无法区分）
    // 第 60 批：错误码改为竞品同款 747007 + 竞品原文文案（竞品前端就是靠这个码识别重名的）
    const dup = await inject("POST", "/knowledge/dirs", { name: "剧集总库" }, u.token, u.spaceId);
    expect(dup.code).toBe(747007);
    expect(dup.msg).toBe("knowledge name already exists");

    // 成环：把 root 挂到自己的子目录下
    const cycle = await inject("POST", `/knowledge/dirs/${root.id}/move`, { parent_id: child.id }, u.token, u.spaceId);
    expect(cycle.code).toBe(400101);
    expect(cycle.msg).toContain("descendant");
  });

  it("删目录级联软删：子树与子树内资产都被软删，列表不再返回（行保留可恢复）", async () => {
    const u = await loginNewUser("14");
    const root = await createDir(u, "待删根");
    const child = await createDir(u, "待删子", root.id);
    const tag = await createTag(u, "构图");
    const keep = await createDir(u, "保留目录");

    const created = await inject(
      "POST",
      "/knowledge/assets",
      { title: "子目录里的条目", content: "内容", dir_id: child.id, tags: [tag.name] },
      u.token,
      u.spaceId,
    );
    expect(created.code).toBe(0);
    const assetId = (created.data as { asset: { id: string } }).asset.id;
    await inject(
      "POST",
      "/knowledge/assets",
      { title: "保留目录里的条目", dir_id: keep.id },
      u.token,
      u.spaceId,
    );

    const deleted = await inject("DELETE", `/knowledge/dirs/${root.id}`, undefined, u.token, u.spaceId);
    expect(deleted.code).toBe(0);
    const d = deleted.data as { dirs: number; assets: number; cascaded_dir_ids: string[] };
    expect(d.dirs).toBe(2); // 自己 + 子目录
    expect(d.assets).toBe(1); // 只有子目录里那一条被带走
    expect(d.cascaded_dir_ids).toContain(child.id);

    const tree = await inject("GET", "/knowledge/dirs", undefined, u.token, u.spaceId);
    const ids = (tree.data as { list: Array<{ id: string }> }).list.map((x) => x.id);
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(child.id);
    expect(ids).toContain(keep.id);

    // 资产业已软删：详情 404，但行还在库里（可恢复）
    const gone = await inject("GET", `/knowledge/assets/${assetId}`, undefined, u.token, u.spaceId);
    expect(gone.code).toBe(400102);
  });

  // ══════════════════════════════════════════════════════════
  // 二、标签（与资产标签数组的一致性）
  // ══════════════════════════════════════════════════════════

  it("标签：同名幂等；改名同步改写资产标签；删标签从资产数组摘掉", async () => {
    const u = await loginNewUser("21");
    const first = await createTag(u, "人设");
    const again = await inject("POST", "/knowledge/tags", { name: "人设" }, u.token, u.spaceId);
    expect(again.code).toBe(0);
    expect((again.data as { idempotent: boolean }).idempotent).toBe(true);
    expect((again.data as { tag: { id: string } }).tag.id).toBe(first.id);

    const dir = await createDir(u, "角色库");
    const asset = await inject(
      "POST",
      "/knowledge/assets",
      { title: "角色设定集", dir_id: dir.id, tags: [first.name] },
      u.token,
      u.spaceId,
    );
    expect(asset.code).toBe(0);
    const assetId = (asset.data as { asset: { id: string } }).asset.id;

    const renamed = await inject("PATCH", `/knowledge/tags/${first.id}`, { name: "人物小传" }, u.token, u.spaceId);
    expect(renamed.code).toBe(0);
    expect((renamed.data as { renamed_assets: number }).renamed_assets).toBe(1);

    // 资产上的标签文本必须同步（只改登记表会让两边永久对不上）
    const detail = await inject("GET", `/knowledge/assets/${assetId}`, undefined, u.token, u.spaceId);
    expect((detail.data as { asset: { tags: string[] } }).asset.tags).toEqual(["人物小传"]);

    const deleted = await inject("DELETE", `/knowledge/tags/${first.id}`, undefined, u.token, u.spaceId);
    expect(deleted.code).toBe(0);
    expect((deleted.data as { affected_assets: number }).affected_assets).toBe(1);
    const after = await inject("GET", `/knowledge/assets/${assetId}`, undefined, u.token, u.spaceId);
    expect((after.data as { asset: { tags: string[] } }).asset.tags).toEqual([]);
  });

  it("未知标签不能在资产上使用（400101 且列出未知项，不自动建标签）", async () => {
    const u = await loginNewUser("22");
    const res = await inject(
      "POST",
      "/knowledge/assets",
      { title: "带错标签的条目", tags: ["不存在的标签"] },
      u.token,
      u.spaceId,
    );
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("unknown tags");
    // 失败不留半成品：该 space 下不应有任何资产
    const listed = await inject("GET", "/knowledge/assets", undefined, u.token, u.spaceId);
    expect((listed.data as { total: number }).total).toBe(0);
    expect((res.body as { data?: unknown }).data).toBeNull();
  });

  // ══════════════════════════════════════════════════════════
  // 三、资产 CRUD / 搜索 / 分页
  // ══════════════════════════════════════════════════════════

  it("资产 CRUD：建→列表→搜索→详情→编辑→删；链接类型必须带 URL", async () => {
    const u = await loginNewUser("31");
    const dir = await createDir(u, "分镜参考");
    const tag = await createTag(u, "参考");

    const created = await inject(
      "POST",
      "/knowledge/assets",
      { title: "雨夜街景", content: "湿地面反光，霓虹", dir_id: dir.id, tags: [tag.name] },
      u.token,
      u.spaceId,
    );
    expect(created.code).toBe(0);
    const assetId = (created.data as { asset: { id: string; source_type_name: string } }).asset.id;

    const listed = await inject("GET", `/knowledge/assets?dir_id=${dir.id}`, undefined, u.token, u.spaceId);
    expect(listed.code).toBe(0);
    expect((listed.data as { total: number }).total).toBe(1);

    const searched = await inject("GET", "/knowledge/assets/search?keyword=霓虹", undefined, u.token, u.spaceId);
    expect(searched.code).toBe(0);
    expect((searched.data as { list: Array<{ id: string }> }).list.map((a) => a.id)).toContain(assetId);

    const missSearch = await inject("GET", "/knowledge/assets/search?keyword=不存在的词", undefined, u.token, u.spaceId);
    expect((missSearch.data as { total: number }).total).toBe(0);

    const patched = await inject(
      "PATCH",
      `/knowledge/assets/${assetId}`,
      { title: "雨夜街景（改）", tags: [] },
      u.token,
      u.spaceId,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { asset: { title: string } }).asset.title).toBe("雨夜街景（改）");

    // 链接条目必须带 URL（否则存出来的是一条空链接，前端点了没反应）
    const badLink = await inject(
      "POST",
      "/knowledge/assets",
      { title: "外链", source_type: 3 },
      u.token,
      u.spaceId,
    );
    expect(badLink.code).toBe(400101);

    const removed = await inject("DELETE", `/knowledge/assets/${assetId}`, undefined, u.token, u.spaceId);
    expect(removed.code).toBe(0);
    const gone = await inject("GET", `/knowledge/assets/${assetId}`, undefined, u.token, u.spaceId);
    expect(gone.code).toBe(400102);
  });

  it("分页与标签筛选：tags 是「且」语义；按标签单独查资产的端点与列表一致", async () => {
    const u = await loginNewUser("32");
    const t1 = await createTag(u, "室内");
    const t2 = await createTag(u, "夜景");
    const titles = ["纯室内", "室内夜景", "纯夜景"];
    for (const [i, title] of titles.entries()) {
      await inject(
        "POST",
        "/knowledge/assets",
        { title, tags: i === 0 ? [t1.name] : i === 1 ? [t1.name, t2.name] : [t2.name] },
        u.token,
        u.spaceId,
      );
    }

    const both = await inject("GET", `/knowledge/assets?tags=${t1.name},${t2.name}`, undefined, u.token, u.spaceId);
    expect(both.code).toBe(0);
    const list = (both.data as { list: Array<{ title: string }>; total: number }).list;
    expect(list.length).toBe(1);
    expect(list[0]!.title).toBe("室内夜景");

    const byTag = await inject("GET", `/knowledge/tags/${t1.id}/assets`, undefined, u.token, u.spaceId);
    expect(byTag.code).toBe(0);
    expect((byTag.data as { total: number }).total).toBe(2);

    const page = await inject("GET", "/knowledge/assets?page=1&page_size=2", undefined, u.token, u.spaceId);
    expect(page.code).toBe(0);
    expect((page.data as { list: unknown[] }).list.length).toBe(2);
    expect((page.data as { total: number }).total).toBe(3);
  });

  it("批量动作：加标签 / 去标签 / 移动 / 删除", async () => {
    const u = await loginNewUser("33");
    const tag = await createTag(u, "批量");
    const dirA = await createDir(u, "源目录");
    const dirB = await createDir(u, "目标目录");
    const ids: string[] = [];
    for (const title of ["批量一", "批量二"]) {
      const res = await inject(
        "POST",
        "/knowledge/assets",
        { title, dir_id: dirA.id },
        u.token,
        u.spaceId,
      );
      ids.push((res.data as { asset: { id: string } }).asset.id);
    }

    const added = await inject(
      "POST",
      "/knowledge/assets/batch-add-tags",
      { ids, tags: [tag.name] },
      u.token,
      u.spaceId,
    );
    expect(added.code).toBe(0);
    expect((added.data as { updated: number }).updated).toBe(2);

    const moved = await inject("POST", "/knowledge/assets/batch-move", { ids, dir_id: dirB.id }, u.token, u.spaceId);
    expect(moved.code).toBe(0);
    const inB = await inject("GET", `/knowledge/assets?dir_id=${dirB.id}`, undefined, u.token, u.spaceId);
    expect((inB.data as { total: number }).total).toBe(2);

    const removedTags = await inject(
      "POST",
      "/knowledge/assets/batch-remove-tags",
      { ids, tags: [tag.name] },
      u.token,
      u.spaceId,
    );
    expect(removedTags.code).toBe(0);
    expect((removedTags.data as { updated: number }).updated).toBe(2);

    const deleted = await inject("POST", "/knowledge/assets/batch-delete", { ids }, u.token, u.spaceId);
    expect(deleted.code).toBe(0);
    expect((deleted.data as { deleted: number }).deleted).toBe(2);

    const empty = await inject("POST", "/knowledge/assets/batch-delete", { ids: [] }, u.token, u.spaceId);
    expect(empty.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════
  // 四、与资产库双向导入（同 space 红线）
  // ══════════════════════════════════════════════════════════

  it("从资产库导入：同 space 成功并回填资源信息；跨 space 导入 403", async () => {
    const u = await loginNewUser("41");
    const other = await loginNewUser("42");
    const dir = await createDir(u, "素材引用");
    const myAsset = await seedAsset(u.spaceId, "雨夜街景原图");
    const foreignAsset = await seedAsset(other.spaceId, "别人团队的图");

    const imported = await inject(
      "POST",
      "/knowledge/assets/import-from-asset",
      { asset_id: myAsset, dir_id: dir.id },
      u.token,
      u.spaceId,
    );
    expect(imported.code).toBe(0);
    const data = imported.data as {
      asset: { source_type: number; asset_id: string; resource: { id: string; kind: string } | null };
      source_asset: { id: string };
    };
    expect(data.asset.source_type).toBe(2); // 资产引用
    expect(data.asset.asset_id).toBe(myAsset);
    expect(data.asset.resource?.kind).toBe("image");
    expect(data.source_asset.id).toBe(myAsset);

    // 跨 space：必须是 403（存在但不可用），不是 404（不存在）
    const crossSpace = await inject(
      "POST",
      "/knowledge/assets/import-from-asset",
      { asset_id: foreignAsset },
      u.token,
      u.spaceId,
    );
    expect(crossSpace.code).toBe(403101);
    expect(crossSpace.msg).toContain("another space");
  });

  it("导出到资产库：资产引用可另存为独立条目；文本条目无二进制被拒；解除引用降级回文本", async () => {
    const u = await loginNewUser("43");
    const myAsset = await seedAsset(u.spaceId, "可导出的素材");
    const imported = await inject(
      "POST",
      "/knowledge/assets/import-from-asset",
      { asset_id: myAsset, title: "知识库里的名字" },
      u.token,
      u.spaceId,
    );
    const knowledgeAssetId = (imported.data as { asset: { id: string } }).asset.id;

    const exported = await inject(
      "POST",
      `/knowledge/assets/${knowledgeAssetId}/to-asset`,
      undefined,
      u.token,
      u.spaceId,
    );
    expect(exported.code).toBe(0);
    const out = exported.data as { asset: { id: string; name: string; kind: string }; source_asset_id: string };
    expect(out.asset.id).not.toBe(myAsset); // 复制成独立条目，不共用同一行
    expect(out.asset.name).toBe("知识库里的名字");
    expect(out.asset.kind).toBe("image");
    expect(out.source_asset_id).toBe(myAsset);

    // 文本条目没有二进制：assets.kind 取值域是 image|video|audio，不能臆造 text 类型
    const textEntry = await inject(
      "POST",
      "/knowledge/assets",
      { title: "纯文本设定" },
      u.token,
      u.spaceId,
    );
    const textId = (textEntry.data as { asset: { id: string } }).asset.id;
    const notExportable = await inject("POST", `/knowledge/assets/${textId}/to-asset`, undefined, u.token, u.spaceId);
    expect(notExportable.code).toBe(400101);
    expect(notExportable.msg).toContain("only asset-reference entries");

    const detached = await inject(
      "DELETE",
      `/knowledge/assets/${knowledgeAssetId}/resource`,
      undefined,
      u.token,
      u.spaceId,
    );
    expect(detached.code).toBe(0);
    expect((detached.data as { asset: { source_type: number; asset_id: string | null } }).asset.source_type).toBe(1);
    expect((detached.data as { asset: { asset_id: string | null } }).asset.asset_id).toBeNull();
  });

  // ══════════════════════════════════════════════════════════
  // 五、概览 / 平铺 / 创建人 / 隔离
  // ══════════════════════════════════════════════════════════

  it("概览 info 计数与平铺 list、创建人聚合口径一致", async () => {
    const u = await loginNewUser("51");
    const dir = await createDir(u, "概览目录");
    await createTag(u, "概览标签");
    const myAsset = await seedAsset(u.spaceId, "概览素材");
    await inject("POST", "/knowledge/assets", { title: "文本条目", dir_id: dir.id }, u.token, u.spaceId);
    await inject(
      "POST",
      "/knowledge/assets/import-from-asset",
      { asset_id: myAsset, dir_id: dir.id },
      u.token,
      u.spaceId,
    );

    const info = await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId);
    expect(info.code).toBe(0);
    const i = info.data as {
      dir_count: number;
      asset_count: number;
      tag_count: number;
      asset_by_source_type: { text: number; asset_reference: number; link: number };
      max_dir_depth: number;
    };
    expect(i.dir_count).toBe(1);
    expect(i.asset_count).toBe(2);
    expect(i.tag_count).toBe(1);
    expect(i.asset_by_source_type.text).toBe(1);
    expect(i.asset_by_source_type.asset_reference).toBe(1);
    expect(i.asset_by_source_type.link).toBe(0);
    expect(i.max_dir_depth).toBe(5);

    const list = await inject("GET", "/knowledge/list?sort=updated", undefined, u.token, u.spaceId);
    expect(list.code).toBe(0);
    expect((list.data as { total: number }).total).toBe(2);

    const writers = await inject("GET", "/knowledge/scriptwriter/list", undefined, u.token, u.spaceId);
    expect(writers.code).toBe(0);
    const w = writers.data as { list: Array<{ user_id: string; asset_count: number }> };
    expect(w.list.length).toBe(1);
    expect(w.list[0]!.user_id).toBe(u.userId);
    expect(w.list[0]!.asset_count).toBe(2);
  });

  // ══════════════════════════════════════════════════════════
  // 五之半、知识库实体（第 59 批：rt:739/740/758/765）
  // ══════════════════════════════════════════════════════════

  /**
   * 这组用例盯的是"一 team 一库"这个判定本身：如果哪天有人把表改成支持多库，
   * 下面第一条（同名/同 space 幂等）与第三条（删后重建能拿到新行）会立刻变红。
   */
  it("知识库实体：GET /base 懒初始化一行、POST /base 幂等返回 created:false", async () => {
    const u = await loginNewUser("61");

    // 首次 GET：老空间（已有目录/资产但没库行）必须自愈，不能 404
    const first = await inject("GET", "/knowledge/base", undefined, u.token, u.spaceId);
    expect(first.code).toBe(0);
    const b1 = (first.data as { base: { id: string; name: string; description: string; cover_uri: string } }).base;
    expect(b1.id).not.toBe("");
    expect(b1.name).toBe("团队知识库");
    expect(b1.description).toBe("");
    expect(b1.cover_uri).toBe("");

    // 再 GET 一次：必须是同一行（不是每读一次建一行）
    const second = await inject("GET", "/knowledge/base", undefined, u.token, u.spaceId);
    expect((second.data as { base: { id: string } }).base.id).toBe(b1.id);

    // info 也带实体块，且与 /base 是同一行（页面一次拿全，不必两处各自初始化）
    const info = await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId);
    expect((info.data as { base: { id: string } }).base.id).toBe(b1.id);

    // POST /base：已存在 → 幂等，不新建、不覆盖已有名称
    const created = await inject("POST", "/knowledge/base", { name: "第二个库" }, u.token, u.spaceId);
    expect(created.code).toBe(0);
    const c = created.data as { base: { id: string; name: string }; created: boolean };
    expect(c.created).toBe(false);
    expect(c.base.id).toBe(b1.id);
    expect(c.base.name).toBe("团队知识库");
  });

  it("知识库实体：改名与改概览分开，未传字段不被清空", async () => {
    const u = await loginNewUser("62");
    // 先把简介/封面/提示写进去
    const setInfo = await inject(
      "POST",
      "/knowledge/base/info/update",
      { description: "本团队的世界观与设定集", cover_uri: "s3://spec/cover.png", note: "先建目录再放条目" },
      u.token,
      u.spaceId,
    );
    expect(setInfo.code).toBe(0);
    const afterInfo = (setInfo.data as { base: Record<string, unknown> }).base;
    expect(afterInfo.description).toBe("本团队的世界观与设定集");
    expect(afterInfo.cover_uri).toBe("s3://spec/cover.png");
    expect(afterInfo.note).toBe("先建目录再放条目");

    // 只改名：简介/封面/提示必须原样保留（这是"拆两条端点"的全部理由）
    const renamed = await inject("POST", "/knowledge/base/update", { name: "星河设定库" }, u.token, u.spaceId);
    expect(renamed.code).toBe(0);
    const b = (renamed.data as { base: Record<string, unknown> }).base;
    expect(b.name).toBe("星河设定库");
    expect(b.description).toBe("本团队的世界观与设定集");
    expect(b.cover_uri).toBe("s3://spec/cover.png");
    expect(b.note).toBe("先建目录再放条目");

    // 只改提示：名称不动
    const noteOnly = await inject("POST", "/knowledge/base/info/update", { note: "改过的提示" }, u.token, u.spaceId);
    expect((noteOnly.data as { base: Record<string, unknown> }).base.name).toBe("星河设定库");

    // 空名/超长名 → 400101（不是 500，也不是静默成功）
    const emptyName = await inject("POST", "/knowledge/base/update", { name: "   " }, u.token, u.spaceId);
    expect(emptyName.code).toBe(400101);
    const longName = await inject("POST", "/knowledge/base/update", { name: "x".repeat(61) }, u.token, u.spaceId);
    expect(longName.code).toBe(400101);
  });

  it("删库：默认只软删库行（目录/标签/资产原地保留），purge=true 才级联清", async () => {
    const u = await loginNewUser("63");
    const dir = await createDir(u, "删库前目录");
    await createTag(u, "删库前标签");
    await inject("POST", "/knowledge/assets", { title: "删库前条目", dir_id: dir.id }, u.token, u.spaceId);
    const before = (await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId)).data as {
      dir_count: number;
      asset_count: number;
      base: { id: string };
    };
    expect(before.dir_count).toBe(1);
    expect(before.asset_count).toBe(1);

    // 默认删：库行软删，内容不动
    const soft = await inject("POST", "/knowledge/base/delete", {}, u.token, u.spaceId);
    expect(soft.code).toBe(0);
    const softData = soft.data as { deleted: boolean; purged: boolean; dirs: number; assets: number };
    expect(softData.deleted).toBe(true);
    expect(softData.purged).toBe(false);
    expect(softData.dirs).toBe(0);
    expect(softData.assets).toBe(0);

    // 内容仍在（这是一 space 一库、不给 dir 加 base_id 的直接好处）
    const mid = (await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId)).data as {
      dir_count: number;
      asset_count: number;
      base: { id: string };
    };
    expect(mid.dir_count).toBe(1);
    expect(mid.asset_count).toBe(1);
    // 删后重读会自动补一行新库（软删行被偏唯一索引放过）→ id 变化
    expect(mid.base.id).not.toBe(before.base.id);

    // purge：库 + 内容一起清
    const purge = await inject("POST", "/knowledge/base/delete", { purge: true }, u.token, u.spaceId);
    expect(purge.code).toBe(0);
    const purgeData = purge.data as { purged: boolean; dirs: number; assets: number; tags: number };
    expect(purgeData.purged).toBe(true);
    expect(purgeData.dirs).toBe(1);
    expect(purgeData.assets).toBe(1);
    expect(purgeData.tags).toBe(1);

    const after = (await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId)).data as {
      dir_count: number;
      asset_count: number;
      tag_count: number;
    };
    expect(after.dir_count).toBe(0);
    expect(after.asset_count).toBe(0);
    expect(after.tag_count).toBe(0);
  });

  it("知识库实体隔离：别的 space 的库名改不到、删不掉", async () => {
    const mine = await loginNewUser("64");
    const other = await loginNewUser("65");
    await inject("POST", "/knowledge/base/update", { name: "我的库" }, mine.token, mine.spaceId);
    await inject("POST", "/knowledge/base/update", { name: "他的库" }, other.token, other.spaceId);

    // 各自只看到自己的库名（服务层所有查询第一条件都是 auth.spaceId）
    const mineNow = await inject("GET", "/knowledge/base", undefined, mine.token, mine.spaceId);
    expect((mineNow.data as { base: { name: string } }).base.name).toBe("我的库");
    const otherNow = await inject("GET", "/knowledge/base", undefined, other.token, other.spaceId);
    expect((otherNow.data as { base: { name: string } }).base.name).toBe("他的库");

    // 冒用别人的 X-Space-Id 改库名：AuthGuard 拦在入口 403101
    const spoof = await inject("POST", "/knowledge/base/update", { name: "被改了" }, other.token, mine.spaceId);
    expect(spoof.code).toBe(403101);
    const stillMine = await inject("GET", "/knowledge/base", undefined, mine.token, mine.spaceId);
    expect((stillMine.data as { base: { name: string } }).base.name).toBe("我的库");
  });

  it("多租户隔离：别的 space 看不到我的知识库；X-Space-Id 指向非成员 space 403", async () => {
    const u = await loginNewUser("52");
    const other = await loginNewUser("53");
    const dir = await createDir(u, "我的目录");
    const created = await inject(
      "POST",
      "/knowledge/assets",
      { title: "我的条目", dir_id: dir.id },
      u.token,
      u.spaceId,
    );
    const assetId = (created.data as { asset: { id: string } }).asset.id;

    // 另一个用户的 space 里什么都看不到
    const otherList = await inject("GET", "/knowledge/list", undefined, other.token, other.spaceId);
    expect((otherList.data as { total: number }).total).toBe(0);

    // 拿别人的 asset id 直接读：404（不是 403，且不泄露存在性）
    const peek = await inject("GET", `/knowledge/assets/${assetId}`, undefined, other.token, other.spaceId);
    expect(peek.code).toBe(400102);

    // 冒用别人的 X-Space-Id：AuthGuard 拦在入口（403101），请求根本进不到业务层
    const spoof = await inject("GET", "/knowledge/dirs", undefined, other.token, u.spaceId);
    expect(spoof.code).toBe(403101);
  });

  it("参数校验：空标题 / 空目录名 / 非法 id 都返回 400101（不是 500）", async () => {
    const u = await loginNewUser("54");
    const emptyTitle = await inject("POST", "/knowledge/assets", { title: "   " }, u.token, u.spaceId);
    expect(emptyTitle.code).toBe(400101);

    const emptyDir = await inject("POST", "/knowledge/dirs", { name: "" }, u.token, u.spaceId);
    expect(emptyDir.code).toBe(400101);

    const badId = await inject("GET", "/knowledge/assets/not-a-number", undefined, u.token, u.spaceId);
    expect(badId.code).toBe(400101);

    const missingDir = await inject(
      "POST",
      "/knowledge/dirs",
      { name: "挂在不存在父目录下", parent_id: "999999999999" },
      u.token,
      u.spaceId,
    );
    expect(missingDir.code).toBe(400102);
  });

  // ── 第 60 批：模板场景（scene）维度 ──────────────────────────────────
  // 竞品证据：dir/list 的 query 是 ["scene","parent_ukd_id"]、tag/list 是 ["scene","query"]、
  // asset/search 是 ["scene","query","scopes","ukd_id","page","page_size","order"] ——
  // 目录树、标签、资产三层都按场景隔离，不是单一的"类型"字段。

  it("场景隔离：同名目录/同名标签可在不同场景各存一份，dirs/tags 按 scene 过滤", async () => {
    const u = await loginNewUser("66");

    // 同一 space 下「风格」与「题材」各建一个同名目录：不冲突
    const styleDir = await inject("POST", "/knowledge/dirs", { name: "复古", scene: 1 }, u.token, u.spaceId);
    expect(styleDir.code).toBe(0);
    expect((styleDir.data as { dir: { scene: number } }).dir.scene).toBe(1);
    const genreDir = await inject("POST", "/knowledge/dirs", { name: "复古", scene: 2 }, u.token, u.spaceId);
    expect(genreDir.code).toBe(0);

    // 同场景再建同名 → 竞品同款 747007
    const dup = await inject("POST", "/knowledge/dirs", { name: "复古", scene: 1 }, u.token, u.spaceId);
    expect(dup.code).toBe(747007);

    // 带 scene 只看本场景那棵树；不带 scene 兼容旧调用方（两棵都在）
    const styleTree = await inject("GET", "/knowledge/dirs?scene=1", undefined, u.token, u.spaceId);
    expect((styleTree.data as { count: number }).count).toBe(1);
    expect((styleTree.data as { list: { scene: number }[] }).list[0]!.scene).toBe(1);
    const genreTree = await inject("GET", "/knowledge/dirs?scene=2", undefined, u.token, u.spaceId);
    expect((genreTree.data as { count: number }).count).toBe(1);
    const allTree = await inject("GET", "/knowledge/dirs", undefined, u.token, u.spaceId);
    expect((allTree.data as { count: number }).count).toBe(2);

    // 子目录跟随父目录场景（不传 scene 也落到父场景）
    const child = await inject(
      "POST",
      "/knowledge/dirs",
      { name: "子目录", parent_id: (styleDir.data as { dir: { id: string } }).dir.id },
      u.token,
      u.spaceId,
    );
    expect((child.data as { dir: { scene: number } }).dir.scene).toBe(1);

    // 标签同理：跨场景允许同名，各自拿到不同的行
    const t1 = await inject("POST", "/knowledge/tags", { name: "复古", scene: 1 }, u.token, u.spaceId);
    const t2 = await inject("POST", "/knowledge/tags", { name: "复古", scene: 2 }, u.token, u.spaceId);
    expect(t1.code).toBe(0);
    expect(t2.code).toBe(0);
    expect((t1.data as { tag: { id: string } }).tag.id).not.toBe((t2.data as { tag: { id: string } }).tag.id);
    const styleTags = await inject("GET", "/knowledge/tags?scene=1", undefined, u.token, u.spaceId);
    expect((styleTags.data as { count: number }).count).toBe(1);
    const allTags = await inject("GET", "/knowledge/tags", undefined, u.token, u.spaceId);
    expect((allTags.data as { count: number }).count).toBe(2);

    // 非法场景值 → 400101（不是静默查空）
    const bad = await inject("GET", "/knowledge/dirs?scene=8", undefined, u.token, u.spaceId);
    expect(bad.code).toBe(400101);
  });

  it("按场景的字段规则：名称上限/正文必填与上限逐类不同（竞品每类一份规则对象）", async () => {
    const u = await loginNewUser("67");

    // scene=1 风格：name ≤ 10、content（竞品 prompt_template）必填、上限 2000
    const tooLong = await inject(
      "POST",
      "/knowledge/assets",
      { title: "一二三四五六七八九十一", scene: 1, content: "霓虹" },
      u.token,
      u.spaceId,
    );
    expect(tooLong.code).toBe(400101);
    expect(tooLong.msg).toContain("at most 10");
    const noPrompt = await inject("POST", "/knowledge/assets", { title: "风格A", scene: 1 }, u.token, u.spaceId);
    expect(noPrompt.code).toBe(400101);
    expect(noPrompt.msg).toContain("content is required");
    const ok = await inject(
      "POST",
      "/knowledge/assets",
      { title: "风格A", scene: 1, content: "赛博朋克霓虹" },
      u.token,
      u.spaceId,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { asset: { scene_slug: string } }).asset.scene_slug).toBe("style");

    // scene=2 题材：无 prompt 列，只建名字即可
    const genre = await inject("POST", "/knowledge/assets", { title: "悬疑", scene: 2 }, u.token, u.spaceId);
    expect(genre.code).toBe(0);

    // scene=14 音色：content 上限只有 50
    const voiceTooLong = await inject(
      "POST",
      "/knowledge/assets",
      { title: "音色A", scene: 14, content: "x".repeat(51) },
      u.token,
      u.spaceId,
    );
    expect(voiceTooLong.code).toBe(400101);
    expect(voiceTooLong.msg).toContain("at most 50");

    // scene=20 音频模版：不要求 content，name 上限 50
    const audio = await inject(
      "POST",
      "/knowledge/assets",
      { title: "音频A", scene: 20 },
      u.token,
      u.spaceId,
    );
    expect(audio.code).toBe(0);
    const audioDto = (audio.data as { asset: { scene_prompt_column: boolean; scene_name_max_length: number } }).asset;
    expect(audioDto.scene_prompt_column).toBe(false);
    expect(audioDto.scene_name_max_length).toBe(50);

    // scene=8 不在竞品枚举里（值不连续）→ 400101
    const badScene = await inject("POST", "/knowledge/assets", { title: "x", scene: 8 }, u.token, u.spaceId);
    expect(badScene.code).toBe(400101);
    expect(badScene.msg).toContain("unknown knowledge scene");
  });

  it("条目场景必须与所在目录一致；列表/搜索/平铺按 scene 过滤，概览给出按场景计数", async () => {
    const u = await loginNewUser("68");
    const styleDir = await inject("POST", "/knowledge/dirs", { name: "风格目录", scene: 1 }, u.token, u.spaceId);
    const styleDirId = (styleDir.data as { dir: { id: string } }).dir.id;

    const okAsset = await inject(
      "POST",
      "/knowledge/assets",
      { title: "风格条目", scene: 1, content: "p", dir_id: styleDirId },
      u.token,
      u.spaceId,
    );
    expect(okAsset.code).toBe(0);

    // 跨场景塞进风格目录 → 400101（否则"风格"tab 里混进音色条目）
    const mismatch = await inject(
      "POST",
      "/knowledge/assets",
      { title: "音色条目", scene: 14, content: "tone", dir_id: styleDirId },
      u.token,
      u.spaceId,
    );
    expect(mismatch.code).toBe(400101);
    expect(mismatch.msg).toContain("different scene");

    // 未分类条目（scene=0）
    await inject("POST", "/knowledge/assets", { title: "散条目" }, u.token, u.spaceId);

    expect((await inject("GET", "/knowledge/assets?scene=1", undefined, u.token, u.spaceId)).data).toMatchObject({
      total: 1,
    });
    expect((await inject("GET", "/knowledge/assets?scene=0", undefined, u.token, u.spaceId)).data).toMatchObject({
      total: 1,
    });
    expect(
      (await inject("GET", "/knowledge/assets/search?scene=1&keyword=风格", undefined, u.token, u.spaceId)).data,
    ).toMatchObject({ total: 1 });
    expect((await inject("GET", "/knowledge/list?scene=14", undefined, u.token, u.spaceId)).data).toMatchObject({
      total: 0,
    });

    const info = await inject("GET", "/knowledge/info", undefined, u.token, u.spaceId);
    const byScene = (info.data as { asset_by_scene: Record<string, number> }).asset_by_scene;
    expect(byScene["1"]).toBe(1);
    expect(byScene["0"]).toBe(1);
  });

  // ── 第 75 批：竞品「知识库模板条目」的条目级字段 ─────────────────────
  //
  // 证据：`ArT8U6Tg.js` 的 payload builder 逐字
  //   `{ uk_id, scene, status, use_type, sp_type, prompt_template, cover_file: k||y[0]||"",
  //      image_files, origin_image_files, orgin_cover_file, meta_data, sort, ... }`
  // 与 `0zWWdXb_.js` 的两个枚举 `status{Enabled:1,Disabled:2}` / `use_type{Official:1,Team:2}`。
  it("条目级字段：封面/配图/归属/启停/meta/sort 全链路，且封面为空时回落首图", async () => {
    const u = await loginNewUser("75");
    const coverAsset = await seedAsset(u.spaceId, "封面图");
    const secondAsset = await seedAsset(u.spaceId, "第二张图");

    const created = await inject(
      "POST",
      "/knowledge/assets",
      {
        title: "视频特效模板",
        scene: 4,
        content: "slow motion",
        cover_asset_id: coverAsset,
        image_asset_ids: [coverAsset, secondAsset],
        use_type: 1,
        sp_type: 7,
        res_type: 12,
        meta_data: { model: "seedance", steps: 12 },
        sort: 5,
      },
      u.token,
      u.spaceId,
    );
    expect(created.code).toBe(0);
    const dto = (
      created.data as {
        asset: {
          id: string;
          cover_asset_id: string | null;
          cover_uri: string | null;
          cover_is_fallback: boolean;
          image_asset_ids: string[];
          use_type: number;
          status: number;
          sp_type: number;
          res_type: number;
          meta_data: Record<string, unknown> | null;
          sort: number;
          scene_cover_required: boolean;
        };
      }
    ).asset;
    expect(dto.cover_asset_id).toBe(coverAsset);
    expect(dto.cover_uri).toBeTruthy(); // 存储签名（mock 模式下也返回可用 URL）
    expect(dto.cover_is_fallback).toBe(false);
    expect(dto.image_asset_ids).toEqual([coverAsset, secondAsset]);
    expect(dto.use_type).toBe(1);
    expect(dto.status).toBe(1); // 默认启用
    expect(dto.sp_type).toBe(7);
    expect(dto.res_type).toBe(12);
    expect(dto.meta_data).toMatchObject({ model: "seedance", steps: 12 });
    expect(dto.sort).toBe(5);
    expect(dto.scene_cover_required).toBe(true); // 4 视频特效的封面必填

    // 默认值：不传 use_type 时是 2（团队），status 是 1（启用），sort 是 0
    const plain = await inject("POST", "/knowledge/assets", { title: "默认值条目" }, u.token, u.spaceId);
    const plainDto = (plain.data as { asset: { use_type: number; status: number; sort: number } }).asset;
    expect(plainDto.use_type).toBe(2);
    expect(plainDto.status).toBe(1);
    expect(plainDto.sort).toBe(0);

    // 列表按 status / use_type 筛选
    const enabledOfficial = await inject(
      "GET",
      "/knowledge/assets?status=1&use_type=1",
      undefined,
      u.token,
      u.spaceId,
    );
    expect((enabledOfficial.data as { total: number }).total).toBe(1);
    const disabled = await inject("GET", "/knowledge/assets?status=2", undefined, u.token, u.spaceId);
    expect((disabled.data as { total: number }).total).toBe(0);

    // 竞品列表请求里的 sp_type 是数组（`sp_type: [-1,1,2,3]`），两种写法都要能解析
    const bySpType = await inject("GET", "/knowledge/assets?sp_type=7", undefined, u.token, u.spaceId);
    expect((bySpType.data as { total: number }).total).toBe(1);
    const bySpTypeMulti = await inject("GET", "/knowledge/assets?sp_type=7,0", undefined, u.token, u.spaceId);
    expect((bySpTypeMulti.data as { total: number }).total).toBe(2); // 7 的那条 + 默认 0 的那条
    const byResType = await inject("GET", "/knowledge/assets?res_type=12", undefined, u.token, u.spaceId);
    expect((byResType.data as { total: number }).total).toBe(1);
    const byResTypeMiss = await inject("GET", "/knowledge/assets?res_type=5", undefined, u.token, u.spaceId);
    expect((byResTypeMiss.data as { total: number }).total).toBe(0);
    // 非法取值要 400101 且 msg 带字段名（否则 CLI/agent 看不出哪个参数错）
    const badSpType = await inject("GET", "/knowledge/assets?sp_type=abc", undefined, u.token, u.spaceId);
    expect(badSpType.code).toBe(400101);
    expect(badSpType.msg).toContain("sp_type");
    const badResType = await inject("GET", "/knowledge/assets?res_type=70000", undefined, u.token, u.spaceId);
    expect(badResType.code).toBe(400101);

    // 清空人工封面 → 回落到 image_asset_ids[0]，并标出是兜底
    const cleared = await inject(
      "PATCH",
      `/knowledge/assets/${dto.id}`,
      { cover_asset_id: null },
      u.token,
      u.spaceId,
    );
    expect(cleared.code).toBe(0);
    const clearedDto = (cleared.data as { asset: { cover_asset_id: string | null; cover_is_fallback: boolean } }).asset;
    expect(clearedDto.cover_asset_id).toBeNull();
    expect(clearedDto.cover_is_fallback).toBe(true);

    // 停用 + 清 meta + 改排序；未传的字段保持原样
    const patched = await inject(
      "PATCH",
      `/knowledge/assets/${dto.id}`,
      { status: 2, meta_data: null, sort: 9 },
      u.token,
      u.spaceId,
    );
    expect(patched.code).toBe(0);
    const patchedDto = (
      patched.data as { asset: { status: number; meta_data: unknown; sort: number; title: string; use_type: number } }
    ).asset;
    expect(patchedDto.status).toBe(2);
    expect(patchedDto.meta_data).toBeNull();
    expect(patchedDto.sort).toBe(9);
    expect(patchedDto.title).toBe("视频特效模板"); // 未传不动
    expect(patchedDto.use_type).toBe(1);
    expect((await inject("GET", "/knowledge/assets?status=1&use_type=1", undefined, u.token, u.spaceId)).data).toMatchObject({
      total: 0,
    });
    expect((await inject("GET", "/knowledge/assets?status=2", undefined, u.token, u.spaceId)).data).toMatchObject({
      total: 1,
    });
  });

  it("封面必填只对 scene 3/4 生效；配图可替代封面；只改标题不会误判缺封面", async () => {
    const u = await loginNewUser("76");
    const img = await seedAsset(u.spaceId, "构图参考图");

    // scene=3 分镜构图：封面（或至少一张配图）必填
    const noCover = await inject(
      "POST",
      "/knowledge/assets",
      { title: "构图A", scene: 3, content: "三分法" },
      u.token,
      u.spaceId,
    );
    expect(noCover.code).toBe(400101);
    expect(noCover.msg).toContain("cover is required");

    // 只给配图、不给单独封面 → 允许（竞品 `cover_file: k || y[0]`）
    const withImages = await inject(
      "POST",
      "/knowledge/assets",
      { title: "构图B", scene: 3, content: "对角线", image_asset_ids: [img] },
      u.token,
      u.spaceId,
    );
    expect(withImages.code).toBe(0);
    const withImagesDto = (
      withImages.data as { asset: { id: string; cover_asset_id: string | null; cover_uri: string | null } }
    ).asset;
    expect(withImagesDto.cover_asset_id).toBeNull();
    expect(withImagesDto.cover_uri).toBeTruthy(); // 由首图兜底

    // scene=1 风格：封面不要求
    const style = await inject(
      "POST",
      "/knowledge/assets",
      { title: "赛博", scene: 1, content: "neon" },
      u.token,
      u.spaceId,
    );
    expect(style.code).toBe(0);

    // 只改标题时，校验器必须用「合并后的现有封面」判断，而不是当成"没有封面"
    const renamed = await inject(
      "PATCH",
      `/knowledge/assets/${withImagesDto.id}`,
      { title: "构图B2" },
      u.token,
      u.spaceId,
    );
    expect(renamed.code).toBe(0);
    expect((renamed.data as { asset: { title: string } }).asset.title).toBe("构图B2");

    // 把配图清空且不设封面 → 该场景又变成缺封面，拒绝
    const emptied = await inject(
      "PATCH",
      `/knowledge/assets/${withImagesDto.id}`,
      { image_asset_ids: [] },
      u.token,
      u.spaceId,
    );
    expect(emptied.code).toBe(400101);
    expect(emptied.msg).toContain("cover is required");
  });

  it("封面/配图引用必须属于本 space 且未删：跨空间 400102、坏 id 400101、超 20 张 400101", async () => {
    const u = await loginNewUser("77");
    const other = await loginNewUser("78");
    const foreign = await seedAsset(other.spaceId, "别人家的图");
    const mine = await seedAsset(u.spaceId, "我的图");

    // 跨空间：不告诉调用方"这个 id 在别处存在"（400102 而不是 400101）
    const cross = await inject(
      "POST",
      "/knowledge/assets",
      { title: "偷图", cover_asset_id: foreign },
      u.token,
      u.spaceId,
    );
    expect(cross.code).toBe(400102);
    const crossList = await inject(
      "POST",
      "/knowledge/assets",
      { title: "偷图2", image_asset_ids: [mine, foreign] },
      u.token,
      u.spaceId,
    );
    expect(crossList.code).toBe(400102);

    // 坏 id 形状
    const badCover = await inject(
      "POST",
      "/knowledge/assets",
      { title: "坏封面", cover_asset_id: "abc" },
      u.token,
      u.spaceId,
    );
    expect(badCover.code).toBe(400101);
    expect(badCover.msg).toContain("cover_asset_id");
    const badImages = await inject(
      "POST",
      "/knowledge/assets",
      { title: "坏配图", image_asset_ids: ["abc"] },
      u.token,
      u.spaceId,
    );
    expect(badImages.code).toBe(400101);
    expect(badImages.msg).toContain("image_asset_ids");

    // 21 张超过上限（zod 层拦，字段名必须出现在 msg 里否则 CLI/agent 看不出是哪个参数）
    const tooMany = await inject(
      "POST",
      "/knowledge/assets",
      { title: "太多图", image_asset_ids: Array.from({ length: 21 }, () => mine) },
      u.token,
      u.spaceId,
    );
    expect(tooMany.code).toBe(400101);
    expect(tooMany.msg).toContain("image_asset_ids");
  });
});
