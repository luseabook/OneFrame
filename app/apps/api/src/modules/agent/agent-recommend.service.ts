import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { agentSessions, agentSkills, assets, scriptProjects } from "@app/db";
import { db } from "../../db/database";
import { AgentSkillsService } from "./agent-skills.service";
import {
  DEFAULT_RECOMMEND_SLUGS,
  categoryLabel,
  categoryTag,
} from "./agent-skills.catalog";

/**
 * 推荐卡（竞品 `GET /df/canvas/agent-recommend-cards`，`routes.txt:378`）。
 *
 * 竞品形状（`d-canvas-agent.md:342-346`，证据 `CpJ9@zXe()`）：
 * `{recommend_id, title, description, preset_prompt, tag, tag_label, skills[{skill_id, skill_name, skill_name_en}], cover_file_id}`，
 * `tag ∈ 1批量生图 / 2视频制作 / 3剧本创作 / 4skill / 5自定义`，缺省标签「推荐」。
 * 竞品远端为空时给 4 张硬编码兜底卡（`CpJ9@HXe`）：一键成片 / 人物多视角 / 第一人称短片 / 武侠短片。
 *
 * 我方语义（**推断 + 合理外推**，已登记待取证）：竞品这条接口"无参数"，
 * 说明服务端按登录空间自身状态选卡；我们用同一思路，信号取**本空间最近 30 天**：
 * - 最近项目（`script_projects`）→ 剧本/分镜类卡；
 * - 最近资产（`assets` 按 kind 计数）→ 视频/图像类卡；
 * - 最近会话（`agent_sessions`）→ 有对话史则优先"续作"类卡。
 * 没有任何信号 → 竞品那 4 张兜底卡。
 *
 * 硬约束：`skills[].skill_id` 必须是**真实存在的卡**（推荐卡要能点开即用），
 * 目录里查不到 slug 的模板整张丢弃，绝不编 id。
 */

export interface RecommendSkillRef {
  skill_id: string;
  skill_name: string;
  skill_name_en: string;
}

export interface RecommendCardDto {
  recommend_id: string;
  title: string;
  description: string;
  preset_prompt: string;
  /** 1 批量生图 / 2 视频制作 / 3 剧本创作 / 4 skill / 5 自定义 */
  tag: number;
  tag_label: string;
  skills: RecommendSkillRef[];
  /** 竞品字段：封面文件 id；我方暂无封面位，固定 null（前端用 tag 图标） */
  cover_file_id: string | null;
}

export interface RecommendResult {
  list: RecommendCardDto[];
  /** signals = 按空间状态选卡；default = 竞品兜底 4 张 */
  source: "signals" | "default";
  signals: {
    recent_project_count: number;
    recent_asset_count: number;
    recent_image_count: number;
    recent_video_count: number;
    recent_session_count: number;
  };
}

interface RecommendTemplate {
  id: string;
  title: string;
  /** 竞品卡片标题之外的一句话卖点（我方自拟文案） */
  description: string;
  slugs: string[];
}

/** 模板目录：每条都必须能落到真实卡上；顺序即优先级 */
const TEMPLATES: RecommendTemplate[] = [
  {
    id: "video_oneshot",
    title: "一键成片",
    description: "一句描述直接出 5~10 秒成片，自动补镜头语言与运镜。",
    slugs: ["video-oneshot", "one-line-film-director"],
  },
  {
    id: "character_multiview",
    title: "人物多视角",
    description: "同一角色的四视角设定图，保证跨镜发型服装一致。",
    slugs: ["character-multiview-sheet"],
  },
  {
    id: "first_person_short",
    title: "第一人称短片",
    description: "主观视角 + 手持呼吸感，适合沉浸式叙事开场。",
    slugs: ["first-person-immersive-video"],
  },
  {
    id: "wuxia_short",
    title: "武侠短片",
    description: "一句话武侠场景 → 导演级分镜与 15 秒成片。",
    slugs: ["wuxia-one-line-film-director"],
  },
  {
    id: "novel_to_script",
    title: "小说转剧本",
    description: "把小说片段直接转成场景/动作/对白的标准剧本格式。",
    slugs: ["novel-to-script", "episode-splitter"],
  },
  {
    id: "storyboard",
    title: "分镜拆解",
    description: "剧本一键拆成可拍摄分镜表：镜号、景别、机位、时长。",
    slugs: ["storyboard-breakdown", "shot-list-generator"],
  },
];

/** 信号窗口：只关心"最近在做的事"，30 天前的项目不再影响推荐位 */
const RECENT_DAYS = 30;
const MIN_CARDS = 3;
const MAX_CARDS = 6;

@Injectable()
export class AgentRecommendService {
  constructor(@Inject(AgentSkillsService) private readonly skills: AgentSkillsService) {}

  async cards(spaceId: string): Promise<RecommendResult> {
    // 推荐必须挂在真实卡上：先确保目录已就位
    await this.skills.ensureCatalog();
    const signals = await this.collectSignals(spaceId);
    const hasSignal =
      signals.recent_project_count > 0 ||
      signals.recent_asset_count > 0 ||
      signals.recent_session_count > 0;

    const templateIds = hasSignal ? this.pickBySignals(signals) : [];
    const resolved = await this.resolve(templateIds);
    if (resolved.length >= MIN_CARDS) {
      return { list: resolved.slice(0, MAX_CARDS), source: "signals", signals };
    }

    // 兜底：竞品那 4 张（顺序照 `CpJ9@HXe`），仍以真实卡为底
    const fallback = await this.resolve(
      TEMPLATES.filter((item) => (DEFAULT_RECOMMEND_SLUGS as readonly string[]).includes(item.slugs[0] ?? "")).map(
        (item) => item.id,
      ),
    );
    return {
      list: (fallback.length >= MIN_CARDS ? fallback : resolved).slice(0, MAX_CARDS),
      source: "default",
      signals,
    };
  }

