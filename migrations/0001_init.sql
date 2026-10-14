-- BSLauncher API 초기 스키마. 모든 시각은 epoch 밀리초(INTEGER).
CREATE TABLE users (
  uuid       TEXT PRIMARY KEY CHECK (length(uuid) = 32),   -- 하이픈 없는 소문자 32자
  nickname   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER', 'ADMIN')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_uuid    TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,                        -- 토큰 원문은 저장하지 않는다(SHA-256)
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_uuid);

CREATE TABLE servers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  minecraft_version TEXT NOT NULL,
  loader            TEXT NOT NULL CHECK (loader IN ('vanilla', 'fabric', 'forge', 'neoforge', 'quilt')),
  loader_version    TEXT,
  address           TEXT NOT NULL,
  port              INTEGER NOT NULL DEFAULT 25565 CHECK (port BETWEEN 1 AND 65535),
  status            TEXT NOT NULL DEFAULT 'MAINTENANCE' CHECK (status IN ('OPEN', 'TESTING', 'MAINTENANCE', 'CLOSED')),
  is_public         INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  icon_url          TEXT,
  banner_url        TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE server_access (
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_uuid  TEXT NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_uuid)
);
CREATE INDEX idx_access_user ON server_access(user_uuid);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uuid  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
