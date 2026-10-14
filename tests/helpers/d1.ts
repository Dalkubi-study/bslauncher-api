import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// vite 가 실험적 모듈 node:sqlite 를 못 알아보므로 런타임에 직접 불러온다.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;

/** node:sqlite 로 만든 최소 D1 호환 어댑터 (테스트 전용). 실제 D1 과 같은 호출 형태만 지원한다. */
class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.db, this.sql, params); }
  async first<T>(): Promise<T | null> { return ((this.db.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null); }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[], success: true }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export function createTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../../migrations");
  for (const file of readdirSync(dir).sort()) sqlite.exec(readFileSync(join(dir, file), "utf8"));
  const db = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    batch: async (statements: Statement[]) => { const out = []; for (const s of statements) out.push(await s.run()); return out; },
  };
  return { db: db as unknown as D1Database, sqlite };
}
