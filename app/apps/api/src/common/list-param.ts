import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";

/**
 * 入站「列表形」参数的统一封顶（第 120 批）
 *
 * 为什么需要它（先量的事实）：
 * 同一个语义的列表字段，在一个入口封了顶、在另一个入口没封 —— 例如
 * `knowledge` 正文的 `tags` 是 `z.array(...).max(20)`，而同一字段的 **query 入口**
 * 是 `z.union([z.string(), z.array(z.string())])`，逐项 `.max(40)` 只管单项长度，
 * 不限项数；`?tags=a&tags=b&...` 在 48MiB bodyLimit（`main.ts`）之内可以塞几十万项。
 * 这类缺口不会让类型检查 / lint / 构建 / 总闸变红：语法完全合法，测试也只走小样本。
 *
 * 三个入口共用一套语义，避免「哪里记得、哪里忘了」：
 * - `parseListParam`：controller 里手写 `split(",")` 的位置（`?ids=a,b`）；
 * - `csvListQuery`：zod query schema 的 `union(string, array)` 形状；
 * - `splitCsvList`：需要自己继续做类型校验的 transform（如 `sp_type` 转整数）。
 *
 * 上限取值不是拍脑袋，全部复用仓库里已经存在的业务上限：
 * - `MAX_TAG_ITEMS = 20`：与 `knowledge` / `market` 正文 `tags` / `tag_ids` 的
 *   `.max(20)` 一致（同一语义、同一上限）；
 * - `MAX_ID_ITEMS = 100`：与列表分页 `page_size` 的上限一致 —— 一次「按 id 批量取」
 *   不应超过一页；web 端 `tasks?ids=` 轮询也只是当前页的条目。
 */

/** 标签 / 分类类列表的项数上限（与正文 `tags` 的既有上限一致） */
export const MAX_TAG_ITEMS = 20;

/** id 类列表的项数上限（与列表分页 `page_size` 的上限一致） */
export const MAX_ID_ITEMS = 100;

/** `a,b,c` 或重复参数 `?k=a&k=b` → 去空白、去空项后的数组（不做项数校验） */
export function splitCsvList(raw: string | readonly string[]): string[] {
  const parts = typeof raw === "string" ? raw.split(",") : raw.slice();
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 超限时的统一文案（手写路径与 zod 路径共用，避免两套措辞漂移） */
export function tooManyListItems(field: string, max: number): string {
  return `too many ${field}: at most ${max}`;
}

/**
 * 解析查询参数里的列表形字段：`undefined` 原样返回（不参与过滤），
 * 空串 / 只有逗号 → `[]`（调用方按「不过滤」处理，与改造前语义一致）。
 *
 * @throws AppError(INVALID_PARAM) 超过 `max` 项，`field` 指回入参字段
 */
export function parseListParam(
  raw: string | readonly string[] | undefined,
  field: string,
  max: number,
): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = splitCsvList(raw);
  if (items.length > max) {
    throw new AppError(ErrorCode.INVALID_PARAM, tooManyListItems(field, max), { field });
  }
  return items;
}

/**
 * 原始 union 形状：只表达「逗号串或重复 query 参数」，**不含项数上限**。
 *
 * 只给「拿到字符串后还要逐项做类型转换」的入口用（如 `sp_type` → 整数）：
 * 转换里必须调 `splitCsvList` + `tooManyListItems` 补上限。除此之外，
 * `z.union([... z.array(...)])` 这个形状只允许出现在本文件
 * （`inbound-list-bounds.spec.ts` 用 AST 盯着，别处出现就红）。
 */
export const csvListRaw = z.union([z.string(), z.array(z.string())]);

/**
 * zod query schema 版：接受 `?tags=a,b` 与 `?tags=a&tags=b` 两种形状，
 * 输出 `string[] | undefined`，超过 `max` 项时走 `parseOrThrow` → 400101。
 */
export function csvListQuery(field: string, max: number) {
  return csvListRaw
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const items = splitCsvList(value);
      if (items.length > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: tooManyListItems(field, max) });
        return z.NEVER;
      }
      return items;
    });
}