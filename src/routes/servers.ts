import { Hono } from "hono";
import { Errors, ok } from "../lib/response";
import { getServerFor, listServersFor } from "../services/servers";
import type { AppEnv } from "../types";

export const serverRoutes = new Hono<AppEnv>();

/** 내가 볼 수 있는 서버만 반환한다. 비어 있으면 빈 배열이고 안내 문구는 런처가 표시한다. */
serverRoutes.get("/", async (c) => ok(c, { servers: await listServersFor(c.env.DB, c.get("user")) }));

serverRoutes.get("/:id", async (c) => {
  const server = await getServerFor(c.env.DB, c.get("user"), c.req.param("id"));
  if (!server) throw Errors.serverNotFound();
  return ok(c, { server });
});
