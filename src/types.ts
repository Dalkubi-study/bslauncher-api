import type { KeyCandidate } from "./mcjwt";

/** Workers 바인딩 (wrangler.toml 의 d1_databases 와 이름이 같아야 한다) */
export type Env = { DB: D1Database };

export type Role = "PLAYER" | "ADMIN";

export type AuthUser = { uuid: string; nickname: string; role: Role; sessionId: string };

/** 테스트에서 바꿀 수 있는 외부 의존성 */
export type Deps = {
  /** Mojang 인증 공개키 */
  keys: () => Promise<KeyCandidate[]>;
  /** 현재 시각(ms) */
  now: () => number;
};

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser; deps: Deps } };
