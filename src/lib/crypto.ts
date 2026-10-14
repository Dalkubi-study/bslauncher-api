const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 암호학적으로 안전한 256비트 토큰(base64url). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}
