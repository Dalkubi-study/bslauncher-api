import { Hono } from "hono";
import { z } from "zod";
import { ApiError, Errors, ok } from "../../lib/response";
import { parseBody, uuidSchema } from "../../lib/validation";
import { audit } from "../../services/audit";
import type { AppEnv } from "../../types";

export const adminUserRoutes = new Hono<AppEnv>();

type UserRow = { uuid: string; nickname: string; role: string; created_at: number; updated_at: number };
const view = (u: UserRow) => ({ uuid: u.uuid, nickname: u.nickname, role: u.role, createdAt: u.created_at, updatedAt: u.updated_at });

/** 닉네임으로 검색한다. 로그인한 적 있는 사람은 자동 등록되므로 화이트리스트 대상은 여기서 고른다. */
adminUserRoutes.get("/", async (c) => {
  const query = (c.req.query("query") ?? "").trim().slice(0, 32);
  const like = `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { results } = await c.env.DB
    .prepare("SELECT * FROM users WHERE nickname LIKE ? ESCAPE '\\' ORDER BY nickname COLLATE NOCASE LIMIT 100")
    .bind(like)
    .all<UserRow>();
  return ok(c, { users: results.map(view) });
});

adminUserRoutes.get("/:uuid", async (c) => {
  const uuid = parseBody(uuidSchema, c.req.param("uuid"));
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE uuid = ?").bind(uuid).first<UserRow>();
  if (!user) throw Errors.userNotFound();
  const { results } = await c.env.DB.prepare("SELECT server_id FROM server_access WHERE user_uuid = ? ORDER BY server_id").bind(uuid).all<{ server_id: string }>();
  return ok(c, { user: view(user), serverAccess: results.map((r) => r.server_id) });
});

/** 아직 로그인하지 않은 사람을 UUID 로 미리 등록한다 (Workers 에서는 Mojang 닉네임 조회가 막혀 있어 UUID 를 직접 받는다). */
const createBody = z.object({ uuid: uuidSchema, nickname: z.string().regex(/^[A-Za-z0-9_]{1,16}$/) }).strict();
adminUserRoutes.post("/", async (c) => {
  const body = parseBody(createBody, await c.req.json().catch(() => null));
  const now = c.get("deps").now();
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE uuid = ?").bind(body.uuid).first();
  if (exists) throw new ApiError(409, "USER_EXISTS", "이미 등록된 사용자입니다.");
  await c.env.DB.prepare("INSERT INTO users (uuid, nickname, role, created_at, updated_at) VALUES (?, ?, 'PLAYER', ?, ?)").bind(body.uuid, body.nickname, now, now).run();
  await audit(c.env.DB, now, c.get("user").uuid, "USER_CREATED", "user", body.uuid, { nickname: body.nickname });
  return ok(c, { uuid: body.uuid }, 201);
});

const patchBody = z.object({ role: z.enum(["PLAYER", "ADMIN"]) }).strict();

async function adminCount(db: D1Database) {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'").first<{ n: number }>())?.n ?? 0;
}

adminUserRoutes.patch("/:uuid", async (c) => {
  const uuid = parseBody(uuidSchema, c.req.param("uuid"));
  const { role } = parseBody(patchBody, await c.req.json().catch(() => null));
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE uuid = ?").bind(uuid).first<UserRow>();
  if (!user) throw Errors.userNotFound();
  if (user.role === "ADMIN" && role !== "ADMIN" && (await adminCount(c.env.DB)) <= 1) throw Errors.lastAdmin();
  const now = c.get("deps").now();
  await c.env.DB.prepare("UPDATE users SET role = ?, updated_at = ? WHERE uuid = ?").bind(role, now, uuid).run();
  if (role !== "ADMIN") await c.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_uuid = ? AND revoked_at IS NULL").bind(now, uuid).run();
  await audit(c.env.DB, now, c.get("user").uuid, "USER_ROLE_CHANGED", "user", uuid, { from: user.role, to: role });
  return ok(c, { uuid, role });
});

adminUserRoutes.delete("/:uuid", async (c) => {
  const uuid = parseBody(uuidSchema, c.req.param("uuid"));
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE uuid = ?").bind(uuid).first<UserRow>();
  if (!user) throw Errors.userNotFound();
  if (user.role === "ADMIN" && (await adminCount(c.env.DB)) <= 1) throw Errors.lastAdmin();
  await c.env.DB.prepare("DELETE FROM users WHERE uuid = ?").bind(uuid).run(); // 세션/접근 권한은 ON DELETE CASCADE
  await audit(c.env.DB, c.get("deps").now(), c.get("user").uuid, "USER_DELETED", "user", uuid, { nickname: user.nickname });
  return ok(c, { deleted: true });
});
