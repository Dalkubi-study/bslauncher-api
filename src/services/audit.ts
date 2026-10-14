/** 관리자 작업 기록. 실패해도 본 작업은 막지 않는다. */
export async function audit(db: D1Database, now: number, adminUuid: string, action: string, targetType: string, targetId: string, metadata?: unknown) {
  try {
    await db
      .prepare("INSERT INTO audit_logs (admin_uuid, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(adminUuid, action, targetType, targetId, metadata === undefined ? null : JSON.stringify(metadata), now)
      .run();
  } catch (error) {
    console.error("audit log failed", error);
  }
}
