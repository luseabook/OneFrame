import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";

// MVP 敏感词最小实现：内置高风险词 + env 扩展（MODERATION_WORDS 逗号分隔）。
// 供应商审核/审核回调在 P2 接入；此处先保证确定性拦截与 745801 错误定位。
const BUILTIN_WORDS = [
  "赌博",
  "毒品",
  "枪支",
  "恐怖主义",
  "色情",
  "诈骗教程",
  "制毒",
  "爆炸物",
];

/** 内置敏感词（输入审核与 LLM 输出审核共用） */
export const BUILTIN_MODERATION_WORDS = BUILTIN_WORDS;

/** 解析生效词表：内置词 + MODERATION_WORDS 扩展 */
export function resolveModerationWords(): string[] {
  const extra = (env.MODERATION_WORDS ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  return [...BUILTIN_WORDS, ...extra];
}

@Injectable()
export class ModerationService {
  private readonly words: string[];

  constructor() {
    this.words = resolveModerationWords();
  }

  assertText(text: string | null | undefined, field: string): void {
    if (!env.MODERATION_ENABLED || !text) return;
    const lower = text.toLowerCase();
    const hit = this.words.find((word) => lower.includes(word.toLowerCase()));
    if (hit) {
      throw new AppError(ErrorCode.INPUT_REJECTED, "内容包含敏感词，请修改后重试", {
        field,
        keyword: hit,
      });
    }
  }

  assertPrompt(prompt: string | null | undefined, field = "input.prompt"): void {
    this.assertText(prompt, field);
  }
}

// ── 内容安全外延（模块 #25 收尾）：词库分类 + 检测结果 ────────────────────
//
// 为什么分类/等级单独一张表而不是改词表结构：`BUILTIN_MODERATION_WORDS` 已被
// 输入审核（围栏）与输出审核共用，改它的形状等于改两处拦截语义；这里只做**附加**
// 标注——词表仍然是唯一事实来源，分类缺省 `custom/2`（未标注的新词按"需复核"处理）。

export type ModerationCategory =
  | "gambling"
  | "drugs"
  | "weapons"
  | "terrorism"
  | "porn"
  | "fraud"
  | "violence"
  | "custom";

export type ModerationLevel = 1 | 2 | 3;

export interface ModerationHit {
  word: string;
  index: number;
  category: ModerationCategory;
  level: ModerationLevel;
}

export type ModerationAction = "allow" | "review" | "block";

/** 内置词的分类与等级（词本身仍来自 BUILTIN_MODERATION_WORDS，不另维护一份词表） */
const WORD_META: Record<string, { category: ModerationCategory; level: ModerationLevel }> = {
  赌博: { category: "gambling", level: 3 },
  毒品: { category: "drugs", level: 3 },
  枪支: { category: "weapons", level: 3 },
  恐怖主义: { category: "terrorism", level: 3 },
  色情: { category: "porn", level: 3 },
  诈骗教程: { category: "fraud", level: 3 },
  制毒: { category: "drugs", level: 3 },
  爆炸物: { category: "weapons", level: 3 },
};

/** 按等级决定动作：3 拦截 / 2 复核 / 无命中放行 */
export function actionForHits(hits: ReadonlyArray<ModerationHit>): ModerationAction {
  if (hits.length === 0) return "allow";
  const maxLevel = hits.reduce((max, hit) => (hit.level > max ? hit.level : max), 1 as ModerationLevel);
  if (maxLevel >= 3) return "block";
  if (maxLevel === 2) return "review";
  return "allow";
}

export interface TextDetectResult {
  enabled: boolean;
  risky: boolean;
  action: ModerationAction;
  hits: ModerationHit[];
  /** 命中词的分类汇总（运营看板按类聚合用） */
  categories: ModerationCategory[];
  scanned_chars: number;
}

@Injectable()
export class ModerationDetectService {
  /** 词表来自同一个 resolveModerationWords()，避免"拦截用一套、检测用另一套" */
  private readonly words: string[] = resolveModerationWords();

  detect(text: string): TextDetectResult {
    const enabled = env.MODERATION_ENABLED;
    if (!enabled || !text) {
      return {
        enabled,
        risky: false,
        action: "allow",
        hits: [],
        categories: [],
        scanned_chars: text.length,
      };
    }
    const lower = text.toLowerCase();
    const hits: ModerationHit[] = [];
    // 逐词扫描而不是正则拼接：词来自配置（可能含正则元字符），拼正则会误命中
    for (const word of this.words) {
      const needle = word.toLowerCase();
      if (!needle) continue;
      let from = 0;
      for (;;) {
        const index = lower.indexOf(needle, from);
        if (index < 0) break;
        const meta = WORD_META[word] ?? { category: "custom" as ModerationCategory, level: 2 as ModerationLevel };
        hits.push({ word, index, category: meta.category, level: meta.level });
        from = index + needle.length;
        if (hits.length >= 200) break; // 上限：极端长文本不放大返回体
      }
      if (hits.length >= 200) break;
    }
    hits.sort((a, b) => a.index - b.index);
    const categories = [...new Set(hits.map((hit) => hit.category))];
    return {
      enabled,
      risky: hits.length > 0,
      action: actionForHits(hits),
      hits,
      categories,
      scanned_chars: text.length,
    };
  }
}
