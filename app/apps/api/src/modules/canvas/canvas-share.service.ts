import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { assets, canvasEdges, canvasGroups, canvasNodes, canvasShares, canvases } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";
import { StorageService } from "../../storage/storage.service";

/**
 * 画布分享（第 126 批）—— 公开只读链接。
 *
 * 与任务分享的区别只有一点：任务分享读**当前结果**，画布分享读**冻结快照**。
 * 画布是可变文档，若公开页每次现读库，"观众看到的版本"会随主人继续编辑而漂移，
 * 且撤销/过期判断与内容读取会分散在两张表上。冻结后：
 *   1. 公开侧只读一行 JSONB，令牌撤回/过期只判本行；
 *   2. 快照里不出现 task_id / space_id / user_id / 积分（见 `sanitizeParams`）；
 *   3. 文件 URL 每次现签（3600s），快照本身不存会过期的签名地址。
 */

/** 单次分享的节点上限：公开响应与快照都要有界，避免一次分享把整张巨型画布序列化进去 */
const MAX_SHARE_NODES = 500;
/** 单次分享的文件上限：与任务分享的打包上限（50）区分，这里只签名不读字节，可略宽 */
const MAX_SHARE_FILES = 200;
/** 边的上限：一张 500 节点的图最多也就千级边，取 4 倍留余量 */
const MAX_SHARE_EDGES = MAX_SHARE_NODES * 4;
/** 公开文件 URL 有效期，与任务分享一致 */
const URL_TTL_S = 3_600;
/** 分享令牌：base64url(24B) = 32 字符；公开侧只接受这个形状，别的形状一律 404 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 公开侧的第一道闸：形状不对的令牌连查库都不必查，直接按"不存在"处理 */
export function isShareToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/**
 * 快照里禁止出现的键。
 *
 * 两类：
 * - 内部身份：`task_id` / `image_task_id` / `source_task_ids` …… 任何以 `_task_id(s)` 结尾的键；
 * - 凭据与空间归属：`space_id` / `user_id` / `api_key` / `authorization` / `token` / `secret`。
 * 产物 URI 单独抽到 `files[]`，所以 `result_uri(s)` / `result_preview_uri` 也不再留在 params 里。
 */
const DROP_KEY =
  /^(?:space_id|user_id|owner_user_id|credits?|credits_frozen|credits_settled|api_key|authorization|token|secret|password|result_uri|result_uris|result_preview_uri)$|(?:^|_)task_?ids?$/;
/** 我方存储 key 的形状 `u/<spaceId>/...`：公开响应里不出现，避免把空间 id 带出去 */
const STORAGE_KEY_RE = /^u\/\d+\//;

export type CanvasShareFileKind = "result" | "preview";

export interface CanvasShareFile {
  node_id: string;
  kind: CanvasShareFileKind;
  /** 存储 key 或外站 URL；只在服务端与快照里出现，公开响应一律签名 */
  uri: string;
}

export interface CanvasShareSnapshot {
  /** 快照格式版本：以后要扩字段时靠它判断，不和画布 version 混用 */
  format: 1;
  canvas: {
    title: string;
    source_version: number;
    /** 人工封面（assets.uri），没有就是 null；自动封面不在分享时猜 */
    cover: string | null;
  };
  nodes: Array<{
    id: string;
    node_type: string;
    name: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    z_index: number;
    status: number;
    group_ids: string[];
    params: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; src_node_id: string; dst_node_id: string; semantic: string }>;
  groups: Array<{ id: string; parent_id: string | null; name: string | null; sort: number; status: number }>;
  files: CanvasShareFile[];
  truncated: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 拍平并剔除内部字段。
 *
 * 深拷贝而不是引用原对象：`canvas_nodes.params` 是 jsonb，原样塞进快照后，
 * 若这里原地删键会连运行时缓存里的对象一起改掉（drizzle 返回的是普通对象）。
 */
export function sanitizeParams(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeParams(item, depth + 1));
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && STORAGE_KEY_RE.test(value)) return null;
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DROP_KEY.test(key)) continue;
    out[key] = sanitizeParams(item, depth + 1);
  }
  return out;
}

/** 从节点 params 里抽产物 URI；顺序固定（结果在前、预览在后），便于页面稳定渲染 */
export function collectFiles(nodeId: string, params: Record<string, unknown>): CanvasShareFile[] {
  const out: CanvasShareFile[] = [];
  const push = (uri: unknown, kind: CanvasShareFileKind): void => {
    if (typeof uri !== "string" || !uri) return;
    if (out.some((f) => f.uri === uri)) return;
    out.push({ node_id: nodeId, kind, uri });
  };
  const list = params.result_uris;
  if (Array.isArray(list)) for (const uri of list) push(uri, "result");
  push(params.result_uri, "result");
  push(params.result_preview_uri, "preview");
  return out;
}

/** 读回自己写的快照；结构不对（历史/损坏）一律按"链接不可用"，不向公开侧抛 500 */
export function readShareSnapshot(value: unknown): CanvasShareSnapshot {
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    !isRecord(value.canvas) ||
    typeof value.canvas.title !== "string" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.files)
  ) {
    throw new AppError(ErrorCode.NOT_FOUND, "share content unavailable");
  }
  return value as unknown as CanvasShareSnapshot;
}

