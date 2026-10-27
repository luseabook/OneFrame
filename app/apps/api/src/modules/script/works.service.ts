import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

/**
 * 全部项目聚合（`GET /works`）—— 工坊项目 + 无限画布项目。
 *
 * 竞品证据：`_acceptance/_gap/fullsite-route-inventory.md:81`（ReelFlow/作品清单口径）；
 * 竞品「全部项目」页把**剧集项目与画布项目**放在同一个清单里（项目 → 作品，画布 → 画布项目），
 * 两套 ID 不同但都是"我的创作"，所以这里聚合的是"我的创作集合"而不是单一域的表。
 *
 * 两条约束：
 * 1. **跨域只读投影**：画布侧只 select `canvases` / `canvas_nodes`，不 import CanvasModule 的
 *    服务、不写任何画布数据（避免两个域互相依赖、也避免作品页出现隐式写）；
 * 2. **工坊侧口径与原 `GET /works` 完全一致**：`episode_count / shot_count / done_count /
 *    work_state` 不变（前端作品墙与既有验收截图都依赖它）；筛选下沉到 SQL ——
 *    在内存里过滤会让分页 `total` 与 `list` 对不上。
 */

export type WorkTab = "workshop" | "canvas" | "all";

export interface WorksQuery {
  tab?: WorkTab;
  /** 形态筛选（与 tab 等价，保留 filter 语义供前端 URL 直传） */
  kind?: "workshop" | "canvas";
  /** 归档维度：archived / active（默认 active）/ all */
  status?: "archived" | "active" | "all";
  /** 作品四态：draft / producing / ready / archived */
  state?: "draft" | "producing" | "ready" | "archived";
  keyword?: string;
  /** 最后更新时间区间（ISO 时间字符串） */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

interface WorkshopRow {
  id: string;
  title: string;
  genre: string | null;
  drama_type: string | null;
  ratio: string | null;
  source_type: number | null;
  source_file_name: string | null;
  source_text: string | null;
  status: number | null;
  archived_at: string | null;
  is_sample: number | null;
  created_at: string;
  updated_at: string;
  episode_count: number;
  shot_count: number;
  done_count: number;
  cover_uri: string | null;
  portrait_uri: string | null;
  timeline_duration_s: number;
  timeline_episode_count: number;
  work_state: string;
}

interface CanvasRow {
  id: string;
  title: string;
  creation_mode: number;
  created_at: string;
  updated_at: string;
  node_count: number;
  running_nodes: number;
  failed_nodes: number;
}

@Injectable()
export class WorksService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async list(spaceId: string, opts: WorksQuery = {}) {
    const tab: WorkTab = opts.kind ?? opts.tab ?? "workshop";
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(60, Math.max(1, opts.pageSize ?? 24));
    const status = opts.status ?? "active";

    if (tab === "all") {
      // 两种形态各自取到当前页末尾再归并排序（作品量级在百级，内存归并可控）
      const [workshop, canvas] = await Promise.all([
        this.queryWorkshop(spaceId, opts, status, 1, page * pageSize),
        this.queryCanvas(spaceId, opts, status, 1, page * pageSize),
      ]);
      const merged = [...workshop.rows, ...canvas.rows].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      const start = (page - 1) * pageSize;
      const total = workshop.total + canvas.total;
      return {
        list: merged.slice(start, start + pageSize),
        total,
        page,
        page_size: pageSize,
        has_more: total > page * pageSize,
        tabs: { workshop: workshop.total, canvas: canvas.total },
      };
    }

    if (tab === "canvas") {
      const canvas = await this.queryCanvas(spaceId, opts, status, page, pageSize);
      return {
        list: canvas.rows,
        total: canvas.total,
        page,
        page_size: pageSize,
        has_more: canvas.total > page * pageSize,
        tabs: { workshop: 0, canvas: canvas.total },
      };
    }

    const workshop = await this.queryWorkshop(spaceId, opts, status, page, pageSize);
    return {
      list: workshop.rows,
      total: workshop.total,
      page,
      page_size: pageSize,
      has_more: workshop.total > page * pageSize,
      tabs: { workshop: workshop.total, canvas: 0 },
    };
  }

