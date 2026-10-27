import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  configFile,
  currentProfile,
  emptyConfig,
  readConfig,
  redactedConfig,
  resolveApiBaseUrl,
  resolveWebBaseUrl,
  writeConfig,
} from "../src/config";
import { REDACTED, redact, redactUrl } from "../src/redact";
import { makeDir } from "./helpers";

/**
 * 凭据落盘与脱敏（`manual/error-codes.md:23`、`commands/account.md:38`）。
 *
 * 这组断言保护的是「token 绝不外泄」这条硬约束：任一输出路径（env info /
 * account info / error.raw）都必须先过 redact 或 redactedConfig。
 */
describe("配置与凭据", () => {
  it("读写往返；文件路径固定在 <dir>/config.json", () => {
    const dir = makeDir();
    writeConfig(dir, {
      ...emptyConfig(),
      api_base_url: "http://api.test/v1",
      current_uid: "u-1",
      profiles: {
        "u-1": {
          uid: "u-1",
          space_id: "100",
          access_token: "secret-token",
          signed_in_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(configFile(dir).endsWith("config.json")).toBe(true);
    const back = readConfig(dir);
    expect(back.api_base_url).toBe("http://api.test/v1");
    expect(currentProfile(back)?.access_token).toBe("secret-token");
  });

  it("POSIX 上配置文件是 0600 语义", () => {
    const dir = makeDir();
    writeConfig(dir, emptyConfig());
    if (process.platform === "win32") {
      // Windows 的 mode 只是提示位，不在此断言（README 已登记该偏离）
      expect(statSync(configFile(dir)).isFile()).toBe(true);
      return;
    }
    expect(statSync(configFile(dir)).mode & 0o777).toBe(0o600);
  });

  it("redactedConfig 永不包含 token / refresh_token", () => {
    const config = {
      ...emptyConfig(),
      current_uid: "u-1",
      profiles: {
        "u-1": {
          uid: "u-1",
          space_id: "100",
          access_token: "secret-token",
          refresh_token: "secret-refresh",
          signed_in_at: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    const text = JSON.stringify(redactedConfig(config));
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("secret-refresh");
    expect(text).toContain("u-1");
  });

  it("redact 递归脱敏且对循环引用安全", () => {
    const obj: Record<string, unknown> = {
      access_token: "a",
      nested: { cookie: "c", password: "p", safe: 1 },
      list: [{ authorization: "Bearer x" }],
    };
    obj.self = obj;
    const redacted = redact(obj) as Record<string, unknown>;
    expect(redacted.access_token).toBe(REDACTED);
    expect((redacted.nested as Record<string, unknown>).cookie).toBe(REDACTED);
    expect((redacted.nested as Record<string, unknown>).safe).toBe(1);
    expect((redacted.list as Record<string, unknown>[])[0].authorization).toBe(REDACTED);
    expect(redacted.self).toBe("[circular]");
  });

  it("redactUrl 抹掉预签名参数", () => {
    const url = redactUrl("https://oss.test/a.png?token=abc&X-Amz-Signature=deadbeef&x=1");
    expect(url).not.toContain("abc");
    expect(url).not.toContain("deadbeef");
    expect(url).toContain("x=1");
  });

  it("API/Web 地址优先级：flag > env > 配置 > 默认", () => {
    const config = { ...emptyConfig(), api_base_url: "http://from-config/v1" };
    expect(resolveApiBaseUrl(config, {}, "http://from-flag/v1")).toBe("http://from-flag/v1");
    expect(resolveApiBaseUrl(config, { ONEFRAME_API_URL: "http://from-env/v1" })).toBe(
      "http://from-env/v1",
    );
    expect(resolveApiBaseUrl(config, {})).toBe("http://from-config/v1");
    expect(resolveApiBaseUrl(emptyConfig(), {})).toContain(":3000/v1");
    expect(resolveWebBaseUrl({ ...emptyConfig(), web_base_url: "http://web.test" }, {})).toBe(
      "http://web.test",
    );
  });
});
