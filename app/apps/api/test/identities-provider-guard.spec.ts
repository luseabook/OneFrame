import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 静态锁：按标识符查 `identities` 时**必须**带 `provider` 条件（第 130 批）。
 *
 * ## 为什么需要它
 *
 * `identities.phone_hash` 这一列从第 130 批起实际含义是「**该 provider 的标识符哈希**」：
 * `provider='phone'` 存手机号 HMAC，`provider='email'` 存邮箱 HMAC（复用
 * `uq_identities_phone(provider, phone_hash)` 这条唯一索引，见 `database.md`）。
 *
 * 列名没改（铁律 3：不为命名做迁移），于是新增了一个**只靠人记**的约束：
 * 任何 `where eq(identities.phoneHash, hash)` 只要漏掉 `provider`，就会把邮箱行当手机号行
 * 捞出来 —— 表现为"手机号登录命中了别人的账号"这类**跨身份串号**。
 * 这种错误类型检查、构建、单测都不会报：只有真的同时存在两类行时才暴露。
 *
 * ## 判据形态
 *
 * 按**语法形态**定位，不按裸子串：以 `identities.phoneHash` / `identities.externalId`
 * 出现的位置为中心取一段窗口，要求窗口内出现 `identities.provider`。
 * 缺点已知：窗口是启发式的，密集代码里可能"借"到相邻语句的 provider 条件。
 * 所以它防的是**遗漏**，不是恶意绕过——真正的防线仍是 code review。
 */
const SRC = join(__dirname, "..", "src");
const WINDOW = 600;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
}

type Offence = { file: string; line: number; snippet: string };

function scan(): Offence[] {
  const files: string[] = [];
  walk(SRC, files);
  const offences: Offence[] = [];
  for (const file of files.sort()) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [/identities\.phoneHash/g, /identities\.externalId/g]) {
      for (const match of text.matchAll(pattern)) {
        const at = match.index ?? 0;
        const start = Math.max(0, at - WINDOW);
        const window = text.slice(start, at + WINDOW);
        if (window.includes("identities.provider")) continue;
        const line = text.slice(0, at).split("\n").length;
        offences.push({
          file: relative(join(__dirname, ".."), file).replaceAll("\\", "/"),
          line,
          snippet: text.slice(at, at + 80).split("\n")[0] ?? "",
        });
      }
    }
  }
  return offences;
}

describe("identities 查询必须带 provider", () => {
  it("按 phoneHash / externalId 过滤时，同一条语句里必须出现 identities.provider", () => {
    const offences = scan();
    expect(
      offences.map((o) => `${o.file}:${o.line} ${o.snippet}`),
      "以下位置按标识符查 identities 却没有限定 provider —— 邮箱行会被当手机号行捞出来",
    ).toEqual([]);
  });

  it("守卫自身能跑出结果（防空跑成假绿）", () => {
    // 只要仓库里确实有"按标识符查 identities"的代码，扫描就必须命中过至少一处；
    // 一处都没有说明扫描路径写错了（例如目录名改了），那时本守卫等于不存在。
    const files: string[] = [];
    walk(SRC, files);
    const hits = files.filter((f) => /identities\.(phoneHash|externalId)/.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThan(0);
  });
});
