import { AppError, ErrorCode } from "@app/shared";

/**
 * AutoDL 容器实例 Pro API 客户端（docs/02-architecture/autodl-integration.md §4.4）。
 *
 * 只做四件事：create / power_on / power_off / release，外加 list 与 snapshot 两个
 * 只读查询。**不做**重试风暴：创建与释放是「有副作用且不可幂等」的动作，
 * 重试由上层（fleet.service）按 instance_name 先查后建来做，避免一次失败留下两台机器。
 */
export const AUTODL_BASE_URL = "https://api.autodl.com";
/**
 * 应用实例 API（2026-11-05 实测）：同一个开发者 Token，主机是 autodl.art，前缀 adl_dev。
 * 它用 `application_uuid` + `application_version` 创建，权重由应用的「公共模型挂载」提供，
 * 所以既不用下载 67GB、也不用扩系统盘——这是「用户零点击」的唯一可行路径。
 */
export const AUTODL_APP_BASE_URL = "https://www.autodl.art";
export const AUTODL_APP_PREFIX = "/api/v1/adl_dev/dev";
export const AUTODL_IMAGE_PREFIX = "/api/v1/dev";

/**
 * 平台状态 → 我方状态。实测（2026-11-05，pro-79385778025b）出现的值：
 * `running` / `shutting_down` / `shutdown`。文档未列出全集，未知值一律 `unknown`，
 * 由上层按"不可用"处理（绝不把未知当 running，否则会一直等一个永远不来的节点）。
 */
export function mapInstanceStatus(raw: string): "running" | "pending" | "stopping" | "stopped" | "unknown" {
  const value = raw.toLowerCase();
  if (value === "running") return "running";
  if (["starting", "pending", "creating", "pulling"].includes(value)) return "pending";
  if (["shutting_down", "stopping"].includes(value)) return "stopping";
  if (["shutdown", "stopped", "released"].includes(value)) return "stopped";
  return "unknown";
}

/**
 * `snapshot.payg_price` 的单位是**厘**（0.001 元），已实测：
 * 4090D 返回 1980 / 1880，对应官网 ¥1.98 / ¥1.88 每小时。转成分要除以 10。
 * （若哪天平台改成"分"，这里的分母会先被单测抓住——见 autodl.provisioner.spec.ts。）
 */
export function priceCentsFromLi(value: number): number {
  return Math.max(0, Math.round(value / 10));
}

export interface AutodlInstance {
  uuid: string;
  name: string;
  status: string;
  gpuSpec: string;
  /** 折扣后的按量价（分/小时）；取不到时为 0 */
  paygPriceCents: number;
}

export interface CreateInstanceInput {
  gpuSpec: string;
  gpuCount: number;
  systemDiskGb: number;
  instanceName: string;
  startCommand?: string;
}

export type ProvisionMode = "image" | "app";

export interface AutodlEnvelope<T> {
  code: string;
  data?: T;
  msg?: string;
  request_id?: string;
}

