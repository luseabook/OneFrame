import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { inArray } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { assets, knowledgeAssets, knowledgeDirs, knowledgeTags } from "@app/db";
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
    const dup = await inject("POST", "/knowledge/dirs", { name: "剧集总库" }, u.token, u.spaceId);
    expect(dup.code).toBe(400101);
    expect(dup.msg).toContain("same name");

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
});
