import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 审计写库重试的守卫（第 108 批）。
 *
 * 此前 `AdminAuditService.record` 是"一次失败即放弃"：连接抖动/主备切换会让一条
 * 已经成功的运营操作永久没有审计记录，而这条丢失去唯一痕迹只有一行被吞掉的异常。
 * 这里把重试语义钉死，同时保证三条不变量不被重试破坏：
 * 1. **绝不抛错**：`record` 永不 reject（连注入的 sleep 抛错也吞掉），业务响应不受影响；
 * 2. **幂等**：同一条审计在重试间复用同一个 id/同一行对象，撞唯一键（23505）按已落库处理，
 *    不会因为"上次其实提交成功"而产生第二条记录；
 * 3. **有界可观测**：默认 3 次尝试、50/100ms 指数退避；重试成功留 `admin_audit_write_recovered`
 *    warn，用尽才留 `admin_audit_write_failed` error（带 request_id 与 attempts）。
 *
 * 只 mock `db.insert`，不连 PG：本机没有数据库时这些路径也必须能被门禁覆盖。
 */
const { insert, values } = vi.hoisted(() => {
  const values = vi.fn();
  const insert = vi.fn(() => ({ values }));
  return { insert, values };
});

vi.mock("../src/db/database", () => ({
  db: { insert },
  pool: { end: async () => undefined },
}));

import { AdminAuditService, type AdminAuditEntry } from "../src/modules/admin/admin-audit.service";

const entry: AdminAuditEntry = {
  adminId: "1001",
  adminUsername: "ops1",
  method: "PATCH",
  path: "/v1/ops/admin/config/home_banner",
  action: "PATCH /v1/ops/admin/config/:key",
  statusCode: 200,
  ok: true,
  ip: "127.0.0.1",
  requestId: "req-108",
  payload: { enabled: true },
};

/** 注入的 sleep：测试不真等退避时间，同时能断言"退避了几次、每次多久" */
const sleep = vi.fn(async (_ms: number) => undefined);

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  insert.mockClear();
  values.mockReset();
  sleep.mockClear();
  warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("admin audit 写库重试", () => {
  it("首次失败、重试成功：同一条（同一行对象）最终落库，不记 error", async () => {
    values.mockRejectedValueOnce(new Error("connect ECONNREFUSED")).mockResolvedValueOnce(undefined);
    const service = new AdminAuditService();

    await expect(service.record(entry, { sleep })).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(2);
    // 复用同一个 row 对象 = 同一个 id：重试写的是同一条审计，不是每次尝试一条新记录
    expect(values.mock.calls[1][0]).toBe(values.mock.calls[0][0]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(50);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("admin_audit_write_recovered"));
  });

  it("用尽重试仍失败：不抛错（业务无感），按固定标记记 error 且带 request_id", async () => {
    values.mockRejectedValue(new Error("db down"));
    const service = new AdminAuditService();

    await expect(service.record(entry, { sleep })).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(3);
    // 指数退避：50ms、100ms
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([50, 100]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain("admin_audit_write_failed");
    expect(message).toContain("attempts=3");
    expect(message).toContain("request_id=req-108");
  });

  it("重试撞唯一键（23505）：视为已落库，不再重试也不再报错", async () => {
    values
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key value"), { code: "23505" }));
    const service = new AdminAuditService();

    await expect(service.record(entry, { sleep })).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("驱动把 SQLSTATE 包在 cause 里也能识别（drizzle 包装层）", async () => {
    values
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockRejectedValueOnce(Object.assign(new Error("insert failed"), { cause: { code: "23505" } }));
    const service = new AdminAuditService();

    await expect(service.record(entry, { sleep })).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("retries=0 时只尝试一次（策略可收窄，默认值不是硬编码）", async () => {
    values.mockRejectedValue(new Error("nope"));
    const service = new AdminAuditService();

    await expect(service.record(entry, { retries: 0, sleep })).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("attempts=1");
  });

  it("退避 sleep 抛错也被吞掉：不影响后续尝试，record 永不 reject", async () => {
    values.mockRejectedValueOnce(new Error("first")).mockResolvedValueOnce(undefined);
    const badSleep = vi.fn(async () => {
      throw new Error("timer broke");
    });
    const service = new AdminAuditService();

    await expect(service.record(entry, { sleep: badSleep })).resolves.toBeUndefined();

    expect(badSleep).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("日志字段压平换行并截断：action 里的换行伪造不出第二条日志", async () => {
    values.mockRejectedValue(new Error("x"));
    const service = new AdminAuditService();

    await service.record(
      { ...entry, action: "POST /v1/ops/x\nadmin_audit_write_failed fake", requestId: "r".repeat(400) },
      { retries: 0, sleep },
    );

    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThan(600);
  });
});