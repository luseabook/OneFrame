import { describe, expect, it } from "vitest";
import { ICP_PROVINCE_PREFIXES, isValidIcp, normalizeIcp } from "./icp-format";

/**
 * 备案号形状判据的用例（`deployment.md` §4.4 / `icp-guard.ts` 共用）。
 *
 * 这套用例的来历值得写下来：判据第一版是"含 ICP备 + 至少 4 位数字"，宽松版能过；
 * 收紧成整串锚定后**又误杀了带空格的真实号** —— 备案系统页面上显示的就是
 * `京 ICP 备 2024000000 号-1`，运维复制粘贴就踩雷。
 * 所以这里"好的"和"坏的"两面都锁：只撞坏值会矫枉过正，只撞好值会放过假号。
 */
describe("normalizeIcp：空白归一化", () => {
  it("去掉中间与首尾的所有空白（备案系统页面的显示形态）", () => {
    expect(normalizeIcp("  京 ICP 备 2024000000 号-1 ")).toBe("京ICP备2024000000号-1");
  });

  it("`-1` 前的空格也要去掉", () => {
    expect(normalizeIcp("京ICP备2024000000号 -1")).toBe("京ICP备2024000000号-1");
  });

  it("空值与 undefined 都归一到空串（页脚据此不渲染）", () => {
    expect(normalizeIcp("")).toBe("");
    expect(normalizeIcp(undefined)).toBe("");
    expect(normalizeIcp(null)).toBe("");
    expect(normalizeIcp("   ")).toBe("");
  });
});

describe("isValidIcp：真实号必须通过", () => {
  it.each([
    ["京ICP备2024000000号-1", "最常见形态：省简称 + 备 + 数字 + 号 + 后缀"],
    ["京ICP证030173号", "经营性备案（ICP证）"],
    ["粤ICP备12345678号", "无后缀"],
    ["沪ICP备09000000号-2", "另一位省份 + 两位后缀"],
    ["京 ICP 备 2024000000 号-1", "带空格（从备案系统复制）"],
    ["京ICP备2024000000号 -1", "后缀前带空格"],
  ])("通过：%s（%s）", (value) => {
    expect(isValidIcp(value)).toBe(true);
  });
});

describe("isValidIcp：占位值与错误形态必须拦下", () => {
  it.each([
    ["TEST-京ICP备0000000号", "INC-01 那次写进线上的形态：前面多了 TEST-"],
    ["pending", "常见占位词"],
    ["TODO", "常见占位词"],
    ["待备案", "中文占位"],
    ["京ICP备2024000000号（上线前替换）", "带后缀说明的占位"],
    ["京公网安备11010502030123号", "公安备案，应写进 ICP_POLICE 而非 ICP_BEIAN"],
    ["", "空值"],
    ["   ", "纯空白"],
    ["京ICP备123号", "数字不足 4 位"],
    ["ICP备2024000000号", "缺省简称"],
    ["京ICP备2024000000", "缺 `号` 结尾"],
  ])("拦下：%s（%s）", (value) => {
    expect(isValidIcp(value)).toBe(false);
  });
});

describe("判据自身的完整性", () => {
  it("31 个省级行政区简称无缺项、无重复", () => {
    expect(ICP_PROVINCE_PREFIXES).toHaveLength(31);
    expect(new Set(ICP_PROVINCE_PREFIXES).size).toBe(31);
  });

  it("每个省简称都能构造出一个合法号（防止某个简称写错字导致误杀）", () => {
    const rejected = ICP_PROVINCE_PREFIXES.filter((p) => !isValidIcp(`${p}ICP备2024000000号`));
    expect(rejected, `以下简称构造的号被判非法：${rejected.join(", ")}`).toEqual([]);
  });
});
