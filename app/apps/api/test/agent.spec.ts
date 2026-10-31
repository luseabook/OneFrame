import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";
import { RedisService } from "../src/redis/redis.service";

/**
 * agent 对话域 e2e（契约 `contract-draft-canvas-agent.md` §2.3 / §3.3 / §4.4）
 *
 * 锁住五条会静默腐化体验或数据的行为：
 * 1. 消息 seq 严格单调（提问一定在回复之前），游标分页不重不漏；
 * 2. 会话/消息/事件一律 space 隔离（跨空间按"不存在"处理，不泄漏存在性）；
 * 3. SSE 游标过期 → **746004**（不是 400102：会话还在，只是增量起点没了）；
 * 4. 决策 D5：默认排队，只有显式 wait 才返回 **746005**；
 * 5. 投递必须复用 generations（目录默认值 + 冻结），任务落库可读回。
 */
describe("agent e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let otherToken = "";
  let canvasId = "";
  let baseUrl = "";

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
    extraHeaders?: Record<string, string>,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    // 显式传空串表示"不带 Bearer"（测 stream-token 通道用），不能用 ?? 兜底掉
    const bearer = authToken === undefined ? token : authToken;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    Object.assign(headers, extraHeaders ?? {});
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(tag: string): Promise<string> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const login = await inject("POST", "/auth/login", { phone, code: sms.data?.debug_code, age_confirmed: true });
    const tk = login.data?.access_token as string;
    if (!tk) throw new Error(`login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
    return tk;
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** 轮询等待助手回复（turn 是异步的，REST 是权威来源 —— ADR-012） */
  async function waitForAssistant(sessionId: string, min = 1, timeoutMs = 15_000) {
    const started = Date.now();
    for (;;) {
      const res = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages?page_size=50`);
      const list = (res.data?.list ?? []) as Array<{ role: number; content: string; seq: number }>;
      if (list.filter((item) => item.role === 2).length >= min) return list;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`assistant reply timeout, got ${list.length} messages`);
      }
      await sleep(150);
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    // SSE 无法用 inject 断言（连接不结束），另起真实端口做流式断言
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;

    token = await loginNewUser("01");
    otherToken = await loginNewUser("02");
    const created = await inject("POST", "/canvas/canvases", { title: "agent 测试画布" });
    canvasId = created.data.id as string;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("会话：建 → 列表 → 改名 → 结束 → 删除后不可读", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, { title: "第一次对话" });
    expect(created.code).toBe(0);
    const sessionId = created.data.session.session_id as string;
    expect(created.data.session.scope).toBe(2);
    expect(created.data.session.canvas_id).toBe(canvasId);

    const list = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions`);
    expect(list.code).toBe(0);
    const found = (list.data.list as Array<{ session_id: string }>).find((s) => s.session_id === sessionId);
    expect(found).toBeTruthy();

    const renamed = await inject("PATCH", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}`, {
      title: "改名后",
    });
    expect(renamed.code).toBe(0);
    expect(renamed.data.session.title).toBe("改名后");

    const ended = await inject("PATCH", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}`, { status: 2 });
    expect(ended.data.session.status).toBe(2);
    // 已结束的会话不能再发言（否则"结束"只是装饰）
    const rejected = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`,
      { content: "还能说话吗" },
    );
    expect(rejected.code).toBe(400101);

    const removed = await inject("DELETE", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}`);
    expect(removed.code).toBe(0);
    const after = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`);
    expect(after.code).toBe(400102);
  });

  it("对话：用户消息立即返回，助手回复按 seq 有序，首条消息成为标题", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;

    const sent = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
      content: "帮我把这个想法拆一下",
    });
    expect(sent.code).toBe(0);
    expect(sent.data.message_id).toBeTruthy();
    expect(sent.data.stream_id).toBe(`m${sent.data.message_id}`);

    const messages = await waitForAssistant(sessionId);
    const user = messages.find((item) => item.role === 1);
    const assistant = messages.find((item) => item.role === 2);
    expect(user).toBeTruthy();
    expect(assistant).toBeTruthy();
    expect(user!.seq).toBeLessThan(assistant!.seq);
    // 空标题会话在列表里无法区分 → 首条消息充当标题
    const list = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions`);
    const session = (list.data.list as Array<{ session_id: string; title: string }>).find(
      (s) => s.session_id === sessionId,
    );
    expect(session?.title).toBe("帮我把这个想法拆一下");
  }, 60_000);

  it("游标分页：after_event_id 不重不漏", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    for (const content of ["第一句", "第二句", "第三句"]) {
      const r = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, { content });
      expect(r.code).toBe(0);
    }
    // 等三条都回复完再翻页：否则翻页过程中新回复会插进来，
    // "收集中"与"事后全量读"必然对不上（这不是分页 bug，是测试自己抢跑）
    await waitForAssistant(sessionId, 3);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const q: string = cursor ? `&after_event_id=${cursor}` : "";
      const res = await inject(
        "GET",
        `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages?page_size=2${q}`,
      );
      const list = res.data.list as Array<{ message_id: string; seq: number }>;
      seen.push(...list.map((item) => item.message_id));
      if (!res.data.has_more) {
        expect(res.data.next_event_id).toBeTruthy();
        break;
      }
      cursor = res.data.next_event_id as string;
    }
    const all = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages?page_size=50`);
    const expected = (all.data.list as Array<{ message_id: string }>).map((item) => item.message_id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expected);
  }, 60_000);

  it("反馈：不能给自己的提问点赞；助手消息可赞可踩", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    const sent = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
      content: "这条我要点赞",
    });
    const self = await inject(
      "POST",
      `/canvas/chat/sessions/${sessionId}/messages/${sent.data.message_id}/reaction`,
      { reaction: "like" },
    );
    expect(self.code).toBe(400101);

    const messages = await waitForAssistant(sessionId);
    const assistant = messages.find((item) => item.role === 2)!;
    const liked = await inject(
      "POST",
      `/canvas/chat/sessions/${sessionId}/messages/${assistant.message_id}/reaction`,
      { reaction: "like" },
    );
    expect(liked.code).toBe(0);
    const reread = await inject("GET", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`);
    const target = (reread.data.list as Array<{ message_id: string; reaction: number }>).find(
      (item) => item.message_id === assistant.message_id,
    );
    expect(target?.reaction).toBe(1);
  }, 60_000);

  it("消息 ↔ 节点绑定：幂等，且能按消息反查", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, { content: "加个文本节点" });
    const messages = await waitForAssistant(sessionId);
    const assistant = messages.find((item) => item.role === 2)!;

    const node = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "来自对话",
      x: 10,
      y: 10,
      params: {},
    });
    const nodeId = node.data.id as string;
    const url = `/canvas/chat/sessions/${sessionId}/messages/${assistant.message_id}/node-binding`;
    const first = await inject("POST", url, { node_ids: [nodeId], binding_kind: 1 });
    expect(first.code).toBe(0);
    expect(first.data.bound).toBe(1);
    // 重复绑定不该报错也不该写第二条（唯一键 + upsert）
    const again = await inject("POST", url, { node_ids: [nodeId], binding_kind: 3 });
    expect(again.code).toBe(0);
    expect(again.data.bound).toBe(1);
    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from agent_message_node_bindings where node_id = $1",
      [nodeId],
    );
    expect(rows[0]?.count).toBe("1");
  }, 60_000);

  it("space 隔离：他人读不到别人的会话与消息", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    const messages = await inject(
      "GET",
      `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`,
      undefined,
      otherToken,
    );
    expect(messages.code).toBe(400102);
  });

  it("决策 D5：默认排队，显式 wait 才报 746005", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    const redis = app.get(RedisService);
    // 白盒制造"有在途轮次"：直接占位，避免靠时序碰运气
    await redis.set(`agent:turn:${sessionId}`, "1", 30);
    try {
      const queued = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
        content: "排队也能发出去",
      });
      expect(queued.code).toBe(0);
      expect(queued.data.queued).toBe(true);

      const waited = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
        content: "要求同步等待",
        wait: true,
      });
      expect(waited.code).toBe(746005);
    } finally {
      await redis.del(`agent:turn:${sessionId}`);
    }
  }, 60_000);

  it("SSE：游标过期 → 746004；stream-token 可替代 Bearer", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;

    // 1) 未知游标：会话还在，只是"增量起点没了" → 746004（不是 400102）
    const expired = await inject("GET", `/canvas/chat/sessions/${sessionId}/stream?last_stream_id=not-exist`);
    expect(expired.code).toBe(746004);

    // 2) 不带 Authorization、改带短令牌：证明 EventSource 场景可鉴权
    const issued = await inject("POST", "/agent/stream-token", { session_id: sessionId });
    expect(issued.code).toBe(0);
    expect(issued.data.token).toBeTruthy();
    const viaToken = await inject(
      "GET",
      `/canvas/chat/sessions/${sessionId}/stream?stream_token=${encodeURIComponent(issued.data.token)}&last_stream_id=not-exist`,
      undefined,
      "", // 明确不带 Bearer
    );
    expect(viaToken.code).toBe(746004);

    // 2b) P1-9：同一枚短令牌不得当普通 Bearer 用 —— 只有显式标注 @AllowStreamToken()
    //     的 SSE 端点才接受查询参数通道，其余受保护路由一律 401（无 jti、不可吊销）。
    //     注：AppError 走「HTTP 200 + 信封非 0 code」（对齐竞品信封，见 exception.filter），
    //     所以这里断言 code，而不是 HTTP 状态码。
    const viaTokenOnNormalRoute = await inject(
      "GET",
      `/me?stream_token=${encodeURIComponent(issued.data.token)}`,
      undefined,
      "",
    );
    expect(viaTokenOnNormalRoute.code).toBe(401101);

    // 3) 令牌绑定的不是这个会话时不该签出（避免拿 A 会话令牌连 B）
    const foreign = await inject("POST", "/agent/stream-token", { session_id: "123456789" });
    expect(foreign.code).toBe(400102);
  }, 60_000);

  it("SSE 真连接：带 last_stream_id 重放能收到助手帧", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    const sent = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
      content: "重放我这条之后的帧",
    });
    await waitForAssistant(sessionId);

    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/v1/canvas/chat/sessions/${sessionId}/stream?last_stream_id=${encodeURIComponent(sent.data.stream_id)}`,
      { headers: { authorization: `Bearer ${token}` }, signal: controller.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    let buffer = "";
    const deadline = Date.now() + 8000;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      while (Date.now() < deadline && !buffer.includes("agent_message")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      controller.abort();
    }
    expect(buffer).toContain("event: agent_message");
    expect(buffer).toContain("id: m");
  }, 60_000);

  it("create-check：可用返回估价；非法档位返回 blocker 而不是抛错", async () => {
    const ok = await inject("POST", "/agent/task/create-check", {
      mode: "text2image",
      model: "tgi-2",
      input: { prompt: "一只在屋顶看日落的猫" },
    });
    expect(ok.code).toBe(0);
    expect(ok.data.ok).toBe(true);
    expect(ok.data.credits_estimate).toBeGreaterThan(0);

    const bad = await inject("POST", "/agent/task/create-check", {
      mode: "text2image",
      model: "sky-media-2.0",
      input: { prompt: "档位不支持" },
    });
    expect(bad.code).toBe(0);
    expect(bad.data.ok).toBe(false);
    expect(bad.data.blockers[0].code).toBe(400101);
  }, 60_000);

  it("create → 详情 → 改标题与反馈（元信息要能读回，不能收下就丢）", async () => {
    const created = await inject(
      "POST",
      "/agent/task/create",
      { mode: "text2image", model: "tgi-2", input: { prompt: "蓝色霓虹街道" } },
      token,
      { "idempotency-key": `agent-spec-${Date.now()}` },
    );
    expect(created.code).toBe(0);
    const taskId = created.data.task_id as string;

    const detail = await inject("GET", `/agent/task/${taskId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.task_id).toBe(taskId);

    const renamed = await inject("PUT", `/agent/task/${taskId}`, { title: "霓虹街景" });
    expect(renamed.code).toBe(0);
    expect(renamed.data.title).toBe("霓虹街景");

    const feedback = await inject("PUT", `/agent/task/${taskId}`, {
      feedback: { reaction: "like", comment: "色调不错" },
    });
    expect(feedback.code).toBe(0);
    expect(feedback.data.feedback).toMatchObject({ reaction: "like", comment: "色调不错" });

    const invalid = await inject("PUT", `/agent/task/${taskId}`, { feedback: { reaction: "angry" } });
    expect(invalid.code).toBe(400101);
  }, 60_000);

  it("对话说「生成一张图」会真投递任务，并把 task_id 挂到助手消息上", async () => {
    const created = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    const sessionId = created.data.session.session_id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions/${sessionId}/messages`, {
      content: "帮我生成一张图：雨夜霓虹街道",
    });
    const messages = await waitForAssistant(sessionId, 1, 20_000);
    const assistant = messages.find((item) => item.role === 2) as unknown as {
      content_type: number;
      task_id: string | null;
    };
    expect(assistant.content_type).toBe(3);
    expect(assistant.task_id).toBeTruthy();
    const task = await inject("GET", `/agent/task/${assistant.task_id}`);
    expect(task.code).toBe(0);
    expect(task.data.status).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("独立创作 Agent：/agent/task/chat 无 session_id 时自动开 scope=1 会话", async () => {
    const chatted = await inject("POST", "/agent/task/chat", { content: "你好，先聊聊" });
    expect(chatted.code).toBe(0);
    expect(chatted.data.message_id).toBeTruthy();

    const list = await inject("GET", "/canvas/canvases?page=1&page_size=50");
    expect(list.code).toBe(0);
    // 自动建的独立会话不该出现在画布内会话列表里（scope 隔离）
    const { rows } = await pool.query<{ scope: number; canvas_id: string | null }>(
      "select scope, canvas_id from agent_sessions where canvas_id is null order by created_at desc limit 1",
    );
    expect(rows[0]?.scope).toBe(1);
    expect(rows[0]?.canvas_id).toBeNull();
  }, 60_000);

  it("任务进度流：竞品是 POST，我方 GET 保留 + POST 别名（第 84 批）", async () => {
    // 竞品形状：POST /web/v1/agent/task/stream（json body + query task_id）。
    // 先把三种"写不进 SSE 之前就会抛错"的路径验掉 —— 它们证明 POST 路由真的到了同一个处理函数。
    const noId = await inject("POST", "/agent/task/stream", {});
    expect(noId.code).toBe(400101);
    expect(noId.msg).toContain("task_id");

    const badBody = await inject("POST", "/agent/task/stream", { task_id: "abc" });
    expect(badBody.code).toBe(400101);
    expect(badBody.msg).toContain("invalid task_id");

    // body 里的 task_id 真的被取到了：不存在的任务 → 400102（不是 400101）
    const missing = await inject("POST", "/agent/task/stream", { task_id: "999999999999999999" });
    expect(missing.code).toBe(400102);

    // query 与 body 同时给时 query 优先
    const byQuery = await inject("POST", "/agent/task/stream?task_id=abc", { task_id: "999999999999999999" });
    expect(byQuery.code).toBe(400101);
    expect(byQuery.msg).toContain("invalid task_id");

    // GET 仍然可用（EventSource 只能发 GET），行为与 POST 一致
    const legacy = await inject("GET", "/agent/task/stream?task_id=abc");
    expect(legacy.code).toBe(400101);
    expect(legacy.msg).toContain("invalid task_id");
  }, 30_000);
});