export interface ProviderFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export class AutodlProvisioner {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: ProviderFetch = fetch,
    private readonly mode: ProvisionMode = "image",
  ) {}

  private get baseUrl(): string {
    return this.mode === "app" ? AUTODL_APP_BASE_URL : AUTODL_BASE_URL;
  }

  private get prefix(): string {
    return this.mode === "app" ? AUTODL_APP_PREFIX : AUTODL_IMAGE_PREFIX;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.token, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError(ErrorCode.FLEET_PROVIDER_ERROR, "AutoDL 网络不可达（超时或 DNS 失败）");
    }

    if (res.status === 401 || res.status === 403) {
      throw new AppError(ErrorCode.FLEET_TOKEN_INVALID, "AutoDL Token 无效或已失效");
    }
    if (res.status === 429) {
      throw new AppError(ErrorCode.FLEET_QUOTA_EXCEEDED, "AutoDL 限流，请稍后重试");
    }
    if (!res.ok) {
      throw new AppError(ErrorCode.FLEET_PROVIDER_ERROR, `AutoDL HTTP ${res.status}`);
    }

    const payload = (await res.json()) as AutodlEnvelope<T>;
    if (payload.code !== "Success") {
      // 平台业务错误：把 code 留在 details 里，message 只保留短文案（不落整包）
      throw new AppError(ErrorCode.FLEET_PROVIDER_ERROR, `AutoDL: ${payload.msg || payload.code}`, {
        providerCode: payload.code,
        requestId: payload.request_id,
      });
    }
    return payload.data as T;
  }

  async listInstances(pageSize = 50): Promise<AutodlInstance[]> {
    const data = await this.call<{ list?: Array<Record<string, unknown>> }>("POST", `${this.prefix}/instance/pro/list`, {
      page_index: 1,
      page_size: pageSize,
    });
    return (data.list ?? []).map((row) => ({
      uuid: String(row.uuid ?? ""),
      name: String(row.name ?? ""),
      status: String(row.status ?? ""),
      gpuSpec: String(row.gpu_spec_uuid ?? ""),
      paygPriceCents: 0,
    }));
  }

  async snapshot(uuid: string): Promise<{ status: string; paygPriceCents: number }> {
    const data = await this.call<Record<string, unknown>>("GET", `${this.prefix}/instance/pro/snapshot`, {
      instance_uuid: uuid,
    });
    return {
      status: String((data as { status?: unknown }).status ?? ""),
      paygPriceCents: priceCentsFromLi(Number((data as { payg_price?: unknown }).payg_price ?? 0) || 0),
    };
  }

  /** 私有/基础镜像创建 */
  async create(input: CreateInstanceInput & { imageUuid: string }): Promise<string> {
    return this.doCreate({
      ...input,
      image_uuid: input.imageUuid,
    });
  }

  /** 应用实例创建（用户零点击路径；权重走公共模型挂载） */
  async createApplication(input: CreateInstanceInput & { applicationUuid: string; applicationVersion?: string }): Promise<string> {
    return this.doCreate({
      ...input,
      application_uuid: input.applicationUuid,
      application_version: input.applicationVersion ?? "latest",
    });
  }

  private async doCreate(input: CreateInstanceInput & Record<string, unknown>): Promise<string> {
    const uuid = await this.call<string>("POST", `${this.prefix}/instance/pro/create`, {
      req_gpu_amount: Math.max(1, Math.min(4, input.gpuCount)),
      expand_system_disk_by_gb: Math.max(0, Math.min(500, input.systemDiskGb)),
      gpu_spec_uuid: input.gpuSpec,
      cuda_v_from: 118,
      instance_name: input.instanceName,
      ...(input.startCommand ? { start_command: input.startCommand } : {}),
      ...Object.fromEntries(
        Object.entries(input).filter(([k]) =>
          ["image_uuid", "application_uuid", "application_version"].includes(k),
        ),
      ),
    });
    if (!uuid) throw new AppError(ErrorCode.FLEET_PROVISION_FAILED, "AutoDL 未返回实例 ID");
    return uuid;
  }

  async powerOn(uuid: string, startCommand?: string): Promise<void> {
    await this.call<null>("POST", `${this.prefix}/instance/pro/power_on`, {
      instance_uuid: uuid,
      payload: "gpu",
      ...(startCommand ? { start_command: startCommand } : {}),
    });
  }

  async powerOff(uuid: string): Promise<void> {
    await this.call<null>("POST", `${this.prefix}/instance/pro/power_off`, { instance_uuid: uuid });
  }

  /**
   * 保存私有镜像（首次环境构建的最后一步）。
   * 实测：**必须先关机**，否则返回 `InternalError: 保存实例镜像前，请确保实例是关机状态`。
   * 返回的 image_uuid 可立即用于 create（实测 20s 内 status=finished，镜像为差量）。
   */
  async saveImage(uuid: string, imageName: string): Promise<string> {
    const data = await this.call<{ image_uuid?: string }>("POST", `${this.prefix}/instance/pro/image/save`, {
      instance_uuid: uuid,
      image_name: imageName,
    });
    if (!data?.image_uuid) throw new AppError(ErrorCode.FLEET_PROVISION_FAILED, "AutoDL 未返回镜像 ID");
    return data.image_uuid;
  }

  async listImages(pageSize = 20): Promise<Array<{ uuid: string; name: string; status: string; sizeBytes: number }>> {
    const data = await this.call<{ list?: Array<Record<string, unknown>> }>(
      "POST",
      `${this.prefix}/instance/pro/image/private/list`,
      { page_index: 1, page_size: pageSize },
    );
    return (data.list ?? []).map((row) => ({
      uuid: String(row.image_uuid ?? ""),
      name: String(row.name ?? ""),
      status: String(row.status ?? ""),
      sizeBytes: Number(row.image_size ?? 0) || 0,
    }));
  }

  /** 释放前必须已关机（平台文档明确），调用方负责顺序 */
  async release(uuid: string): Promise<void> {
    await this.call<null>("POST", `${this.prefix}/instance/pro/release`, { instance_uuid: uuid });
  }
}