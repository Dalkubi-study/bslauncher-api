import type { MiddlewareHandler } from "hono";
import { Errors } from "../lib/response";
import { authenticate } from "../services/auth";
import type { AppEnv } from "../types";

/** Authorization: Bearer <세션 토큰> 검증. 통과하면 c.get("user") 로 사용자를 꺼낸다. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
  if (!match) throw Errors.unauthorized();
  const user = await authenticate(c.env.DB, c.get("deps"), match[1]!);
  if (!user) throw Errors.sessionExpired();
  c.set("user", user);
  await next();
};

/** 반드시 requireAuth 뒤에 둔다. 로그인했다고 관리자 API 를 쓸 수 있는 것은 아니다. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "ADMIN") throw Errors.forbidden();
  await next();
};
