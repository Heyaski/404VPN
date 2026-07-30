import { createHmac, timingSafeEqual } from "node:crypto";
import type express from "express";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Токен админки: `<срок>.<подпись>`. Ключ подписи — сам пароль, поэтому смена
 * пароля мгновенно обесценивает выданные токены и отдельного хранилища сессий не нужно.
 */
function sign(password: string, payload: string): string {
  return createHmac("sha256", password).update(payload).digest("hex");
}

export function issueAdminToken(password: string, nowMs = Date.now()): string {
  const exp = String(nowMs + TOKEN_TTL_MS);
  return `${exp}.${sign(password, exp)}`;
}

export function verifyAdminToken(token: string, password: string, nowMs = Date.now()): boolean {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < nowMs) return false;

  const expected = Buffer.from(sign(password, exp), "hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(given, "hex");
  } catch {
    return false;
  }
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Сравнение пароля постоянного времени — чтобы подбор не считывался по задержке. */
export function passwordMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminAuth(password: string): express.RequestHandler {
  return (req, res, next) => {
    const header = req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !verifyAdminToken(token, password)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
