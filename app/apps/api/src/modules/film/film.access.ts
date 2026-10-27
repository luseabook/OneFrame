import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { filmTables, filmTasks, spaces } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { TeamService, type TeamContext } from "../team/team.service";

/**
 * 影视版（film）域鉴权闸门 —— 契约 §3.2 的四层校验。
 *
 * 层序不可交换（fail-fast，且**不泄露下层存在性**）：
 *   L0 功能准入 `spaces.film_enabled` → 403 + reason=film_not_enabled
 *   L2 空间成员 `space_members`        → 403 + reason=not_member
 *   L3 角色特权（仅写管理类动作）      → 403 + reason=role_insufficient
 *   L4 资源作用域（表/行必须属于本 space）→ 400102（统一"不存在"，不泄露跨租户存在性）
 *
 * 为什么 L0 要单独一层：参照产品对 film 域**零 permission_code 映射**，影视版是
 * 商务开通制（`GET /func-whitelist?scene=ai_film`），所以"有没有这个功能"先于
 * "你能干什么"。把两件事压成一个 403 会让前端无法区分「去联系商务」与「找管理员要权限」。
 *
 * 为什么 film 没有细粒度权限码：契约 §7 A4 已取证（RE 侧 156 条 route→perm 映射里
 * 0 条 /film/*）。故本域口径是：**读=成员，写=成员，删除/导出/批量改派=管理特权**
 * （对齐竞品"影视版成员都能编辑任务表，只有管理动作受限"的事实，见 §1.3 注）。
 */

/** 写操作的三档强度：read(成员) / write(成员) / manage(团队特权) */
export type FilmGate = "read" | "write" | "manage";

export interface FilmTableRow {
  id: bigint;
  spaceId: bigint;
  projectId: bigint;
  name: string;
  isPreset: boolean;
  sort: number;
  version: number;
}

export interface FilmTaskRow {
  id: bigint;
  tableId: bigint;
  spaceId: bigint;
  parentId: bigint | null;
  sort: number;
  version: number;
  status: number;
  title: string;
  reviewVersionNo: number;
  assigneeUserId: bigint | null;
  createdBy: bigint | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FilmAccessService {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  /**
   * L0 + L2 (+L3) 一次性闸门。所有 film 端点入口调用。
   *
   * 返回 TeamContext 给上层做后续判定（例如 notify 要校验被通知者是否成员）。
   */
  async gate(spaceId: string, userId: string, need: FilmGate = "read"): Promise<TeamContext> {
    await this.requireFilmEnabled(spaceId);
    const ctx = await this.team.requireMember(spaceId, userId);
    if (need === "manage") this.team.requirePrivilege(ctx, "film.manage");
    return ctx;
  }

  /**
   * L0：影视版功能准入。
   *
   * 未开通一律 403（不是 404）：前端要据此显示「联系商务开通」引导页，
   * 404 会被前端当成"路径写错"，引导位就出不来。
   * 用 `data.reason` 区分，与 `func-whitelist` 端点同源（同一个 `spaces.film_enabled` 列）。
   */
  async requireFilmEnabled(spaceId: string): Promise<void> {
    const [row] = await db
      .select({ filmEnabled: spaces.filmEnabled })
      .from(spaces)
      .where(eq(spaces.id, BigInt(spaceId)))
      .limit(1);
    if (!row) {
      // space 不存在时不区分"不存在"与"未开通"，避免探测他人空间
      throw new AppError(ErrorCode.FORBIDDEN, "film not enabled for this space", {
        reason: "film_not_enabled",
      });
    }
    if (row.filmEnabled !== 1) {
      throw new AppError(ErrorCode.FORBIDDEN, "film not enabled for this space", {
        reason: "film_not_enabled",
      });
    }
  }

  /** `func-whitelist?scene=ai_film` 的判定本体（不抛错，返回布尔） */
  async isFilmEnabled(spaceId: string): Promise<boolean> {
    if (!spaceId) return false;
    const [row] = await db
      .select({ filmEnabled: spaces.filmEnabled })
      .from(spaces)
      .where(eq(spaces.id, BigInt(spaceId)))
      .limit(1);
    return row?.filmEnabled === 1;
  }

  /**
   * L4：任务表必须存在、属于本 space、且未被逻辑删除。
   *
   * 跨 space 一律 `400102 NOT_FOUND`（不是 403）——沿用 `api-spec.md:407` 的既有口径：
   * 403 等于承认"这个 id 在别的团队真的存在"，那是租户结构泄露。
   */
  async requireTable(spaceId: string, tableId: string | bigint): Promise<FilmTableRow> {
    const id = typeof tableId === "bigint" ? tableId : BigInt(tableId);
    const [row] = await db
      .select()
      .from(filmTables)
      .where(and(eq(filmTables.id, id), eq(filmTables.spaceId, BigInt(spaceId))))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task table not found");
    return row as FilmTableRow;
  }

  /**
   * L4：行必须属于该表，且默认排除软删行。
   *
   * `allowDeleted` 只给 `batch-restore` 用（它必须能读到已删行）。
   */
  async requireTask(
    table: FilmTableRow,
    taskId: string | bigint,
    opts: { allowDeleted?: boolean } = {},
  ): Promise<FilmTaskRow> {
    const id = typeof taskId === "bigint" ? taskId : BigInt(taskId);
    const conds = [eq(filmTasks.id, id), eq(filmTasks.tableId, table.id)];
    if (!opts.allowDeleted) conds.push(isNull(filmTasks.deletedAt));
    const [row] = await db
      .select()
      .from(filmTasks)
      .where(and(...conds))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "film task not found");
    return row as FilmTaskRow;
  }

  /**
   * 项目作用域（L4 的项目层）。
   *
   * ⚠️ 数据层现状（诚实登记，见 `_acceptance/_team/report-film.md`）：`film_projects`
   * 表尚未建，`film_tables.project_id` 是**不透明 ID 且无 FK**（schema.ts schema 注释：
   * "film 项目本体表随第 5 批端点一起建"）。因此项目存在性只能从既有事实反推：
   *   - 该项目已有表 → 必须全部落在本 space（否则 400102）
   *   - 该项目还没有任何表 → 允许建第一张表（这就是"隐式创建项目"）
   * 这样跨租户读别人的 project_id 只会拿到空列表，不会泄露。
   */
  async assertProjectScope(spaceId: string, projectId: string): Promise<void> {
    const [foreign] = await db
      .select({ id: filmTables.id })
      .from(filmTables)
      .where(and(eq(filmTables.projectId, BigInt(projectId))))
      .limit(1);
    if (foreign) {
      const [own] = await db
        .select({ id: filmTables.id })
        .from(filmTables)
        .where(and(eq(filmTables.projectId, BigInt(projectId)), eq(filmTables.spaceId, BigInt(spaceId))))
        .limit(1);
      if (!own) throw new AppError(ErrorCode.NOT_FOUND, "film project not found");
    }
  }
}
