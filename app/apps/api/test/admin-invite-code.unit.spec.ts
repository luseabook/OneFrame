import { describe, expect, it } from "vitest";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
  maskPhone,
} from "../src/modules/admin/admin-community.service";
import { AI_LABEL_CSV_HEADER, csvEscape, readAiLabel } from "../src/modules/admin/admin-ai-label.service";

/**
 * 纯函数单测（契约 §5）：本机没有 PG/Redis 也能跑，是这批 P2 的**门禁**。
 *
 * 为什么只测这几个函数：它们承载了"不该靠 e2e 才发现"的口径——
 * 码的字母表（决定用户能不能手输）、手机号打码格式（决定会不会泄露明文）、
 * AI 标识 JSONB 的解析（决定审计口径）、CSV 转义（决定导出文件会不会错列）。
 * 其余逻辑依赖真实库，放在 admin-community.spec.ts / admin-ai-label.spec.ts（只写不跑）。
 *
 * 注意：这里 import 的是 service 文件，但 `db` 只是构造了 pg Pool（惰性连接），
 * 不查库就不会有连接。所以本文件不需要 DATABASE_URL 指向真实实例。
 */
describe("邀请码生成（契约 §2.3）", () => {
  it("字母表与契约逐字一致（去掉了 0/O/1/I），且是 32 进位", () => {
    // 契约 §2.3 给的串就是唯一事实：改它等于改"用户能不能手输对这个码"
    expect(INVITE_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    // 0/O、1/I 是手输场景最主要的歧义来源（注意字母表**保留** L，与契约一致）
    for (const char of ["0", "O", "1", "I"]) {
      expect(INVITE_CODE_ALPHABET).not.toContain(char);
    }
    expect(INVITE_CODE_LENGTH).toBe(8);
  });

  it("生成的码长度固定、字符全部来自字母表", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const char of code) expect(INVITE_CODE_ALPHABET).toContain(char);
    }
  });

  it("注入 pick 后结果确定（单测无需关心随机源）", () => {
    // 恒取 0 → 字母表第一个字符重复 8 次
    expect(generateInviteCode(() => 0)).toBe("A".repeat(INVITE_CODE_LENGTH));
    // 恒取最后一个下标 → 字母表最后一个字符
    const last = INVITE_CODE_ALPHABET[INVITE_CODE_ALPHABET.length - 1];
    expect(generateInviteCode(() => INVITE_CODE_ALPHABET.length - 1)).toBe(last.repeat(INVITE_CODE_LENGTH));
    // 递增序列：验证每一位都按 pick 的**当次**返回值取字符，而不是"取了第一个就重复"
    let calls = 0;
    const sequence = generateInviteCode(() => {
      calls += 1;
      return calls % INVITE_CODE_ALPHABET.length;
    });
    expect(calls).toBe(INVITE_CODE_LENGTH);
    expect(sequence).toBe(
      Array.from(
        { length: INVITE_CODE_LENGTH },
        (_, index) => INVITE_CODE_ALPHABET[(index + 1) % INVITE_CODE_ALPHABET.length],
      ).join(""),
    );
  });

  it("批量生成不重复（40bit 熵下 2000 个码的碰撞概率可忽略）", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 2000; index += 1) codes.add(generateInviteCode());
    // 不要求 100% 无碰撞（理论上可能），但出现重复就意味着随机源坏了
    expect(codes.size).toBeGreaterThanOrEqual(1999);
  });
});

describe("手机号打码（契约 §2.1）", () => {
  it("11 位手机号保留前 3 后 4", () => {
    expect(maskPhone("13812341234")).toBe("138****1234");
    expect(maskPhone(" 13812341234 ")).toBe("138****1234");
  });

  it("隐藏位数按长度自适应（不写死 4 个星）", () => {
    // 13 位异常值：3 + 6 星 + 4 = 13，中间段长度由长度推出来
    expect(maskPhone("1381234567890")).toBe("138******7890");
  });

  it("过短/空值：整串打码或 null，绝不出现\"打码后等于原值\"", () => {
    expect(maskPhone("1234567")).toBe("*******");
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("   ")).toBeNull();
  });
});

describe("AI 标识 JSONB 解析（契约 §2.4）", () => {
  it("完整标签：四个布尔/原因都能取到", () => {
    const view = readAiLabel([
      {
        url: "x",
        meta: {
          ai_label: {
            enabled: true,
            ai_generated: true,
            standard: "GB 45438",
            explicit: true,
            implicit: true,
            explicit_reason: "media_too_large",
          },
        },
      },
    ]);
    expect(view).toEqual({
      has: true,
      enabled: true,
      explicit: true,
      implicit: true,
      explicitReason: "media_too_large",
    });
  });

  it("enabled=false 的标签仍然算\"有标签\"（enabled 与 has 是两个维度）", () => {
    const view = readAiLabel([{ meta: { ai_label: { enabled: false } } }]);
    expect(view.has).toBe(true);
    expect(view.enabled).toBe(false);
    // 没有写 explicit/implicit → null，而不是 false
    expect(view.explicit).toBeNull();
    expect(view.implicit).toBeNull();
    expect(view.explicitReason).toBeNull();
  });

  it("没有标签 / 空数组 / 脏数据：has=false 且全为 null", () => {
    for (const results of [null, undefined, [], [{ url: "x" }], [{ meta: {} }], [{ meta: { ai_label: "oops" } }], "not-an-array"]) {
      const view = readAiLabel(results);
      expect(view.has).toBe(false);
      expect(view.enabled).toBeNull();
      expect(view.explicit).toBeNull();
      expect(view.implicit).toBeNull();
      expect(view.explicitReason).toBeNull();
    }
  });

  it("只看第一条 result（同一任务各 result 共用一份标签）", () => {
    const view = readAiLabel([{ meta: {} }, { meta: { ai_label: { enabled: true } } }]);
    expect(view.has).toBe(false);
  });
});

describe("CSV 转义（契约 §2.4/§2.6）", () => {
  it("逗号/引号/换行整段加引号且内部引号双写", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("null/undefined 导出为空串（不是字面量 null）", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("AI 标识表头列顺序固定", () => {
    expect(AI_LABEL_CSV_HEADER).toBe(
      "task_id,space_id,model,mode,status,has_ai_label,enabled,explicit,implicit,explicit_reason,result_count,finished_at",
    );
  });
});