  /** 工坊侧筛选：归档 / 关键词 / 时间 / 四态 */
  private workshopWhere(opts: WorksQuery, status: "archived" | "active" | "all"): SQL | undefined {
    const clauses: SQL[] = [];
    if (status === "archived") clauses.push(sql`archived_at is not null`);
    if (status === "active") clauses.push(sql`archived_at is null`);
    if (opts.keyword && opts.keyword.trim()) clauses.push(sql`title ilike ${`%${opts.keyword.trim()}%`}`);
    if (opts.from) clauses.push(sql`updated_at >= ${opts.from}::timestamptz`);
    if (opts.to) clauses.push(sql`updated_at <= ${opts.to}::timestamptz`);
    if (opts.state) clauses.push(sql`work_state = ${opts.state}`);
    return clauses.length > 0 ? sql.join(clauses, sql` and `) : undefined;
  }

  /**
   * 画布侧筛选：只有关键词与时间。
   * 画布没有"归档"与"四态"概念 → 归档视图下画布侧必然为空；
   * 按四态筛（draft/producing/ready）时画布不参与（它的 work_state 恒为 canvas）。
   */
  private canvasFilterable(opts: WorksQuery, status: "archived" | "active" | "all"): boolean {
    if (status === "archived") return false;
    if (opts.state && opts.state !== "archived") return false;
    return true;
  }

  private canvasWhere(opts: WorksQuery): SQL | undefined {
    const clauses: SQL[] = [];
    if (opts.keyword && opts.keyword.trim()) clauses.push(sql`title ilike ${`%${opts.keyword.trim()}%`}`);
    if (opts.from) clauses.push(sql`updated_at >= ${opts.from}::timestamptz`);
    if (opts.to) clauses.push(sql`updated_at <= ${opts.to}::timestamptz`);
    return clauses.length > 0 ? sql.join(clauses, sql` and `) : undefined;
  }

