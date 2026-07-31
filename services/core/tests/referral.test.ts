import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import {
  applyReferral,
  ensureReferralCode,
  generateReferralCode,
  normalizeReferralCode,
  referralStats,
} from "../src/referral.js";
import { createTopupOrder, processSuccessfulPayment } from "../src/payments.js";

let pool: pg.Pool;

beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

async function makeTgUser(telegramId: number): Promise<string> {
  const { rows: [t] } = await pool.query(
    "INSERT INTO telegram_users(telegram_id, chat_id) VALUES ($1,$1) RETURNING id", [telegramId]);
  return t.id as string;
}

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

const balanceOfTg = async (tgId: string) =>
  (await pool.query(
    "SELECT u.balance FROM telegram_users t JOIN users u ON u.id=t.user_id WHERE t.id=$1", [tgId]
  )).rows[0]?.balance ?? null;

const outbox = async () =>
  (await pool.query("SELECT template_key, payload FROM notification_outbox ORDER BY created_at")).rows;

describe("реферальные коды", () => {
  it("генерирует 8 символов без похожих букв", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    for (const ch of "ILOU") expect(code).not.toContain(ch);
  });

  it("уникальны на 500 генераций", () => {
    expect(new Set(Array.from({ length: 500 }, generateReferralCode)).size).toBe(500);
  });

  it("нормализация терпит регистр и мусор", () => {
    expect(normalizeReferralCode(" ab12-cd34 ")).toBe("AB12CD34");
  });

  it("выдаётся один раз и не меняется", async () => {
    const tg = await makeTgUser(1);
    const first = await ensureReferralCode(pool, tg);
    expect(await ensureReferralCode(pool, tg)).toBe(first);
  });
});

describe("переход по ссылке", () => {
  it("начисляет обоим и связывает аккаунты", async () => {
    const inviter = await makeTgUser(1);
    const invitee = await makeTgUser(2);
    const code = await ensureReferralCode(pool, inviter);

    const result = await applyReferral(pool, invitee, code);
    expect(result).toEqual({ ok: true, inviteeBonus: 50, inviterBonus: 30 });

    expect(await balanceOfTg(invitee)).toBe("50.00");
    expect(await balanceOfTg(inviter)).toBe("30.00");

    const { rows: [link] } = await pool.query(
      "SELECT referred_by FROM telegram_users WHERE id=$1", [invitee]);
    expect(link.referred_by).toBe(inviter);

    const keys = (await outbox()).map((r) => r.template_key);
    expect(keys).toContain("referral_bonus");
    expect(keys).toContain("referral_joined");
  });

  it("пишет начисление в журнал наград", async () => {
    const inviter = await makeTgUser(1);
    const invitee = await makeTgUser(2);
    await applyReferral(pool, invitee, await ensureReferralCode(pool, inviter));
    const { rows: [reward] } = await pool.query("SELECT kind, amount FROM referral_rewards");
    expect(reward).toMatchObject({ kind: "join", amount: "30.00" });
  });

  it("нельзя пригласить самого себя", async () => {
    const tg = await makeTgUser(1);
    const code = await ensureReferralCode(pool, tg);
    expect(await applyReferral(pool, tg, code)).toEqual({ ok: false, reason: "self_referral" });
    expect(await balanceOfTg(tg)).toBeNull();
  });

  it("нельзя быть приглашённым дважды", async () => {
    const first = await makeTgUser(1);
    const second = await makeTgUser(2);
    const invitee = await makeTgUser(3);
    await applyReferral(pool, invitee, await ensureReferralCode(pool, first));
    const again = await applyReferral(pool, invitee, await ensureReferralCode(pool, second));
    expect(again).toEqual({ ok: false, reason: "already_referred" });
    expect(await balanceOfTg(invitee)).toBe("50.00"); // повторного начисления нет
  });

  it("неизвестный код ничего не начисляет", async () => {
    const invitee = await makeTgUser(1);
    expect(await applyReferral(pool, invitee, "ZZZZZZZZ")).toEqual({ ok: false, reason: "unknown_code" });
    expect(await outbox()).toHaveLength(0);
  });

  it("нулевые бонусы в настройках отключают начисления, но связь остаётся", async () => {
    await pool.query("UPDATE settings SET value='0' WHERE key LIKE 'referral_%bonus'");
    const inviter = await makeTgUser(1);
    const invitee = await makeTgUser(2);
    expect((await applyReferral(pool, invitee, await ensureReferralCode(pool, inviter))).ok).toBe(true);
    expect(await balanceOfTg(invitee)).toBeNull();
    expect(await outbox()).toHaveLength(0);
    const { rows: [link] } = await pool.query(
      "SELECT referred_by FROM telegram_users WHERE id=$1", [invitee]);
    expect(link.referred_by).toBe(inviter);
  });
});

