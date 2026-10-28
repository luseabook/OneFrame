/**
 * 知识库「模板场景」（scene）维度 —— 第 60 批，**全部来自竞品前端 bundle 取证**。
 *
 * 证据来源（`E:\wanxing\rea-reelmate\scripts-canvas\files\origins\<hash>\assets\0zWWdXb_.js`，
 * 6,097 字节，Vite 产物原文）：
 *
 *   1) 枚举本体（注意**值不连续**，缺 8/10/12/13/19）：
 *      `e[e.Style=1]="Style", e[e.Genre=2]="Genre", e[e.Composition=3]="Composition",`
 *      `e[e.VideoEffect=4]="VideoEffect", e[e.StoryboardT2i=6]="StoryboardT2i",`
 *      `e[e.SeeDance2=7]="SeeDance2", e[e.ScreenplayNovel=9]="ScreenplayNovel",`
 *      `e[e.AIStoryboard=5]="AIStoryboard", e[e.StoryboardRef=11]="StoryboardRef",`
 *      `e[e.Voice=14]="Voice", e[e.ScenePrompt=15]="ScenePrompt", e[e.Camera=16]="Camera",`
 *      `e[e.Palette=17]="Palette", e[e.Expression=18]="Expression", e[e.AudioLibrary=20]="AudioLibrary"`
 *
 *   2) 类型 → 业务串（**与枚举名不同名**，抄错就会与竞品筛选口径不一致）：
 *      `m={1:"style",2:"theme",3:"storyboard",4:"video_effect",15:"storyboard_prompt",`
 *      `6:"storyboard_t2i",7:"seedance2",9:"novel_to_script",5:"ai_storyboard",`
 *      `11:"storyboard_ref",14:"tone",20:"audio_library",16:"camera",17:"palette",18:"expression"}`
 *
 *   3) 每类的字段规则（`_` 对象原文），决定 name 上限、prompt 是否必填与上限、封面是否必填：
 *      `1:{name:10,prompt_template:{maxLength:2e3,required},cover_file:{required:!1}}`
 *      `2:{name:10}` / `3:{name:10,prompt_template:200,cover_file:{required:!0}}`
 *      `4:{name:10,prompt_template:200,cover_file:{required:!0}}`
 *      `15:{name:50,prompt_template:500}` / `20:{name:50}` / `14:{name:10,prompt_template:50}`
 *      `11:{name:20,storyboard_prompt?,video_prompt?,anyPrompt:{required}}`
 *      `6:{name:20,storyboard_prompt?,image_prompt?,video_prompt?,anyPrompt:{required}}`
 *      `5:{name:50,prompt_template:{maxLength:2e4,required}}`
 *      `9:{name:50,desc:50,script_2_novel_items:[{prompt_type:1..5,prompt_template:5e3}]}`
 *
 *   4) 列表 tab 定义（`o` 对象原文），`phase1:!0` 标出首期上线范围（共 8 个 tab）：
 *      `all` / `14 音色模版` / `20 音频模版` / `1 风格` / `2 题材` / `15 分镜提示词` /
 *      `9 编剧知识库（小说转剧本）` / `5 AI 拆分镜` 为 phase1；
 *      `11 剧本拆分镜（参考生视频）` / `6 剧本拆分图（图生视频）` 为 phase1:!1（未上线）。
 *      `columns` 是竞品真实表头：`["name","prompt","status","updater","updated_at","actions"]`，
 *      其中**音频模版(20)与题材(2)没有 `prompt` 列**。
 *
 * 我方口径说明（诚实边界）：
 * - 竞品把「知识库」当作**模板库**：每条资产是一份某类模板（风格/音色/提示词…），
 *   而不是我方此前理解的「设定集文本条目」。scene 就是这条模板属于哪一类。
 * - 竞品 `status` 枚举 `Enabled=1 / Disabled=2`、来源枚举 `Official=1 / Team=2` 也取自此文件，
 *   但我方本批**只落 scene**，status 与来源留给后续批次（避免一次改太多、也避免无响应体证据时自造）。
 * - 我方 `scene=0` 表示「未分类/通用」，仅用于兼容本批之前的历史数据；竞品没有这个值。
 */