  /**
   * 工坊侧：与原 `listWorks` 同一套聚合口径，外面套一层把 `work_state` 算出来，
   * 让状态筛选能进 SQL（否则分页总数与列表对不上）。
   */
  private async queryWorkshop(
    spaceId: string,
    opts: WorksQuery,
    status: "archived" | "active" | "all",
    page: number,
    pageSize: number,
  ) {
    const where = this.workshopWhere(opts, status);
    const base = sql`
      with base as (
        select p.id::text as id, p.title, p.genre, p.drama_type, p.ratio, p.source_type,
               p.source_file_name, p.source_text, p.status,
               p.archived_at, p.is_sample, p.created_at, p.updated_at,
               (select count(*)::int from episodes e where e.project_id = p.id) as episode_count,
               (select count(*)::int
                  from storyboards s
                  join episodes e2 on e2.id = s.episode_id
                 where e2.project_id = p.id) as shot_count,
               (select count(*)::int
                  from tasks t
                  join storyboards s2 on s2.id = t.shot_id
                  join episodes e3 on e3.id = s2.episode_id
                 where e3.project_id = p.id and t.status = 3) as done_count,
               (select a.uri
                  from assets a
                  join tasks t3 on t3.id::text = (a.meta->>'task_id')
                  join storyboards s4 on s4.id = t3.shot_id
                  join episodes e5 on e5.id = s4.episode_id
                 where e5.project_id = p.id and a.deleted_at is null
                   and coalesce(a.meta->>'content_type', '') like 'image/%'
                 order by a.id desc limit 1) as cover_uri,
               (select ast.uri
                  from assets ast
                  join project_assets pa on pa.portrait_asset_id = ast.id
                 where pa.project_id = p.id and ast.deleted_at is null
                 order by ast.id desc limit 1) as portrait_uri,
               coalesce((
                 select sum(coalesce((c->>'duration')::numeric, 0))::int
                   from project_timelines pt
                   cross join lateral jsonb_array_elements(pt.clips) c
                  where pt.project_id = p.id
               ), 0) as timeline_duration_s,
               (select count(*)::int from project_timelines pt2 where pt2.project_id = p.id)
                 as timeline_episode_count
          from script_projects p
         where p.space_id = ${BigInt(spaceId)}
      ),
      scored as (
        select *,
               (case
                  when archived_at is not null then 'archived'
                  when shot_count = 0 then 'draft'
                  when done_count > 0 and done_count >= shot_count then 'ready'
                  else 'producing'
                end) as work_state
          from base
      )
      select * from scored
    `;
    const rowsQuery = sql`${base} ${
      where ? sql`where ${where}` : sql``
    } order by updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const countQuery = sql`select count(*)::int as count from (${base} ${
      where ? sql`where ${where}` : sql``
    }) t`;
    const [rowsResult, countResult] = await Promise.all([db.execute(rowsQuery), db.execute(countQuery)]);
    const rows = (((rowsResult as unknown) as { rows?: WorkshopRow[] }).rows ?? []) as WorkshopRow[];
    const total = Number((((countResult as unknown) as { rows?: Array<{ count: number }> }).rows ?? [])[0]?.count ?? 0);
    return { rows: await Promise.all(rows.map((row) => this.workshopDto(row))), total };
  }

  private async workshopDto(row: WorkshopRow) {
    const coverKey = row.cover_uri ?? row.portrait_uri ?? null;
    const coverUrl = coverKey
      ? await this.storage.signDownload(coverKey, 3600).catch(() => null)
      : null;
    return {
      id: row.id,
      kind: "workshop" as const,
      title: row.title,
      genre: row.genre,
      ratio: row.ratio,
      drama_type: row.drama_type,
      source_type: row.source_type,
      source_file_name: row.source_file_name,
      source_text: row.source_text,
      status: row.status,
      archived_at: row.archived_at,
      is_sample: row.is_sample === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      episode_count: Number(row.episode_count ?? 0),
      shot_count: Number(row.shot_count ?? 0),
      done_count: Number(row.done_count ?? 0),
      cover_uri: coverUrl,
      timeline_duration_s: Number(row.timeline_duration_s ?? 0),
      timeline_episode_count: Number(row.timeline_episode_count ?? 0),
      work_state: row.work_state,
      // 画布侧字段：工坊项目显式给 null，前端一处渲染
      node_count: null as number | null,
      creation_mode: null as number | null,
      running_nodes: null as number | null,
      failed_nodes: null as number | null,
    };
  }

  private async queryCanvas(
    spaceId: string,
    opts: WorksQuery,
    status: "archived" | "active" | "all",
    page: number,
    pageSize: number,
  ) {
    if (!this.canvasFilterable(opts, status)) return { rows: [], total: 0 };
    const where = this.canvasWhere(opts);
    const base = sql`
      with base as (
        select c.id::text as id, c.title, c.creation_mode, c.created_at, c.updated_at,
               (select count(*)::int from canvas_nodes n where n.canvas_id = c.id) as node_count,
               (select count(*)::int from canvas_nodes n2 where n2.canvas_id = c.id and n2.status = 2)
                 as running_nodes,
               (select count(*)::int from canvas_nodes n3 where n3.canvas_id = c.id and n3.status = 3)
                 as failed_nodes
          from canvases c
         where c.space_id = ${BigInt(spaceId)} and c.deleted_at is null
      )
      select * from base
    `;
    const rowsQuery = sql`${base} ${
      where ? sql`where ${where}` : sql``
    } order by updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const countQuery = sql`select count(*)::int as count from (${base} ${
      where ? sql`where ${where}` : sql``
    }) t`;
    const [rowsResult, countResult] = await Promise.all([db.execute(rowsQuery), db.execute(countQuery)]);
    const rows = (((rowsResult as unknown) as { rows?: CanvasRow[] }).rows ?? []) as CanvasRow[];
    const total = Number((((countResult as unknown) as { rows?: Array<{ count: number }> }).rows ?? [])[0]?.count ?? 0);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        kind: "canvas" as const,
        title: row.title,
        genre: null,
        ratio: null,
        drama_type: null,
        source_type: null,
        source_file_name: null,
        source_text: null,
        status: null,
        archived_at: null,
        is_sample: false,
        created_at: row.created_at,
        updated_at: row.updated_at,
        episode_count: 0,
        shot_count: Number(row.node_count ?? 0),
        done_count: 0,
        cover_uri: null,
        timeline_duration_s: 0,
        timeline_episode_count: 0,
        work_state: "canvas",
        node_count: Number(row.node_count ?? 0),
        creation_mode: row.creation_mode,
        running_nodes: Number(row.running_nodes ?? 0),
        failed_nodes: Number(row.failed_nodes ?? 0),
      })),
      total,
    };
  }
}


