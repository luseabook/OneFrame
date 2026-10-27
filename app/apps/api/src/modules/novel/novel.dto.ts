import type {
  novelChapterOutlines,
  novelChapters,
  novelCharacters,
  novelEditMessages,
  novelEditPendings,
  novelEditSessions,
  novelEpisodeOutlines,
  novelEpisodes,
  novelScriptVersions,
  novelWorldviews,
  novels,
} from "@app/db";

/**
 * novel 域的行类型与出参映射（集中一处，三个 service 共用）。
 *
 * 两条约定：
 * 1. **id 一律字符串化**：主键是雪花 bigint，直接进 JSON 会在 JS 端丢精度。
 * 2. **时间一律 ISO 字符串**：出参与 `shared/schemas/novel.ts` 的 z.string() 对齐，
 *    不让前端拿到 Date 对象再自己 format。
 */

export type NovelRow = typeof novels.$inferSelect;
export type NovelChapterRow = typeof novelChapters.$inferSelect;
export type NovelWorldviewRow = typeof novelWorldviews.$inferSelect;
export type NovelCharacterRow = typeof novelCharacters.$inferSelect;
export type NovelChapterOutlineRow = typeof novelChapterOutlines.$inferSelect;
export type NovelEpisodeOutlineRow = typeof novelEpisodeOutlines.$inferSelect;
export type NovelEpisodeRow = typeof novelEpisodes.$inferSelect;
export type NovelScriptVersionRow = typeof novelScriptVersions.$inferSelect;
export type NovelEditSessionRow = typeof novelEditSessions.$inferSelect;
export type NovelEditMessageRow = typeof novelEditMessages.$inferSelect;
export type NovelEditPendingRow = typeof novelEditPendings.$inferSelect;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** jsonb 列在 drizzle 里是 unknown；这里统一收敛成对象，避免每个调用点各写一份强转 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function novelDto(row: NovelRow) {
  return {
    id: String(row.id),
    space_id: String(row.spaceId),
    title: row.title,
    source_type: row.sourceType,
    status: row.status,
    sp_type: row.spType,
    ratio: row.ratio,
    episode_count: row.episodeCount,
    meta: asRecord(row.meta),
    archived_at: iso(row.archivedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** 章节（含正文；详情接口用） */
export function chapterDto(row: NovelChapterRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    chapter_no: row.chapterNo,
    title: row.title,
    content: row.content,
    word_count: row.wordCount,
  };
}

/** 章节（不含正文；列表接口用——列表拉全书正文是列表页变慢的经典原因） */
export function chapterSummaryDto(row: NovelChapterRow) {
  const { content: _content, ...rest } = chapterDto(row);
  return rest;
}

export function worldviewDto(row: NovelWorldviewRow) {
  const settings = asRecord(row.settings);
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    summary: row.summary,
    settings,
    // 结构化字段同时平铺一份：前端世界观面板直接用，不必每处 `settings.era as string`
    era: typeof settings.era === "string" ? settings.era : "",
    geography: typeof settings.geography === "string" ? settings.geography : "",
    factions: Array.isArray(settings.factions) ? settings.factions : [],
    rules: Array.isArray(settings.rules) ? settings.rules : [],
    relations: Array.isArray(settings.relations) ? settings.relations : [],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function characterDto(row: NovelCharacterRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    name: row.name,
    role_type: row.roleType,
    description: row.description,
    appearance: row.appearance,
    personality: row.personality,
    prompt: row.prompt,
    is_core: row.isCore,
  };
}

export function chapterOutlineDto(row: NovelChapterOutlineRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    chapter_no: row.chapterNo,
    title: row.title,
    synopsis: row.synopsis,
    sort: row.sort,
  };
}

export function episodeOutlineDto(row: NovelEpisodeOutlineRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    episode_no: row.episodeNo,
    title: row.title,
    synopsis: row.synopsis,
    sort: row.sort,
  };
}

/** 分集剧本（含正文） */
export function episodeDto(row: NovelEpisodeRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    episode_no: row.episodeNo,
    title: row.title,
    script_text: row.scriptText,
    status: row.status,
    version: row.version,
  };
}

/** 分集剧本（不含正文；列表用，正文按集点开再拉） */
export function episodeSummaryDto(row: NovelEpisodeRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    episode_no: row.episodeNo,
    title: row.title,
    status: row.status,
    version: row.version,
    chars: row.scriptText.length,
  };
}

export function scriptVersionDto(row: NovelScriptVersionRow) {
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    episode_id: row.episodeId === null ? null : String(row.episodeId),
    version_no: row.versionNo,
    chars: row.scriptText.length,
    finalized_at: iso(row.finalizedAt),
    created_by: row.createdBy === null ? null : String(row.createdBy),
    created_at: row.createdAt.toISOString(),
  };
}

export function editSessionDto(row: NovelEditSessionRow) {
  const context = asRecord(row.context);
  return {
    id: String(row.id),
    novel_id: String(row.novelId),
    user_id: String(row.userId),
    status: row.status,
    heartbeat_at: iso(row.heartbeatAt),
    title: typeof context.title === "string" ? context.title : "",
    instructions: typeof context.instructions === "string" ? context.instructions : "",
    scope_episode_nos: Array.isArray(context.scope_episode_nos) ? context.scope_episode_nos : [],
    is_current: context.is_current === true,
    last_turn_at: typeof context.last_turn_at === "string" ? context.last_turn_at : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function editMessageDto(row: NovelEditMessageRow) {
  return {
    id: String(row.id),
    session_id: String(row.sessionId),
    role: row.role,
    content: row.content,
    pending_changes: Array.isArray(row.pendingChanges) ? row.pendingChanges : [],
    created_at: row.createdAt.toISOString(),
  };
}

/** 逐集 diff（apply/reject 的对象；前端双栏对照直接用 original/proposed 两段） */
export function editPendingDto(row: NovelEditPendingRow, episodeNo: number) {
  return {
    id: String(row.id),
    session_id: String(row.sessionId),
    episode_id: String(row.episodeId),
    episode_no: episodeNo,
    original_text: row.originalText,
    proposed_text: row.proposedText,
    change_summary: row.changeSummary,
    status: row.status,
  };
}
