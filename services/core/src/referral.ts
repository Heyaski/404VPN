import { randomInt } from "node:crypto";
import type pg from "pg";
import { ensureAccountForTelegram, queueNotification } from "./accounts.js";
import { withTxOn } from "./db.js";
import { applyBalanceChange } from "./ledger.js";
import { getSetting } from "./settings.js";

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: без похожих символов
const CODE_LENGTH = 8;

export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Нормализует то, что пришло в deep link: регистр и мусор не важны. */
export function normalizeReferralCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, CODE_LENGTH);
}

/** Код выдаётся лениво — при первом обращении, и потом уже не меняется. */
export async function ensureReferralCode(db: pg.Pool, telegramUserId: string): Promise<string> {
  const { rows: [existing] } = await db.query(
    "SELECT referral_code FROM telegram_users WHERE id=$1", [telegramUserId]);
  if (existing?.referral_code) return existing.referral_code as string;

  // уникальный индекс — источник правды; при коллизии просто пробуем ещё раз
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { rows } = await db.query(
      `UPDATE telegram_users SET referral_code=$2
       WHERE id=$1 AND referral_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM telegram_users t WHERE t.referral_code = $2)
       RETURNING referral_code`,
      [telegramUserId, code],
    );
    if (rows[0]?.referral_code) return rows[0].referral_code as string;
    const { rows: [again] } = await db.query(
      "SELECT referral_code FROM telegram_users WHERE id=$1", [telegramUserId]);
    if (again?.referral_code) return again.referral_code as string;
  }
  throw new Error("не удалось выдать реферальный код");
}

export type ReferralOutcome =
  | { ok: true; inviteeBonus: number; inviterBonus: number }
  | { ok: false; reason: "unknown_code" | "self_referral" | "already_referred" };

/**
 * Привязывает пришедшего по ссылке к пригласившему и начисляет обоим бонусы.
 *
 * Защиты: нельзя пригласить самого себя и нельзя быть приглашённым дважды —
 * иначе бонус за присоединение легко накрутить повторными переходами.
 * Обе стороны получают деньги через ledger, как любое другое движение баланса.
 */
export async function applyReferral(
  db: pg.Pool,
  inviteeTelegramUserId: string,
  rawCode: string,
): Promise<ReferralOutcome> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { ok: false, reason: "unknown_code" };

  const inviteeBonus = await getSetting(db, "referral_invitee_bonus");
  const inviterBonus = await getSetting(db, "referral_inviter_bonus");

  return withTxOn(db, async (c): Promise<ReferralOutcome> => {
    const { rows: [invitee] } = await c.query(
      "SELECT id, referred_by FROM telegram_users WHERE id=$1 FOR UPDATE", [inviteeTelegramUserId]);
    if (!invitee) return { ok: false, reason: "unknown_code" };
    if (invitee.referred_by) return { ok: false, reason: "already_referred" };

    const { rows: [inviter] } = await c.query(
      "SELECT id FROM telegram_users WHERE referral_code=$1", [code]);
    if (!inviter) return { ok: false, reason: "unknown_code" };
    if (inviter.id === inviteeTelegramUserId) return { ok: false, reason: "self_referral" };

    await c.query(
      "UPDATE telegram_users SET referred_by=$2, referred_at=now() WHERE id=$1",
      [inviteeTelegramUserId, inviter.id]);

    if (inviteeBonus > 0) {
      const account = await ensureAccountForTelegram(c, inviteeTelegramUserId);
      const { balanceAfter } = await applyBalanceChange(
        c, account, inviteeBonus, "referral_bonus", { inviter_id: inviter.id });
      await queueNotification(c, inviteeTelegramUserId, "referral_bonus", {
        amount: inviteeBonus.toFixed(2), balance: balanceAfter,
      });
    }

    if (inviterBonus > 0) {
      const account = await ensureAccountForTelegram(c, inviter.id);
      const { balanceAfter } = await applyBalanceChange(
        c, account, inviterBonus, "referral_bonus", { referral_id: inviteeTelegramUserId });
      await c.query(
        `INSERT INTO referral_rewards(inviter_id, referral_id, kind, amount)
         VALUES ($1,$2,'join',$3) ON CONFLICT DO NOTHING`,
        [inviter.id, inviteeTelegramUserId, inviterBonus.toFixed(2)]);
      await queueNotification(c, inviter.id, "referral_joined", {
        amount: inviterBonus.toFixed(2), balance: balanceAfter,
      });
    }

    return { ok: true, inviteeBonus, inviterBonus };
  });
}

/**
 * Процент пригласившему с пополнения его реферала.
 * Вызывается внутри транзакции оплаты — начисление и сам платёж либо есть оба, либо нет.
 */
export async function payReferralCommission(
  c: pg.PoolClient,
  opts: { payerTelegramUserId: string | null; amountRub: number; orderId: number },
): Promise<number> {
  if (!opts.payerTelegramUserId) return 0;

  const percent = await getSetting(c, "referral_commission_percent");
  if (percent <= 0) return 0;

  const { rows: [payer] } = await c.query(
    "SELECT referred_by FROM telegram_users WHERE id=$1", [opts.payerTelegramUserId]);
  if (!payer?.referred_by) return 0;

  // считаем в копейках, чтобы не ловить дробную грязь на процентах
  const rewardKop = Math.round((Math.round(opts.amountRub * 100) * percent) / 100);
  if (rewardKop <= 0) return 0;
  const rewardRub = rewardKop / 100;

  const inviterAccount = await ensureAccountForTelegram(c, payer.referred_by);
  const { balanceAfter } = await applyBalanceChange(
    c, inviterAccount, rewardRub, "referral_commission",
    { referral_id: opts.payerTelegramUserId, order_id: opts.orderId, percent });

  await c.query(
    `INSERT INTO referral_rewards(inviter_id, referral_id, kind, amount, payment_order_id)
     VALUES ($1,$2,'commission',$3,$4)`,
    [payer.referred_by, opts.payerTelegramUserId, rewardRub.toFixed(2), opts.orderId]);

  await queueNotification(c, payer.referred_by, "referral_commission", {
    amount: rewardRub.toFixed(2),
    payment: opts.amountRub.toFixed(2),
    percent,
    balance: balanceAfter,
  });

  return rewardRub;
}

export interface ReferralStats {
  code: string;
  link: string | null;
  invited: number;
  earned: string;
}

export async function referralStats(db: pg.Pool, telegramUserId: string): Promise<ReferralStats> {
  const code = await ensureReferralCode(db, telegramUserId);
  const { rows: [row] } = await db.query(
    `SELECT (SELECT count(*)::int FROM telegram_users t WHERE t.referred_by = $1) AS invited,
            (SELECT coalesce(sum(amount),0)::numeric(10,2) FROM referral_rewards r
              WHERE r.inviter_id = $1) AS earned`,
    [telegramUserId],
  );
  const { rows: [botRow] } = await db.query(
    "SELECT value #>> '{}' AS username FROM settings WHERE key='bot_username'");
  const username = botRow?.username || "";
  return {
    code,
    link: username ? `https://t.me/${username}?start=ref_${code}` : null,
    invited: row.invited as number,
    earned: row.earned as string,
  };
}
