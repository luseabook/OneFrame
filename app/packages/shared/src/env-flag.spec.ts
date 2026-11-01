import { describe, expect, it } from "vitest";
import {
  ENV_FALSE_WORDS,
  ENV_TRUE_WORDS,
  parseEnvEnum,
  parseEnvFlag,
  readEnvEnum,
  readEnvFlag,
  STORAGE_DRIVER_SPEC,
  STORAGE_S3_FORCE_PATH_STYLE_SPEC,
} from "./env-flag";

/**
 * 唯一入口的行为契约：未设置 / 空白 = 没配置 → 默认值；接受表固定；坏值立刻抛；
 * 枚举返回规范拼写；默认值与 values 本身也校验。
 *
 * 这些用例只经由注入的 env 读取，**不碰 process.env** —— 同批其它 spec 并行跑时不互相污染。
 */
describe("readEnvFlag", () => {
  it("未设置 / 空白 / 纯空白 → 默认值（空白是没配置，不是 false）", () => {
    for (const raw of [undefined, "", "   ", "\t", "\r\n"]) {
      expect(readEnvFlag("AI_LABEL_ENABLED", { default: true }, raw === undefined ? {} : { AI_LABEL_ENABLED: raw })).toBe(
        true,
      );
      expect(
        readEnvFlag("STORAGE_S3_FORCE_PATH_STYLE", { default: false }, raw === undefined ? {} : { STORAGE_S3_FORCE_PATH_STYLE: raw }),
      ).toBe(false);
    }
  });

  it("接受表：开 = 1 / true / yes / on，关 = 0 / false / no / off（大小写不敏感、首尾空白裁掉）", () => {
    for (const raw of ENV_TRUE_WORDS) {
      expect(readEnvFlag("X", { default: false }, { X: raw })).toBe(true);
    }
    for (const raw of ENV_FALSE_WORDS) {
      expect(readEnvFlag("X", { default: true }, { X: raw })).toBe(false);
    }
    for (const raw of ["TRUE", "True", "  true  ", "YES", "On", "OFF", "False", "\t0\n"]) {
      const expected = (ENV_TRUE_WORDS as readonly string[]).includes(raw.trim().toLowerCase());
      expect(readEnvFlag("X", { default: !expected }, { X: raw })).toBe(expected);
    }
  });

  it.each(["enable", "disabled", "t", "f", "y", "n", "2", "-1", "真", "是"])("坏值 %j 立刻抛 RangeError（带变量名与原始值）", (raw) => {
    expect(() => readEnvFlag("AI_LABEL_ENABLED", { default: true }, { AI_LABEL_ENABLED: raw })).toThrowError(
      `invalid AI_LABEL_ENABLED: ${JSON.stringify(raw)}`,
    );
    expect(() => readEnvFlag("AI_LABEL_ENABLED", { default: true }, { AI_LABEL_ENABLED: raw })).toThrow(RangeError);
  });

  it("默认值本人写错也抛（与是否设置环境变量无关）", () => {
    expect(() =>
      readEnvFlag("X", { default: "false" as unknown as boolean }, {}),
    ).toThrowError(/invalid default for X/);
  });

  it("错误文案里出现接受表与「blank = unset」，不出现误导性的 default 字样", () => {
    let message = "";
    try {
      readEnvFlag("AI_LABEL_ENABLED", { default: true }, { AI_LABEL_ENABLED: "maybe" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("1, true, yes, on / 0, false, no, off");
    expect(message).toContain("blank = unset");
    expect(message).not.toMatch(/default/i);
  });
});

describe("readEnvEnum", () => {
  it("未设置 / 空白 → 默认值", () => {
    expect(readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC, {})).toBe("local");
  });

  it("按 values 逐项不区分大小写匹配，返回规范拼写而不是原样传下去", () => {
    expect(readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC, { STORAGE_DRIVER: "S3" })).toBe("s3");
    expect(readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC, { STORAGE_DRIVER: " Local " })).toBe("local");
    expect(readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC, { STORAGE_DRIVER: "s3" })).toBe("s3");
  });

  it("未知取值立刻抛 RangeError，文案列出全部合法取值", () => {
    expect(() =>
      readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC, { STORAGE_DRIVER: "gcs" }),
    ).toThrowError('invalid STORAGE_DRIVER: "gcs" (must be one of: local, s3; blank = unset)');
  });

  it("spec 本身写错也抛：values 为空 / 有空白 / 大小写重复 / 默认值不在 values 里", () => {
    expect(() => readEnvEnum("X", { values: [], default: "a" as never }, {})).toThrowError(/values must not be empty/);
    expect(() =>
      readEnvEnum("X", { values: ["a", " a "] as readonly string[], default: "a" }, {}),
    ).toThrowError(/duplicate value|surrounding blanks/);
    expect(() =>
      readEnvEnum("X", { values: ["a", "A"] as readonly string[], default: "a" }, {}),
    ).toThrowError(/duplicate value/);
    expect(() =>
      readEnvEnum("X", { values: ["a", "b"], default: "c" }, {}),
    ).toThrowError('invalid default for X: "c" (must be one of: a, b)');
  });
});

describe("parseEnvFlag / parseEnvEnum（不设默认值的裸解析）", () => {
  it("未设置 / 空白 → undefined，由调用方决定默认值", () => {
    expect(parseEnvFlag("X", undefined)).toBeUndefined();
    expect(parseEnvFlag("X", "  ")).toBeUndefined();
    expect(parseEnvEnum("X", undefined, ["a"])).toBeUndefined();
    expect(parseEnvEnum("X", "", ["a"])).toBeUndefined();
  });
});

describe("跨包共用的取值表", () => {
  it("存储驱动与 path-style 的表只有一份（api 生成访问 URL、worker 构造存储同口径）", () => {
    expect(STORAGE_DRIVER_SPEC).toEqual({ values: ["local", "s3"], default: "local" });
    expect(STORAGE_S3_FORCE_PATH_STYLE_SPEC).toEqual({ default: false });
  });
});