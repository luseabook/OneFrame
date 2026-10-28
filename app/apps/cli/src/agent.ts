import type { ApiClient } from "./http";
import type { Runtime } from "./runtime";

/**
 * Agent 会话的 SSE 客户端（`agent enter` / `agent run` 的事件消费）。
 *
 * 契约出处：`docs/02-architecture/api-spec.md` §17.35。服务端每条事件形如
 *
 * ```
 * id: 2026...\nevent: agent_message\ndata: {"id":"…","type":"agent_message","seq":3,"payload":{…}}\n\n
 * ```
 *
 * 以及每 15s 一条 `event: ping\ndata: {"ts":…}` 心跳（`agent-stream.service.ts:162`）。
 *
 * 为什么自己写解码器而不是引第三方 SSE 库：整个 CLI 的运行时依赖是零（`http.ts:8` 的
 * 注释说明过为什么不引 axios/node-fetch），而 SSE 的帧语法只有 5 行——`id:` / `event:` /
 * `data:` / 注释行 / 空行分隔。引库会让「零依赖」这条约束破一个口子，换来的只是把
 * 这 30 行搬进 node_modules。
 */

export interface SseFrame {
  /** `id:` 字段（断线续传游标） */
  id: string | null;
  /** `event:` 字段；缺省按 SSE 规范是 `message` */
  event: string;
  /** 多行 `data:` 用 `\n` 拼接后的原文 */
  data: string;
  /** `data` 能按 JSON 解析时的对象（我方服务端发的一律是 JSON） */
  json: Record<string, unknown> | null;
}

export type FollowTerminal = "agent_message" | "error" | "timeout" | "closed";

export interface FollowOutcome {
  terminal: FollowTerminal;
  frames: SseFrame[];
  /** 助手最终回复正文（`agent_message` 帧的 `payload.content`） */
  reply: string | null;
  /** 服务端错误事件的内容（`error` 帧） */
  error: { code: number | null; message: string } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseFrame(raw: string): SseFrame | null {
  const dataLines: string[] = [];
  let id: string | null = null;
  let event = "message";
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") continue;
    // `:` 开头是注释（服务端没用，但规范要求容忍；某些反代会插 note）
    if (line.startsWith(":")) continue;
    const at = line.indexOf(":");
    const field = at === -1 ? line : line.slice(0, at);
    let value = at === -1 ? "" : line.slice(at + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    // retry 等字段我方不用，忽略即可（SSE 规范允许客户端忽略未知字段）
  }
  // 没有 data 的帧按规范不派发（心跳帧恰好有 data，所以不会被误吞）
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  let json: Record<string, unknown> | null = null;
  try {
    json = asRecord(JSON.parse(data) as unknown);
  } catch {
    json = null;
  }
  return { id, event, data, json };
}

/**
 * 增量 SSE 解码器：网络分块与帧边界无关（一帧可能横跨两块，一块也可能含多帧），
 * 因此必须自己缓冲到空行再派发。
 */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (!boundary || boundary.index === undefined) break;
      const raw = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** 连接结束时的残留（服务端正常收尾都带空行，这里只兜底） */
  flush(): SseFrame[] {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest.trim()) return [];
    const frame = parseFrame(rest);
    return frame ? [frame] : [];
  }
}

/**
 * 消费一条会话事件流，直到「本轮有结论」。
 *
 * 终态定义（`agent-chat.service.ts:149-224` 的 `runTurn`）：
 * - `agent_message`：助手那一轮的消息已落库 → 本轮结束；
 * - `error`：本轮失败（服务端会把错误当事件推，而不是让连接断掉，所以必须自己判）。
 *
 * `timeout` / `closed` 都是**非终态**收尾：前者由 `--timeout` 决定，后者是服务端关连接。
 * 两种都原样报给调用方，由它决定退出码——不在这里假装成功。
 */
export async function followSession(options: {
  runtime: Runtime;
  client: ApiClient;
  sessionId: string;
  lastStreamId?: string;
  timeoutMs: number;
  onFrame?: (frame: SseFrame) => void;
}): Promise<FollowOutcome> {
  const { runtime, client, sessionId, timeoutMs } = options;
  const request = client.streamRequest(
    `/canvas/chat/sessions/${encodeURIComponent(sessionId)}/stream`,
    options.lastStreamId ? { last_stream_id: options.lastStreamId } : {},
  );
  const handle = await runtime.openStream({
    method: "GET",
    url: request.url,
    headers: request.headers,
  });
  const decoder = new SseDecoder();
  const frames: SseFrame[] = [];
  let terminal: FollowTerminal | null = null;
  let reply: string | null = null;
  let error: { code: number | null; message: string } | null = null;

  const consume = (batch: SseFrame[]): void => {
    for (const frame of batch) {
      frames.push(frame);
      options.onFrame?.(frame);
      // 心跳不是业务事件：记进 frames 供排障，但不影响终态判断
      if (frame.event === "ping") continue;
      if (frame.event === "agent_message") {
        const payload = asRecord(frame.json?.payload);
        reply = typeof payload.content === "string" ? payload.content : "";
        terminal = "agent_message";
      } else if (frame.event === "error") {
        const payload = asRecord(frame.json?.payload);
        error = {
          code: typeof payload.code === "number" ? payload.code : null,
          message: typeof payload.message === "string" ? payload.message : "agent turn failed",
        };
        terminal = "error";
      }
    }
  };

  const iterator = handle.chunks[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(1, timeoutMs));
  });

  try {
    while (terminal === null) {
      const next = await Promise.race([
        iterator.next().then((result) => ({ kind: "chunk" as const, result })),
        timeout.then(() => ({ kind: "timeout" as const })),
      ]);
      if (next.kind === "timeout") {
        terminal = "timeout";
        break;
      }
      if (next.result.done) {
        consume(decoder.flush());
        terminal ??= "closed";
        break;
      }
      consume(decoder.push(next.result.value));
    }
  } finally {
    if (timer) clearTimeout(timer);
    // 先切断连接：SSE 响应体永不结束，只「不再读」会让 socket 上的 read 一直挂着，
    // 进程因此不退出（实测症状：信封已写 stdout，命令却不回 shell）。
    try {
      handle.cancel?.();
    } catch {
      // 连接已断：cancel 幂等，抛错忽略
    }
    // **不 await** `iterator.return()`：异步生成器可能正挂在一次永不 settle 的 `read()` 上，
    // await 会把「到点返回 timeout」变成「一直等下去」——那正好抵消了超时的意义。
    try {
      const closing = iterator.return?.(undefined);
      if (closing) closing.catch(() => undefined);
    } catch {
      // 连接已断：return 抛错无需处理
    }
  }

  return { terminal: terminal ?? "closed", frames, reply, error };
}
