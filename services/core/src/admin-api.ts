import express from "express";
import type pg from "pg";
import { pool as defaultPool, withTxOn } from "./db.js";
import { adminAuth, issueAdminToken, passwordMatches } from "./admin-auth.js";
import { generateCode, hashCode, normalizeCode } from "./codes.js";
import { applyBalanceChange } from "./ledger.js";
import { getSetting } from "./settings.js";
import { daysLeft } from "./templates.js";
import { reactivate } from "./billing.js";
import { createRateLimiter } from "./device-api.js";
import type { WgProvider } from "./wg/provider.js";

const EDITABLE_SETTINGS = [
  "device_monthly_price",
  "min_topup",
  "reminder_threshold_days",
  "max_devices_default",
  "device_code_ttl_minutes",
];

async function clientIdsOf(c: pg.PoolClient, userId: string): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT wg_client_id FROM devices
     WHERE user_id=$1 AND is_active AND revoked_at IS NULL AND wg_client_id IS NOT NULL`,
    [userId],
  );
  return rows.map((r) => r.wg_client_id as string);
}

export function createAdminRouter(
  password: string,
  wg: WgProvider,
  db: pg.Pool = defaultPool,
): express.Router {
  const router = express.Router();
  router.use(express.json());
  const allowLogin = createRateLimiter(10, 60_000);

  router.post("/admin/api/login", (req, res) => {
    if (!allowLogin(req.ip ?? "unknown")) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }
    const given = (req.body as { password?: unknown })?.password;
    if (typeof given !== "string" || !passwordMatches(given, password)) {
      res.status(401).json({ error: "bad_password" });
      return;
    }
    res.json({ token: issueAdminToken(password) });
  });

  router.use("/admin/api", adminAuth(password));

  router.get("/admin/api/stats", async (_req, res) => {
    const { rows: [s] } = await db.query(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE status='active') AS active,
        (SELECT count(*)::int FROM users WHERE status='suspended') AS suspended,
        (SELECT count(*)::int FROM devices WHERE is_active AND revoked_at IS NULL) AS devices,
        (SELECT coalesce(sum(balance),0)::numeric(12,2) FROM users) AS balance_total,
        (SELECT coalesce(sum(amount),0)::numeric(12,2) FROM payment_orders WHERE status='success') AS revenue_total,
        (SELECT coalesce(sum(amount),0)::numeric(12,2) FROM payment_orders
          WHERE status='success' AND paid_at >= date_trunc('month', now())) AS revenue_month,
        (SELECT count(*)::int FROM access_codes WHERE status='issued') AS codes_issued
    `);
    res.json(s);
  });

  router.get("/admin/api/users", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const monthly = await getSetting(db, "device_monthly_price");
    const { rows } = await db.query(
      `SELECT u.id, u.balance, u.status, u.max_devices, u.created_at, u.last_charged_at,
              (SELECT count(*)::int FROM devices d
                WHERE d.user_id=u.id AND d.is_active AND d.revoked_at IS NULL) AS devices,
              t.telegram_id, t.username
       FROM users u LEFT JOIN telegram_users t ON t.user_id = u.id
       WHERE $1 = '' OR t.username ILIKE '%' || $1 || '%'
          OR CAST(t.telegram_id AS text) LIKE '%' || $1 || '%'
          OR CAST(u.id AS text) LIKE $1 || '%'
       ORDER BY u.created_at DESC LIMIT 100`,
      [query],
    );
    res.json({
      users: rows.map((u) => {
        const left = daysLeft(Number(u.balance), u.devices, monthly);
        return { ...u, daysLeft: Number.isFinite(left) ? left : null };
      }),
    });
  });

  router.get("/admin/api/users/:id", async (req, res) => {
    const { rows: [user] } = await db.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { rows: devices } = await db.query(
      `SELECT id, name, platform, is_active, revoked_at, wg_client_id, created_at, last_seen_at
       FROM devices WHERE user_id=$1 ORDER BY created_at DESC`, [req.params.id]);
    const { rows: transactions } = await db.query(
      `SELECT type, amount, balance_after, meta, created_at FROM balance_transactions
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.params.id]);
    const { rows: [telegram] } = await db.query(
      "SELECT telegram_id, username, is_blocked_bot FROM telegram_users WHERE user_id=$1",
      [req.params.id]);
    res.json({ user, devices, transactions, telegram: telegram ?? null });
  });

  /** Ручная корректировка баланса — только через ledger, как и все движения денег. */
  router.post("/admin/api/users/:id/balance", async (req, res, next) => {
    const amount = Number((req.body as { amount?: unknown })?.amount);
    const note = (req.body as { note?: unknown })?.note;
    if (!Number.isFinite(amount) || amount === 0) {
      res.status(400).json({ error: "invalid_amount" });
      return;
    }
    try {
      const balanceAfter = await withTxOn(db, async (c) => {
        const { rows: [u] } = await c.query("SELECT id FROM users WHERE id=$1", [req.params.id]);
        if (!u) return null;
        const applied = await applyBalanceChange(c, req.params.id, amount, "admin_adjust", {
          note: typeof note === "string" ? note.slice(0, 200) : undefined,
        });
        return applied.balanceAfter;
      });
      if (balanceAfter === null) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // пополнили заблокированному за неуплату — снимаем приостановку и включаем пиры
      await reactivate(db, wg, req.params.id).catch((e) => console.error("reactivate failed:", e));
      res.json({ balance: balanceAfter });
    } catch (e) {
      next(e);
    }
  });

  /** Блокировка и разблокировка. Блокировка сразу гасит пиры в wg-easy. */
  router.post("/admin/api/users/:id/status", async (req, res, next) => {
    const status = (req.body as { status?: unknown })?.status;
    if (status !== "active" && status !== "blocked") {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    try {
      const clientIds = await withTxOn(db, async (c) => {
        const { rows: [u] } = await c.query(
          "SELECT id, balance FROM users WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!u) return null;
        // разблокировка при нулевом балансе возвращает в suspended, а не в active
        const next = status === "blocked" ? "blocked" : Number(u.balance) > 0 ? "active" : "suspended";
        await c.query("UPDATE users SET status=$2 WHERE id=$1", [req.params.id, next]);
        return { next, ids: await clientIdsOf(c, req.params.id) };
      });
      if (!clientIds) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const enabled = clientIds.next === "active";
      for (const id of clientIds.ids) await wg.setEnabled(id, enabled).catch(() => undefined);
      res.json({ status: clientIds.next });
    } catch (e) {
      next(e);
    }
  });

  router.get("/admin/api/codes", async (_req, res) => {
    const { rows } = await db.query(
      `SELECT c.id, c.amount, c.status, c.expires_at, c.created_at, c.redeemed_at,
              c.user_id IS NOT NULL AS is_link_code, c.redeemed_by
       FROM access_codes c ORDER BY c.created_at DESC LIMIT 200`);
    res.json({ codes: rows });
  });

  /** Промо-коды: без привязки к аккаунту, поэтому создают новый и зачисляют номинал. */
  router.post("/admin/api/codes", async (req, res, next) => {
    const body = req.body as { amount?: unknown; count?: unknown; expiresDays?: unknown };
    const amount = Number(body?.amount);
    const count = Math.min(Math.max(Number(body?.count ?? 1) || 1, 1), 50);
    const expiresDays = Math.min(Math.max(Number(body?.expiresDays ?? 90) || 90, 1), 365);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "invalid_amount" });
      return;
    }
    try {
      const codes: string[] = [];
      await withTxOn(db, async (c) => {
        for (let i = 0; i < count; i++) {
          const code = generateCode();
          await c.query(
            `INSERT INTO access_codes(code_hash, amount, expires_at)
             VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
            [hashCode(normalizeCode(code)), amount.toFixed(2), String(expiresDays)],
          );
          codes.push(code);
        }
      });
      res.json({ codes });
    } catch (e) {
      next(e);
    }
  });

  router.post("/admin/api/codes/:id/revoke", async (req, res, next) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE access_codes SET status='revoked' WHERE id=$1 AND status='issued'",
        [req.params.id]);
      if (!rowCount) {
        res.status(400).json({ error: "not_revocable" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get("/admin/api/payments", async (_req, res) => {
    const { rows } = await db.query(
      `SELECT p.id, p.amount, p.status, p.created_at, p.paid_at, p.user_id,
              t.telegram_id, t.username
       FROM payment_orders p LEFT JOIN telegram_users t ON t.id = p.telegram_user_id
       ORDER BY p.created_at DESC LIMIT 200`);
    res.json({ payments: rows });
  });

  router.get("/admin/api/settings", async (_req, res) => {
    const { rows } = await db.query(
      "SELECT key, value FROM settings WHERE key = ANY($1) ORDER BY key", [EDITABLE_SETTINGS]);
    const { rows: presets } = await db.query(
      "SELECT id, amount, title, is_active, sort_order FROM topup_presets ORDER BY sort_order");
    res.json({ settings: rows, presets });
  });

  router.put("/admin/api/settings", async (req, res, next) => {
    const updates = req.body as Record<string, unknown>;
    const entries = Object.entries(updates ?? {}).filter(([k]) => EDITABLE_SETTINGS.includes(k));
    if (entries.length === 0) {
      res.status(400).json({ error: "nothing_to_update" });
      return;
    }
    try {
      await withTxOn(db, async (c) => {
        for (const [key, value] of entries) {
          const numeric = Number(value);
          if (!Number.isFinite(numeric) || numeric < 0) continue;
          await c.query(
            "UPDATE settings SET value=$2::jsonb, updated_at=now() WHERE key=$1",
            [key, JSON.stringify(numeric)]);
        }
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.put("/admin/api/presets/:id", async (req, res, next) => {
    const body = req.body as { amount?: unknown; title?: unknown; is_active?: unknown };
    try {
      const { rowCount } = await db.query(
        `UPDATE topup_presets
         SET amount = coalesce($2, amount), title = coalesce($3, title),
             is_active = coalesce($4, is_active)
         WHERE id = $1`,
        [req.params.id,
         Number.isFinite(Number(body?.amount)) ? Number(body.amount).toFixed(2) : null,
         typeof body?.title === "string" ? body.title.slice(0, 40) : null,
         typeof body?.is_active === "boolean" ? body.is_active : null],
      );
      if (!rowCount) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
