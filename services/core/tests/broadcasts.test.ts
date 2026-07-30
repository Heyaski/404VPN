import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import {
  audienceClause,
  countAudience,
  dispatchDueBroadcasts,
  expandBroadcast,
  finishSentBroadcasts,
  type TargetFilter,
} from "../src/broadcasts.js";

let pool: pg.Pool;

beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

/** telegram-пользователь; при balance=null остаётся без аккаунта. */
async function makeRecipient(
  telegramId: number,
  opts: { balance?: number; status?: string; devices?: number; blockedBot?: boolean } = {},
): Promise<void> {
  let userId: string | null = null;
  if (opts.balance !== undefined) {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (balance, status) VALUES ($1,$2) RETURNING id",
      [opts.balance.toFixed(2), opts.status ?? "active"]);
    userId = u.id;
    for (let i = 0; i < (opts.devices ?? 0); i++) {
      await pool.query(
        "INSERT INTO devices(user_id, token_hash, wg_public_key) VALUES ($1,$2,$3)",
        [userId, `h-${telegramId}-${i}`, `pk-${telegramId}-${i}`]);
    }
  }
  await pool.query(
    "INSERT INTO telegram_users(telegram_id, chat_id, user_id, is_blocked_bot) VALUES ($1,$1,$2,$3)",
    [telegramId, userId, opts.blockedBot ?? false]);
}

async function makeBroadcast(
  filter: TargetFilter,
  opts: { scheduledMinutesAgo?: number; status?: string } = {},
): Promise<string> {
  const { rows: [b] } = await pool.query(
    `INSERT INTO broadcasts(title, message_text, target_filter, scheduled_at, status)
     VALUES ('Тест', 'Привет от 404VPN', $1,
             now() - ($2 || ' minutes')::interval, $3)
     RETURNING id`,
    [JSON.stringify(filter), String(opts.scheduledMinutesAgo ?? 1), opts.status ?? "scheduled"]);
  return b.id as string;
}

const outboxTexts = async () =>
  (await pool.query("SELECT text_override, template_key FROM notification_outbox")).rows;

describe("audienceClause", () => {
  it("matches everyone by default", () => {
    expect(audienceClause({ all: true }, 100, 1).sql).toBe("true");
    expect(audienceClause({}, 100, 1).sql).toBe("true");
  });
  it("filters by status with a parameter", () => {
    const c = audienceClause({ status: "suspended" }, 100, 3);
    expect(c.sql).toBe("u.status = $3");
    expect(c.params).toEqual(["suspended"]);
  });
  it("filters accounts without a vpn account", () => {
    expect(audienceClause({ no_account: true }, 100, 1).sql).toBe("t.user_id IS NULL");
  });
  it("bakes the daily rate into the days-left filter", () => {
    const c = audienceClause({ days_left_lte: 3 }, 100, 2);
    expect(c.sql).toContain("333"); // 100 ₽/мес → 333 копейки в сутки
    expect(c.params).toEqual([3]);
  });
});

describe("countAudience", () => {
  beforeEach(async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    await makeRecipient(2, { balance: 0, status: "suspended", devices: 1 });
    await makeRecipient(3, { balance: 10, devices: 1 }); // ≈3 дня
    await makeRecipient(4); // без аккаунта
    await makeRecipient(5, { balance: 300, devices: 1, blockedBot: true });
  });

  it("counts everyone except those who blocked the bot", async () => {
    expect(await countAudience(pool, { all: true }, 100)).toBe(4);
  });
  it("counts by status", async () => {
    expect(await countAudience(pool, { status: "active" }, 100)).toBe(2);
    expect(await countAudience(pool, { status: "suspended" }, 100)).toBe(1);
  });
  it("counts accounts without a vpn account", async () => {
    expect(await countAudience(pool, { no_account: true }, 100)).toBe(1);
  });
  it("counts those running out of balance", async () => {
    // 10 ₽ при 1 устройстве ≈ 3 дня; 300 ₽ — 90 дней, в выборку не попадает
    expect(await countAudience(pool, { days_left_lte: 3 }, 100)).toBe(2); // включая нулевой баланс
  });
});

describe("expandBroadcast", () => {
  it("creates one outbox row per recipient with the broadcast text", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    await makeRecipient(2, { balance: 300, devices: 1 });
    const id = await makeBroadcast({ all: true });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [b] } = await client.query("SELECT * FROM broadcasts WHERE id=$1", [id]);
      expect(await expandBroadcast(client, b, 100)).toBe(2);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const rows = await outboxTexts();
    expect(rows).toHaveLength(2);
    expect(rows[0].text_override).toBe("Привет от 404VPN");
    expect(rows[0].template_key).toBe("broadcast");
  });

  it("is idempotent — a repeated expansion adds nobody", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    const id = await makeBroadcast({ all: true });
    const client = await pool.connect();
    try {
      const { rows: [b] } = await client.query("SELECT * FROM broadcasts WHERE id=$1", [id]);
      await client.query("BEGIN");
      expect(await expandBroadcast(client, b, 100)).toBe(1);
      expect(await expandBroadcast(client, b, 100)).toBe(0);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await outboxTexts()).toHaveLength(1);
  });

  it("skips those who blocked the bot", async () => {
    await makeRecipient(1, { balance: 300, devices: 1, blockedBot: true });
    await makeRecipient(2, { balance: 300, devices: 1 });
    const id = await makeBroadcast({ all: true });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [b] } = await client.query("SELECT * FROM broadcasts WHERE id=$1", [id]);
      expect(await expandBroadcast(client, b, 100)).toBe(1);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });
});

describe("dispatchDueBroadcasts", () => {
  it("takes a due broadcast, marks it sending and queues recipients", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    const id = await makeBroadcast({ all: true });
    expect(await dispatchDueBroadcasts(pool)).toBe(1);
    const { rows: [b] } = await pool.query("SELECT status FROM broadcasts WHERE id=$1", [id]);
    expect(b.status).toBe("sending");
    expect(await outboxTexts()).toHaveLength(1);
  });

  it("ignores a broadcast scheduled for the future", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    await pool.query(
      `INSERT INTO broadcasts(title, message_text, target_filter, scheduled_at, status)
       VALUES ('Позже','текст','{"all":true}', now() + interval '1 hour', 'scheduled')`);
    expect(await dispatchDueBroadcasts(pool)).toBe(0);
    expect(await outboxTexts()).toHaveLength(0);
  });

  it("ignores drafts and already sending ones", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    await makeBroadcast({ all: true }, { status: "draft" });
    await makeBroadcast({ all: true }, { status: "sending" });
    expect(await dispatchDueBroadcasts(pool)).toBe(0);
  });

  it("does not queue a second copy on a repeated run", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    await makeBroadcast({ all: true });
    await dispatchDueBroadcasts(pool);
    await dispatchDueBroadcasts(pool);
    expect(await outboxTexts()).toHaveLength(1);
  });
});

describe("finishSentBroadcasts", () => {
  it("closes a broadcast once every recipient is processed", async () => {
    await makeRecipient(1, { balance: 300, devices: 1 });
    const id = await makeBroadcast({ all: true });
    await dispatchDueBroadcasts(pool);

    expect(await finishSentBroadcasts(pool)).toBe(0); // получатель ещё в pending
    await pool.query("UPDATE notification_outbox SET status='sent'");
    expect(await finishSentBroadcasts(pool)).toBe(1);
    const { rows: [b] } = await pool.query("SELECT status FROM broadcasts WHERE id=$1", [id]);
    expect(b.status).toBe("sent");
  });
});
