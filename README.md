<<<<<<< HEAD
# bslauncher-api

BSLauncher 서버 API (Cloudflare Workers + D1 + Hono + Zod). 현재 범위: **로그인, 세션, 서버 목록, 서버 접근 권한, 관리자 API(사용자/서버/권한), 감사 로그**.
뉴스/갤러리/매니페스트/R2/런처 업데이트는 다음 단계입니다.

## 인증 방식 (스파이크로 확인됨)
Cloudflare Workers 에서는 Mojang API 가 403 으로 막혀 있어, 런처가 보낸 Minecraft 토큰(RS256 JWT)의 **서명을 내장 Mojang 공개키로 직접 검증**합니다.
검증이 통과하면 UUID 는 Mojang 이 보증한 값이며 클라이언트가 지어낼 수 없습니다. 이후에는 BSLauncher 전용 세션 토큰(12시간, DB에는 SHA-256 해시만 저장)을 씁니다.
- 처음 로그인한 UUID 는 `PLAYER` 로 자동 생성 → 공개 서버만 보임. 비공개 서버는 관리자가 `server_access` 로 부여.
- 한계: Mojang 이 토큰을 폐기해도 만료(약 24시간)까지는 통과. Mojang 키가 바뀌면 `src/mojang-keys.json` 갱신 후 재배포.

## 설치 / 배포 (CMD)
```bat
npm install
npm run check                                   REM 타입 검사 + 테스트 20개
npx wrangler login
npx wrangler d1 create bslauncher-db            REM 출력된 database_id 를 wrangler.toml 에 붙여넣기
npm run db:migrate:remote
npx wrangler deploy
```
`src/mojang-keys.json` 은 **스파이크 때 받은 실제 공개키 파일을 그대로 유지**하세요 (이 zip 의 파일은 `{}` 빈 자리표시자입니다).
```bat
curl https://api.minecraftservices.com/publickeys -o src\mojang-keys.json
```

## 첫 관리자 만들기
먼저 `npm run login-test` 로 로그인해 두면 users 에 본인이 생깁니다. 그다음:
```bat
npx wrangler d1 execute bslauncher-db --remote --command "UPDATE users SET role='ADMIN' WHERE nickname='내닉네임'"
```

## 동작 확인 (사용자 PC)
```bat
set API_URL=https://bslauncher-api.<서브도메인>.workers.dev
npm run login-test
```

## 엔드포인트 (/api/v1, 응답은 `{success, data}` / `{success:false, error:{code,message}}`)
| 경로 | 설명 |
|---|---|
| `POST /auth/session` `{accessToken}` | Minecraft 토큰 → 세션 발급 |
| `POST /auth/logout` | 세션 폐기 |
| `GET /me` | 내 정보 |
| `GET /servers`, `GET /servers/:id` | 볼 수 있는 서버(`canLaunch` 포함). 없으면 빈 배열 |
| `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/:uuid` | 사용자 관리(닉네임 검색, UUID 사전 등록, 역할) |
| `GET/POST /admin/servers`, `GET/PATCH/DELETE /admin/servers/:id` | 서버 관리 |
| `GET/POST /admin/servers/:id/access`, `DELETE .../access/:uuid` | 서버 접근 권한 |

## 서버 상태 규칙
- 볼 수 있는 서버: 관리자 / 공개 서버 / `server_access` 등록자
- `OPEN` → 볼 수 있으면 실행 가능, `TESTING` → 관리자와 등록자만, `MAINTENANCE`·`CLOSED` → 실행 불가(`canLaunch:false`)

## 보안 메모
- 마지막 관리자는 강등/삭제 불가, 강등 시 그 사용자의 세션은 즉시 폐기, 관리자 변경은 `audit_logs` 에 기록
- 속도 제한은 코드에 넣지 않았습니다(D1 쓰기 절약). Cloudflare 대시보드의 Rate limiting 규칙으로 `/api/v1/auth/*` 에 적용하세요.
- Cloudflare 계정 2FA 필수. Worker 로그에 토큰/본문을 남기지 않습니다.
=======
# bslauncher-api
>>>>>>> 502b161d22c9335fdfb942079829b5cd4acc6579
