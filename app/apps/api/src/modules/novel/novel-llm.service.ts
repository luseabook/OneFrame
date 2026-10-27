import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import {
  AppError,
  ErrorCode,
  NovelRoleType,
  chapterOutlineResultSchema,
  editChatResultSchema,
  episodeOutlineResultSchema,
  novelCharactersResultSchema,
  novelScriptResultSchema,
  worldviewResultSchema,
  type ChapterOutlineResult,
  type EditChatResult,
  type EpisodeOutlineResult,
  type NovelCharactersResult,
  type NovelScriptResult,
  type WorldviewResult,
} from "@app/shared";
import { DeepSeekChatAdapter } from "@app/model-adapters";
import { env } from "../../config/env";

/**
 * 小说改编链的 LLM 步骤（世界观 / 角色卡 / 章节大纲 / 分集大纲 / 剧本 / 编辑对话）。
 *
 * 三条硬约束（决定了本文件为什么长这样）：
 *
 * 1. **LLM 输出 schema 与请求 schema 是两套**（见 `shared/schemas/novel.ts` 开头注释）。
 *    这里只吃 `*ResultSchema`，输出一律经 `schema.parse` 落地——
 *    模型幻觉字段被 strip、空数组/重复集当场失败，而不是"成功但什么都不落库"。
 *
 * 2. **无 Key 必须能跑且确定性**（`LLM_MODE=mock` 或没有 `DEEPSEEK_API_KEY`）。
 *    所有 mock 输出都是"内容文本的稳定哈希 → 固定候选池偏移"派生，
 *    同一输入永远得到同一输出。这不是为了好看：编辑 Agent 的 diff、章节大纲的
 *    `chapter_no` 都必须可复跑对齐，否则 CI 里每次断言都要跟着改。
 *
 * 3. **不新造 HTTP 客户端**：真实调用走既有 `DeepSeekChatAdapter`（`@app/model-adapters`），
 *    与 `script/llm.service.ts` 同一套重试/错误映射（429/5xx 可重试、结构错误不重试）。
 */

// ── 确定性派生工具 ──────────────────────────────────────────────

/** 文本 → 稳定 32 位种子（FNV-1a）。同一文本永远同一种子，用于 mock 候选池偏移。 */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** 从固定候选池按种子确定性取第 n 个（同一 seed+offset 恒定） */
function pick<T>(pool: readonly T[], seed: number, offset = 0): T {
  return pool[(seed + offset * 7919) % pool.length] as T;
}

/** 按种子取 count 个互不相同的池元素（池不够大时从头续接，保证不重复） */
function pickMany<T>(pool: readonly T[], count: number, seed: number): T[] {
  const size = Math.min(count, pool.length);
  const start = seed % pool.length;
  return Array.from({ length: size }, (_, i) => pool[(start + i) % pool.length] as T);
}

