import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { outboxJobId, claimPendingOutbox } from "../src/notifier.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

describe("notifier", () => {
  it("jobId is deterministic and contains no ':' (BullMQ rejects it)", () => {
    expect(outboxJobId("abc")).toBe("outbox-abc");
    expect(outboxJobId("abc")).toBe(outboxJobId("abc"));
    expect(outboxJobId("550e8400-e29b-41d4-a716-446655440000")).not.toMatch(/:/);
  });
  it("claims pending rows once and marks them queued", async () => {
    const { rows: [t] } = await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (1, 1) RETURNING id");
    await pool.query(
      "INSERT INTO notification_outbox(telegram_user_id, template_key) VALUES ($1,'payment_success')", [t.id]);
    const first = await claimPendingOutbox(pool);
    expect(first).toHaveLength(1);
    expect(first[0].chat_id).toBe("1");
    const second = await claimPendingOutbox(pool);
    expect(second).toHaveLength(0);
  });
});
