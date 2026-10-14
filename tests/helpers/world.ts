import { createApp } from "../../src/app";
import { loadKeys } from "../../src/mcjwt";
import { createTestDb } from "./d1";

const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const ALICE = { uuid: "a".repeat(32), name: "Alice" };
export const BOB = { uuid: "b".repeat(32), name: "Bob" };
export const CAROL = { uuid: "c".repeat(32), name: "Carol" };

export async function makeWorld() {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  const keys = loadKeys({ authenticationKeys: [{ publicKey: btoa(String.fromCharCode(...spki)) }] });
  const clock = { now: 1_800_000_000_000 };
  const { db, sqlite } = createTestDb();
  const app = createApp({ keys: () => keys, now: () => clock.now });

  /** 실제 Mojang 토큰과 같은 모양의 JWT 를 테스트 키로 서명한다 */
  async function mcToken(p: { uuid: string; name: string }, over: Record<string, unknown> = {}, header: object = { kid: "t", alg: "RS256" }) {
    const payload = { iss: "authentication", exp: Math.floor(clock.now / 1000) + 86400, nbf: 0, profiles: { mc: p.uuid }, pfd: [{ type: "mc", id: p.uuid, name: p.name }], ...over };
    const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    return `${body}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)))}`;
  }

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }, { DB: db });
    return { status: res.status, body: (await res.json()) as any };
  };

  /** 로그인해서 세션 토큰을 돌려준다 */
  async function login(p: { uuid: string; name: string }) {
    const res = await call("POST", "/auth/session", { body: { accessToken: await mcToken(p) } });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return res.body.data.session.token as string;
  }
  const makeAdmin = (uuid: string) => sqlite.prepare("UPDATE users SET role = 'ADMIN' WHERE uuid = ?").run(uuid);

  const serverBody = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: id.toUpperCase(), minecraftVersion: "1.21.8", loader: "fabric", loaderVersion: "0.16.0", address: "play.example.com", ...over,
  });
  return { app, db, sqlite, clock, call, mcToken, login, makeAdmin, serverBody };
}