describe("процент с пополнений реферала", () => {
  async function pairWithPayment(amount: number) {
    const inviter = await makeTgUser(1);
    const invitee = await makeTgUser(2);
    await applyReferral(pool, invitee, await ensureReferralCode(pool, inviter));
    await pool.query("DELETE FROM notification_outbox"); // чистим шум от бонусов за вход
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: invitee, userId: null, amountRub: amount }));
    await tx((c) => processSuccessfulPayment(c, orderId, amount.toFixed(2)));
    return { inviter, invitee, orderId };
  }

  it("начисляет пригласившему 20% и уведомляет его", async () => {
    const { inviter } = await pairWithPayment(300);
    expect(await balanceOfTg(inviter)).toBe("90.00"); // 30 бонус + 60 процент
    const commission = (await outbox()).find((r) => r.template_key === "referral_commission");
    expect(commission?.payload).toMatchObject({ amount: "60.00", payment: "300.00", percent: 20 });
  });

  it("пишет комиссию в журнал с привязкой к платежу", async () => {
    const { orderId } = await pairWithPayment(300);
    const { rows: [reward] } = await pool.query(
      "SELECT kind, amount, payment_order_id FROM referral_rewards WHERE kind='commission'");
    expect(reward).toMatchObject({ amount: "60.00", payment_order_id: orderId });
  });

  it("считает без потери копеек", async () => {
    const { inviter } = await pairWithPayment(333);
    expect(await balanceOfTg(inviter)).toBe("96.60"); // 30 + 66.60
  });

  it("без пригласившего процент не начисляется", async () => {
    const solo = await makeTgUser(9);
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: solo, userId: null, amountRub: 300 }));
    await tx((c) => processSuccessfulPayment(c, orderId, "300.00"));
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM referral_rewards");
    expect(rows[0].n).toBe(0);
  });

  it("нулевой процент в настройках отключает начисление", async () => {
    await pool.query("UPDATE settings SET value='0' WHERE key='referral_commission_percent'");
    const { inviter } = await pairWithPayment(300);
    expect(await balanceOfTg(inviter)).toBe("30.00"); // только бонус за присоединение
  });
});

describe("статистика для мини-приложения", () => {
  it("считает приглашённых и заработанное", async () => {
    const inviter = await makeTgUser(1);
    const code = await ensureReferralCode(pool, inviter);
    await applyReferral(pool, await makeTgUser(2), code);
    await applyReferral(pool, await makeTgUser(3), code);

    const stats = await referralStats(pool, inviter);
    expect(stats).toMatchObject({ code, invited: 2, earned: "60.00" });
    expect(stats.link).toBeNull(); // имя бота ещё не известно
  });

  it("собирает ссылку, когда имя бота известно", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb('vpn404bot'::text) WHERE key='bot_username'");
    const tg = await makeTgUser(1);
    const stats = await referralStats(pool, tg);
    expect(stats.link).toBe(`https://t.me/vpn404bot?start=ref_${stats.code}`);
  });
});
