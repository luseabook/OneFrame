/**
 * agent 域的公共类型（DTO 形状即前端契约，见
 * `_acceptance/_gap/agent-chat-frontend-contract.md`）。
 */

/** 会话作用域：画布内对话带 canvasId，独立创作 Agent 不带 */
export interface CanvasScope {
  spaceId: string;
  canvasId: string | null;
}

export type AgentRole = 1 | 2 | 3; // user / assistant / system
export type AgentContentType = 1 | 2 | 3 | 4; // text / card / plan / hitl

export interface AgentMessageDto {
  message_id: string;
  role: AgentRole;
  content: string;
  content_type: AgentContentType;
  payload: Record<string, unknown>;
  task_id: string | null;
  seq: number;
  created_at: string;
  reaction: number;
}

/** 事件类型：只有前 6 个是参照站抓到的字面量，其余是本期自定的保守集合（契约 A-01 待取证） */
export const AGENT_EVENT = {
  SESSION_OPENED: "session_opened",
  USER_MESSAGE: "user_message",
  MODEL_STEP: "model_step",
  AGENT_MESSAGE: "agent_message",
  TASK_PROGRESS: "task_progress",
  ERROR: "error",
} as const;

export type AgentEventType = (typeof AGENT_EVENT)[keyof typeof AGENT_EVENT];