/** 知识库模板场景（值取自竞品枚举，**不是自造**） */
export const KNOWLEDGE_SCENE = {
  UNSET: 0,
  STYLE: 1,
  GENRE: 2,
  COMPOSITION: 3,
  VIDEO_EFFECT: 4,
  AI_STORYBOARD: 5,
  STORYBOARD_T2I: 6,
  SEE_DANCE2: 7,
  SCREENPLAY_NOVEL: 9,
  STORYBOARD_REF: 11,
  VOICE: 14,
  SCENE_PROMPT: 15,
  CAMERA: 16,
  PALETTE: 17,
  EXPRESSION: 18,
  AUDIO_LIBRARY: 20,
} as const;

export type KnowledgeSceneValue = (typeof KNOWLEDGE_SCENE)[keyof typeof KNOWLEDGE_SCENE];

/** 全部合法值（含 UNSET=0；顺序与竞品 tab 顺序一致，便于前端直接渲染） */
export const KNOWLEDGE_SCENE_VALUES: readonly KnowledgeSceneValue[] = [
  KNOWLEDGE_SCENE.UNSET,
  KNOWLEDGE_SCENE.VOICE,
  KNOWLEDGE_SCENE.AUDIO_LIBRARY,
  KNOWLEDGE_SCENE.STYLE,
  KNOWLEDGE_SCENE.GENRE,
  KNOWLEDGE_SCENE.SCENE_PROMPT,
  KNOWLEDGE_SCENE.SCREENPLAY_NOVEL,
  KNOWLEDGE_SCENE.AI_STORYBOARD,
  KNOWLEDGE_SCENE.STORYBOARD_REF,
  KNOWLEDGE_SCENE.STORYBOARD_T2I,
  KNOWLEDGE_SCENE.COMPOSITION,
  KNOWLEDGE_SCENE.VIDEO_EFFECT,
  KNOWLEDGE_SCENE.SEE_DANCE2,
  KNOWLEDGE_SCENE.CAMERA,
  KNOWLEDGE_SCENE.PALETTE,
  KNOWLEDGE_SCENE.EXPRESSION,
];

export const isKnowledgeScene = (v: unknown): v is KnowledgeSceneValue =>
  typeof v === "number" && (KNOWLEDGE_SCENE_VALUES as readonly number[]).includes(v);

/**
 * 类型 → 业务串（竞品 `m` 对象原文）。
 * 注意 `Genre→theme`、`Voice→tone`、`ScreenplayNovel→novel_to_script`、`Composition→storyboard`
 * 四处**枚举名与业务串不同名**，这是竞品既有事实，不是我方笔误。
 */
export const KNOWLEDGE_SCENE_SLUG: Readonly<Record<number, string>> = {
  [KNOWLEDGE_SCENE.UNSET]: "",
  [KNOWLEDGE_SCENE.STYLE]: "style",
  [KNOWLEDGE_SCENE.GENRE]: "theme",
  [KNOWLEDGE_SCENE.COMPOSITION]: "storyboard",
  [KNOWLEDGE_SCENE.VIDEO_EFFECT]: "video_effect",
  [KNOWLEDGE_SCENE.AI_STORYBOARD]: "ai_storyboard",
  [KNOWLEDGE_SCENE.STORYBOARD_T2I]: "storyboard_t2i",
  [KNOWLEDGE_SCENE.SEE_DANCE2]: "seedance2",
  [KNOWLEDGE_SCENE.SCREENPLAY_NOVEL]: "novel_to_script",
  [KNOWLEDGE_SCENE.STORYBOARD_REF]: "storyboard_ref",
  [KNOWLEDGE_SCENE.VOICE]: "tone",
  [KNOWLEDGE_SCENE.SCENE_PROMPT]: "storyboard_prompt",
  [KNOWLEDGE_SCENE.CAMERA]: "camera",
  [KNOWLEDGE_SCENE.PALETTE]: "palette",
  [KNOWLEDGE_SCENE.EXPRESSION]: "expression",
  [KNOWLEDGE_SCENE.AUDIO_LIBRARY]: "audio_library",
};

/** 业务串 → 类型（反查；空串不参与） */
export const knowledgeSceneBySlug = (slug: string): KnowledgeSceneValue | undefined => {
  const hit = Object.entries(KNOWLEDGE_SCENE_SLUG).find(([, s]) => s === slug);
  return hit ? (Number(hit[0]) as KnowledgeSceneValue) : undefined;
};

