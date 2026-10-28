import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 台账**内部一致性**守卫（第 103 批）。
 *
 * ## 为什么需要它
 * 这份台账在十几个批次里反复出现「同一批数字写在四处、改了其中一处」的问题：
 * - 第 84 批发现 #12 的「竞品 29+12 全覆盖」是**重复记账**（管理侧 18 行已归 #27）；
 * - 第 98 批发现 #17 的 0.08 是**记账过期**（两项缺口其实早已实现且有测试）；
 * - 第 103 批又发现：**模块行已经重算到 202.67，但 §0 结论与 §3.4 汇总表还写着 202.58**
 *   （第 97 批 +0.01、第 98 批 +0.08 都只改了模块行，忘了改汇总）。
 *
 * 前两次是「口径错」，这次是「**算术漂移**」—— 后者更适合用测试钉住：
 * 模块行是**唯一事实源**，其余汇总数字必须能由它重算出来。
 *
 * ## 断什么
 * 1. 28 行模块、Σ权重 = 206；
 * 2. 每行 `加权得分 ≈ 权重 × 完成度`（允许 0.011 的两位小数舍入）；
 * 3. Σ加权得分 == §3.4「全站」的已完成值；
 * 4. Σ(权重 ×(1−完成)) == 剩余权重，且 §0 结论里的剩余值与之相同；
 * 5. §0 结论、§3.4 汇总表、剩余总权重脚注三处**必须彼此一致**；
 * 6. 每个未满 100% 的行都要有非空「主要缺口」（不允许「没有出处的扣分」）。
 *
 * ## 不做什么（诚实边界）
 * 只校验**算术与交叉引用**，不校验「完成度是否公允」—— 那需要人读代码，
 * 是 §5.5 逐项核账的活，测试替代不了。
 */

const LEDGER = join(__dirname, "..", "..", "..", "..", "docs", "07-plan", "implement-progress-vs-reelmate.md");

interface ModuleRow {
  idx: number;
  name: string;
  weight: number;
  pct: number;
  score: number;
  gap: string;
}

/** 解析台账里 **3 张**模块子表（§3.1 A组 / §3.2 B组 / §3.3 C组） */
function parseModules(md: string): ModuleRow[] {
  const lines = md.split("\n");
  const rows: ModuleRow[] = [];
  let inTable = false;

  for (const line of lines) {
    // 表头：`| # | 模块 | 竞品端点 | 权重 | 完成 | 加权得分 | 我方现状 | 主要缺口 |`
    if (line.startsWith("| # |") && line.includes("模块") && line.includes("加权得分")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith("|---")) continue; // 分隔行
    if (!line.startsWith("|")) {
      inTable = false; // 表结束（空行或标题）
      continue;
    }

    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 8 || !/^\d+$/.test(cells[0]!)) continue;

    const [, name, , weightRaw, pctRaw, scoreRaw, , ...gapParts] = cells;
    const wMatch = /\((\d+)\)/.exec(weightRaw ?? "");
    const pMatch = /([\d.]+)\s*%/.exec(pctRaw ?? "");
    if (!wMatch || !pMatch) continue;
    rowPush(rows, {
      idx: Number(cells[0]),
      name: (name ?? "").replace(/\*\*/g, ""),
      weight: Number(wMatch[1]),
      pct: Number(pMatch[1]) / 100,
      score: Number((scoreRaw ?? "").replace(/\*/g, "")),
      gap: (gapParts.join("|") ?? "").trim(),
    });
  }
  return rows;
}

function rowPush(rows: ModuleRow[], row: ModuleRow): void {
  if (Number.isFinite(row.weight) && Number.isFinite(row.pct) && Number.isFinite(row.score)) {
    rows.push(row);
  }
}

/** 取 `key` 之后第一个数字（用于从摘要句子里抽数） */
function pickNumber(md: string, anchor: string, what: string): number {
  const i = md.indexOf(anchor);
  expect(i, `台账里找不到锚点：${what}`).toBeGreaterThan(-1);
  const tail = md.slice(i + anchor.length, i + anchor.length + 160);
  const m = /(\d+(?:\.\d+)?)/.exec(tail);
  expect(m, `锚点「${what}」之后没有数字`).toBeTruthy();
  return Number(m![1]);
}

