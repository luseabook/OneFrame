import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 运营后台「数字输入 → 解析器」类型守卫（第 107 批浏览器 E2E 实测缺陷）。
 *
 * 缺陷形状：Vue 对 `<input type="number">` 上的 **裸 `v-model`** 会自动做 looseToNumber，
 * `""` → 空串仍兜住，但运营一填数字，绑定的 reactive 字段就从 `""` 变成 `0`/`500`。
 * 由于字段的**静态类型**仍是 `string`（初值 `""`），解析器若写 `raw.trim()`：
 *   - typecheck / lint / build 全绿（类型上它确实是 string）；
 *   - 运行期抛 `...trim is not a function`，被上层 catch 成一条看不懂的红条；
 *   - **请求根本发不出去**——第 107 批实测：邀请码「生成」点了没反应，api 访问日志里
 *     一个 POST 都没有；价格面板的编辑/新建是同一条路径（尚未被 E2E 写用例覆盖）。
 *
 * 所以这里钉的不是"某个文案"，而是**收口方式**：
 *   1. 两个已知解析器必须接受 `string | number` 并用 `String(raw)` 收口；
 *   2. 全目录扫描：任何 `type="number"` 的输入若用裸 `v-model`（而非 `v-model.number`），
 *      所在文件必须带 `String(` 与 `Number.isInteger(` —— 即"先收成字符串、再严格校验"，
 *      防止下一个面板又直接 `.trim()`。
 *
 * **仍未覆盖**：真实的输入 → 点击 → 请求链路（静态守卫证明不了运行期），
 * 邀请码那条由 `_acceptance/e2e-admin-panels.cjs` 的写用例负责；价格写操作暂无 E2E。
 */
const ADMIN_DIR = join(__dirname, "..", "..", "web", "components", "admin");

function readPanel(name: string): string {
  return readFileSync(join(ADMIN_DIR, name), "utf8");
}

/** 抽出所有 `<input …type="number"…>` 标签（属性可跨行；`[^>]` 天然吞换行）。 */
function numericInputs(source: string): string[] {
  return source.match(/<input\b[^>]*type="number"[^>]*>/g) ?? [];
}

describe("邀请码面板：数字解析器接受 number 并用 String() 收口", () => {
  const source = readPanel("AdminInviteCodesPanel.vue");

  it("签名是 string | number（裸 v-model 会送进 number）", () => {
    expect(source).toMatch(/function\s+parseIntField\(\s*raw:\s*string\s*\|\s*number/);
  });

  it("用 String(raw) 收口，不再直接对入参 trim", () => {
    expect(source).toContain("String(raw).trim()");
    // 直接对入参调 .trim() 就是本次缺陷本身；`createForm.expiresAt.trim()` 是字符串字段，不算
    expect(source).not.toMatch(/\braw\.trim\(\)/);
  });
});

describe("价格面板：数字解析器接受 number 并用 String() 收口", () => {
  const source = readPanel("AdminPricePanel.vue");

  it("签名是 string | number", () => {
    expect(source).toMatch(/function\s+parseIntInput\(\s*raw:\s*string\s*\|\s*number/);
  });

  it("用 String(raw) 收口，不再直接对入参 trim", () => {
    expect(source).toContain("String(raw).trim()");
    expect(source).not.toMatch(/\braw\.trim\(\)/);
  });
});

describe("全目录扫描：裸 v-model 的数字输入必须配套校验收口", () => {
  const files = readdirSync(ADMIN_DIR).filter((name) => name.endsWith(".vue"));

  /** 每个文件里「用裸 v-model 绑定的数字输入」条数 */
  const plainBindings = files
    .map((name) => {
      const source = readFileSync(join(ADMIN_DIR, name), "utf8");
      const plain = numericInputs(source).filter((tag) => !tag.includes("v-model.number"));
      return { name, source, plain: plain.length };
    })
    .filter((entry) => entry.plain > 0);

  it("目录里确实有面板在用裸 v-model 绑数字（守卫不是空跑）", () => {
    expect(plainBindings.length).toBeGreaterThan(0);
  });

  it("每个裸绑定数字的文件都做了 String() 收口 + Number.isInteger 校验", () => {
    const offenders = plainBindings
      .filter((entry) => !entry.source.includes("String(") || !entry.source.includes("Number.isInteger("))
      .map((entry) => entry.name);
    expect(offenders).toEqual([]);
  });

  it("显式 v-model.number 的面板（市场）不需要收口也不会踩到", () => {
    const market = readPanel("AdminMarketPanel.vue");
    const tags = numericInputs(market);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => tag.includes("v-model.number"))).toBe(true);
  });
});