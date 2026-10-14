import { loadKeys, McTokenError, verifyMinecraftToken } from "../mcjwt";
import { randomToken, sha256Hex } from "../lib/crypto";
import { Errors } from "../lib/response";
import type { AuthUser, Deps, Role } from "../types";

/** 세션 수명. Minecraft 토큰(약 24시간)보다 짧게 둔다. 만료되면 런처가 조용히 다시 로그인한다. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** last_used_at 은 D1 쓰기를 아끼려고 이 간격으로만 갱신한다. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export type LoginResult = { token: string; expiresAt: number; user: { uuid: string; nickname: string; role: Role } };

/**
 * Minecraft 토큰의 서명을 오프라인으로 검증하고(Mojang 호출 없음) BSLauncher 세션을 발급한다.
 * 처음 보는 UUID 는 PLAYER 로 자동 생성한다 (서버 접근 권한은 관리자가 따로 부여).
 */
export async function loginWithMinecraftToken(db: D1Database, deps: Deps, accessToken: string): Promise<LoginResult> {
  const now = deps.now();
  let claims;
  try {
    claims = await verifyMinecraftToken(accessToken, await deps.keys(), now);
  } catch (error) {
    if (error instanceof McTokenError) throw Errors.loginFailed();
    throw error;
  }
  // 실제 토큰에서 확인한 발급자 값. 다른 발급자의 토큰은 받지 않는다.
  if (claims.iss !== "authentication" || !claims.name) throw Errors.loginFailed();

  await db
    .prepare(
      `INSERT INTO users (uuid, nickname, role, created_at, updated_at) VALUES (?1, ?2, 'PLAYER', ?3, ?3)
       ON CONFLICT(uuid) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at
       WHERE users.nickname != excluded.nickname`,
    )
    .bind(claims.uuid, claims.name, now)
    .run();
  const user = await db.prepare("SELECT uuid, nickname, role FROM users WHERE uuid = ?").bind(claims.uuid).first<{ uuid: string; nickname: string; role: Role }>();
  if (!user) throw Errors.loginFailed();

  const token = randomToken();
  const expiresAt = now + SESSION_TTL_MS;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_uuid = ? AND (expires_at < ? OR revoked_at IS NOT NULL)").bind(user.uuid, now),
    db
      .prepare("INSERT INTO sessions (id, user_uuid, token_hash, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), user.uuid, await sha256Hex(token), expiresAt, now, now),
  ]);
  return { token, expiresAt, user };
}

/** Bearer 토큰으로 세션을 찾는다. 없거나 만료/폐기되었으면 null. */
export async function authenticate(db: D1Database, deps: Deps, token: string): Promise<AuthUser | null> {
  const now = deps.now();
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_used_at, u.uuid, u.nickname, u.role
       FROM sessions s JOIN users u ON u.uuid = s.user_uuid WHERE s.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<{ session_id: string; expires_at: number; revoked_at: number | null; last_used_at: number; uuid: string; nickname: string; role: Role }>();
  if (!row || row.revoked_at !== null || row.expires_at < now) return null;
  if (now - row.last_used_at > TOUCH_INTERVAL_MS) {
    await db.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, row.session_id).run();
  }
  return { uuid: row.uuid, nickname: row.nickname, role: row.role, sessionId: row.session_id };
}

export async function revokeSession(db: D1Database, sessionId: string, now: number) {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, sessionId).run();
}

export { loadKeys };
