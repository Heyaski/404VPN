import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { applyBalanceChange } from "../src/ledger.js";

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

describe("applyBalanceChange", () => {
  it("credits and records transaction with balance_after", async () => {
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const r = await tx((c) => applyBalanceChange(c, u.id, 300, "topup", { order_id: 1 }));
    expect(r.balanceAfter).toBe("300.00");
    const { rows: [row] } = await pool.query("SELECT * FROM balance_transactions WHERE user_id=$1", [u.id]);
    expect(row.type).toBe("topup");
    expect(row.amount).toBe("300.00");
    expect(row.balance_after).toBe("300.00");
    const { rows: [u2] } = await pool.query("SELECT balance FROM users WHERE id=$1", [u.id]);
    expect(u2.balance).toBe("300.00");
  });
  it("debits without float drift (0.1+0.2 style)", async () => {
    const { rows: [u] } = await pool.query("INSERT INTO users (balance) VALUES (0.30) RETURNING id");
    const r = await tx((c) => applyBalanceChange(c, u.id, -0.1, "daily_charge", {}));
    expect(r.balanceAfter).toBe("0.20");
  });
  it("throws for unknown user", async () => {
    await expect(
      tx((c) => applyBalanceChange(c, "00000000-0000-0000-0000-000000000000", 10, "topup", {})),
    ).rejects.toThrow(/not found/);
  });
});
