import { createHash, randomBytes } from "node:crypto";
import type express from "express";
import type pg from "pg";

export interface DeviceIdentity {
  id: string;
  userId: string;
}

export interface DeviceRequest extends express.Request {
  device?: DeviceIdentity;
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function deviceAuth(db: pg.Pool): express.RequestHandler {
  return async (req: DeviceRequest, res, next) => {
    const header = req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const { rows: [row] } = await db.query(
        "SELECT id, user_id FROM devices WHERE token_hash=$1 AND revoked_at IS NULL",
        [hashToken(token)],
      );
      if (!row) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      req.device = { id: row.id, userId: row.user_id };
      next();
    } catch (e) {
      next(e);
    }
  };
}
