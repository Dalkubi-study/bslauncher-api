import { Hono } from "hono";
import { z } from "zod";
import { ok } from "../lib/response";
import { parseBody } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { loginWithMinecraftToken, revokeSession } from "../services/auth";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

const loginBody = z.object({ accessToken: z.string().min(20).max(4096) }).strict();

/**
 * 로그인: 런처가 Minecraft 토큰을 보내면 서명을 검증하고 BSLauncher 세션 토큰을 발급한다.
 * Minecraft 토큰은 저장하지 않고 로그에도 남기지 않는다.
 */
authRoutes.post("/session", async (c) => {
  const { accessToken } = parseBody(loginBody, await c.req.json().catch(() => null));
  const result = await loginWithMinecraftToken(c.env.DB, c.get("deps"), accessToken);
  return ok(c, { session: { token: result.token, expiresAt: result.expiresAt }, user: result.user });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.get("user").sessionId, c.get("deps").now());
  return ok(c, { loggedOut: true });
});
