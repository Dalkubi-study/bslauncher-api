import { z } from "zod";
import { Errors } from "./response";

/** 입력은 전부 Zod 로 검증한다. 모르는 키는 거부(strict)하는 스키마만 쓴다. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw Errors.validation(first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined);
  }
  return result.data;
}

export const uuidSchema = z
  .string()
  .transform((v) => v.replace(/-/g, "").toLowerCase())
  .pipe(z.string().regex(/^[0-9a-f]{32}$/, "UUID 형식이 아닙니다"));

export const serverIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, "서버 ID는 소문자/숫자/-/_ 2~32자");

const httpsUrl = z.string().url().max(500).refine((v) => v.startsWith("https://"), "https 주소만 허용합니다");

export const serverFields = {
  name: z.string().trim().min(1).max(40),
  description: z.string().max(2000),
  minecraftVersion: z.string().regex(/^[0-9A-Za-z._-]{1,32}$/, "Minecraft 버전 형식이 아닙니다"),
  loader: z.enum(["vanilla", "fabric", "forge", "neoforge", "quilt"]),
  loaderVersion: z.string().regex(/^[0-9A-Za-z._+-]{1,64}$/).nullable(),
  address: z.string().regex(/^[A-Za-z0-9.-]{1,253}$/, "서버 주소 형식이 아닙니다"),
  port: z.number().int().min(1).max(65535),
  status: z.enum(["OPEN", "TESTING", "MAINTENANCE", "CLOSED"]),
  isPublic: z.boolean(),
  iconUrl: httpsUrl.nullable(),
  bannerUrl: httpsUrl.nullable(),
  sortOrder: z.number().int().min(-1000).max(1000),
};
