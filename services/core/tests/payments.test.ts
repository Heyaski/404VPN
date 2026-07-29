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
  it("new user: payment issues access code with amount", async () => {
    const tgId = await makeTgUser();
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 150 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "150.00"));
    expect(r.kind).toBe("code_issued");
    if (r.kind !== "code_issued") throw new Error("unreachable");
    expect(r.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const { rows: [ac] } = await pool.query("SELECT * FROM access_codes");
    expect(ac.amount).toBe("150.00");
    expect(ac.status).toBe("issued");
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
