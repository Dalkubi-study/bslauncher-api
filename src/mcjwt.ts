/**
 * Minecraft access token(JWT, RS256) 오프라인 검증.
 * Cloudflare Workers에서는 Mojang API 호출이 403으로 막히므로,
 * 내장한 Mojang 공개키로 서명을 직접 검증한다 (서버 호출 없음).
 *
 * 지원하는 키 형식 (실제 형식은 /publickeys 응답으로 확인):
 *   1) { authenticationKeys: [{ publicKey: "<base64 SPKI DER>" }] }
 *   2) JWKS { keys: [{ kty:"RSA", n, e, kid? }] }
 *   3) PEM 문자열을 담은 { publicKey: "-----BEGIN PUBLIC KEY-----..." } 항목
 */
export type KeyCandidate = { kid?: string; key: CryptoKey };

export type McClaims = {
  uuid: string;
  name: string | null;
  iss: string | null;
  exp: number;
  raw: Record<string, unknown>;
};

export class McTokenError extends Error {
  constructor(public code: "MALFORMED" | "BAD_ALG" | "NO_KEY" | "BAD_SIGNATURE" | "EXPIRED" | "NOT_YET_VALID" | "NO_PROFILE") {
    super(code);
  }
}

const RSA_IMPORT = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function b64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function pemToDer(pem: string): Uint8Array {
  return b64ToBytes(pem.replace(/-----(BEGIN|END)[^-]+-----/g, ""));
}

export async function loadKeys(source: unknown): Promise<KeyCandidate[]> {
  const out: KeyCandidate[] = [];
  const addSpki = async (b64OrPem: string, kid?: string) => {
    const der = b64OrPem.includes("BEGIN") ? pemToDer(b64OrPem) : b64ToBytes(b64OrPem);
    out.push({ kid, key: await crypto.subtle.importKey("spki", der, RSA_IMPORT, false, ["verify"]) });
  };
  const obj = (source ?? {}) as Record<string, unknown>;
  const auth = obj.authenticationKeys;
  if (Array.isArray(auth)) for (const k of auth) if (typeof k?.publicKey === "string") await addSpki(k.publicKey, k.kid);
  const jwks = obj.keys;
  if (Array.isArray(jwks)) {
    for (const k of jwks) {
      if (k?.kty === "RSA" && k.n && k.e) {
        out.push({ kid: k.kid, key: await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, RSA_IMPORT, false, ["verify"]) });
      } else if (typeof k?.publicKey === "string") await addSpki(k.publicKey, k.kid);
    }
  }
  return out;
}

const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(b64ToBytes(part))) as Record<string, unknown>;

/** 서명·만료를 검증하고 프로필(UUID/닉네임)을 반환한다. 서명 검증 전에는 payload를 믿지 않는다. */
export async function verifyMinecraftToken(token: string, keys: KeyCandidate[], nowMs = Date.now()): Promise<McClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new McTokenError("MALFORMED");
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(h);
    payload = decodeJson(p);
  } catch {
    throw new McTokenError("MALFORMED");
  }
  // 알고리즘 혼동 공격 방지: 반드시 RS256만 허용한다 (none/HS256 거부).
  if (header.alg !== "RS256") throw new McTokenError("BAD_ALG");

  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const byKid = kid ? keys.filter((k) => k.kid === kid) : [];
  const candidates = byKid.length > 0 ? byKid : keys; // kid 정보가 없는 키는 전부 시도한다
  if (candidates.length === 0) throw new McTokenError("NO_KEY");

  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = b64ToBytes(s);
  let valid = false;
  for (const c of candidates) {
    if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", c.key, sig, data)) { valid = true; break; }
  }
  if (!valid) throw new McTokenError("BAD_SIGNATURE");

  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp * 1000 < nowMs) throw new McTokenError("EXPIRED");
  if (typeof payload.nbf === "number" && payload.nbf * 1000 > nowMs + 60_000) throw new McTokenError("NOT_YET_VALID");

  // 프로필: pfd[type=mc] 우선, 없으면 profiles.mc
  let uuid: string | null = null;
  let name: string | null = null;
  const pfd = payload.pfd;
  if (Array.isArray(pfd)) {
    const mc = pfd.find((x) => x?.type === "mc");
    if (mc && typeof mc.id === "string") { uuid = mc.id; name = typeof mc.name === "string" ? mc.name : null; }
  }
  if (!uuid) {
    const profiles = payload.profiles as Record<string, unknown> | undefined;
    if (profiles && typeof profiles.mc === "string") uuid = profiles.mc;
  }
  if (!uuid) throw new McTokenError("NO_PROFILE");
  uuid = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw new McTokenError("NO_PROFILE");
  return { uuid, name, iss: typeof payload.iss === "string" ? payload.iss : null, exp, raw: payload };
}
