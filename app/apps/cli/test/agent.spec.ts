import { describe, expect, it } from "vitest";
import { SseDecoder, followSession } from "../src/agent";
import { ApiClient } from "../src/http";
import { createRuntime } from "../src/runtime";
import { harness, withProfile } from "./helpers";

/**
 * Agent 会话的流式客户端（第 78 批）。
 *
 * 断言分三层：
 * 1. `SseDecoder` 的**帧边界**——网络分块与帧边界无关，这是最容易写错的地方；
 * 2. `agent run` 的三种收尾（有回复 / 服务端错误事件 / 超时）必须映射到三种不同退出码，
 *    不能都变成 0；
 * 3. `agent enter` 的 REPL 命令集与「退出后仍只出一个 envelope」。
 */

const frame = (event: string, payload: unknown, id = "1"): string =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ id, type: event, seq: Number(id), payload })}\n\n`;

const chatReply = (data: unknown) => JSON.stringify({ code: 0, msg: "", data });

/** 一轮正常回复的事件流：thinking → agent_message */
const okStream = async () => ({
  status: 200,
  chunks: (async function* one(): AsyncGenerator<string> {
    yield [
      frame("model_step", { step: "thinking" }, "2"),
      frame("agent_message", { message_id: "9", content: "好的，已为你排好三个镜头", content_type: 1, payload: {} }, "3"),
    ].join("");
  })(),
});

/** 服务端把回合失败当 error 事件推（连接本身是 200） */
const errorStream = async () => ({
  status: 200,
  chunks: (async function* bad(): AsyncGenerator<string> {
    yield frame("error", { code: 500000, message: "模型返回超时" }, "2");
  })(),
});

/** 永不产出的流：模拟 LLM 一直不返回 */
const hangStream = async () => ({
  status: 200,
  chunks: (async function* hang(): AsyncGenerator<string> {
    await new Promise(() => undefined);
  })(),
});

describe("SseDecoder", () => {
  it("一帧被网络切成两块时也要拼出完整帧", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('event: model_step\ndata: {"step":"thin')).toEqual([]);
    const frames = decoder.push('king"}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("model_step");
    expect(frames[0].json).toEqual({ step: "thinking" });
  });

  it("一块里含多帧，以及 CRLF 行尾", () => {
    const decoder = new SseDecoder();
    const frames = decoder.push(
      'id: 1\r\nevent: ping\r\ndata: {"ts":1}\r\n\r\nid: 2\r\nevent: agent_message\r\ndata: {"payload":{"content":"hi"}}\r\n\r\n',
    );
    expect(frames.map((f) => f.event)).toEqual(["ping", "agent_message"]);
    expect(frames.map((f) => f.id)).toEqual(["1", "2"]);
  });

  it("多行 data 用换行拼接；注释行被忽略；没有 data 的帧不派发", () => {
    const decoder = new SseDecoder();
    const frames = decoder.push(": 反代插的注释\nevent: note\ndata: 第一行\ndata: 第二行\n\nevent: empty\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("note");
    expect(frames[0].data).toBe("第一行\n第二行");
    // 非 JSON 的 data 不抛错，json 置 null（CLI 仍能把原文打给用户）
    expect(frames[0].json).toBeNull();
  });

  it("flush 兜底最后一段没有空行结尾的残留", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('event: agent_message\ndata: {"payload":{"content":"x"}}')).toEqual([]);
    const flushed = decoder.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].json).toEqual({ payload: { content: "x" } });
  });
});

describe("agent run", () => {
  it("不加 --follow 时只投递消息，并如实说明没有跟流", async () => {
    const result = await harness(["agent", "run", "s-1", "--set", "content=帮我排三个镜头"], {
      config: withProfile,
      respond: () => ({ status: 200, body: chatReply({ message_id: "m-1", stream_id: "st-1", queued: false }) }),
    });
    expect(result.code).toBe(0);
    const data = result.output.data as Record<string, unknown>;
    expect(data).toMatchObject({ session_id: "s-1", message_id: "m-1", stream_id: "st-1", followed: false });
    expect(String(data.hint)).toContain("--follow");
    // 投递请求体必须带 session_id + content（服务端 agent.controller.ts 的 zod 形状）
    expect(JSON.parse(result.calls[0].body ?? "{}")).toEqual({ session_id: "s-1", content: "帮我排三个镜头" });
    expect(result.streamCalls).toHaveLength(0);
  });

  it("--follow 消费到 agent_message 后收尾，reply 与帧都进 envelope", async () => {
    const result = await harness(["agent", "run", "s-1", "--follow", "--set", "content=hi"], {
      config: withProfile,
      respond: () => ({ status: 200, body: chatReply({ message_id: "m-1", stream_id: "st-1", queued: false }) }),
      stream: okStream,
    });
    expect(result.code).toBe(0);
    const data = result.output.data as Record<string, unknown>;
    expect(data.terminal).toBe("agent_message");
    expect(data.reply).toBe("好的，已为你排好三个镜头");
    expect((data.frames as { event: string }[]).map((f) => f.event)).toEqual(["model_step", "agent_message"]);
    // 进度走 stderr（SKILL.md:43：stdout 只消费业务数据）
    expect(result.stderr).toContain("[thinking] thinking");
    expect(result.stderr).toContain("[reply] 好的，已为你排好三个镜头");
    // 续传游标要带上 user message 的 stream_id，否则会从队尾开始、漏掉本轮事件
    expect(result.streamCalls[0].url).toContain("last_stream_id=st-1");
    expect(result.streamCalls[0].url).toContain("/canvas/chat/sessions/s-1/stream");
    expect(result.streamCalls[0].headers.authorization).toBeTruthy();
    // 终态之后必须切断连接，否则真实环境里 Node 会因挂起的 read 不退出
    expect(result.streamCancels).toBe(1);
  });

  it("服务端用 error 事件报回合失败时退出码为 4（不是 0）", async () => {
    const result = await harness(["agent", "run", "s-1", "--follow", "--set", "content=hi"], {
      config: withProfile,
      respond: () => ({ status: 200, body: chatReply({ message_id: "m-1", stream_id: "st-1", queued: false }) }),
      stream: errorStream,
    });
    expect(result.code).toBe(4);
    expect(result.output.ok).toBe(false);
    const error = result.output.error as Record<string, unknown>;
    expect(error.kind).toBe("task_failed");
    expect(String(error.message)).toContain("模型返回超时");
  });

  it("--timeout 到点时如实报超时（退出码 6），不假装成功", async () => {
    const result = await harness(["agent", "run", "s-1", "--follow", "--timeout", "30ms", "--set", "content=hi"], {
      config: withProfile,
      respond: () => ({ status: 200, body: chatReply({ message_id: "m-1", stream_id: "st-1", queued: false }) }),
      stream: hangStream,
    });
    expect(result.code).toBe(6);
    const error = result.output.error as Record<string, unknown>;
    expect(error.kind).toBe("timeout");
    expect(String(error.message)).toContain("30ms");
    // 超时也必须切断连接（这是「到点真的返回」的前提）
    expect(result.streamCancels).toBe(1);
  });

  it("缺少 --set content 时是用法错误（退出码 2），不发任何请求", async () => {
    const result = await harness(["agent", "run", "s-1"], { config: withProfile });
    expect(result.code).toBe(2);
    expect(result.calls).toHaveLength(0);
    expect((result.output.error as Record<string, unknown>).kind).toBe("usage");
  });
});

describe("agent enter", () => {
  it("REPL 逐行发送，/exit 退出，只出一个 envelope", async () => {
    const result = await harness(["agent", "enter", "s-1"], {
      config: withProfile,
      lines: ["帮我排三个镜头", "/session", "/help", "/exit"],
      respond: () => ({ status: 200, body: chatReply({ message_id: "m-1", stream_id: "st-1", queued: false }) }),
      stream: okStream,
    });
    expect(result.code).toBe(0);
    const data = result.output.data as Record<string, unknown>;
    expect(data).toMatchObject({ session_id: "s-1", turns: 1, exit_reason: "exit", exited: true });
    expect(data.transcript).toEqual([{ input: "帮我排三个镜头", reply: "好的，已为你排好三个镜头" }]);
    // 只有一句真实发言 → 只有一次投递
    expect(result.calls).toHaveLength(1);
    // 提示与帮助都走 stderr；`/session` 把 ID 打出来
    expect(result.stderr).toContain("agent> ");
    expect(result.stderr).toContain("/exit    退出");
    expect(result.stderr).toContain("s-1\n");
  });

  it("EOF（Ctrl-D）也算正常退出", async () => {
    const result = await harness(["agent", "enter", "s-1"], { config: withProfile, lines: [] });
    expect(result.code).toBe(0);
    expect(result.output.data).toMatchObject({ turns: 0, exit_reason: "eof", exited: true });
  });

  it("缺 SESSION_ID 时是用法错误", async () => {
    const result = await harness(["agent", "enter"], { config: withProfile });
    expect(result.code).toBe(2);
    expect((result.output.error as Record<string, unknown>).kind).toBe("usage");
  });
});

describe("followSession", () => {
  it("服务端直接关连接时 terminal=closed，不编造 reply", async () => {
    const runtime = createRuntime({
      env: {},
      openStream: async () => ({
        status: 200,
        chunks: (async function* none(): AsyncGenerator<string> {
          // 立刻 EOF
        })(),
      }),
    });
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      transport: async () => ({ status: 200, body: "" }),
      token: "t",
      spaceId: "1",
    });
    const outcome = await followSession({ runtime, client, sessionId: "s", timeoutMs: 500 });
    expect(outcome.terminal).toBe("closed");
    expect(outcome.reply).toBeNull();
    expect(outcome.error).toBeNull();
  });
});
