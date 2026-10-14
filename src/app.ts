import { Hono } from "hono";
import { ZodError } from "zod";
import { loadKeys } from "./mcjwt";
import mojangKeysJson from "./mojang-keys.json";
import { ApiError, Errors, fail, ok } from "./lib/response";
import { requireAdmin, requireAuth } from "./middleware/auth";
import { adminServerRoutes } from "./routes/admin/servers";
import { adminUserRoutes } from "./routes/admin/users";
import { authRoutes } from "./routes/auth";
import { serverRoutes } from "./routes/servers";
import type { AppEnv, Deps } from "./types";

/** 운영용 기본 의존성: 내장 Mojang 공개키 + 실제 시계 */
function defaultDeps(): Deps {
  let keys: ReturnType<typeof loadKeys> | null = null;
  return {
    keys: () => (keys ??= loadKeys(mojangKeysJson)),
    now: () => Date.now(),
  };
}

export function createApp(deps: Deps = defaultDeps()) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/api/v1/health", (c) => ok(c, { status: "ok" }));

  const v1 = new Hono<AppEnv>();
  v1.route("/auth", authRoutes);
  v1.get("/me", requireAuth, (c) => {
    const { uuid, nickname, role } = c.get("user");
    return ok(c, { uuid, nickname, role });
  });
  v1.use("/servers/*", requireAuth);
  v1.use("/servers", requireAuth);
  v1.route("/servers", serverRoutes);
  v1.use("/admin/*", requireAuth, requireAdmin);
  v1.route("/admin/users", adminUserRoutes);
  v1.route("/admin/servers", adminServerRoutes);
  app.route("/api/v1", v1);

  app.notFound((c) => fail(c, new ApiError(404, "NOT_FOUND", "존재하지 않는 경로입니다.")));
  app.onError((error, c) => {
    if (error instanceof ApiError) return fail(c, error);
    if (error instanceof ZodError) return fail(c, Errors.validation());
    console.error("unhandled", error); // 토큰/본문은 기록하지 않는다
    return fail(c, new ApiError(500, "INTERNAL", "서버 오류가 발생했습니다."));
  });
  return app;
}
