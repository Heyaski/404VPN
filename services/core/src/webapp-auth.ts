import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebAppUser {
  telegramId: number;
  username?: string;
  firstName?: string;
}

function hmacChain(botToken: string, dataCheckString: string): string {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
}

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86_400,
  nowMs = Date.now(),
): WebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]+$/i.test(hash)) return null;
  params.delete("hash");

  const expected = Buffer.from(hmacChain(botToken, dataCheckString(params)), "hex");
  const given = Buffer.from(hash, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  try {
    const u = JSON.parse(rawUser) as { id?: number; username?: string; first_name?: string };
    if (typeof u.id !== "number") return null;
    return { telegramId: u.id, username: u.username, firstName: u.first_name };
  } catch {
    return null;
  }
}

// Только для тестов: собирает валидную initData тем же алгоритмом
export function buildInitData(user: object, botToken: string, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(authDate)),
    user: JSON.stringify(user),
  });
  params.set("hash", hmacChain(botToken, dataCheckString(params)));
  return params.toString();
}
