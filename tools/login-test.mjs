// 실제 Microsoft 로그인으로 배포된 API 를 end-to-end 확인한다. (사용자 PC에서 실행)
//   CMD:  set API_URL=https://bslauncher-api.<서브도메인>.workers.dev
//         (선택) set MS_CLIENT_ID=...  /  set MS_REDIRECT=https://login.microsoftonline.com/common/oauth2/nativeclient
//         npm run login-test
// 토큰 값은 출력하지 않는다.
import { Auth } from "msmc";

const API = (process.env.API_URL ?? "").replace(/\/$/, "");
if (!API) { console.error("API_URL 환경 변수를 지정하세요."); process.exit(1); }

const call = async (method, path, token, body) => {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const show = (label, r) => console.log(`${label} → HTTP ${r.status}`, JSON.stringify(r.body?.data ?? r.body?.error ?? r.body).slice(0, 400));

const clientId = process.env.MS_CLIENT_ID;
const auth = clientId
  ? new Auth({ client_id: clientId, redirect: process.env.MS_REDIRECT ?? "https://login.microsoftonline.com/common/oauth2/nativeclient", prompt: "select_account" })
  : new Auth("select_account");
console.log(clientId ? `Client ID: 사용자 지정(${clientId.slice(0, 8)}…)` : "Client ID: msmc 기본");

const mc = await (await auth.launch("raw")).getMinecraft();
console.log(`Microsoft 로그인 OK: ${mc.profile?.name} (${mc.profile?.id})`);

const login = await call("POST", "/auth/session", null, { accessToken: mc.mcToken });
show("1) 로그인", { status: login.status, body: { data: { user: login.body?.data?.user, expiresAt: login.body?.data?.session?.expiresAt }, error: login.body?.error } });
const token = login.body?.data?.session?.token;
if (!token) process.exit(1);

show("2) /me", await call("GET", "/me", token));
const servers = await call("GET", "/servers", token);
show("3) 서버 목록", servers);
if (servers.body?.data?.servers?.length === 0) console.log("   (비어 있음 → 런처는 '표시할 서버가 없습니다. 관리자에게 화이트리스트 등록을 요청하세요.'를 표시)");
show("4) 관리자 API (일반 계정이면 403이 정상)", await call("GET", "/admin/users", token));
show("5) 로그아웃", await call("POST", "/auth/logout", token));
show("6) 로그아웃 후 /me (401이 정상)", await call("GET", "/me", token));