  /**
   * 选卡规则（可解释、无随机）：
   * - 只看最近 30 天；
   * - 有项目 → 优先"剧本/分镜"（用户已经在做故事）；
   * - 视频资产 > 图像资产 → 用户在做视频，推成片/第一人称；
   * - 图像资产 >= 视频 → 用户在备图，推人物多视角 + 一键成片；
   * - 有会话史 → 追加"一键成片"（最高频冷启动路径）。
   *
   * 不足 3 张时按模板目录顺序补齐：推荐位"只有 1~2 张"会让首屏看起来像没推荐，
   * 而补齐的来源仍是模板目录（不是兜底 4 张），所以 `source` 依旧是 signals。
   */
  private pickBySignals(signals: RecommendResult["signals"]): string[] {
    const picked: string[] = [];
    const push = (id: string): void => {
      if (!picked.includes(id)) picked.push(id);
    };
    if (signals.recent_project_count > 0) {
      push("novel_to_script");
      push("storyboard");
    }
    if (signals.recent_video_count > 0 && signals.recent_video_count >= signals.recent_image_count) {
      push("video_oneshot");
      push("first_person_short");
    }
    if (signals.recent_image_count > 0) {
      push("character_multiview");
      push("video_oneshot");
    }
    if (signals.recent_session_count > 0) push("video_oneshot");
    for (const template of TEMPLATES) {
      if (picked.length >= MIN_CARDS) break;
      push(template.id);
    }
    return picked;
  }

  /** 把模板落成真实卡：slug → DB 行；查不到的模板整张丢弃 */
  private async resolve(templateIds: string[]): Promise<RecommendCardDto[]> {
    if (templateIds.length === 0) return [];
    const slugs = new Set<string>();
    const templates: RecommendTemplate[] = [];
    for (const id of templateIds) {
      const template = TEMPLATES.find((item) => item.id === id);
      if (!template) continue;
      templates.push(template);
      for (const slug of template.slugs) slugs.add(slug);
    }
    // 逐个 slug 用参数化条件拼 or()：把数组拼进 sql.raw 会给自己开注入口子，
    // 而 slug 虽来自内部常量，也不该养成这种写法
    const slugConditions = [...slugs].map((slug) => sql`${agentSkills.config}->>'slug' = ${slug}`);
    const rows = await db
      .select()
      .from(agentSkills)
      .where(
        and(
          isNull(agentSkills.spaceId),
          isNull(agentSkills.deletedAt),
          eq(agentSkills.status, 1),
          eq(agentSkills.visibility, 2),
          or(...slugConditions),
        ),
      );
    const bySlug = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const slug = (row.config as Record<string, unknown> | null)?.slug;
      if (typeof slug === "string") bySlug.set(slug, row);
    }

    const out: RecommendCardDto[] = [];
    for (const template of templates) {
      const refs: RecommendSkillRef[] = [];
      for (const slug of template.slugs) {
        const row = bySlug.get(slug);
        if (!row) continue;
        refs.push({
          skill_id: String(row.id),
          skill_name: row.name,
          skill_name_en: slug,
        });
      }
      // 一张卡必须至少挂一个真实技能，否则不可用
      if (refs.length === 0) continue;
      const primary = bySlug.get(template.slugs[0] ?? "");
      const category = primary?.category ?? "skill";
      out.push({
        recommend_id: `rec_${template.id}`,
        title: template.title,
        description: primary?.summary || template.description,
        preset_prompt: primary?.promptTemplate || "",
        tag: categoryTag(category),
        tag_label: categoryLabel(category),
        skills: refs,
        cover_file_id: null,
      });
    }
    return out;
  }

  private async collectSignals(spaceId: string): Promise<RecommendResult["signals"]> {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000);
    const spaceBig = BigInt(spaceId);

    const [projectRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(scriptProjects)
      .where(
        and(
          eq(scriptProjects.spaceId, spaceBig),
          isNull(scriptProjects.archivedAt),
          gte(scriptProjects.createdAt, since),
        ),
      );

    const assetRows = await db
      .select({ kind: assets.kind, total: sql<number>`count(*)::int` })
      .from(assets)
      .where(
        and(eq(assets.spaceId, spaceBig), isNull(assets.deletedAt), gte(assets.createdAt, since)),
      )
      .groupBy(assets.kind);

    const [sessionRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.spaceId, spaceBig),
          isNull(agentSessions.deletedAt),
          gte(agentSessions.createdAt, since),
        ),
      );

    const imageCount = assetRows.find((row) => row.kind === "image")?.total ?? 0;
    const videoCount = assetRows.find((row) => row.kind === "video")?.total ?? 0;
    return {
      recent_project_count: projectRow?.total ?? 0,
      recent_asset_count: assetRows.reduce((sum, row) => sum + row.total, 0),
      recent_image_count: imageCount,
      recent_video_count: videoCount,
      recent_session_count: sessionRow?.total ?? 0,
    };
  }
}
