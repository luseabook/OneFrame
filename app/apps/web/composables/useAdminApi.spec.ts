import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminApiBlob } from "./useAdminApi";

/**
 * N-13 的调用点级验证（不只是纯函数）：
 * 后端全局异常过滤器把 `AppError` 输出成 **HTTP 200 + `{code,msg}`**
 * （`apps/api/src/common/http/exception.filter.ts:19-22`），所以在 HTTP 层「未购买/未登录」也是 200。
 * 旧实现只在 `!response.ok` 里判 code —— 于是错误 JSON 被当成 CSV 返回给用户下载。
 *
 * 这里替换 `fetch`，直接驱动真实的 `adminApiBlob`，
 * 断言的是**函数行为**而不是「产物里有没有这个字符串」。
 */

const makeResponse = (body: string, contentType: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, ...init, headers: { "content-type": contentType, ...(init.headers ?? {}) } });

describe("adminApiBlob：HTTP 200 + 业务错误码必须抛错，不得当文件返回", () => {
  // 凭证是 HttpOnly Cookie（H-2）：JS 读不到，只断言请求确实带上了 credentials
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("content-type=application/json + code=403001 → 抛 AdminApiError(403001)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse(JSON.stringify({ code: 403001, msg: "无权限导出" }), "application/json")),
    );
    await expect(adminApiBlob("/ops/export")).rejects.toBeInstanceOf(AdminApiError);
    await expect(adminApiBlob("/ops/export")).rejects.toMatchObject({ code: 403001, message: "无权限导出" });
    // H-2：凭证走 HttpOnly Cookie，请求必须显式 include（不是 Authorization 头）
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/v1/ops/export", { credentials: "include" });
  });

  it("未登录（200 + code=401101）同样抛错，不会返回空 CSV", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse(JSON.stringify({ code: 401101, msg: "missing bearer token" }), "application/json")),
    );
    await expect(adminApiBlob("/ops/export")).rejects.toMatchObject({ code: 401101 });
  });

  it("正常的 text/csv → 返回 blob 与 content-disposition 里的文件名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeResponse("a,b\n1,2\n", "text/csv; charset=utf-8", {
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="export.csv"' },
        }),
      ),
    );
    const { blob, filename } = await adminApiBlob("/ops/export");
    expect(filename).toBe("export.csv");
    expect(await blob.text()).toContain("a,b");
  });

  it("中文文件名走 RFC 5987 的 filename*（HTTP 头是 latin-1，不能直接放中文）", async () => {
    // 夹具教训：`filename="导出.csv"` 会让 Node 的 Response 抛
    // "Cannot convert argument to a ByteString" —— 是实现无关的夹具违规。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeResponse("x\n", "text/csv", {
          headers: {
            "content-type": "text/csv",
            "content-disposition": "attachment; filename*=UTF-8''%E5%AF%BC%E5%87%BA.csv",
          },
        }),
      ),
    );
    const { filename } = await adminApiBlob("/ops/export");
    expect(filename).toBe("导出.csv");
  });

  it("没有 content-disposition 时回落到 download.csv，不抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResponse("x\n", "text/csv")));
    const { filename } = await adminApiBlob("/ops/export");
    expect(filename).toBe("download.csv");
  });

  it("真 4xx（非信封）仍然抛错，code 用 HTTP 状态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 502, headers: { "content-type": "text/html" } })),
    );
    await expect(adminApiBlob("/ops/export")).rejects.toMatchObject({ code: 502 });
  });
});
