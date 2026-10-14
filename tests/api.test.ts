import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "../src/services/auth";
import { ALICE, BOB, CAROL, makeWorld } from "./helpers/world";

describe("로그인/세션", () => {
  it("처음 보는 UUID는 PLAYER로 자동 생성되고, 닉네임이 바뀌면 갱신된다", async () => {
    const w = await makeWorld();
    const res = await w.call("POST", "/auth/session", { body: { accessToken: await w.mcToken(ALICE) } });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({ uuid: ALICE.uuid, nickname: "Alice", role: "PLAYER" });
    const renamed = await w.call("POST", "/auth/session", { body: { accessToken: await w.mcToken({ uuid: ALICE.uuid, name: "Alice2" }) } });
    expect(renamed.body.data.user.nickname).toBe("Alice2");
    expect((w.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
  });

  it("세션 토큰 원문은 DB에 저장되지 않고 해시만 저장된다", async () => {
    const w = await makeWorld();
    const token = await w.login(ALICE);
    const rows = w.sqlite.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("위조/변조/만료/잘못된 발급자/다른 형식 토큰은 로그인에 실패한다", async () => {
    const w = await makeWorld();
    const good = await w.mcToken(ALICE);
    const [h, , s] = good.split(".");
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
    const forged = `${h}.${b64({ iss: "authentication", exp: 9e9, profiles: { mc: BOB.uuid }, pfd: [{ type: "mc", id: BOB.uuid, name: "Bob" }] })}.${s}`;
    const bad = [
      forged,
      await w.mcToken(ALICE, { exp: 1 }),
      await w.mcToken(ALICE, { iss: "evil" }),
      await w.mcToken(ALICE, {}, { alg: "none" }),
      await w.mcToken(ALICE, { pfd: [{ type: "mc", id: ALICE.uuid }] }), // 닉네임 없음
      "x".repeat(40),
    ];
    for (const accessToken of bad) {
      const res = await w.call("POST", "/auth/session", { body: { accessToken } });
      expect(res.status, accessToken.slice(0, 20)).toBe(401);
      expect(res.body.error.code).toBe("LOGIN_FAILED");
    }
    expect((w.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(0);
  });

  it("알 수 없는 키가 있는 요청은 400이다", async () => {
    const w = await makeWorld();
    const res = await w.call("POST", "/auth/session", { body: { accessToken: await w.mcToken(ALICE), uuid: BOB.uuid } });
    expect(res.status).toBe(400);
  });

  it("세션 없음/잘못된 토큰/만료/로그아웃은 401이고 /me는 사용자를 돌려준다", async () => {
    const w = await makeWorld();
    expect((await w.call("GET", "/me")).status).toBe(401);
    expect((await w.call("GET", "/me", { token: "z".repeat(43) })).status).toBe(401);
    const token = await w.login(ALICE);
    expect((await w.call("GET", "/me", { token })).body.data).toEqual({ uuid: ALICE.uuid, nickname: "Alice", role: "PLAYER" });
    expect((await w.call("POST", "/auth/logout", { token })).status).toBe(200);
    expect((await w.call("GET", "/me", { token })).status).toBe(401);
    const t2 = await w.login(ALICE);
    w.clock.now += SESSION_TTL_MS + 1;
    const expired = await w.call("GET", "/me", { token: t2 });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("last_used_at 은 10분 이내 요청에서는 갱신하지 않는다 (D1 쓰기 절약)", async () => {
    const w = await makeWorld();
    const token = await w.login(ALICE);
    const read = () => (w.sqlite.prepare("SELECT last_used_at FROM sessions").get() as { last_used_at: number }).last_used_at;
    const first = read();
    w.clock.now += 60_000;
    await w.call("GET", "/me", { token });
    expect(read()).toBe(first);
    w.clock.now += 11 * 60_000;
    await w.call("GET", "/me", { token });
    expect(read()).toBe(w.clock.now);
  });
});

describe("서버 목록/접근 권한", () => {
  async function setup() {
    const w = await makeWorld();
    const admin = await w.login(ALICE);
    w.makeAdmin(ALICE.uuid);
    const bob = await w.login(BOB);
    const mk = (id: string, over: Record<string, unknown>) => w.call("POST", "/admin/servers", { token: admin, body: w.serverBody(id, over) });
    expect((await mk("pub", { isPublic: true, status: "OPEN" })).status).toBe(201);
    expect((await mk("priv", { isPublic: false, status: "OPEN" })).status).toBe(201);
    expect((await mk("test", { isPublic: true, status: "TESTING" })).status).toBe(201);
    expect((await mk("mnt", { isPublic: true, status: "MAINTENANCE" })).status).toBe(201);
    return { w, admin, bob };
  }
  const ids = (res: { body: any }) => res.body.data.servers.map((s: any) => s.id).sort();
  const launch = (res: { body: any }) => Object.fromEntries(res.body.data.servers.map((s: any) => [s.id, s.canLaunch]));

  it("권한 없는 사용자는 공개 서버만 보고, TESTING/MAINTENANCE는 실행할 수 없다", async () => {
    const { w, bob } = await setup();
    const res = await w.call("GET", "/servers", { token: bob });
    expect(ids(res)).toEqual(["mnt", "pub", "test"]);
    expect(launch(res)).toEqual({ pub: true, test: false, mnt: false });
    expect((await w.call("GET", "/servers/priv", { token: bob })).status).toBe(404); // 존재 여부도 숨긴다
  });

  it("관리자가 UUID에 권한을 부여하면 비공개 서버가 보이고 TESTING도 실행 가능하다", async () => {
    const { w, admin, bob } = await setup();
    for (const id of ["priv", "test"]) {
      expect((await w.call("POST", `/admin/servers/${id}/access`, { token: admin, body: { userUuid: BOB.uuid } })).status).toBe(201);
    }
    const res = await w.call("GET", "/servers", { token: bob });
    expect(ids(res)).toEqual(["mnt", "priv", "pub", "test"]);
    expect(launch(res)).toEqual({ pub: true, priv: true, test: true, mnt: false });
    expect((await w.call("POST", "/admin/servers/priv/access", { token: admin, body: { userUuid: BOB.uuid } })).status).toBe(409);
    expect((await w.call("DELETE", `/admin/servers/priv/access/${BOB.uuid}`, { token: admin })).status).toBe(200);
    expect(ids(await w.call("GET", "/servers", { token: bob }))).not.toContain("priv");
  });

  it("볼 수 있는 서버가 없으면 빈 배열이다 (안내 문구는 런처가 표시)", async () => {
    const w = await makeWorld();
    const admin = await w.login(ALICE);
    w.makeAdmin(ALICE.uuid);
    await w.call("POST", "/admin/servers", { token: admin, body: w.serverBody("priv") });
    const carol = await w.login(CAROL);
    const res = await w.call("GET", "/servers", { token: carol });
    expect(res.status).toBe(200);
    expect(res.body.data.servers).toEqual([]);
  });

  it("관리자는 모든 서버를 보고 실행할 수 있다", async () => {
    const { w, admin } = await setup();
    const res = await w.call("GET", "/servers", { token: admin });
    expect(ids(res)).toEqual(["mnt", "priv", "pub", "test"]);
    expect(launch(res)).toEqual({ pub: true, priv: true, test: true, mnt: false });
  });

  it("서버 상태를 바꾸면 즉시 반영되고 감사 로그가 남는다", async () => {
    const { w, admin, bob } = await setup();
    await w.call("PATCH", "/admin/servers/mnt", { token: admin, body: { status: "OPEN" } });
    expect(launch(await w.call("GET", "/servers", { token: bob })).mnt).toBe(true);
    const log = w.sqlite.prepare("SELECT action, metadata FROM audit_logs WHERE action = 'SERVER_STATUS_CHANGED'").get() as { metadata: string };
    expect(JSON.parse(log.metadata)).toEqual({ from: "MAINTENANCE", to: "OPEN" });
  });
});

describe("관리자 API 보호와 입력 검증", () => {
  it("일반 사용자와 비로그인은 /admin 을 쓸 수 없다", async () => {
    const w = await makeWorld();
    const bob = await w.login(BOB);
    for (const [m, p] of [["GET", "/admin/users"], ["GET", "/admin/servers"], ["POST", "/admin/servers"], ["DELETE", `/admin/users/${BOB.uuid}`]] as const) {
      expect((await w.call(m, p, { token: bob, body: m === "POST" ? w.serverBody("x") : undefined })).status, `${m} ${p}`).toBe(403);
      expect((await w.call(m, p)).status, `${m} ${p} anon`).toBe(401);
    }
  });

  it("서버 입력값을 검증한다", async () => {
    const w = await makeWorld();
    const admin = await w.login(ALICE);
    w.makeAdmin(ALICE.uuid);
    const bad: Record<string, unknown>[] = [
      { id: "Bad ID" }, { port: 70000 }, { loader: "bukkit" }, { address: "a b" }, { iconUrl: "http://insecure.example/x.png" },
      { bannerUrl: "javascript:alert(1)" }, { status: "PAUSED" }, { extra: 1 }, { name: "" },
    ];
    for (const over of bad) {
      const res = await w.call("POST", "/admin/servers", { token: admin, body: w.serverBody("ok1", over) });
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect((await w.call("POST", "/admin/servers", { token: admin, body: w.serverBody("ok1") })).status).toBe(201);
    expect((await w.call("POST", "/admin/servers", { token: admin, body: w.serverBody("ok1") })).status).toBe(409);
    expect((await w.call("PATCH", "/admin/servers/ok1", { token: admin, body: {} })).status).toBe(400);
    expect((await w.call("PATCH", "/admin/servers/nope", { token: admin, body: { name: "x" } })).status).toBe(404);
  });

  it("사용자 관리: 사전 등록, 중복, 마지막 관리자 보호, 강등 시 세션 폐기", async () => {
    const w = await makeWorld();
    const admin = await w.login(ALICE);
    w.makeAdmin(ALICE.uuid);
    expect((await w.call("POST", "/admin/users", { token: admin, body: { uuid: "1c4175c3-354e-4b43-84c0-b93b0c216e63", nickname: "DALKUBI" } })).status).toBe(201);
    expect((await w.call("POST", "/admin/users", { token: admin, body: { uuid: "1c4175c3354e4b4384c0b93b0c216e63", nickname: "DALKUBI" } })).status).toBe(409);
    expect((await w.call("GET", "/admin/users?query=dalk", { token: admin })).body.data.users).toHaveLength(1);
    // 마지막 관리자는 강등/삭제 불가
    expect((await w.call("PATCH", `/admin/users/${ALICE.uuid}`, { token: admin, body: { role: "PLAYER" } })).status).toBe(409);
    expect((await w.call("DELETE", `/admin/users/${ALICE.uuid}`, { token: admin })).status).toBe(409);
    // 관리자 2명이 되면 강등 가능하고, 강등된 사용자의 세션은 즉시 폐기된다
    const bob = await w.login(BOB);
    await w.call("PATCH", `/admin/users/${BOB.uuid}`, { token: admin, body: { role: "ADMIN" } });
    expect((await w.call("GET", "/admin/users", { token: bob })).status).toBe(200);
    await w.call("PATCH", `/admin/users/${BOB.uuid}`, { token: admin, body: { role: "PLAYER" } });
    expect((await w.call("GET", "/me", { token: bob })).status).toBe(401);
  });

  it("LIKE 와일드카드가 이스케이프된다", async () => {
    const w = await makeWorld();
    const admin = await w.login(ALICE);
    w.makeAdmin(ALICE.uuid);
    await w.login(BOB);
    expect((await w.call("GET", "/admin/users?query=%25", { token: admin })).body.data.users).toHaveLength(0);
  });

  it("없는 경로와 500 오류도 같은 JSON 형식이다", async () => {
    const w = await makeWorld();
    const res = await w.call("GET", "/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: expect.any(String) } });
    expect((await w.call("GET", "/health")).body).toEqual({ success: true, data: { status: "ok" } });
  });
});
