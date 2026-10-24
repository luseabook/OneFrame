import type { FastifyRequest } from "fastify";

export interface AuthContext {
  userId: string;
  spaceId: string;
  jti: string;
}

export type AuthedRequest = FastifyRequest & { auth?: AuthContext };
