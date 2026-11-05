import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { models } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";

export interface ResolutionOption {
  value: string;
  label: string;
}

export interface ModeConfig {
  endpoint?: string;
  ratios?: string[];
  durations?: number[];
  default_duration?: number;
  resolution_options?: ResolutionOption[];
  resolutions?: string[];
  default_resolution?: string;
  counts?: number[];
  default_count?: number;
  media_limits?: Record<string, number>;
  mouth_drive?: string;
  off_peak?: boolean;
}

export type ModelRow = typeof models.$inferSelect;

export interface ModelDto {
  name: string;
  display_name: string;
  vendor: string;
  types: string[];
  need_vip: boolean;
  sort: number;
  visible: boolean;
  description: string;
  logo: string;
  tags: unknown;
  promotions: unknown;
  audio_video_support: boolean;
  mode_order: Record<string, number>;
  modes: Record<string, ModeConfig>;
  scene_modes: Record<string, unknown>;
  /** hosted | byoc | either（docs/02-architecture/autodl-integration.md §2.7） */
  compute_source: string;
}

export interface ModelFilters {
  capability?: string;
  mode?: string;
  visible?: boolean;
}

@Injectable()
export class ModelsService {
  /**
   * 列出用户可选的模型。
   *
   * `visible` 缺省时**只返回可见模型**（而不是返回全部行）：目录里有内部能力行
   * （工具箱的 `toolbox-*`，`visible=false`），它们有 models 行只是为了满足
   * `tasks.model_id` 的外键与计价维度，绝不该出现在任何模型选择器里。
   * 显式传 `visible=false` 仍能拿到内部行（运营排查用）。
   */
  async list(filters: ModelFilters): Promise<ModelDto[]> {
    const rows = await db.select().from(models).orderBy(models.sort);
    return rows
      .filter((row) => (filters.visible === undefined ? row.visible : row.visible === filters.visible))
      .filter((row) => (filters.capability ? row.capability === filters.capability : true))
      .filter((row) => {
        if (!filters.mode) return true;
        const modes = row.modes as Record<string, ModeConfig>;
        return Object.prototype.hasOwnProperty.call(modes, filters.mode);
      })
      .map((row) => this.toDto(row));
  }

  /**
   * 按协议名取模型（内部计价/编排入口）。
   *
   * 这里**不过滤 visible**：`credits.price()`、画布节点派生、Agent 投递都靠它按名
   * 解析模型行，其中包含 `visible=false` 的内部能力行（工具箱）。用户可见性由
   * `list()` 与 `GET /models` 控制——用户拿不到不可见模型的名字，就没法自己选到它。
   * 若这里也按 visible 拦，工具箱任务会直接 "model not found"，表单能填但投不出去。
   */
  async findByName(name: string): Promise<ModelRow> {
    const [row] = await db.select().from(models).where(eq(models.name, name));
    if (!row) {
      throw new AppError(ErrorCode.INVALID_PARAM, `model not found: ${name}`, { field: "model" });
    }
    return row;
  }

  async findById(id: bigint): Promise<ModelRow> {
    const [row] = await db.select().from(models).where(eq(models.id, id));
    if (!row) throw new AppError(ErrorCode.INVALID_PARAM, `model not found: ${id}`, { field: "model" });
    return row;
  }

  toDto(row: ModelRow): ModelDto {
    return {
      name: row.name,
      display_name: row.displayName,
      vendor: row.vendor,
      types: row.types,
      need_vip: row.needVip,
      sort: row.sort,
      visible: row.visible,
      description: row.description,
      logo: row.logo,
      tags: row.tags,
      promotions: row.promotions,
      audio_video_support: row.audioVideoSupport,
      mode_order: row.modeOrder as Record<string, number>,
      modes: row.modes as Record<string, ModeConfig>,
      scene_modes: row.sceneModes as Record<string, unknown>,
      compute_source: row.computeSource,
    };
  }
}
