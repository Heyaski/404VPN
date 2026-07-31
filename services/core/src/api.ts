import express from "express";
import type pg from "pg";
import { pool as defaultPool, withTxOn } from "./db.js";
import { generateCode, hashCode, normalizeCode } from "./codes.js";
import { referralStats } from "./referral.js";
import { validateInitData } from "./webapp-auth.js";
import { createTopupOrder } from "./payments.js";
import { buildPaymentUrl, type RobokassaCreds } from "./robokassa.js";
import { daysLeft } from "./templates.js";

const MAX_TOPUP_RUB = 100_000;
const MINIAPP_PATHS = [
  "/api/me",
  "/api/presets",
  "/api/topup",
  "/api/history",
  "/api/device-code",
  "/api/referral",
  "/api/support",
];

interface AuthedRequest extends express.Request {
  tgUserId?: string;
}

async function getSetting(db: pg.Pool, key: string): Promise<number> {
  const { rows: [r] } = await db.query("SELECT value FROM settings WHERE key=$1", [key]);
  return Number(r?.value ?? 0);
}

async function getLinkedAccount(db: pg.Pool, tgUserId: string) {
  const { rows: [row] } = await db.query(
    `SELECT u.id, u.balance, u.status,
            (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id AND d.is_active) AS devices
     FROM telegram_users t JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [tgUserId],
  );
  return row as { id: string; balance: string; status: string; devices: number } | undefined;
}

export function createApiRouter(
  botToken: string,
  creds: RobokassaCreds,
  db: pg.Pool = defaultPool,
): express.Router {
  const router = express.Router();
  router.use(express.json());

  // Строго свои маршруты: на весь префикс /api вешать нельзя — там же живут
  // /api/redeem и /api/device/* с другой аутентификацией (токен устройства).
  router.use(MINIAPP_PATHS, async (req: AuthedRequest, res, next) => {
    const user = validateInitData(req.header("X-Telegram-Init-Data") ?? "", botToken);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      // chat_id = telegram_id для личных чатов; существующий chat_id из бота не перетираем
      const { rows: [row] } = await db.query(
        `INSERT INTO telegram_users(telegram_id, chat_id, username)
         VALUES ($1, $1, $2)
         ON CONFLICT (telegram_id) DO UPDATE
           SET username = EXCLUDED.username,
               chat_id = COALESCE(telegram_users.chat_id, EXCLUDED.chat_id),
               last_interaction_at = now()
         RETURNING id`,
        [user.telegramId, user.username ?? null],
      );
      req.tgUserId = row.id;
      next();
    } catch (e) {
      next(e);
    }
  });

  router.get("/api/me", async (req: AuthedRequest, res) => {
    const account = await getLinkedAccount(db, req.tgUserId!);
    if (!account) {
      res.json({ linked: false });
      return;
    }
    const monthly = await getSetting(db, "device_monthly_price");
    const left = daysLeft(Number(account.balance), account.devices, monthly);
    res.json({
      linked: true,
      balance: account.balance,
      devices: account.devices,
      status: account.status,
      daysLeft: Number.isFinite(left) ? left : null,
    });
  });

  router.get("/api/presets", async (_req, res) => {
    const { rows } = await db.query(
      "SELECT amount, title FROM topup_presets WHERE is_active ORDER BY sort_order");
    res.json({
      presets: rows.map((p) => ({ amount: Number(p.amount), title: p.title })),
      minTopup: await getSetting(db, "min_topup"),
    });
  });

  router.post("/api/topup", async (req: AuthedRequest, res) => {
    const amount = Number((req.body as { amount?: unknown })?.amount);
    const min = await getSetting(db, "min_topup");
    if (!Number.isFinite(amount) || amount < min || amount > MAX_TOPUP_RUB) {
      res.status(400).json({ error: "invalid amount", minTopup: min, maxTopup: MAX_TOPUP_RUB });
      return;
    }
    const account = await getLinkedAccount(db, req.tgUserId!);
    const { orderId } = await withTxOn(db, (c) =>
      createTopupOrder(c, {
        telegramUserId: req.tgUserId!,
        userId: account?.id ?? null,
        amountRub: amount,
      }));
    res.json({
      orderId,
      paymentUrl: buildPaymentUrl(creds, {
        invId: orderId,
        outSum: amount.toFixed(2),
        description: `Пополнение 404VPN #${orderId}`,
      }),
    });
  });

  /**
   * Код для привязки нового устройства. Выпускается по кнопке в Mini App,
   * баланс не трогает и не зависит от оплаты — поэтому аккаунт остаётся доступным
   * даже после отвязки всех устройств.
   */
  router.post("/api/device-code", async (req: AuthedRequest, res) => {
    const account = await getLinkedAccount(db, req.tgUserId!);
    if (!account) {
      res.status(404).json({ error: "no_account" });
      return;
    }
    const ttlMinutes = (await getSetting(db, "device_code_ttl_minutes")) || 30;
    const code = generateCode();
    await withTxOn(db, async (c) => {
      // валидным держим ровно один код: прошлые невостребованные отзываем
      await c.query(
        "UPDATE access_codes SET status='revoked' WHERE user_id=$1 AND status='issued'", [account.id]);
      await c.query(
        `INSERT INTO access_codes(code_hash, amount, expires_at, user_id)
         VALUES ($1, 0, now() + ($2 || ' minutes')::interval, $3)`,
        [hashCode(normalizeCode(code)), String(ttlMinutes), account.id],
      );
    });
    res.json({ code, expiresInMinutes: ttlMinutes });
  });

  /** Реферальная программа: ссылка, статистика и текущие условия. */
  router.get("/api/referral", async (req: AuthedRequest, res, next) => {
    try {
      const stats = await referralStats(db, req.tgUserId!);
      res.json({
        ...stats,
        inviteeBonus: await getSetting(db, "referral_invitee_bonus"),
        inviterBonus: await getSetting(db, "referral_inviter_bonus"),
        commissionPercent: await getSetting(db, "referral_commission_percent"),
      });
    } catch (e) {
      next(e);
    }
  });

  /** Справка и контакт поддержки — редактируются в админке. */
  router.get("/api/support", async (_req, res, next) => {
    try {
      const { rows: [tpl] } = await db.query(
        "SELECT text_template FROM notification_templates WHERE key='help'");
      const { rows: [contact] } = await db.query(
        "SELECT value #>> '{}' AS text FROM settings WHERE key='support_contact'");
      res.json({ help: tpl?.text_template ?? "", contact: contact?.text ?? "" });
    } catch (e) {
      next(e);
    }
  });

  router.get("/api/history", async (req: AuthedRequest, res) => {
    const account = await getLinkedAccount(db, req.tgUserId!);
    if (account) {
      const { rows } = await db.query(
        `SELECT type, amount, created_at FROM balance_transactions
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [account.id]);
      res.json({
        items: rows.map((r) => ({ kind: r.type, amount: r.amount, date: r.created_at })),
      });
      return;
    }
    const { rows } = await db.query(
      `SELECT status, amount, created_at FROM payment_orders
       WHERE telegram_user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.tgUserId]);
    res.json({
      items: rows.map((r) => ({ kind: `order_${r.status}`, amount: r.amount, date: r.created_at })),
    });
  });

  return router;
}
