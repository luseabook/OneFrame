import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canvasDownloadLists, canvasNodes } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";
import { env } from "../../config/env";
import { StorageService } from "../../storage/storage.service";
import { TasksService } from "../tasks/tasks.service";
import {
  fetchGuarded,
  resolveDownloadLimits,
  resolveUriPolicy,
  safeUriForLog,
  type CanvasDownloadPolicy,
  type DownloadLimits,
} from "./canvas-download.guard";

/** 打包上限：与 `tasks/batch-download` 对齐（≤50 项），避免一次请求拖垮进程 */
const MAX_NODES = 50;
/** 下载链接有效期：24h（契约 §3.5 `…/download/url` 明确写 24h） */
const URL_TTL_S = 86_400;

/**
 * 用户可控 URI 的拉取策略（PR-04 SSRF 收口，见 `canvas-download.guard.ts`）。
 *
 * 启动时从 env 解析一次：`env` 本身是启动即校验的常量，运行期改环境变量本来就不生效。
 * allowlist 未配置 = 只允许存储自身 host；内网/保留地址永远拒绝（白名单也放不进来）。
 */
const URI_POLICY: CanvasDownloadPolicy = resolveUriPolicy(env);
const DOWNLOAD_LIMITS: DownloadLimits = resolveDownloadLimits(env);

export interface DownloadListDto {
  download_list_id: string;
  canvas_id: string;
  node_count: number;
  file_count: number;
  filename: string;
  status: number;
  created_at: string;
}

