import { z } from "zod";

// api-spec §2（ADR-006：自有 JWT，手机验证码登录）
export const phoneSchema = z.string().regex(/^1\d{10}$/, "invalid phone");
export const smsCodeSchema = z.string().regex(/^\d{6}$/, "invalid code");

export const smsCodeRequestSchema = z.object({ phone: phoneSchema });
export const loginRequestSchema = z.object({
  phone: phoneSchema,
  code: smsCodeSchema,
});
// refresh token 经 HttpOnly Cookie 传递，无请求体（security.md：SameSite=Strict）
export const refreshRequestSchema = z.object({}).strict();

// refresh_token 经 Set-Cookie（SameSite=Strict, HttpOnly）下发，不出现在响应体
export const loginResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  user: z.object({
    id: z.string(),
    nickname: z.string(),
    avatar: z.string().nullable(),
  }),
  space_id: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
