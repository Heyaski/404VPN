import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createTopupOrder, processSuccessfulPayment } from "../src/payments.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

async function makeTgUser(): Promise<string> {
  const { rows: [t] } = await pool.query(
    "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (111, 111) RETURNING id");
  return t.id;
}

describe("payments", () => {
  it("linked user: payment credits balance and writes outbox", async () => {
    const tgId = await makeTgUser();
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: u.id, amountRub: 300 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "300.00"));
    expect(r.kind).toBe("credited");
    const { rows: [ob] } = await pool.query("SELECT * FROM notification_outbox");
    expect(ob.template_key).toBe("payment_success");
  });
  it("first payment creates an account, links telegram to it and credits the balance", async () => {
    const tgId = await makeTgUser();
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 150 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "150.00"));
    expect(r.kind).toBe("credited");

    const { rows: [tg] } = await pool.query("SELECT user_id FROM telegram_users WHERE id=$1", [tgId]);
    expect(tg.user_id).toBeTruthy();
    const { rows: [u] } = await pool.query("SELECT balance FROM users");
    expect(u.balance).toBe("150.00");
    // код больше не выпускается при оплате — его выдаёт Mini App по кнопке
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM access_codes");
    expect(rows[0].n).toBe(0);
  });

  it("second payment from the same telegram account reuses it", async () => {
    const tgId = await makeTgUser();
    const first = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 100 }));
    await tx((c) => processSuccessfulPayment(c, first.orderId, "100.00"));
    const second = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 200 }));
    await tx((c) => processSuccessfulPayment(c, second.orderId, "200.00"));

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
    expect(rows[0].n).toBe(1);
    const { rows: [u] } = await pool.query("SELECT balance FROM users");
    expect(u.balance).toBe("300.00");
  });
  it("duplicate callback is idempotent (single credit, single code)", async () => {
    const tgId = await makeTgUser();
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: u.id, amountRub: 100 }));
    await tx((c) => processSuccessfulPayment(c, orderId, "100.00"));
    const r2 = await tx((c) => processSuccessfulPayment(c, orderId, "100.00"));
    expect(r2.kind).toBe("already_processed");
    const { rows: [{ count }] } = await pool.query("SELECT count(*) FROM balance_transactions");
    expect(count).toBe("1");
  });
  it("rejects an order with neither an account nor a telegram user", async () => {
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: null, userId: null, amountRub: 100 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "100.00"));
    expect(r.kind).toBe("rejected");
    const { rows: [o] } = await pool.query("SELECT status FROM payment_orders WHERE id=$1", [orderId]);
    expect(o.status).toBe("pending");
  });

  it("rejects wrong OutSum", async () => {
    const tgId = await makeTgUser();
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 100 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "1.00"));
    expect(r.kind).toBe("rejected");
    const { rows: [o] } = await pool.query("SELECT status FROM payment_orders WHERE id=$1", [orderId]);
    expect(o.status).toBe("pending");
  });
  it("rejects unknown order", async () => {
    const r = await tx((c) => processSuccessfulPayment(c, 999999, "100.00"));
    expect(r.kind).toBe("rejected");
  });
});