@Injectable()
export class CanvasDownloadService {
  private readonly logger = new Logger("canvas.download");

  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  /**
   * 打包选中节点的产物。
   *
   * 为什么"打包"同步做、而链接单独现签：文件是用户已经付过费生成出来的，
   * 打包只是把它们收拢；同步做能把"某个文件读不到"当场跳过并记进 manifest，
   * 而不是丢一个后台任务让用户等一个可能永远不完成的下载单。
   */
  async create(
    spaceId: string,
    canvasId: string,
    userId: string,
    nodeIds: string[],
  ): Promise<DownloadListDto> {
    if (nodeIds.length === 0 || nodeIds.length > MAX_NODES) {
      throw new AppError(ErrorCode.INVALID_PARAM, `node_ids must be 1..${MAX_NODES}`, {
        field: "node_ids",
      });
    }
    let cid: bigint;
    try {
      cid = toBigId(canvasId, "canvas_id");
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid canvas_id", { field: "canvas_id" });
    }
    const ids = nodeIds.map((raw) => {
      try {
        return BigInt(raw);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid node id", { field: "node_ids", value: raw });
      }
    });

    const nodes = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.canvasId, cid),
          eq(canvasNodes.spaceId, BigInt(spaceId)),
          inArray(canvasNodes.id, ids),
          isNull(canvasNodes.deletedAt),
        ),
      );
    if (nodes.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, "nodes not found in this canvas", { canvas_id: canvasId });
    }

    // 节点自身可能还没把结果写进 params（老数据/worker 只写了 tasks.results），
    // 所以缺产物时回查一次任务结果——两条来源都是真实数据，不是猜测
    const taskIds = nodes
      .map((node) => node.taskId)
      .filter((id): id is bigint => id !== null)
      .map((id) => String(id));
    const taskResults = new Map<string, string[]>();
    if (taskIds.length > 0) {
      const rows = await this.tasks.getMany(spaceId, taskIds);
      for (const row of rows) {
        const results = Array.isArray(row.results) ? (row.results as Array<{ uri?: string }>) : [];
        const uris = results.map((item) => item.uri).filter((uri): uri is string => !!uri);
        if (uris.length > 0) taskResults.set(row.task_id, uris);
      }
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const manifest: Array<{ node_id: string; node_type: string; name: string; files: string[] }> = [];
    let fileCount = 0;

    for (const node of nodes) {
      const params = (node.params ?? {}) as Record<string, unknown>;
      const uris = this.collectUris(params, node.taskId === null ? [] : (taskResults.get(String(node.taskId)) ?? []));
      const files: string[] = [];
      for (const [index, uri] of uris.entries()) {
        try {
          const data = await this.readUri(spaceId, uri);
          if (!data) continue;
          const ext = (uri.split("?")[0] ?? "").split(".").pop()?.toLowerCase() || "bin";
          const filename = `${node.nodeType}-${node.id}-${index + 1}.${ext}`;
          zip.file(filename, data);
          files.push(filename);
          fileCount += 1;
        } catch (error) {
          // 单个文件读不到不阻断整包：manifest 里会缺这一条，用户至少能拿到别的。
          // 但**被守卫拒绝必须留痕**：静默吞掉会让"有人在探测内网"这件事永远不可见。
          this.logSkip(node.id, uri, error);
        }
      }
      manifest.push({
        node_id: String(node.id),
        node_type: node.nodeType,
        name: node.name,
        files,
      });
    }

    if (fileCount === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "selected nodes have no downloadable results yet", {
        field: "node_ids",
      });
    }

    zip.file(
      "manifest.json",
      JSON.stringify(
        { generated_at: new Date().toISOString(), canvas_id: canvasId, nodes: manifest },
        null,
        2,
      ),
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const objectKey = `u/${spaceId}/canvas-downloads/${newId()}.zip`;
    await this.storage.put(spaceId, objectKey, buffer, "application/zip");

    const [row] = await db
      .insert(canvasDownloadLists)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        canvasId: cid,
        nodeCount: nodes.length,
        fileCount,
        objectKey,
        filename: `canvas-${canvasId}-${fileCount}.zip`,
        status: 2,
        createdBy: BigInt(userId),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "download list create failed");
    return this.toDto(row);
  }

  async list(
    spaceId: string,
    canvasId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ list: DownloadListDto[]; total: number; page: number; page_size: number }> {
    const size = Math.min(Math.max(1, pageSize), 100);
    const offset = (Math.max(1, page) - 1) * size;
    const where = and(
      eq(canvasDownloadLists.spaceId, BigInt(spaceId)),
      eq(canvasDownloadLists.canvasId, toBigId(canvasId, "canvas_id")),
    );
    const rows = await db
      .select()
      .from(canvasDownloadLists)
      .where(where)
      .orderBy(desc(canvasDownloadLists.createdAt))
      .limit(size)
      .offset(offset);
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(canvasDownloadLists)
      .where(where);
    return {
      list: rows.map((row) => this.toDto(row)),
      total: countRow?.total ?? 0,
      page: Math.max(1, page),
      page_size: size,
    };
  }

  /** 现签链接：只存 object_key，每次取都给一条新的（旧链接过期不影响下载单本身） */
  async url(
    spaceId: string,
    canvasId: string,
    listId: string,
  ): Promise<{ url: string; filename: string; file_count: number; expires_in: number }> {
    let id: bigint;
    try {
      id = BigInt(listId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid download_list_id", {
        field: "download_list_id",
      });
    }
    const [row] = await db
      .select()
      .from(canvasDownloadLists)
      .where(
        and(
          eq(canvasDownloadLists.id, id),
          eq(canvasDownloadLists.spaceId, BigInt(spaceId)),
          eq(canvasDownloadLists.canvasId, toBigId(canvasId, "canvas_id")),
        ),
      );
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, "download list not found", { download_list_id: listId });
    }
    if (row.status === 3) {
      throw new AppError(ErrorCode.NOT_FOUND, "download list failed, please repack", {
        download_list_id: listId,
      });
    }
    const url = await this.storage.signDownload(spaceId, row.objectKey, URL_TTL_S);
    return { url, filename: row.filename, file_count: row.fileCount, expires_in: URL_TTL_S };
  }

  /** 产物 URI 的两级来源：节点 params 优先，缺失时用任务结果兜底（去重保序） */
  private collectUris(params: Record<string, unknown>, fromTask: string[]): string[] {
    const out: string[] = [];
    const push = (uri: unknown): void => {
      if (typeof uri === "string" && uri && !out.includes(uri)) out.push(uri);
    };
    const list = params.result_uris;
    if (Array.isArray(list)) list.forEach(push);
    push(params.result_uri);
    if (out.length === 0) {
      fromTask.forEach(push);
      // 连正式结果都没有时才退回预览图：预览是缩略图，不该冒充产物
      push(params.result_preview_uri);
    }
    return out;
  }

  /**
   * 拉取一条产物 URI（PR-04）。
   *
   * http(s) 一律走 `fetchGuarded`：协议白名单 → host 白名单（未配置=仅存储 host）
   * → IP/DNS 内网黑名单 → 10s 超时 → 流式大小上限 → 3xx 逐跳复检。
   * 其它带协议的形态（`mock://` 等）不是真实文件，返回 null 由调用方跳过；
   * 无协议的相对 key 才是自有存储对象，走 `storage.read`（不经过网络）。
   */
  private async readUri(spaceId: string, uri: string): Promise<Buffer | null> {
    if (/^https?:\/\//i.test(uri)) {
      return fetchGuarded(uri, URI_POLICY, DOWNLOAD_LIMITS);
    }
    // 其他协议（mock:// 等）不是真实文件，跳过而不是塞一个空文件进去
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null;
    return this.storage.read(spaceId, uri);
  }

  /**
   * 跳过产物的日志：只记 node_id / 原因 / host，**不打印 URI 的 query**（签名参数不进日志）。
   * 业务错误（守卫拒绝）用 warn 且带 `reason`，便于按原因聚合并发现探测行为。
   */
  private logSkip(nodeId: bigint, uri: string, error: unknown): void {
    const target = safeUriForLog(uri);
    if (error instanceof AppError) {
      const details = (error.details ?? {}) as { reason?: unknown; host?: unknown; status?: unknown };
      this.logger.warn(
        `canvas-download skip node=${String(nodeId)} uri=${target} code=${error.code}` +
          ` reason=${typeof details.reason === "string" ? details.reason : "-"}` +
          ` host=${typeof details.host === "string" ? details.host : "-"}` +
          (typeof details.status === "number" ? ` status=${details.status}` : ""),
      );
      return;
    }
    this.logger.warn(
      `canvas-download skip node=${String(nodeId)} uri=${target} reason=read_failed error=${
        error instanceof Error ? error.name : "unknown"
      }`,
    );
  }

  private toDto(row: typeof canvasDownloadLists.$inferSelect): DownloadListDto {
    return {
      download_list_id: String(row.id),
      canvas_id: String(row.canvasId),
      node_count: row.nodeCount,
      file_count: row.fileCount,
      filename: row.filename,
      status: row.status,
      created_at: row.createdAt.toISOString(),
    };
  }
}