/**
 * 从表格单元里取**当前值**。
 *
 * 台账的「已清零」写法是 `~~0.08~~ → **0**` —— 直接取第一个数字会拿到**过期的旧值**。
 * 所以有 `→` 时取箭头之后的数，否则取第一个。
 * （这个坑是写守卫时自己踩到的：第一版取到 0.08，误以为台账没改。）
 */
function currentNumber(cell: string): number | null {
  const cleaned = cell.replace(/\*/g, "");
  const arrow = cleaned.lastIndexOf("→");
  const scope = arrow >= 0 ? cleaned.slice(arrow + 1) : cleaned;
  const m = /(\d+(?:\.\d+)?)/.exec(scope);
  return m ? Number(m[1]) : null;
}

describe("台账内部一致性（第 103 批守卫）", () => {
  const md = readFileSync(LEDGER, "utf8");
  const rows = parseModules(md);

  const sumWeight = rows.reduce((s, r) => s + r.weight, 0);
  const sumScore = rows.reduce((s, r) => s + r.score, 0);
  const sumRemain = rows.reduce((s, r) => s + r.weight * (1 - r.pct), 0);

  it("模块表解析完整：28 行、Σ权重 206、编号 1..28 无缺无重", () => {
    expect(rows.length, "模块行数应为 28（§3.1+§3.2+§3.3 三张子表）").toBe(28);
    expect(sumWeight).toBe(206);
    const idxs = rows.map((r) => r.idx).sort((a, b) => a - b);
    expect(idxs).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it("每行「加权得分 = 权重 × 完成度」（允许两位小数舍入）", () => {
    const bad = rows
      .map((r) => ({ ...r, expected: Math.round(r.weight * r.pct * 100) / 100 }))
      .filter((r) => Math.abs(r.expected - r.score) > 0.011);
    expect(
      bad.map((r) => `#${r.idx} ${r.name}: 记 ${r.score}，应为 ${r.expected}`),
    ).toEqual([]);
  });

  it("§3.4 汇总表的三组数字必须能由模块行重算出来", () => {
    // 核心组 / 生态组按台账 §3.4 的成员划分：核心 18 个、生态 10 个
    const CORE = [1, 2, 3, 4, 5, 6, 11, 15, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28];
    const core = rows.filter((r) => CORE.includes(r.idx));
    const eco = rows.filter((r) => !CORE.includes(r.idx));
    expect(core.length + eco.length).toBe(28);
    expect(core.length).toBe(18);

    const coreScore = Math.round(core.reduce((s, r) => s + r.score, 0) * 100) / 100;
    const ecoScore = Math.round(eco.reduce((s, r) => s + r.score, 0) * 100) / 100;
    const allScore = Math.round((coreScore + ecoScore) * 100) / 100;

    // §3.4 表格里的三行
    expect(md, `核心组应记 ${coreScore}`).toContain(`| 核心创作闭环 | 18 | 110 | ${coreScore} |`);
    expect(md, `生态组应记 ${ecoScore}`).toContain(`| 生态与规模化 | 10 | 96 | ${ecoScore} |`);
    expect(md, `全站应记 ${allScore}`).toContain(`| **全站** | **28** | **206** | **${allScore}** |`);

    // 脚注两处同样的数
    expect(md).toContain(`→ 已完成 **${coreScore}**`);
    expect(md).toContain(`→ 已完成 **${ecoScore}**`);
  });

  it("剩余权重：Σ(权重×(1−完成)) == §0 结论 == §3.4 脚注", () => {
    const remain = Math.round(sumRemain * 100) / 100;
    const done = Math.round(sumScore * 100) / 100;

    // §3.4 脚注：「206 − X = Y」
    expect(md, `剩余总权重脚注应为 206 − ${done} = ${remain}`).toContain(
      `206 − ${done} = **${remain}**`,
    );

    // §0 一句话结论：`202.67/206，剩余 3.33`
    expect(md, `§0 结论里的已完成/剩余应为 ${done}/${remain}`).toContain(
      `${done}/206，剩余 ${remain}`,
    );

    // 算术自洽：206 − 已完成 == 剩余（台账按两位小数记，允许 0.011）
    expect(Math.abs(206 - done - remain)).toBeLessThanOrEqual(0.011);
  });

  it("每个未满 100% 的行都必须写清「主要缺口」（不允许没有出处的扣分）", () => {
    const unfinished = rows.filter((r) => r.pct < 1);
    expect(unfinished.length, "本轮应仍有未满 100% 的模块").toBeGreaterThan(0);
    const missing = unfinished.filter((r) => r.gap.replace(/[*\s]/g, "").length < 4);
    expect(missing.map((r) => `#${r.idx} ${r.name}`)).toEqual([]);
  });

  /**
   * §5 缺口表（按剩余权重排序的那张）与模块行必须**逐条对齐**。
   *
   * 这是本批新发现的漂移点：第 97/98 批改了模块行（#23 +0.01、#17 +0.08），
   * 但 §0 与 §3.4 的汇总没跟上。§5 缺口表是第三个会漂的地方 ——
   * 例如 #23 做掉之后，若 §5 仍写「剩余 0.015」，就会让人以为还有活。
   */
  it("§5 缺口表：每条剩余值必须等于对应模块的「权重×(1−完成)」", () => {
    const lines = md.split("\n");
    const start = lines.findIndex((l) => l.startsWith("| 排名 |") && l.includes("剩余"));
    expect(start, "找不到 §5 缺口表表头").toBeGreaterThan(-1);

    const byIdx = new Map(rows.map((r) => [r.idx, r]));
    const mismatched: string[] = [];
    let checked = 0;

    for (let i = start + 2; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.startsWith("|")) break;
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      if (cells[1]!.includes("合计")) continue; // 合计行不参与逐条比对

      // 模块列形如 `**剧本广场（#12）**` / `广告剧 / 转绘 / 内容安全`（多模块合计）
      const ids = [...cells[1]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const w = currentNumber(cells[2]!);
      const r = currentNumber(cells[3]!);
      if (ids.length === 0 || w === null || r === null) continue;

      const expectedW = ids.reduce((s, id) => s + (byIdx.get(id)?.weight ?? 0), 0);
      const expectedR = ids.reduce((s, id) => {
        const row = byIdx.get(id);
        return s + (row ? row.weight * (1 - row.pct) : 0);
      }, 0);
      checked += 1;

      if (Math.abs(w - expectedW) > 0.011) {
        mismatched.push(`§5 第 ${cells[0]} 行（${cells[1]}）：权重记 ${w}，模块行合计 ${expectedW}`);
      }
      if (Math.abs(r - expectedR) > 0.011) {
        mismatched.push(
          `§5 第 ${cells[0]} 行（${cells[1]}）：剩余记 ${r}，模块行算出 ${Math.round(expectedR * 1000) / 1000}`,
        );
      }
    }

    expect(checked, "§5 缺口表至少要核到几条").toBeGreaterThan(3);
    expect(mismatched).toEqual([]);
  });

  it("§5 缺口表的剩余合计必须等于全站剩余（且与合计行自洽）", () => {
    const lines = md.split("\n");
    const start = lines.findIndex((l) => l.startsWith("| 排名 |") && l.includes("剩余"));
    let sum = 0;
    let statedTotal: number | null = null;
    for (let i = start + 2; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.startsWith("|")) break;
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      if (cells[1]!.includes("合计")) {
        statedTotal = currentNumber(cells[3]!);
        continue;
      }
      const r = currentNumber(cells[3]!);
      if (r === null) continue;
      sum += r;
    }
    const remain = Math.round(sumRemain * 100) / 100;
    expect(Math.abs(sum - remain), `§5 逐行剩余合计 ${sum} 应≈全站剩余 ${remain}`).toBeLessThanOrEqual(0.02);
    expect(statedTotal, "§5 合计行缺失").not.toBeNull();
    expect(Math.abs(statedTotal! - remain), `§5 合计行 ${statedTotal} 应≈${remain}`).toBeLessThanOrEqual(0.011);
  });
});