@Injectable()
export class CanvasShareService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // ── 主人侧 ───────────────────────────────────────────────
  /**
   * 新建分享：先冻结当前画布，再撤销该画布所有仍有效的旧链接。
   *
   * 为什么同一个画布只保留一条有效链接：分享地址一旦复制出去就脱离我方控制，
   * 若每次点"分享"都新增一条，"关闭分享"就得逐条撤销（漏一条就是永久可读）。
   * 重新分享使旧链接立即失效，语义单一且可解释。
   */
  async create(
    spaceId: string,
    canvasId: string,
    input: { expires_in_days: number; allow_clone: boolean },
  ) {
    const snapshot = await this.buildSnapshot(spaceId, canvasId);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expires_in_days * 24 * 3600 * 1000);

    await db.transaction(async (tx) => {
      await tx
        .update(canvasShares)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(canvasShares.canvasId, BigInt(snapshot.canvas_id)), isNull(canvasShares.revokedAt)));
      await tx.insert(canvasShares).values({
        id: newId(),
        canvasId: BigInt(snapshot.canvas_id),
        spaceId: BigInt(spaceId),
        token,
        snapshot: snapshot.data,
        allowClone: input.allow_clone,
        expiresAt,
      });
    });

    return {
      token,
      share_path: `/canvas/share/${token}`,
      expires_at: expiresAt.toISOString(),
      allow_clone: input.allow_clone,
      node_count: snapshot.data.nodes.length,
      file_count: snapshot.data.files.length,
      truncated: snapshot.data.truncated,
    };
  }

  /** 关闭分享：撤销全部有效链接（幂等；没有也返回 ok） */
  async close(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const revoked = await db
      .update(canvasShares)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(canvasShares.canvasId, canvas.id),
          eq(canvasShares.spaceId, canvas.spaceId),
          isNull(canvasShares.revokedAt),
        ),
      )
      .returning({ id: canvasShares.id });
    return { ok: true, closed: revoked.length };
  }

  /**
   * 刷新快照：保持同一个 token/过期时间，只把内容更新到画布当前状态。
   *
   * 分开于"重新分享"是因为主人可能只想把刚生成的图补进已有链接
   * （链接已经发在群里，换 token 等于让所有观众重新拿地址）。
   */
  async retry(spaceId: string, canvasId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [share] = await db
      .select()
      .from(canvasShares)
      .where(
        and(
          eq(canvasShares.canvasId, canvas.id),
          eq(canvasShares.spaceId, canvas.spaceId),
          isNull(canvasShares.revokedAt),
          gt(canvasShares.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(canvasShares.createdAt))
      .limit(1);
    if (!share) throw new AppError(ErrorCode.NOT_FOUND, "no active share for this canvas");

    const { data } = await this.buildSnapshot(spaceId, canvasId);
    await db
      .update(canvasShares)
      .set({ snapshot: data, updatedAt: new Date() })
      .where(eq(canvasShares.id, share.id));
    return {
      ok: true,
      token: share.token,
      share_path: `/canvas/share/${share.token}`,
      expires_at: share.expiresAt.toISOString(),
      allow_clone: share.allowClone,
      node_count: data.nodes.length,
      file_count: data.files.length,
      truncated: data.truncated,
      refreshed_at: new Date().toISOString(),
    };
  }

  // ── 公开侧（只认 token） ──────────────────────────────────
  async publicGet(token: string) {
    const { share, snapshot } = await this.mustGetPublicShare(token);
    return {
      share: {
        expires_at: share.expiresAt.toISOString(),
        allow_clone: share.allowClone,
      },
      canvas: {
        title: snapshot.canvas.title,
        version: snapshot.canvas.source_version,
        cover_url: await this.signUri(snapshot.canvas.cover),
        node_count: snapshot.nodes.length,
        file_count: snapshot.files.length,
        truncated: snapshot.truncated,
      },
      nodes: snapshot.nodes.map((node) => ({
        ...node,
        file_count: snapshot.files.filter((f) => f.node_id === node.id).length,
      })),
      edges: snapshot.edges,
      groups: snapshot.groups,
    };
  }

  /** 公开产物地址：每次请求现签，快照里不保存会过期的签名 URL */
  async publicFileUrls(token: string) {
    const { snapshot } = await this.mustGetPublicShare(token);
    const files = [];
    for (const file of snapshot.files) {
      const url = await this.signUri(file.uri);
      if (url) files.push({ node_id: file.node_id, kind: file.kind, url });
    }
    return { files, expires_in: URL_TTL_S, truncated: snapshot.truncated };
  }

  /** 缩略图：每个节点取第一张预览，没有预览就退回第一张结果（视频封面缺失时仍能显示） */
  async publicFileThumbs(token: string) {
    const { snapshot } = await this.mustGetPublicShare(token);
    const picked = new Map<string, CanvasShareFile>();
    for (const file of snapshot.files) {
      const current = picked.get(file.node_id);
      if (!current) picked.set(file.node_id, file);
      else if (current.kind === "result" && file.kind === "preview") picked.set(file.node_id, file);
    }
    const thumbs = [];
    for (const file of picked.values()) {
      const url = await this.signUri(file.uri);
      if (url) thumbs.push({ node_id: file.node_id, url });
    }
    return { thumbs, expires_in: URL_TTL_S };
  }

  // ── 内部 ────────────────────────────────────────────────
  private async mustGetCanvas(spaceId: string, canvasId: string) {
    const id = toBigId(canvasId, "canvas_id");
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, id), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    return canvas;
  }

  /**
   * 冻结当前画布。
   *
   * 返回里额外带 `canvas_id` 给调用方落库用；快照内部**不**存它
   * （公开响应没有理由出现画布内部 id，虽然它本身不算敏感）。
   */
  private async buildSnapshot(
    spaceId: string,
    canvasId: string,
  ): Promise<{ canvas_id: string; data: CanvasShareSnapshot }> {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const nodeRows = await db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)))
      .orderBy(asc(canvasNodes.zIndex), asc(canvasNodes.id))
      .limit(MAX_SHARE_NODES + 1);
    const truncated = nodeRows.length > MAX_SHARE_NODES;
    const kept = nodeRows.slice(0, MAX_SHARE_NODES);
    const keptIds = new Set(kept.map((n) => n.id));

    const [edgeRows, groupRows, coverRows] = await Promise.all([
      db
        .select()
        .from(canvasEdges)
        .where(eq(canvasEdges.canvasId, canvas.id))
        .orderBy(asc(canvasEdges.id))
        .limit(MAX_SHARE_EDGES + 1),
      db
        .select()
        .from(canvasGroups)
        .where(eq(canvasGroups.canvasId, canvas.id))
        .orderBy(asc(canvasGroups.sort), asc(canvasGroups.id))
        .limit(MAX_SHARE_NODES),
      canvas.coverAssetId
        ? db
            .select({ uri: assets.uri })
            .from(assets)
            .where(and(eq(assets.id, canvas.coverAssetId), isNull(assets.deletedAt)))
            .limit(1)
        : Promise.resolve([] as Array<{ uri: string }>),
    ]);

    const files: CanvasShareFile[] = [];
    const nodes: CanvasShareSnapshot["nodes"] = kept.map((node) => {
      const rawParams = isRecord(node.params) ? node.params : {};
      if (files.length < MAX_SHARE_FILES) {
        for (const file of collectFiles(String(node.id), rawParams)) {
          if (files.length >= MAX_SHARE_FILES) break;
          files.push(file);
        }
      }
      return {
        id: String(node.id),
        node_type: node.nodeType,
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        z_index: node.zIndex,
        status: node.status,
        group_ids: (node.groupIds ?? []).map((g) => String(g)),
        params: sanitizeParams(rawParams) as Record<string, unknown>,
      };
    });

    // 边的两端都必须被保留：快照被截断时，指向不存在节点的边会让公开页画出断头线
    const edges = edgeRows
      .slice(0, MAX_SHARE_EDGES)
      .filter((e) => keptIds.has(e.srcNodeId) && keptIds.has(e.dstNodeId))
      .map((e) => ({
        id: String(e.id),
        src_node_id: String(e.srcNodeId),
        dst_node_id: String(e.dstNodeId),
        semantic: e.semantic,
      }));

    const data: CanvasShareSnapshot = {
      format: 1,
      canvas: {
        title: canvas.title,
        source_version: canvas.version,
        cover: coverRows[0]?.uri ?? null,
      },
      nodes,
      edges,
      groups: groupRows.map((g) => ({
        id: String(g.id),
        parent_id: g.parentId ? String(g.parentId) : null,
        name: g.name,
        sort: g.sort,
        status: g.status,
      })),
      files,
      // 节点或边任一侧被上限截断，都要如实告诉公开页"还有更多没展示"
      truncated: truncated || edgeRows.length > MAX_SHARE_EDGES,
    };
    return { canvas_id: String(canvas.id), data };
  }

  /** 公开侧唯一的入口：令牌形状、撤销、过期、画布是否还在，全部在这一处判 */
  private async mustGetPublicShare(token: string) {
    if (!isShareToken(token)) throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    const [share] = await db.select().from(canvasShares).where(eq(canvasShares.token, token)).limit(1);
    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    // 画布被软删后，链接立即失效：分享的是"这张画布"，画布不在就没有可看的内容
    const [canvas] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(
        and(
          eq(canvases.id, share.canvasId),
          eq(canvases.spaceId, share.spaceId),
          isNull(canvases.deletedAt),
        ),
      )
      .limit(1);
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    return { share, snapshot: readShareSnapshot(share.snapshot) };
  }

  /** 存储 key 现签；http(s) 原样；其余协议（data:/mock:/blob:）公开侧无法保证可读，直接丢弃 */
  private async signUri(uri: string | null | undefined): Promise<string | null> {
    if (!uri) return null;
    if (/^https?:\/\//i.test(uri)) return uri;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null;
    return this.storage.signDownload(uri, URL_TTL_S).catch(() => null);
  }
}