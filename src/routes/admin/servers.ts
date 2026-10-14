import { Hono } from "hono";
import { z } from "zod";
import { ApiError, Errors, ok } from "../../lib/response";
import { parseBody, serverFields, serverIdSchema, uuidSchema } from "../../lib/validation";
import { audit } from "../../services/audit";
import { toServerView, type ServerRow } from "../../services/servers";
import type { AppEnv } from "../../types";

export const adminServerRoutes = new Hono<AppEnv>();

const adminView = (row: ServerRow) => ({ ...toServerView(row, false), canLaunch: undefined, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at });

const createBody = z
  .object({
    id: serverIdSchema,
    ...serverFields,
    description: serverFields.description.default(""),
    loaderVersion: serverFields.loaderVersion.default(null),
    port: serverFields.port.default(25565),
    status: serverFields.status.default("MAINTENANCE"),
    isPublic: serverFields.isPublic.default(false),
    iconUrl: serverFields.iconUrl.default(null),
    bannerUrl: serverFields.bannerUrl.default(null),
    sortOrder: serverFields.sortOrder.default(0),
  })
  .strict();

const patchBody = z.object(serverFields).partial().strict();

/** PATCH 가능한 필드 → DB 컬럼 (문자열 조합이 아니라 고정된 목록만 SQL 에 들어간다) */
const COLUMNS: Record<string, string> = {
  name: "name", description: "description", minecraftVersion: "minecraft_version", loader: "loader", loaderVersion: "loader_version",
  address: "address", port: "port", status: "status", isPublic: "is_public", iconUrl: "icon_url", bannerUrl: "banner_url", sortOrder: "sort_order",
};

const getRow = (db: D1Database, id: string) => db.prepare("SELECT * FROM servers WHERE id = ?").bind(id).first<ServerRow>();

adminServerRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM servers ORDER BY sort_order, name").all<ServerRow>();
  return ok(c, { servers: results.map(adminView) });
});

adminServerRoutes.get("/:id", async (c) => {
  const row = await getRow(c.env.DB, c.req.param("id"));
  if (!row) throw Errors.serverNotFound();
  return ok(c, { server: adminView(row) });
});

adminServerRoutes.post("/", async (c) => {
  const b = parseBody(createBody, await c.req.json().catch(() => null));
  if (await getRow(c.env.DB, b.id)) throw new ApiError(409, "SERVER_EXISTS", "이미 존재하는 서버 ID입니다.");
  const now = c.get("deps").now();
  await c.env.DB
    .prepare(
      `INSERT INTO servers (id, name, description, minecraft_version, loader, loader_version, address, port, status, is_public, icon_url, banner_url, sort_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
    )
    .bind(b.id, b.name, b.description, b.minecraftVersion, b.loader, b.loaderVersion, b.address, b.port, b.status, b.isPublic ? 1 : 0, b.iconUrl, b.bannerUrl, b.sortOrder, now)
    .run();
  await audit(c.env.DB, now, c.get("user").uuid, "SERVER_CREATED", "server", b.id, { name: b.name });
  return ok(c, { server: adminView((await getRow(c.env.DB, b.id))!) }, 201);
});

adminServerRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const before = await getRow(c.env.DB, id);
  if (!before) throw Errors.serverNotFound();
  const patch = parseBody(patchBody, await c.req.json().catch(() => null));
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw Errors.validation("변경할 값이 없습니다");
  const now = c.get("deps").now();
  const sets = entries.map(([k], i) => `${COLUMNS[k]} = ?${i + 1}`).join(", ");
  const values = entries.map(([, v]) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
  await c.env.DB
    .prepare(`UPDATE servers SET ${sets}, updated_at = ?${entries.length + 1} WHERE id = ?${entries.length + 2}`)
    .bind(...values, now, id)
    .run();
  if (patch.status && patch.status !== before.status) {
    await audit(c.env.DB, now, c.get("user").uuid, "SERVER_STATUS_CHANGED", "server", id, { from: before.status, to: patch.status });
  } else {
    await audit(c.env.DB, now, c.get("user").uuid, "SERVER_UPDATED", "server", id, { fields: entries.map(([k]) => k) });
  }
  return ok(c, { server: adminView((await getRow(c.env.DB, id))!) });
});

adminServerRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await getRow(c.env.DB, id))) throw Errors.serverNotFound();
  await c.env.DB.prepare("DELETE FROM servers WHERE id = ?").bind(id).run(); // server_access 는 CASCADE
  await audit(c.env.DB, c.get("deps").now(), c.get("user").uuid, "SERVER_DELETED", "server", id);
  return ok(c, { deleted: true });
});

// ── 서버 접근 권한 ───────────────────────────────────────────────
adminServerRoutes.get("/:id/access", async (c) => {
  const id = c.req.param("id");
  if (!(await getRow(c.env.DB, id))) throw Errors.serverNotFound();
  const { results } = await c.env.DB
    .prepare("SELECT a.user_uuid, u.nickname, a.role, a.created_at FROM server_access a JOIN users u ON u.uuid = a.user_uuid WHERE a.server_id = ? ORDER BY u.nickname COLLATE NOCASE")
    .bind(id)
    .all<{ user_uuid: string; nickname: string; role: string; created_at: number }>();
  return ok(c, { access: results.map((r) => ({ userUuid: r.user_uuid, nickname: r.nickname, role: r.role, createdAt: r.created_at })) });
});

const accessBody = z.object({ userUuid: uuidSchema, role: z.enum(["PLAYER"]).default("PLAYER") }).strict();

adminServerRoutes.post("/:id/access", async (c) => {
  const id = c.req.param("id");
  if (!(await getRow(c.env.DB, id))) throw Errors.serverNotFound();
  const { userUuid, role } = parseBody(accessBody, await c.req.json().catch(() => null));
  if (!(await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE uuid = ?").bind(userUuid).first())) throw Errors.userNotFound();
  const now = c.get("deps").now();
  const result = await c.env.DB.prepare("INSERT OR IGNORE INTO server_access (server_id, user_uuid, role, created_at) VALUES (?, ?, ?, ?)").bind(id, userUuid, role, now).run();
  if (result.meta.changes === 0) throw new ApiError(409, "ACCESS_EXISTS", "이미 권한이 부여되어 있습니다.");
  await audit(c.env.DB, now, c.get("user").uuid, "ACCESS_GRANTED", "server", id, { userUuid });
  return ok(c, { granted: true }, 201);
});

adminServerRoutes.delete("/:id/access/:uuid", async (c) => {
  const id = c.req.param("id");
  const uuid = parseBody(uuidSchema, c.req.param("uuid"));
  const result = await c.env.DB.prepare("DELETE FROM server_access WHERE server_id = ? AND user_uuid = ?").bind(id, uuid).run();
  if (result.meta.changes === 0) throw new ApiError(404, "ACCESS_NOT_FOUND", "부여된 권한이 없습니다.");
  await audit(c.env.DB, c.get("deps").now(), c.get("user").uuid, "ACCESS_REVOKED", "server", id, { userUuid: uuid });
  return ok(c, { revoked: true });
});