/**
 * 类型 → i18n key 后缀（竞品 `y` 对象原文）。
 * 竞品把 17(Palette) 映射到 `canvas.preset.palette` 而不是 `knowledgeBase.type.*`，
 * 这里保留原样并单独标注，避免前端照抄时找不到 key。
 */
export const KNOWLEDGE_SCENE_I18N: Readonly<Record<number, string>> = {
  [KNOWLEDGE_SCENE.STYLE]: "style",
  [KNOWLEDGE_SCENE.GENRE]: "genre",
  [KNOWLEDGE_SCENE.COMPOSITION]: "composition",
  [KNOWLEDGE_SCENE.VIDEO_EFFECT]: "videoEffect",
  [KNOWLEDGE_SCENE.AI_STORYBOARD]: "aiStoryboard",
  [KNOWLEDGE_SCENE.STORYBOARD_T2I]: "storyboardT2i",
  [KNOWLEDGE_SCENE.SCREENPLAY_NOVEL]: "screenplayNovel",
  [KNOWLEDGE_SCENE.STORYBOARD_REF]: "storyboardRef",
  [KNOWLEDGE_SCENE.VOICE]: "voice",
  [KNOWLEDGE_SCENE.SCENE_PROMPT]: "storyboardPrompt",
  [KNOWLEDGE_SCENE.AUDIO_LIBRARY]: "audioLibrary",
};

/** 单个场景的字段规则（竞品 `_` 对象，只保留我方 API 有对应字段的部分） */
export interface KnowledgeSceneRule {
  /** 名称最大长度（竞品每类不同：10 / 20 / 50） */
  nameMaxLength: number;
  /** 模板正文（我方 `content` 对应竞品 `prompt_template`）是否必填 */
  promptRequired: boolean;
  /** 模板正文最大长度（0 = 该场景不限制，竞品也无上限声明） */
  promptMaxLength: number;
  /** 封面是否必填（竞品仅 3 分镜构图 / 4 视频特效 必填） */
  coverRequired: boolean;
  /** 竞品是否在列表里显示 prompt 列（音频模版与题材不显示） */
  promptColumn: boolean;
  /** 竞品标为首期上线（phase1:!0） */
  phase1: boolean;
}

/**
 * 每类规则表。取值逐条对应竞品 `_` 对象；`UNSET(0)` 与竞品没有的类给"不限制"。
 * 竞品对 11/6 用的是 `anyPrompt`（三选一必填），我方收敛成「正文必填」并在此注明差异。
 */
export const KNOWLEDGE_SCENE_RULES: Readonly<Record<number, KnowledgeSceneRule>> = {
  [KNOWLEDGE_SCENE.UNSET]: { nameMaxLength: 200, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.VOICE]: { nameMaxLength: 10, promptRequired: true, promptMaxLength: 50, coverRequired: false, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.AUDIO_LIBRARY]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: false, phase1: true },
  [KNOWLEDGE_SCENE.STYLE]: { nameMaxLength: 10, promptRequired: true, promptMaxLength: 2000, coverRequired: false, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.GENRE]: { nameMaxLength: 10, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: false, phase1: true },
  [KNOWLEDGE_SCENE.SCENE_PROMPT]: { nameMaxLength: 50, promptRequired: true, promptMaxLength: 500, coverRequired: false, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.SCREENPLAY_NOVEL]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 5000, coverRequired: false, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.AI_STORYBOARD]: { nameMaxLength: 50, promptRequired: true, promptMaxLength: 20000, coverRequired: false, promptColumn: true, phase1: true },
  // phase1:!1 —— 竞品未上线，我方照样收数据（不阻塞），但前端不加 tab
  [KNOWLEDGE_SCENE.STORYBOARD_REF]: { nameMaxLength: 20, promptRequired: true, promptMaxLength: 5000, coverRequired: false, promptColumn: true, phase1: false },
  [KNOWLEDGE_SCENE.STORYBOARD_T2I]: { nameMaxLength: 20, promptRequired: true, promptMaxLength: 5000, coverRequired: false, promptColumn: true, phase1: false },
  [KNOWLEDGE_SCENE.COMPOSITION]: { nameMaxLength: 10, promptRequired: true, promptMaxLength: 200, coverRequired: true, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.VIDEO_EFFECT]: { nameMaxLength: 10, promptRequired: true, promptMaxLength: 200, coverRequired: true, promptColumn: true, phase1: true },
  [KNOWLEDGE_SCENE.SEE_DANCE2]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: true, phase1: false },
  [KNOWLEDGE_SCENE.CAMERA]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: true, phase1: false },
  [KNOWLEDGE_SCENE.PALETTE]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: true, phase1: false },
  [KNOWLEDGE_SCENE.EXPRESSION]: { nameMaxLength: 50, promptRequired: false, promptMaxLength: 0, coverRequired: false, promptColumn: true, phase1: false },
};