/** 文本压缩成单行摘要（给 mock 的 synopsis 用；不引入随机性） */
function condense(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

// 候选池：全部为"中性虚构名"，避免与真实品牌/人物混淆
const MOCK_ERAS = [
  "民国上海，租界与弄堂并存的年代",
  "架空仙侠世界，九洲灵脉渐次枯竭",
  "当代都市，旧城改造与资本并购交叠",
  "九十年代东北小城，国企改制的最后几年",
  "近未来沿海都市，记忆可以被交易",
  "边塞古国，关隘之外是无人归来的荒原",
] as const;

const MOCK_GEOGRAPHIES = [
  "潮湿的江南水巷与旧式里弄交错，雨夜路灯昏黄，石板路常年反光",
  "群山环抱的边城，废关隘与栈道相连，风沙掩盖了旧战场",
  "霓虹与雨水交织的沿海都市，高架桥下是见不得光的交易",
  "黄沙漫天的西部小镇，一条旧公路贯穿全镇，加油站是唯一夜灯",
  "被改造河道切开的北方旧城，铁路与仓库区构成城市背面",
] as const;

const MOCK_FACTION_NAMES = [
  "清源会",
  "北岭镖局",
  "鹤鸣书院",
  "海砂贸易行",
  "旧案调查组",
  "归墟教",
  "临江商社",
  "夜航船队",
] as const;

const MOCK_RULE_TEMPLATES = [
  "凡涉密约，必有第三方见证；违约者十年内不得再入行会",
  "城内禁用真兵刃，械斗一律按「扰乱市面」论处",
  "灵脉枯竭后，任何强行引气都会留下无法抹去的痕迹",
  "记忆交易必须双方同时在场，单方操作会被交易行记录并追责",
  "旧案卷宗密封三十年，开封需两名以上主事联署",
] as const;

const MOCK_CHARACTER_NAMES = [
  "林晚",
  "顾沉",
  "苏禾",
  "周野",
  "陈默",
  "叶青",
  "陆离",
  "白露",
  "沈川",
  "夏至",
] as const;

const MOCK_TRAITS = [
  "克制、话少，但一旦开口就能戳中要害",
  "表面圆滑周全，实则把每一笔账都记在心里",
  "冲动、护短，愿意为一句承诺赌上全部",
  "冷静到接近冷漠，唯独对旧物有执念",
  "擅长倾听，习惯用别人的秘密换取自己的余地",
] as const;

const MOCK_APPEARANCES = [
  "身形清瘦，常穿深色长外套，左手腕有旧疤，眼神很少直视人",
  "肩背笔直，短发，眉骨较高，笑起来左边有浅酒窝",
  "惯用旧式呢帽压住眉眼，手指关节有长期握刀留下的茧",
  "面色偏白，长发束在脑后，衣领永远扣到最上面一颗",
  "轮廓硬朗，胡茬常年不修，耳后有一道浅色伤疤",
] as const;

/** 台词/动作候选（剧本 mock 用，按集号与种子取用，保证同一输入同一稿） */
const MOCK_SCRIPT_BEATS = [
  ["场景一 · 夜 · 外", "（雨落在青石板上，脚步声由远及近。）", "林晚：你迟到了三分钟。", "顾沉：路上有人跟着。", "（两人并肩走入巷口，镜头缓慢后拉。）"],
  ["场景一 · 日 · 内", "（旧桌上一份卷宗被推到中间。）", "苏禾：这份东西，你看过之后就不能再装作不知道。", "周野：我从来就没装作不知道。", "（纸张翻动声盖过外面的车流。）"],
  ["场景一 · 夜 · 内", "（灯只开了一盏，影子在墙上拉得很长。）", "陈默：他们要我签字，我签了。", "叶青：那你现在还站在这里，说明你后悔了。", "（镜头切到窗外，一辆车缓缓停下。）"],
  ["场景二 · 黄昏 · 外", "（关隘外的风把衣角吹得笔直。）", "陆离：过了这道门，就没有回头路。", "白露：我本来也没有打算回头。", "（远处传来钟声，画面定格。）"],
] as const;

/**
 * LLM 步骤服务。
 *
 * `enabled` 为 false 时全部走确定性 mock —— 这是本批"无 Key 也能跑通整条链"的实现点。
 */
@Injectable()
export class NovelLlmService {
  private readonly deepseek =
    env.LLM_MODE === "real" && env.DEEPSEEK_API_KEY
      ? new DeepSeekChatAdapter({
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: env.DEEPSEEK_BASE_URL,
          model: env.DEEPSEEK_MODEL,
        })
      : null;

  /** 当前是否走真实模型（出参用它告诉前端这次是 mock 还是真生成） */
  get mode(): "mock" | "real" {
    return this.deepseek ? "real" : "mock";
  }

  // ── 1. 世界观（content-analysis 的产出之一）────────────────────
  async worldview(input: { title: string; sourceText: string }): Promise<WorldviewResult> {
    const seed = seedOf([input.title, condense(input.sourceText, 4_000)].join("\n"));
    if (!this.deepseek) {
      const era = pick(MOCK_ERAS, seed);
      const geography = pick(MOCK_GEOGRAPHIES, seed, 1);
      const factionNames = pickMany(MOCK_FACTION_NAMES, 3, seed);
      const ruleA = pick(MOCK_RULE_TEMPLATES, seed, 2);
      const ruleB = pick(MOCK_RULE_TEMPLATES, seed, 3);
      const names = pickMany(MOCK_CHARACTER_NAMES, 3, seed);
      return worldviewResultSchema.parse({
        era,
        geography,
        factions: factionNames.map((name, i) => ({
          name,
          description: `${name}在《${input.title}》中掌握${i === 0 ? "资金与批文" : i === 1 ? "运输与消息" : "人手与旧案卷宗"}。`,
        })),
        rules: [ruleA, ruleB],
        relations: [
          { from: names[0], to: names[1], kind: "同盟", note: "表面合作，各有底线" },
          { from: names[1], to: names[2], kind: "敌对", note: "旧案里的一笔账" },
          { from: names[0], to: names[2], kind: "师徒", note: "授业之恩未还" },
        ],
        summary:
          `《${input.title}》发生在${era}。${geography}。` +
          `三方势力（${factionNames.join("、")}）围绕同一桩旧案彼此试探，` +
          `主角在"守规矩"与"破规矩"之间反复选择，` +
          `每一次选择都会让上一集的伏笔变成下一集的代价。`,
      });
    }
    return this.completeJson<WorldviewResult>(
      "你是短剧的世界观架构师。根据用户提供的小说片段，输出世界观设定。" +
        '只输出 JSON：{"era":"","geography":"","factions":[{"name":"","description":""}],' +
        '"rules":[""],"relations":[{"from":"角色名","to":"角色名","kind":"关系类别","note":""}],"summary":""}。' +
        "relations 的 from/to 必须是具体角色名且不得自指；summary 200~400 字；不要输出 JSON 之外的任何文字。",
      JSON.stringify({ title: input.title, excerpt: condense(input.sourceText, 12_000) }),
      worldviewResultSchema,
    );
  }

  // ── 2. 角色卡（content-analysis 与 core_character 共用）─────────
  async characters(input: {
    title: string;
    sourceText: string;
    count: number;
    /** 已有角色名：生成时避开重名，避免同一本子里出现"两张林晚" */
    existingNames?: string[];
  }): Promise<NovelCharactersResult> {
    const count = Math.max(1, Math.min(input.count, 10));
    const seed = seedOf([input.title, condense(input.sourceText, 4_000), String(count)].join("\n"));
    if (!this.deepseek) {
      const taken = new Set(input.existingNames ?? []);
      const available = MOCK_CHARACTER_NAMES.filter((name) => !taken.has(name));
      // 池被占满时退回全集（宁可让应用层判重，也不返回空数组——空数组是"这次没生成成功"的形态）
      const names = pickMany(available.length > 0 ? available : MOCK_CHARACTER_NAMES, count, seed);
      return novelCharactersResultSchema.parse({
        characters: names.map((name, i) => ({
          name,
          role_type: i === 0 ? NovelRoleType.LEAD : i === 2 ? NovelRoleType.VILLAIN : NovelRoleType.SUPPORTING,
          description: `《${input.title}》中的${i === 0 ? "主线驱动者" : i === 2 ? "主要阻力来源" : "关键关系人"}，与旧案有直接牵连。`,
          appearance: pick(MOCK_APPEARANCES, seed, i),
          personality: pick(MOCK_TRAITS, seed, i),
          prompt: `电影感短剧角色肖像，${name}，《${input.title}》，${pick(MOCK_APPEARANCES, seed, i).slice(0, 40)}，9:16 竖屏，清晰五官，浅景深`,
          is_core: i === 0,
        })),
      });
    }
    return this.completeJson<NovelCharactersResult>(
      `你是短剧角色设计师。从素材中抽取不超过 ${count} 个角色，角色名不得重复。` +
        '只输出 JSON：{"characters":[{"name":"","role_type":1,"description":"","appearance":"",' +
        '"personality":"","prompt":"","is_core":true}]}。' +
        "role_type：1 主角 / 2 配角 / 3 反派；prompt 为中文文生图提示词（含光影与构图）。",
      JSON.stringify({
        title: input.title,
        excerpt: condense(input.sourceText, 12_000),
        existing_names: input.existingNames ?? [],
      }),
      novelCharactersResultSchema,
    );
  }

  // ── 3. 章节大纲 ─────────────────────────────────────────────
  async chapterOutlines(input: {
    title: string;
    chapters: Array<{ chapterNo: number; title: string; content: string }>;
    worldviewSummary?: string;
  }): Promise<ChapterOutlineResult> {
    const seed = seedOf([input.title, ...input.chapters.map((c) => c.content.slice(0, 200))].join("\n"));
    if (!this.deepseek) {
      return chapterOutlineResultSchema.parse({
        chapters: input.chapters.map((chapter, i) => ({
          chapter_no: i + 1,
          title: chapter.title.trim() || `第${i + 1}章 ${pick(["开端", "暗涌", "交锋", "转折", "收束"], seed, i)}`,
          synopsis: condense(
            chapter.content ||
              `本章推进"${input.title}"第 ${i + 1} 个节拍：${pick(
                ["旧线索浮出水面", "关键人物立场松动", "一场交易谈崩", "伏笔被提前引爆"],
                seed,
                i,
              )}。`,
            180,
          ),
        })),
      });
    }
    return this.completeJson<ChapterOutlineResult>(
      `你是短剧的章节规划师。把 ${input.chapters.length} 章原文各归纳成一条章纲，chapter_no 必须从 1 起严格递增。` +
        '只输出 JSON：{"chapters":[{"chapter_no":1,"title":"","synopsis":""}]}。synopsis 80~200 字。',
      JSON.stringify({
        title: input.title,
        worldview: condense(input.worldviewSummary ?? "", 1_500),
        chapters: input.chapters.map((c, i) => ({
          no: i + 1,
          title: c.title,
          excerpt: condense(c.content, 1_000),
        })),
      }),
      chapterOutlineResultSchema,
    );
  }

  // ── 4. 分集大纲 ─────────────────────────────────────────────
  async episodeOutlines(input: {
    title: string;
    episodeCount: number;
    chapterOutlines: Array<{ chapterNo: number; title: string; synopsis: string }>;
    worldviewSummary?: string;
    instructions?: string;
  }): Promise<EpisodeOutlineResult> {
    const episodeCount = Math.max(1, Math.min(input.episodeCount, 100));
    const beats = ["入局", "试探", "背叛", "反扑", "摊牌", "代价", "余波"];
    if (!this.deepseek) {
      return episodeOutlineResultSchema.parse({
        episodes: Array.from({ length: episodeCount }, (_, i) => {
          // 章纲按比例映射到集：每集吃掉哪几章在 synopsis 里点明，便于人工核对是否漏章
          const from = Math.floor((i * input.chapterOutlines.length) / episodeCount) + 1;
          const to = Math.max(from, Math.floor(((i + 1) * input.chapterOutlines.length) / episodeCount));
          const beat = beats[i % beats.length];
          const anchor = input.chapterOutlines[i % Math.max(1, input.chapterOutlines.length)];
          return {
            episode_no: i + 1,
            title: `第${i + 1}集 ${beat}`,
            synopsis:
              `覆盖第 ${from}${to > from ? `-${to}` : ""} 章。` +
              `${anchor ? `以"${anchor.title}"为支点，` : ""}` +
              `本集围绕"${beat}"展开：${
                ["主角第一次被迫在规矩与真相之间选边。", "盟友的动机出现裂缝，旧线索被重新拼起。", "一次不该发生的交易，把双方都逼到台面上。"][
                  i % 3
                ]
              }` +
              `结尾留一个指向下一集的钩子${input.instructions ? `（创作要求：${condense(input.instructions, 80)}）` : ""}。`,
          };
        }),
      });
    }
    return this.completeJson<EpisodeOutlineResult>(
      `你是短剧的总编剧。把章纲改编成恰好 ${episodeCount} 集的分集大纲，episode_no 必须从 1 起严格递增。` +
        '只输出 JSON：{"episodes":[{"episode_no":1,"title":"","synopsis":""}]}。每集 synopsis 60~180 字，结尾要有钩子。',
      JSON.stringify({
        title: input.title,
        episode_count: episodeCount,
        worldview: condense(input.worldviewSummary ?? "", 1_500),
        chapters: input.chapterOutlines,
        instructions: input.instructions ?? "",
      }),
      episodeOutlineResultSchema,
    );
  }

  // ── 5. 分集剧本（多集批量）──────────────────────────────────
  async scripts(input: {
    title: string;
    episodes: Array<{ episodeNo: number; title: string; synopsis: string }>;
    instructions?: string;
  }): Promise<NovelScriptResult> {
    const seed = seedOf(
      [input.title, ...input.episodes.map((e) => `${e.episodeNo}:${e.synopsis}`)].join("\n"),
    );
    if (!this.deepseek) {
      return novelScriptResultSchema.parse({
        episodes: input.episodes.map((episode, i) => {
          const beat = pick(MOCK_SCRIPT_BEATS, seed, i);
          return {
            episode_no: episode.episodeNo,
            title: episode.title || `第${episode.episodeNo}集`,
            script_text: [
              `【${input.title} · 第${episode.episodeNo}集 ${episode.title}】`,
              ...beat,
              `（本集梗概：${condense(episode.synopsis, 120)}）`,
              input.instructions ? `（创作要求：${condense(input.instructions, 100)}）` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }),
      });
    }
    return this.completeJson<NovelScriptResult>(
      "你是短剧编剧。按分集大纲逐集写出可拍摄剧本（场景标题 / 动作 / 对白三段式），" +
        '每集都要有输出、集号与给定集号一一对应。只输出 JSON：' +
        '{"episodes":[{"episode_no":1,"title":"","script_text":""}]}。',
      JSON.stringify({
        title: input.title,
        episodes: input.episodes,
        instructions: input.instructions ?? "",
      }),
      novelScriptResultSchema,
    );
  }

  // ── 6. 剧本编辑 Agent 的一轮"变更计划"────────────────────────
  /**
   * 输出的是**变更计划**而不是整篇剧本：哪几集要改、改成什么、为什么。
   * 正文 diff 由服务端落 `novel_edit_pendings`，模型无权直接改正文——
   * 否则"只驳回第 3 集"这个产品能力无从实现（见 plan §3.2）。
   */
  async editPlan(input: {
    title: string;
    userMessage: string;
    instructions?: string;
    episodes: Array<{ episodeNo: number; title: string; scriptText: string }>;
  }): Promise<EditChatResult> {
    const seed = seedOf([input.userMessage, ...input.episodes.map((e) => e.scriptText.slice(0, 200))].join("\n"));
    if (!this.deepseek) {
      if (input.episodes.length === 0) {
        return editChatResultSchema.parse({
          reply: "当前本子还没有已生成的剧本集，请先生成分集剧本再来编辑。",
          episodes: [],
        });
      }
      // 确定性选择：按消息种子挑 1~2 集（永不越界），改动为"追加一条可核对的改编批注"
      const hitCount = Math.min(input.episodes.length, seed % 2 === 0 ? 1 : 2);
      const start = seed % input.episodes.length;
      const targets = Array.from({ length: hitCount }, (_, i) => input.episodes[(start + i) % input.episodes.length]!);
      return editChatResultSchema.parse({
        reply:
          `收到："${condense(input.userMessage, 60)}"。` +
          `我按这条要求改了 ${targets.length} 集（第 ${targets.map((e) => e.episodeNo).join("、")} 集），` +
          "逐集确认后才会写入正文。",
        episodes: targets.map((episode) => ({
          episode_no: episode.episodeNo,
          new_text: [
            episode.scriptText,
            `（改编批注 · 第${episode.episodeNo}集）`,
            `【修改依据】${condense(input.userMessage, 200)}`,
            `【落点】${
              [
                "把结尾的处理提前到本集第三场，让钩子更硬。",
                "压缩中间过场，把对白换成动作。",
                "补一场两分钟的对手戏，交代动机。",
              ][seed % 3]
            }`,
            input.instructions ? `【会话约束】${condense(input.instructions, 100)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          change_summary: condense(
            `按"${condense(input.userMessage, 60)}"调整本集：${
              ["结尾前移、钩子加强", "压缩过场、对白改动作", "补对手戏、补动机"][seed % 3]
            }`,
            300,
          ),
        })),
      });
    }
    return this.completeJson<EditChatResult>(
      "你是短剧剧本的改写编辑。根据用户要求，只输出**要修改的集**及其建议全文，不要输出未改动的集。" +
        '只输出 JSON：{"reply":"给用户的一句话说明","episodes":[{"episode_no":1,"new_text":"该集修改后的完整剧本正文","change_summary":"这集改了什么（一句话）"}]}。' +
        "没有任何改动时 episodes 返回空数组。禁止把整本剧本塞进一集。",
      JSON.stringify({
        title: input.title,
        requirement: input.userMessage,
        session_instructions: input.instructions ?? "",
        episodes: input.episodes.map((e) => ({
          episode_no: e.episodeNo,
          title: e.title,
          script_text: e.scriptText.slice(0, 20_000),
        })),
      }),
      editChatResultSchema,
    );
  }

  // ── 内部：真实模型的 JSON 强约束调用 ─────────────────────────
  private async completeJson<T>(system: string, user: string, schema: z.ZodTypeAny): Promise<T> {
    if (!this.deepseek) throw new AppError(ErrorCode.INTERNAL, "LLM not configured");
    const { text } = await this.deepseek.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.4 },
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output is not JSON");
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output JSON parse failed");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      // 只回前 3 条 issue：整包 issues 可能上千行，塞进响应会把错误信封本身变成事故
      throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output schema invalid", {
        issues: result.error.issues.slice(0, 3),
      });
    }
    return result.data as T;
  }
}
