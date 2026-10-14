import type { AuthUser } from "../types";

export type ServerStatus = "OPEN" | "TESTING" | "MAINTENANCE" | "CLOSED";

export type ServerRow = {
  id: string; name: string; description: string; minecraft_version: string; loader: string; loader_version: string | null;
  address: string; port: number; status: ServerStatus; is_public: number; icon_url: string | null; banner_url: string | null;
  sort_order: number; created_at: number; updated_at: number;
};

/** 일반 사용자에게 내려가는 서버 정보 (내부 컬럼은 노출하지 않는다) */
export function toServerView(row: ServerRow, canLaunch: boolean) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    minecraftVersion: row.minecraft_version,
    loader: row.loader,
    loaderVersion: row.loader_version,
    address: row.address,
    port: row.port,
    status: row.status,
    isPublic: row.is_public === 1,
    iconUrl: row.icon_url,
    bannerUrl: row.banner_url,
    canLaunch,
  };
}

/**
 * 서버 접근 규칙 (한곳에서만 정의한다)
 *  - 볼 수 있는 서버: 관리자 / 공개 서버 / server_access 에 등록된 서버
 *  - 실행 가능: OPEN 이면 볼 수 있는 모두, TESTING 이면 관리자와 server_access 등록자만, 그 외 상태는 불가
 */
export function evaluateAccess(user: AuthUser, server: Pick<ServerRow, "is_public" | "status">, hasAccessRow: boolean) {
  const isAdmin = user.role === "ADMIN";
  const canView = isAdmin || server.is_public === 1 || hasAccessRow;
  const canLaunch = canView && (server.status === "OPEN" || (server.status === "TESTING" && (isAdmin || hasAccessRow)));
  return { canView, canLaunch };
}

export async function listServersFor(db: D1Database, user: AuthUser) {
  const { results } = await db
    .prepare(
      `SELECT s.*, (a.user_uuid IS NOT NULL) AS has_access FROM servers s
       LEFT JOIN server_access a ON a.server_id = s.id AND a.user_uuid = ?
       ORDER BY s.sort_order, s.name`,
    )
    .bind(user.uuid)
    .all<ServerRow & { has_access: number }>();
  const views = [];
  for (const row of results) {
    const access = evaluateAccess(user, row, row.has_access === 1);
    if (access.canView) views.push(toServerView(row, access.canLaunch));
  }
  return views;
}

/** 볼 수 없는 서버는 존재 여부를 숨기려고 null(=404)로 돌려준다. */
export async function getServerFor(db: D1Database, user: AuthUser, serverId: string) {
  const row = await db
    .prepare(
      `SELECT s.*, (a.user_uuid IS NOT NULL) AS has_access FROM servers s
       LEFT JOIN server_access a ON a.server_id = s.id AND a.user_uuid = ? WHERE s.id = ?`,
    )
    .bind(user.uuid, serverId)
    .first<ServerRow & { has_access: number }>();
  if (!row) return null;
  const access = evaluateAccess(user, row, row.has_access === 1);
  return access.canView ? toServerView(row, access.canLaunch) : null;
}