export const knowledgeSceneRule = (scene: number): KnowledgeSceneRule =>
  KNOWLEDGE_SCENE_RULES[scene] ?? KNOWLEDGE_SCENE_RULES[KNOWLEDGE_SCENE.UNSET]!;

/** 列表 tab（竞品 `o` 对象原文顺序；columns 是竞品真实表头） */
export interface KnowledgeSceneTab {
  /** 0 代表"全部"（竞品 tab key 用字符串 "all"） */
  scene: KnowledgeSceneValue;
  /** 竞品 tab key，`"all"` 或数字 */
  key: string | number;
  i18nKey: string;
  columns: readonly string[];
  phase1: boolean;
}

export const KNOWLEDGE_SCENE_TABS: readonly KnowledgeSceneTab[] = [
  { scene: KNOWLEDGE_SCENE.UNSET, key: "all", i18nKey: "knowledgeBase.tab.all", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.VOICE, key: 14, i18nKey: "knowledgeBase.tab.voice", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.AUDIO_LIBRARY, key: 20, i18nKey: "knowledgeBase.tab.audioLibrary", columns: ["name", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.STYLE, key: 1, i18nKey: "knowledgeBase.tab.style", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.GENRE, key: 2, i18nKey: "knowledgeBase.tab.genre", columns: ["name", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.SCENE_PROMPT, key: 15, i18nKey: "knowledgeBase.tab.storyboardPrompt", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.SCREENPLAY_NOVEL, key: 9, i18nKey: "knowledgeBase.tab.screenplayNovel", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.AI_STORYBOARD, key: 5, i18nKey: "knowledgeBase.tab.aiStoryboardOnestep", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: true },
  { scene: KNOWLEDGE_SCENE.STORYBOARD_REF, key: 11, i18nKey: "knowledgeBase.tab.storyboardRef", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: false },
  { scene: KNOWLEDGE_SCENE.STORYBOARD_T2I, key: 6, i18nKey: "knowledgeBase.tab.storyboardT2i", columns: ["name", "prompt", "status", "updater", "updated_at", "actions"], phase1: false },
];

/** 首期上线的 tab（竞品 `o.filter(e => e.phase1)`） */
export const knowledgePhase1Tabs = (): readonly KnowledgeSceneTab[] =>
  KNOWLEDGE_SCENE_TABS.filter((t) => t.phase1);

/**
 * 按场景规则校验一条模板资产的字段，返回首个错误（无错返回 null）。
 * 与 zod 的基础校验分工：zod 管类型与绝对上限，这里管**每类不同**的上限与必填。
 */
export const validateKnowledgeSceneFields = (
  scene: number,
  input: { title?: string; content?: string | null; coverUri?: string | null },
): { field: string; message: string } | null => {
  const rule = knowledgeSceneRule(scene);
  if (input.title !== undefined && input.title.length > rule.nameMaxLength) {
    return { field: "title", message: `name must be at most ${rule.nameMaxLength} characters for this scene` };
  }
  const content = input.content ?? "";
  if (rule.promptRequired && content.trim().length === 0) {
    return { field: "content", message: "content is required for this scene" };
  }
  if (rule.promptMaxLength > 0 && content.length > rule.promptMaxLength) {
    return { field: "content", message: `content must be at most ${rule.promptMaxLength} characters for this scene` };
  }
  if (rule.coverRequired && !input.coverUri) {
    return { field: "cover_uri", message: "cover_uri is required for this scene" };
  }
  return null;
};
