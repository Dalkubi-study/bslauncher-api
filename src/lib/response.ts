import type { Context } from "hono";

/** API 오류. code 는 클라이언트가 분기에 쓰고 message 는 사용자에게 보여 줄 수 있는 한글 문구다. */
export class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503, public code: string, message: string) {
    super(message);
  }
}

export const ok = <T>(c: Context, data: T, status: 200 | 201 = 200) => c.json({ success: true as const, data }, status);

export const fail = (c: Context, error: ApiError) =>
  c.json({ success: false as const, error: { code: error.code, message: error.message } }, error.status);

/** 자주 쓰는 오류 모음 (문구를 한곳에서 관리한다) */
export const Errors = {
  unauthorized: () => new ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다."),
  sessionExpired: () => new ApiError(401, "SESSION_EXPIRED", "로그인이 만료되었습니다. 다시 로그인해 주세요."),
  forbidden: () => new ApiError(403, "FORBIDDEN", "권한이 없습니다."),
  serverNotFound: () => new ApiError(404, "SERVER_NOT_FOUND", "서버를 찾을 수 없습니다."),
  userNotFound: () => new ApiError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다."),
  validation: (detail?: string) => new ApiError(400, "VALIDATION_FAILED", detail ? `요청 값이 올바르지 않습니다. (${detail})` : "요청 값이 올바르지 않습니다."),
  loginFailed: () => new ApiError(401, "LOGIN_FAILED", "로그인에 실패했습니다."),
  lastAdmin: () => new ApiError(409, "LAST_ADMIN", "마지막 관리자는 변경하거나 삭제할 수 없습니다."),
};
