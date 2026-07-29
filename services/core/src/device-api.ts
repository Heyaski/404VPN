import express from "express";
import type pg from "pg";
import { pool as defaultPool, withTxOn } from "./db.js";
import { hashCode, normalizeCode } from "./codes.js";
import { applyBalanceChange } from "./ledger.js";
import { deviceAuth, generateDeviceToken, hashToken, type DeviceRequest } from "./device-auth.js";
import { getSetting } from "./settings.js";
import { daysLeft } from "./templates.js";
import { reactivate } from "./billing.js";
import { WgNotConfiguredError, type WgProvider } from "./wg/provider.js";

const REDEEM_MAX_ATTEMPTS = 5;
const REDEEM_WINDOW_MS = 60_000;

/** Простое окно попыток в памяти. Для одного инстанса достаточно; при масштабировании — в Redis. */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 10_000) hits.clear(); // страховка от роста памяти
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

type RedeemResult =
  | { ok: true; token: string; balance: string; devices: number }
  | { ok: false; error: "invalid_code" | "already_used" | "expired" | "revoked" | "device_limit" };

export interface DeviceRouterOptions {
  redeemMaxAttempts?: number;
  redeemWindowMs?: number;
}

export function createDeviceRouter(
  wg: WgProvider,
  db: pg.Pool = defaultPool,
  opts: DeviceRouterOptions = {},
): express.Router {
  const router = express.Router();
  router.use(express.json());
  const allowRedeem = createRateLimiter(
    opts.redeemMaxAttempts ?? REDEEM_MAX_ATTEMPTS,
    opts.redeemWindowMs ?? REDEEM_WINDOW_MS,
  );

  router.post("/api/redeem", async (req, res, next) => {
    if (!allowRedeem(req.ip ?? "unknown")) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }
    const { code, deviceName } = (req.body ?? {}) as { code?: unknown; deviceName?: unknown };
    if (typeof code !== "string" || code.trim() === "") {
      res.status(400).json({ error: "invalid_code" });
      return;
    }

    try {
      const result = await withTxOn(db, async (c): Promise<RedeemResult> => {
        const { rows: [ac] } = await c.query(
          "SELECT * FROM access_codes WHERE code_hash=$1 FOR UPDATE", [hashCode(normalizeCode(code))]);
        if (!ac) return { ok: false, error: "invalid_code" };
        if (ac.status === "redeemed") return { ok: false, error: "already_used" };
        if (ac.status === "revoked") return { ok: false, error: "revoked" };
        if (new Date(ac.expires_at) <= new Date()) {
          await c.query("UPDATE access_codes SET status='expired' WHERE id=$1", [ac.id]);
          return { ok: false, error: "expired" };
        }

        let userId: string;
        let balance: string;

        if (ac.user_id) {
          // код привязки, выпущенный в Mini App: аккаунт уже есть, баланс не трогаем
          const { rows: [account] } = await c.query(
            "SELECT id, balance, max_devices FROM users WHERE id=$1 FOR UPDATE", [ac.user_id]);
          if (!account) return { ok: false, error: "invalid_code" };
          const { rows: [{ devices }] } = await c.query(
            `SELECT count(*)::int AS devices FROM devices
             WHERE user_id=$1 AND is_active AND revoked_at IS NULL`, [account.id]);
          if (devices >= account.max_devices) return { ok: false, error: "device_limit" };
          userId = account.id;
          balance = account.balance;
        } else {
          // код покупки (старая схема): создаём аккаунт и зачисляем номинал
          const maxDevices = await getSetting(c, "max_devices_default");
          const { rows: [user] } = await c.query(
            "INSERT INTO users (max_devices) VALUES ($1) RETURNING id", [maxDevices || 5]);
          const applied = await applyBalanceChange(
            c, user.id, Number(ac.amount), "code_redeem", { code_id: ac.id });
          userId = user.id;
          balance = applied.balanceAfter;
          // код куплен в боте — привязываем telegram-аккаунт, чтобы /balance и уведомления работали
          await c.query(
            `UPDATE telegram_users SET user_id=$1
             WHERE user_id IS NULL
               AND id = (SELECT telegram_user_id FROM payment_orders WHERE access_code_id=$2)`,
            [userId, ac.id]);
        }

        await c.query(
          "UPDATE access_codes SET status='redeemed', redeemed_by=$2, redeemed_at=now() WHERE id=$1",
          [ac.id, userId]);

        const token = generateDeviceToken();
        await c.query(
          "INSERT INTO devices(user_id, name, token_hash, platform) VALUES ($1,$2,$3,'ios')",
          [userId, typeof deviceName === "string" && deviceName ? deviceName.slice(0, 64) : "iPhone",
           hashToken(token)]);

        const { rows: [{ devices }] } = await c.query(
          `SELECT count(*)::int AS devices FROM devices
           WHERE user_id=$1 AND is_active AND revoked_at IS NULL`, [userId]);

        return { ok: true, token, balance, devices };
      });

      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      const monthly = await getSetting(db, "device_monthly_price");
      const left = daysLeft(Number(result.balance), result.devices, monthly);
      res.json({
        token: result.token,
        balance: result.balance,
        daysLeft: Number.isFinite(left) ? left : null,
      });
    } catch (e) {
      next(e);
    }
  });

  router.use("/api/device", deviceAuth(db));

  router.get("/api/device/me", async (req: DeviceRequest, res, next) => {
    try {
      const { rows: [row] } = await db.query(
        `SELECT u.balance, u.status, d.name AS device_name,
                (SELECT count(*)::int FROM devices x
                  WHERE x.user_id=u.id AND x.is_active AND x.revoked_at IS NULL) AS devices
         FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
        [req.device!.id]);
      const monthly = await getSetting(db, "device_monthly_price");
      const left = daysLeft(Number(row.balance), row.devices, monthly);
      res.json({
        balance: row.balance,
        status: row.status,
        devices: row.devices,
        deviceName: row.device_name,
        daysLeft: Number.isFinite(left) ? left : null,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post("/api/device/tunnel", async (req: DeviceRequest, res, next) => {
    try {
      const { rows: [row] } = await db.query(
        `SELECT d.wg_client_id, d.name, u.id AS user_id, u.status
         FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
        [req.device!.id]);
      if (row.status === "blocked") {
        res.status(403).json({ error: "blocked" });
        return;
      }
      if (row.status !== "active") {
        res.status(402).json({ error: "suspended" });
        return;
      }
      if (row.wg_client_id) {
        res.json(await wg.getTunnel(row.wg_client_id));
        return;
      }
      const created = await wg.createClient(`404vpn-${req.device!.id.slice(0, 8)}`);
      await db.query(
        "UPDATE devices SET wg_client_id=$2, wg_public_key=$3, last_seen_at=now() WHERE id=$1",
        [req.device!.id, created.clientId, created.publicKey]);
      res.json(created.tunnel);
    } catch (e) {
      if (e instanceof WgNotConfiguredError) {
        res.status(503).json({ error: "wg_unavailable" });
        return;
      }
      next(e);
    }
  });

  router.delete("/api/device", async (req: DeviceRequest, res, next) => {
    try {
      const { rows: [row] } = await db.query(
        "SELECT wg_client_id FROM devices WHERE id=$1", [req.device!.id]);
      if (row?.wg_client_id) await wg.deleteClient(row.wg_client_id);
      await db.query(
        "UPDATE devices SET is_active=false, revoked_at=now(), wg_client_id=NULL WHERE id=$1",
        [req.device!.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export { reactivate };
