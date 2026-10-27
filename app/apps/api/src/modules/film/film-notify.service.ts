import { createHmac, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";

/**
 * 影视版离线通知投递（模块 #8 收尾）。
 *
 * ## 为什么需要它
 * `notifyAssignees` 目前只做**广播面**（`FilmRealtimeService`，进程内的 WS 事件）——
 * 用户不在线就什么都没收到。竞品有离线推送，我方补一条**可配置 webhook** 投递：
 * 把自己接到企业微信/飞书/Slack 的机器人或客户自己的网关，不必等我们接推送厂商。
 *
 * ## 三条约定
 * 1. **未配置即不投递**：`FILM_NOTIFY_WEBHOOK_URL` 为空时返回 `delivery:"stored"`
 *    （事件已落库/已广播），绝不假装"已推送"。
 * 2. **签名可验**：`x-of-signature: sha256=<hex>`，HMAC-SHA256 over 原始 body，
 *    密钥 `FILM_NOTIFY_SECRET`；接收方可用同一密钥校验来源。
 * 3. **重试有限且有界**：3 次指数退避（80/240/720ms）、每次 2s 超时；
 *    全失败返回 `delivery:"failed"` + `attempts`，由调用方决定是否记告警。
 *
 * 环境变量在**调用时**读取（不是模块加载时）：便于测试在同一进程里切"未配置/已配置"，
 * 与 OAuth 服务的做法一致（见 `oauth.service.ts` 注释）。
 */

export interface FilmNotifyEvent {
  type: string;
  spaceId: string;
  projectId?: string;
  tableId?: string;
  payload?: Record<string, unknown>;
}

export interface FilmNotifyResult {
  delivery: "stored" | "delivered" | "failed";
  attempts: number;
  status?: number;
  error?: string;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [80, 240, 720];
const TIMEOUT_MS = 2000;

@Injectable()
export class FilmNotifyService {
  /** 读取运行时配置（每次调用读，见文件头约定 4） */
  private config(): { url: string; secret: string } {
    return {
      url: String(process.env.FILM_NOTIFY_WEBHOOK_URL ?? "").trim(),
      secret: String(process.env.FILM_NOTIFY_SECRET ?? "").trim(),
    };
  }

  sign(rawBody: string, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  }

  /** 投递一条事件；未配置 → stored（事件仍已在广播面/库中） */
  async deliver(event: FilmNotifyEvent): Promise<FilmNotifyResult> {
    const { url, secret } = this.config();
    if (!url) return { delivery: "stored", attempts: 0 };

    const body = JSON.stringify({
      id: randomUUID(),
      type: event.type,
      space_id: event.spaceId,
      project_id: event.projectId ?? null,
      table_id: event.tableId ?? null,
      created_at: new Date().toISOString(),
      payload: event.payload ?? {},
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-of-event": event.type,
    };
    if (secret) headers["x-of-signature"] = this.sign(body, secret);

    let lastError = "";
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
        lastStatus = res.status;
        if (res.ok) return { delivery: "delivered", attempts: attempt, status: res.status };
        lastError = `http ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt - 1] ?? 720));
      }
    }
    return { delivery: "failed", attempts: MAX_ATTEMPTS, status: lastStatus, error: lastError };
  }
}
