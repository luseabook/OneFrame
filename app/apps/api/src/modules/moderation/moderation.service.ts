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
