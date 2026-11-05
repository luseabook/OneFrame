import { describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@app/shared";
import { AutodlProvisioner, mapInstanceStatus, priceCentsFromLi } from "./autodl.provisioner";

function envelope(data: unknown, code = "Success"): Response {
  return new Response(JSON.stringify({ code, data, msg: code === "Success" ? "" : "boom", request_id: "r1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AutoDL provisioner：请求形状与错误映射", () => {
  it("create 按平台约束夹住卡数(1~4)与系统盘(0~500)，并带 start_command", async () => {
    let sent: Record<string, unknown> = {};
    const p = new AutodlProvisioner("tok", async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return envelope("pro-123");
    });

    const uuid = await p.create({
      gpuSpec: "v-48g",
      gpuCount: 9,
      imageUuid: "image-1",
      systemDiskGb: 999,
      instanceName: "oneframe-p1-abcd",
      startCommand: "bash /root/join.sh",
    });

    expect(uuid).toBe("pro-123");
    expect(sent.req_gpu_amount).toBe(4);
    expect(sent.expand_system_disk_by_gb).toBe(500);
    expect(sent.gpu_spec_uuid).toBe("v-48g");
    expect(sent.start_command).toBe("bash /root/join.sh");
  });

  it("401 映射为 FLEET_TOKEN_INVALID（前端要引导重新绑定，而不是重试）", async () => {
    const p = new AutodlProvisioner("bad", async () => new Response("unauthorized", { status: 401 }));
    await expect(p.listInstances()).rejects.toMatchObject({ code: ErrorCode.FLEET_TOKEN_INVALID });
  });

  it("429 映射为配额/限流错误", async () => {
    const p = new AutodlProvisioner("tok", async () => new Response("slow down", { status: 429 }));
    await expect(p.listInstances()).rejects.toMatchObject({ code: ErrorCode.FLEET_QUOTA_EXCEEDED });
  });

  it("code !== Success 时带 providerCode，不把整包塞进 message", async () => {
    const p = new AutodlProvisioner("tok", async () => envelope(null, "ParamError"));
    await expect(p.create({ gpuSpec: "v-48g", gpuCount: 1, imageUuid: "i", systemDiskGb: 50, instanceName: "n" })).rejects.toMatchObject({
      code: ErrorCode.FLEET_PROVIDER_ERROR,
      details: { providerCode: "ParamError" },
    });
  });

  it("网络异常归类为 FLEET_PROVIDER_ERROR（可重试由上层决定）", async () => {
    const p = new AutodlProvisioner("tok", async () => {
      throw new TypeError("fetch failed");
    });
    const err = await p.listInstances().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorCode.FLEET_PROVIDER_ERROR);
  });

  it("list 解析实例列表；snapshot 取折扣后按量价（分）", async () => {
    const p = new AutodlProvisioner("tok", async (url) => {
      if (String(url).endsWith("/list")) {
        return envelope({ list: [{ uuid: "pro-1", name: "of-p1", status: "running", gpu_spec_uuid: "v-48g" }] });
      }
      return envelope({ status: "running", payg_price: 1970 });
    });

    const list = await p.listInstances();
    expect(list[0]).toMatchObject({ uuid: "pro-1", status: "running", gpuSpec: "v-48g" });

    const snap = await p.snapshot("pro-1");
    // 平台返回值单位是「厘」，1970 厘 = ¥1.97 = 197 分
    expect(snap.paygPriceCents).toBe(197);
  });
});

describe("AutoDL：实测口径固化（2026-11-05 真机验证）", () => {
  it("payg_price 是厘，不是分（4090D 官网 ¥1.98 ↔ 平台 1980）", () => {
    expect(priceCentsFromLi(1980)).toBe(198);
    expect(priceCentsFromLi(1880)).toBe(188);
    expect(priceCentsFromLi(0)).toBe(0);
  });

  it("平台状态名与文档不一致，必须显式映射：shutdown 不是 running", () => {
    expect(mapInstanceStatus("running")).toBe("running");
    expect(mapInstanceStatus("shutting_down")).toBe("stopping");
    expect(mapInstanceStatus("shutdown")).toBe("stopped");
    expect(mapInstanceStatus("starting")).toBe("pending");
    expect(mapInstanceStatus("whatever")).toBe("unknown");
  });

  it("saveImage 返回 image_uuid；listImages 解析差量镜像", async () => {
    const p = new AutodlProvisioner("tok", async (url) => {
      if (String(url).endsWith("/image/save")) return envelope({ image_uuid: "image-1" });
      return envelope({ list: [{ image_uuid: "image-1", name: "env", status: "finished", image_size: 44093440 }] });
    });
    await expect(p.saveImage("pro-1", "env")).resolves.toBe("image-1");
    const images = await p.listImages();
    expect(images[0]).toMatchObject({ uuid: "image-1", status: "finished" });
  });
});
describe("AutoDL 应用实例（autodl.art / adl_dev）", () => {
  it("application 模式打到 autodl.art + adl_dev 前缀，body 用 application_uuid 而不是 image_uuid", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const p = new AutodlProvisioner(
      "tok",
      async (u, init) => {
        url = String(u);
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return envelope("pro-app-1");
      },
      "app",
    );

    const uuid = await p.createApplication({
      gpuSpec: "v-48g",
      gpuCount: 1,
      systemDiskGb: 0,
      instanceName: "of-app",
      startCommand: "bash /root/join.sh",
      applicationUuid: "J1c7lsvbq5",
      applicationVersion: "latest",
    });

    expect(uuid).toBe("pro-app-1");
    expect(url).toContain("https://www.autodl.art/api/v1/adl_dev/dev/instance/pro/create");
    expect(body).toMatchObject({
      application_uuid: "J1c7lsvbq5",
      application_version: "latest",
      start_command: "bash /root/join.sh",
    });
    expect(body.image_uuid).toBeUndefined();
  });

  it("image 模式仍打 api.autodl.com 且带 image_uuid（既有行为不回归）", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const p = new AutodlProvisioner("tok", async (u, init) => {
      url = String(u);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return envelope("pro-img-1");
    });
    await p.create({ gpuSpec: "4090D", gpuCount: 1, systemDiskGb: 100, instanceName: "of-img", imageUuid: "image-1" });
    expect(url).toContain("https://api.autodl.com/api/v1/dev/instance/pro/create");
    expect(body.image_uuid).toBe("image-1");
  });
});
