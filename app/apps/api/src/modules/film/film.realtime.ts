import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

/**
 * film 表协同广播（机制 #3：WebSocket 广播 + `client_id` 回声抑制）。
 *
 * ⚠️ **诚实声明（重要，别把它当"实时协同已上线"）**：
 * 本仓库 API 侧**没有任何 WebSocket 网关**（全仓 `@nestjs/websockets` / `@WebSocketGateway`
 * 零命中，已验证）。参照产品的通道是
 * `/v1/rmwebsocket/film/tables/{tableId}/collab/...?client_id=&mode=`（contract §1.3），
 * 帧协议完全未取证（§7 A9）。因此本期**只做到"进程内广播总线 + 可插拔订阅接口"**：
 *
 * - 写接口（PUT cells / status / bindings / submit-result …）在事务成功后调用 `broadcast()`；
 * - 未来接 WS 网关时，只需在 `broadcast()` 处把事件转成帧，**业务代码零改动**；
 * - 断线回落到 HTTP 轮询（ADR-012 的降级基线）：写接口的响应体本身就是权威状态。
 *
 * `client_id` 回声抑制：前端每次写请求带 `client_id`（沿用竞品的既有做法），广播事件里
 * 原样带 `origin_client_id`；订阅方用自己的 client_id 比对，相等即丢弃——否则用户会看到
 * 自己刚输入的内容被远端回显"重置"一次（竞品为此专门加了该字段，见 §1.3）。
 * 该判定被抽成纯函数 `shouldDeliver`，便于单测（进程内广播本身没有可断言的传输层）。
 */

export interface FilmBroadcastInput {
  spaceId: string;
  projectId: string;
  tableId: string;
  type: string;
  payload?: Record<string, unknown>;
  originUserId: string;
  originClientId?: string | null;
}

export interface FilmBroadcastEvent extends Required<Omit<FilmBroadcastInput, "payload" | "originClientId">> {
  seq: number;
  channel: string;
  payload: Record<string, unknown>;
  origin_client_id: string | null;
  at: string;
}

export interface FilmSubscriber {
  /** 订阅方的 client_id（缺失表示"服务端订阅者/无回声抑制需求"） */
  clientId?: string | null;
  /** 订阅方用户（用于"自己改的自己不看"这类策略时兜底） */
  userId?: string;
}

@Injectable()
export class FilmRealtimeService {
  private readonly emitter = new EventEmitter();
  private seq = 0;

  constructor() {
    // 表协同是"多人多表"场景，监听器数量天然随在线人数增长；不抬高上限会触发
    // MaxListenersExceededWarning 把日志刷满（事件总线本身不做投递保证）
    this.emitter.setMaxListeners(0);
  }

  /** 通道名对齐竞品 `film_table_{wsid}_{tableId}`（wsid ≡ user_id 之外的部分我方可省略） */
  channelFor(spaceId: string, tableId: string): string {
    return `film_table_${spaceId}_${tableId}`;
  }

  /**
   * 发一条广播。**同步**返回事件（含 seq），方便调用方把 `seq` 放进响应头/体里，
   * 让客户端能判断"我这条之后有没有漏事件"（轮询降级时用得上）。
   */
  broadcast(input: FilmBroadcastInput): FilmBroadcastEvent {
    this.seq += 1;
    const event: FilmBroadcastEvent = {
      seq: this.seq,
      channel: this.channelFor(input.spaceId, input.tableId),
      spaceId: input.spaceId,
      projectId: input.projectId,
      tableId: input.tableId,
      type: input.type,
      payload: input.payload ?? {},
      originUserId: input.originUserId,
      origin_client_id: input.originClientId ?? null,
      at: new Date().toISOString(),
    };
    this.emitter.emit(event.channel, event);
    return event;
  }

  /** 订阅某个表通道；返回退订函数（WS 网关接入时在这里注册连接） */
  subscribe(channel: string, handler: (event: FilmBroadcastEvent) => void): () => void {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  /**
   * 回声抑制判定（纯函数，可单测）。
   *
   * 只按 **client_id 相等** 抑制，不按 user_id 抑制：同一个人的两个标签页/两端的
   * client_id 不同，第二个端必须能看到第一个端的修改（否则多端协同就断了）。
   */
  static shouldDeliver(event: FilmBroadcastEvent, subscriber: FilmSubscriber): boolean {
    const subClient = subscriber.clientId ?? null;
    if (subClient && event.origin_client_id && subClient === event.origin_client_id) return false;
    return true;
  }
}
