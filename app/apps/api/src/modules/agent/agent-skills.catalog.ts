/**
 * 平台 Skill 卡初始目录（33 张）—— Skill 卡广场的"运营位"。
 *
 * 为什么目录在代码里而不是 `db/seed.ts`：
 * 1. `db/seed.ts` 是"演示数据"（示例作品/示例项目），由 Lead 独占维护；
 *    Skill 卡目录是**产品能力**（每张卡都必须能真的拼出 prompt 并被 Agent 使用），
 *    它的正确性由本模块的 spec 守护，跟着模块一起演进更安全。
 * 2. 目录要「幂等 upsert」：服务启动后第一次访问广场时补齐缺失的卡，
 *    已存在的卡不覆盖（运营可能改过标题/下架过卡，不能被重启冲掉）。
 *
 * 竞品证据（ADR-013）：
 * - 技能广场 8 端点与"实测 33 张卡"：`rea-reelmate/routes.txt:378-385`、
 *   `docs/07-plan/completion-plan-to-100.md:178`。
 * - 斜杠指令 DSL（`/character-multiview-sheet` 等）：`docs/01-product/_parts/d-canvas-agent.md:349`。
 * - 卡片文案/分类枚举（tag 1..5）：`d-canvas-agent.md:342-345`。
 *
 * 说明：竞品 33 张卡的**逐条标题文案未取证**（证据基座只给了 3 个斜杠指令名与 5 个分类）。
 * 因此这里的中文标题/摘要/wait 提示词是**我方自拟**（可运营替换），
 * 但斜杠指令名、分类枚举、字段形状严格照证据。未取证部分已登记在
 * `_acceptance/_team/report-agent.md`「待取证」一节。
 */

/** 分类枚举 = 竞品 tag 1..5（`d-canvas-agent.md:344` `jc={BATCH_IMAGE:1,...}`） */
export const SKILL_CATEGORIES = [
  { key: "batch_image", label: "批量生图", tag: 1 },
  { key: "video", label: "视频制作", tag: 2 },
  { key: "script", label: "剧本创作", tag: 3 },
  { key: "skill", label: "技能", tag: 4 },
  { key: "custom", label: "自定义", tag: 5 },
] as const;

export type SkillCategoryKey = (typeof SKILL_CATEGORIES)[number]["key"];

export const SKILL_CATEGORY_KEYS: string[] = SKILL_CATEGORIES.map((item) => item.key);

/** 分类 key → 竞品 tag 数值（推荐卡 `tag` 字段直接用它） */
export function categoryTag(category: string): number {
  return SKILL_CATEGORIES.find((item) => item.key === category)?.tag ?? 4;
}

export function categoryLabel(category: string): string {
  return SKILL_CATEGORIES.find((item) => item.key === category)?.label ?? "技能";
}

/** 一张平台卡的定义。`slug` 同时是斜杠指令名与幂等键（存在 `config.slug`）。 */
export interface SkillCatalogEntry {
  slug: string;
  /** 中文卡片标题 */
  name: string;
  summary: string;
  category: SkillCategoryKey;
  /** 选中该卡后填入输入框的预置 prompt（以 `/slug` 开头，前端据此识别技能） */
  promptTemplate: string;
  tags: string[];
}

/**
 * 33 张卡的目录（7 批量生图 / 8 视频 / 7 剧本 / 6 技能 / 5 自定义）。
 * 顺序即广场默认排序的种子权重（服务层按 use_count 降序，初始值按索引递减）。
 */
