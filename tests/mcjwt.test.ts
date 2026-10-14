import { describe, expect, it } from "vitest";
import { loadKeys, McTokenError, verifyMinecraftToken } from "../src/mcjwt";

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const UUID = "1c4175c3354e4b4384c0b93b0c216e63";

async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const sign = async (payload: object, header: object = { kid: "k1", alg: "RS256" }) => {
    const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    return `${body}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)))}`;
  };
  return { pair, spkiB64: btoa(String.fromCharCode(...spki)), jwk, sign };
}
const payload = (over: object = {}) => ({ iss: "authentication", exp: Math.floor(Date.now() / 1000) + 3600, nbf: 0, profiles: { mc: UUID }, pfd: [{ type: "mc", id: UUID, name: "DALKUBI" }], ...over });
const code = async (p: Promise<unknown>) => p.then(() => "OK", (e) => (e instanceof McTokenError ? e.code : String(e)));

describe("verifyMinecraftToken", () => {
  it("올바른 토큰은 UUID/닉네임을 반환한다 (SPKI / JWKS 형식 모두)", async () => {
    const s = await setup();
    const token = await s.sign(payload());
    for (const source of [{ authenticationKeys: [{ publicKey: s.spkiB64 }] }, { keys: [{ ...s.jwk, kid: "k1" }] }]) {
      const claims = await verifyMinecraftToken(token, await loadKeys(source));
      expect(claims).toMatchObject({ uuid: UUID, name: "DALKUBI", iss: "authentication" });
    }
  });
  it("다른 키로 서명했거나 payload가 변조되면 거부한다", async () => {
    const a = await setup();
    const b = await setup();
    const keys = await loadKeys({ authenticationKeys: [{ publicKey: a.spkiB64 }] });
    expect(await code(verifyMinecraftToken(await b.sign(payload()), keys))).toBe("BAD_SIGNATURE");
    const good = await a.sign(payload());
    const [h, , sig] = good.split(".");
    const forged = `${h}.${b64url(JSON.stringify(payload({ pfd: [{ type: "mc", id: "f".repeat(32), name: "Admin" }] })))}.${sig}`;
    expect(await code(verifyMinecraftToken(forged, keys))).toBe("BAD_SIGNATURE");
  });
  it("alg none/HS256, 만료, 형식 오류, 키 없음, 프로필 없음을 거부한다", async () => {
    const s = await setup();
    const keys = await loadKeys({ authenticationKeys: [{ publicKey: s.spkiB64 }] });
    expect(await code(verifyMinecraftToken(await s.sign(payload(), { alg: "none" }), keys))).toBe("BAD_ALG");
    expect(await code(verifyMinecraftToken(await s.sign(payload(), { alg: "HS256" }), keys))).toBe("BAD_ALG");
    expect(await code(verifyMinecraftToken(await s.sign(payload({ exp: 1 })), keys))).toBe("EXPIRED");
    expect(await code(verifyMinecraftToken("a.b", keys))).toBe("MALFORMED");
    expect(await code(verifyMinecraftToken(await s.sign(payload()), []))).toBe("NO_KEY");
    expect(await code(verifyMinecraftToken(await s.sign(payload({ pfd: undefined, profiles: {} })), keys))).toBe("NO_PROFILE");
  });
  it("profiles.mc만 있어도 UUID를 읽고 하이픈을 제거한다", async () => {
    const s = await setup();
    const keys = await loadKeys({ authenticationKeys: [{ publicKey: s.spkiB64 }] });
    const dashed = "1c4175c3-354e-4b43-84c0-b93b0c216e63";
    const claims = await verifyMinecraftToken(await s.sign(payload({ pfd: undefined, profiles: { mc: dashed } })), keys);
    expect(claims.uuid).toBe(UUID);
    expect(claims.name).toBeNull();
  });
});