export const SKILL_CATALOG: SkillCatalogEntry[] = [
  // ── 批量生图（7）──────────────────────────────────────
  {
    slug: "character-multiview-sheet",
    name: "人物多视角设定图",
    summary: "同一角色的正/侧/45°/背面四视角设定图，保证发型服装一致，可直接做分镜参考。",
    category: "batch_image",
    promptTemplate:
      "/character-multiview-sheet 为角色「{{角色}}」生成四视角设定图：正面、45° 侧、正侧、背面，同一套服装与发型，纯色背景，电影级打光。",
    tags: ["角色", "设定图", "一致性"],
  },
  {
    slug: "scene-multiview-grid",
    name: "场景九宫格",
    summary: "把一句场景描述扩成 9 个机位的同一场景图，用于挑景与场景一致性对齐。",
    category: "batch_image",
    promptTemplate:
      "/scene-multiview-grid 为场景「{{场景}}」生成 3×3 九宫格：远景/中景/近景 × 俯/平/仰三个机位，同一时空与光照。",
    tags: ["场景", "九宫格", "机位"],
  },
  {
    slug: "character-expressions-9",
    name: "角色表情九连",
    summary: "生成同一角色的 9 种表情，供分镜里做情绪切换时保持脸不跳。",
    category: "batch_image",
    promptTemplate:
      "/character-expressions-9 为角色「{{角色}}」生成 9 种表情：平静、微笑、惊讶、愤怒、悲伤、恐惧、厌恶、得意、崩溃，同一张脸同一套服装。",
    tags: ["角色", "表情", "一致性"],
  },
  {
    slug: "prop-design-sheet",
    name: "道具设定图",
    summary: "关键道具的三视图设定，附带材质与尺寸说明，避免跨镜道具变形。",
    category: "batch_image",
    promptTemplate:
      "/prop-design-sheet 为道具「{{道具}}」生成三视图设定图，标注材质与大致尺寸，纯色背景。",
    tags: ["道具", "设定图"],
  },
  {
    slug: "key-visual-poster",
    name: "主视觉海报",
    summary: "竖版 9:16 主视觉海报，留标题安全区，适合做封面与宣发物。",
    category: "batch_image",
    promptTemplate:
      "/key-visual-poster 生成 9:16 主视觉海报：{{主题}}，构图留出上方 1/4 标题安全区，电影海报质感。",
    tags: ["海报", "封面"],
  },
  {
    slug: "product-hero-shot",
    name: "产品主图",
    summary: "电商级产品主图：纯色或渐变背景 + 三点布光，突出材质细节。",
    category: "batch_image",
    promptTemplate:
      "/product-hero-shot 生成产品主图：{{产品}}，纯渐变背景，三点布光，突出材质与边缘高光，正方形构图。",
    tags: ["电商", "产品"],
  },
  {
    slug: "style-transfer-pack",
    name: "风格迁移套图",
    summary: "把一组既有画面统一迁移到目标风格，输出同风格套图。",
    category: "batch_image",
    promptTemplate:
      "/style-transfer-pack 把{{素材}}统一迁移到「{{风格}}」风格，保持主体构图不变，输出一组同风格套图。",
    tags: ["风格", "套图"],
  },

  // ── 视频制作（8）─────────────────────────────────────
  {
    slug: "video-oneshot",
    name: "一键成片",
    summary: "一句描述直接出 5~10 秒成片：自动补镜头语言、运镜与节奏。",
    category: "video",
    promptTemplate:
      "/video-oneshot 用一句话出片：{{描述}}。自动补全镜头语言与运镜，输出 5~10 秒可直接用的成片。",
    tags: ["成片", "一键"],
  },
  {
    slug: "first-person-immersive-video",
    name: "第一人称沉浸短片",
    summary: "以角色主观视角推进的沉浸式短片，强调手持感与呼吸节奏。",
    category: "video",
    promptTemplate:
      "/first-person-immersive-video 生成第一人称主观视角短片：{{情境}}，手持轻微晃动、浅景深、呼吸节奏感。",
    tags: ["第一人称", "沉浸"],
  },
  {
    slug: "wuxia-one-line-film-director",
    name: "武侠一句话短片",
    summary: "一句话武侠场景 → 导演级分镜与运镜，输出 15 秒内的武侠短片。",
    category: "video",
    promptTemplate:
      "/wuxia-one-line-film-director 以武侠导演视角处理一句话：{{一句话}}。给出镜头分解并生成 15 秒内短片，强调身法与衣袂动态。",
    tags: ["武侠", "短片", "导演"],
  },
  {
    slug: "product-demo-video",
    name: "产品演示视频",
    summary: "把产品卖点拆成 3 个镜头脚本并出演示视频，带字幕位。",
    category: "video",
    promptTemplate:
      "/product-demo-video 为{{产品}}生成 15 秒演示视频：开场痛点、核心卖点展示、结尾字幕位。",
    tags: ["产品", "演示"],
  },
  {
    slug: "talking-head-video",
    name: "数字人口播",
    summary: "给定讲稿生成口播视频，口型对齐、机位固定、可加字幕。",
    category: "video",
    promptTemplate:
      "/talking-head-video 用这段讲稿生成口播视频：{{讲稿}}。固定中景机位，口型对齐，预留字幕安全区。",
    tags: ["口播", "数字人"],
  },
  {
    slug: "action-camera-shot",
    name: "运动镜头补拍",
    summary: "为已有分镜补一个跟拍/环绕运动镜头，衔接前后镜。",
    category: "video",
    promptTemplate:
      "/action-camera-shot 为{{场景}}补一个运动镜头：环绕跟拍主体，速度渐入渐出，与前后镜动作衔接。",
    tags: ["运镜", "补拍"],
  },
  {
    slug: "loop-animation",
    name: "循环动效",
    summary: "生成首尾可无缝循环的短动效，适合做背景与加载态视觉。",
    category: "video",
    promptTemplate: "/loop-animation 生成 4 秒无缝循环动效：{{主体}}，首尾帧严格对齐，无镜头切换。",
    tags: ["动效", "循环"],
  },
  {
    slug: "transition-bridge",
    name: "转场桥接镜头",
    summary: "两个镜之间缺过渡时，生成 1 秒桥接镜头，避免硬切跳感。",
    category: "video",
    promptTemplate: "/transition-bridge 生成 1 秒桥接镜头，衔接「{{镜头A}}」与「{{镜头B}}」，动作方向连续。",
    tags: ["转场", "衔接"],
  },

  // ── 剧本创作（7）─────────────────────────────────────
  {
    slug: "one-line-film-director",
    name: "一句话成片导演",
    summary: "把一句话扩成可执行的短片方案：立意、人物、三幕结构、镜头清单。",
    category: "script",
    promptTemplate:
      "/one-line-film-director 把这句话做成短片方案：{{一句话}}。输出立意、主要人物、三幕结构与镜头清单。",
    tags: ["导演", "方案"],
  },
  {
    slug: "novel-to-script",
    name: "小说转剧本",
    summary: "小说片段转标准剧本格式：场景标题、动作、对白，保留原文情绪。",
    category: "script",
    promptTemplate:
      "/novel-to-script 把下面小说片段转成剧本格式（场景/动作/对白）：{{原文}}。保留原文情绪与关键细节。",
    tags: ["改编", "剧本"],
  },
  {
    slug: "short-drama-outline",
    name: "短剧大纲",
    summary: "按每集 90 秒节奏拆出若干集，每集一个小高潮 + 一个钩子。",
    category: "script",
    promptTemplate:
      "/short-drama-outline 为题材「{{题材}}」写 {{集数}} 集短剧大纲，每集 90 秒节奏，集末留钩子。",
    tags: ["短剧", "大纲"],
  },
  {
    slug: "character-arc-builder",
    name: "人物小传",
    summary: "生成角色小传：动机、缺陷、秘密、成长弧，供后续对白保持一致。",
    category: "script",
    promptTemplate:
      "/character-arc-builder 为角色「{{角色}}」写小传：外在目标、内在动机、致命缺陷、不愿说出口的秘密、成长弧。",
    tags: ["人物", "小传"],
  },
  {
    slug: "cliffhanger-writer",
    name: "钩子与反转",
    summary: "给现有剧情加 3 个可选反转与集末钩子，标注风险等级。",
    category: "script",
    promptTemplate: "/cliffhanger-writer 基于当前剧情「{{剧情}}」给 3 个反转选项与 3 个集末钩子，标注狗血风险等级。",
    tags: ["反转", "钩子"],
  },
  {
    slug: "dialogue-polish",
    name: "对白润色",
    summary: "把信息型对白改成有潜台词的口语对白，保留信息量。",
    category: "script",
    promptTemplate:
      "/dialogue-polish 润色这段对白：{{对白}}。去掉解释性台词，改成有潜台词的口语，信息量不减。",
    tags: ["对白", "润色"],
  },
  {
    slug: "episode-splitter",
    name: "分集拆分",
    summary: "把长故事按集时长与悬念密度拆集，输出每集起止与钩子。",
    category: "script",
    promptTemplate:
      "/episode-splitter 把故事「{{故事}}」拆成每集 {{时长}} 秒的分集结构，输出每集起止事件与集末钩子。",
    tags: ["分集", "结构"],
  },

  // ── 技能（6）───────────────────────────────────────
  {
    slug: "storyboard-breakdown",
    name: "分镜拆解",
    summary: "把剧本拆成可拍摄分镜：镜号、景别、机位、动作、台词、时长。",
    category: "skill",
    promptTemplate:
      "/storyboard-breakdown 把剧本拆成分镜表：镜号、景别、机位、画面动作、台词、时长（秒）。",
    tags: ["分镜", "拆解"],
  },
  {
    slug: "shot-list-generator",
    name: "镜头清单",
    summary: "按拍摄可行性给镜头排序，标出可合并镜与必须特写的镜。",
    category: "skill",
    promptTemplate: "/shot-list-generator 基于分镜生成镜头清单，标注可合并镜、必须特写镜与所需器材。",
    tags: ["镜头", "清单"],
  },
  {
    slug: "consistency-checker",
    name: "一致性检查",
    summary: "检查跨镜的人物/服装/道具/光线是否跳变，输出问题清单与修法。",
    category: "skill",
    promptTemplate: "/consistency-checker 检查这组分镜的人物、服装、道具、光线一致性，逐条列出跳变点与修法。",
    tags: ["一致性", "质检"],
  },
  {
    slug: "asset-library-binder",
    name: "资产库绑定",
    summary: "为新生成内容匹配资产库里已有素材，避免重复生成同一角色。",
    category: "skill",
    promptTemplate: "/asset-library-binder 为本次生成匹配资产库中已有的角色/场景/道具素材，列出可复用项与缺失项。",
    tags: ["资产库", "复用"],
  },
  {
    slug: "canvas-node-planner",
    name: "画布节点编排",
    summary: "把生成计划翻译成无限画布的节点图（节点类型、连接、参数）。",
    category: "skill",
    promptTemplate:
      "/canvas-node-planner 把当前创作计划翻译成画布节点图：节点类型、连接关系、每个节点的参数取值。",
    tags: ["画布", "编排"],
  },
  {
    slug: "task-batch-dispatcher",
    name: "批量投递",
    summary: "把一批镜头按预算与并发拆成多轮投递，先估价再执行。",
    category: "skill",
    promptTemplate:
      "/task-batch-dispatcher 把这批镜头按预算 {{积分}} 拆分投递批次，先给估价与每轮并发数，确认后再执行。",
    tags: ["批量", "积分"],
  },

  // ── 自定义（5）─────────────────────────────────────
  {
    slug: "brand-tone-keeper",
    name: "品牌语气把控",
    summary: "把文案收敛到品牌语气基线，输出改写前后对照。",
    category: "custom",
    promptTemplate: "/brand-tone-keeper 把这段文案收敛到品牌语气「{{语气}}」：{{文案}}。给出改写前后对照与理由。",
    tags: ["品牌", "文案"],
  },
  {
    slug: "style-guide-builder",
    name: "风格手册",
    summary: "从已有成片反推风格手册：色彩、光比、构图、运镜偏好。",
    category: "custom",
    promptTemplate: "/style-guide-builder 从这些成片反推风格手册：色彩倾向、光比、构图习惯、运镜偏好、禁用元素。",
    tags: ["风格", "手册"],
  },
  {
    slug: "cover-title-writer",
    name: "封面标题文案",
    summary: "生成 10 个封面标题候选并标注点击动机类型。",
    category: "custom",
    promptTemplate: "/cover-title-writer 为内容「{{内容}}」生成 10 个封面标题候选，逐条标注点击动机（好奇/共鸣/利益/反差）。",
    tags: ["标题", "封面"],
  },
  {
    slug: "subtitle-translator",
    name: "字幕翻译",
    summary: "字幕中英互译并保持时间轴与字数约束（单行不超过 16 字）。",
    category: "custom",
    promptTemplate:
      "/subtitle-translator 把字幕翻译成{{目标语言}}，保持时间轴不变，单行不超过 16 字，口语化优先。",
    tags: ["字幕", "翻译"],
  },
  {
    slug: "feedback-summarizer",
    name: "反馈汇总",
    summary: "把多轮评审意见归并成可执行修改项，去掉互相冲突的诉求。",
    category: "custom",
    promptTemplate: "/feedback-summarizer 把以下评审意见归并成可执行修改项，标出互相冲突的诉求并给出取舍建议：{{意见}}。",
    tags: ["评审", "汇总"],
  },
];

/** 推荐卡兜底：竞品远端为空时的 4 张硬编码卡（`d-canvas-agent.md:346` `CpJ9@HXe`） */
export const DEFAULT_RECOMMEND_SLUGS = [
  "video-oneshot",
  "character-multiview-sheet",
  "first-person-immersive-video",
  "wuxia-one-line-film-director",
] as const;
