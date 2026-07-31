import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import {
  chargeDailyOnce,
  remindLowBalanceOnce,
  reactivate,
  syncAccess,
  syncAllAccess,
} from "../src/billing.js";
import { FakeWgProvider } from "../src/wg/fake.js";

let pool: pg.Pool;
let wg: FakeWgProvider;

beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); wg = new FakeWgProvider(); });
afterAll(async () => { await pool.end(); });

/** Пользователь с N устройствами; chargedDaysAgo=null — ещё ни разу не списывали. */
async function makeUser(
  balance: number,
  devices = 1,
  opts: {
    chargedDaysAgo?: number | null;
    withTelegram?: boolean;
    clientIds?: boolean;
    status?: "active" | "suspended" | "blocked";
  } = {},
): Promise<string> {
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (balance, status, last_charged_at) VALUES ($1, $3,
       CASE WHEN $2::int IS NULL THEN NULL ELSE (current_date - $2::int) END) RETURNING id`,
    [balance.toFixed(2), opts.chargedDaysAgo ?? null, opts.status ?? "active"],
  );
  for (let i = 0; i < devices; i++) {
    await pool.query(
      "INSERT INTO devices(user_id, wg_public_key, wg_client_id) VALUES ($1,$2,$3)",
      [u.id, `pk-${u.id}-${i}`, opts.clientIds === false ? null : `client-${i + 1}`],
    );
  }
  if (opts.withTelegram !== false) {
    await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id, user_id) VALUES ($1,$1,$2)",
      [Math.floor(Math.random() * 1e9), u.id],
    );
  }
  return u.id as string;
}

const balanceOf = async (id: string) =>
  (await pool.query("SELECT balance, status FROM users WHERE id=$1", [id])).rows[0];

describe("chargeDailyOnce", () => {
  it("charges price/30 per device for one day", async () => {
    const id = await makeUser(300, 1);
    const r = await chargeDailyOnce(pool, wg);
    expect(r).toEqual({ charged: 1, suspended: 0 });
    expect((await balanceOf(id)).balance).toBe("296.67"); // 300 - 3.33
  });

  it("charges per device", async () => {
    const id = await makeUser(300, 2);
    await chargeDailyOnce(pool, wg);
    expect((await balanceOf(id)).balance).toBe("293.34"); // 300 - 2×3.33
  });

  it("is idempotent within the same day", async () => {
    const id = await makeUser(300, 1);
    await chargeDailyOnce(pool, wg);
    const second = await chargeDailyOnce(pool, wg);
    expect(second.charged).toBe(0);
    expect((await balanceOf(id)).balance).toBe("296.67");
  });

  it("does not charge accounts without devices", async () => {
    const id = await makeUser(300, 0);
    expect(await chargeDailyOnce(pool, wg)).toEqual({ charged: 0, suspended: 0 });
    expect((await balanceOf(id)).balance).toBe("300.00");
    const { rows: [u] } = await pool.query("SELECT last_charged_at FROM users WHERE id=$1", [id]);
    expect(u.last_charged_at).toBeNull(); // дата не проставлена — дни не «сгорели»
  });

  it("catches up missed days", async () => {
    const id = await makeUser(300, 1, { chargedDaysAgo: 3 });
    await chargeDailyOnce(pool, wg);
    expect((await balanceOf(id)).balance).toBe("290.01"); // 300 - 3×3.33
  });

  it("suspends on zero balance, disables peers and queues a notification", async () => {
    const id = await makeUser(3, 1);
    const r = await chargeDailyOnce(pool, wg);
    expect(r.suspended).toBe(1);
    const after = await balanceOf(id);
    expect(after.status).toBe("suspended");
    expect(Number(after.balance)).toBeLessThanOrEqual(0);
    expect(wg.calls).toContain("disable:client-1");
    const { rows: [ob] } = await pool.query("SELECT template_key FROM notification_outbox");
    expect(ob.template_key).toBe("suspended");
  });

  it("skips already suspended accounts", async () => {
    const id = await makeUser(3, 1);
    await chargeDailyOnce(pool, wg);
    const balanceAfterSuspend = (await balanceOf(id)).balance;
    await pool.query("UPDATE users SET last_charged_at = current_date - 1");
    expect(await chargeDailyOnce(pool, wg)).toEqual({ charged: 0, suspended: 0 });
    expect((await balanceOf(id)).balance).toBe(balanceAfterSuspend);
  });
});

describe("remindLowBalanceOnce", () => {
  it("queues low_balance when days left is at or below the threshold", async () => {
    await makeUser(10, 1); // 10 / 3.33 = 3 дня, порог 3
    expect(await remindLowBalanceOnce(pool)).toBe(1);
    const { rows: [ob] } = await pool.query("SELECT template_key, payload FROM notification_outbox");
    expect(ob.template_key).toBe("low_balance");
    expect(ob.payload.days_left).toBe(3);
  });

  it("does not remind twice a day", async () => {
    await makeUser(10, 1);
    await remindLowBalanceOnce(pool);
    expect(await remindLowBalanceOnce(pool)).toBe(0);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM notification_outbox");
    expect(rows[0].n).toBe(1);
  });

  it("stays quiet when the balance is comfortable", async () => {
    await makeUser(300, 1);
    expect(await remindLowBalanceOnce(pool)).toBe(0);
  });

  it("stays quiet without devices", async () => {
    await makeUser(1, 0);
    expect(await remindLowBalanceOnce(pool)).toBe(0);
  });
});

describe("syncAccess — доступ следует за балансом", () => {
  it("обнуление баланса гасит пиры и ставит уведомление, даже если списание сегодня уже прошло", async () => {
    const id = await makeUser(300, 1);
    await chargeDailyOnce(pool, wg); // last_charged_at = сегодня
    wg.calls.length = 0;
    await pool.query("UPDATE users SET balance = 0 WHERE id=$1", [id]);

    expect(await syncAccess(pool, wg, id)).toBe("suspended");
    expect((await balanceOf(id)).status).toBe("suspended");
    expect(wg.calls).toContain("disable:client-1");
    const { rows: [ob] } = await pool.query(
      "SELECT template_key FROM notification_outbox ORDER BY created_at DESC LIMIT 1");
    expect(ob.template_key).toBe("suspended");
  });

  it("отрицательный баланс тоже закрывает доступ", async () => {
    const id = await makeUser(300, 1);
    await pool.query("UPDATE users SET balance = -50 WHERE id=$1", [id]);
    expect(await syncAccess(pool, wg, id)).toBe("suspended");
    expect(wg.calls).toContain("disable:client-1");
  });

  it("положительный баланс возвращает доступ и включает пиры", async () => {
    const id = await makeUser(0, 1, { status: "suspended" });
    await pool.query("UPDATE users SET balance = 300 WHERE id=$1", [id]);
    expect(await syncAccess(pool, wg, id)).toBe("active");
    expect(wg.calls).toContain("enable:client-1");
  });

  it("блокировка админом сильнее баланса", async () => {
    const id = await makeUser(300, 1, { status: "blocked" });
    expect(await syncAccess(pool, wg, id)).toBe("blocked");
    expect((await balanceOf(id)).status).toBe("blocked");
    expect(wg.calls).toContain("disable:client-1");
  });

  it("не спамит уведомлением, если доступ уже закрыт", async () => {
    const id = await makeUser(0, 1, { status: "suspended" });
    await syncAccess(pool, wg, id);
    await syncAccess(pool, wg, id);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM notification_outbox");
    expect(rows[0].n).toBe(0); // перехода не было — уведомлять не о чем
  });

  it("закрывает доступ и без устройств (туннель по нулевому балансу не выдаётся)", async () => {
    const id = await makeUser(0, 0);
    expect(await syncAccess(pool, wg, id)).toBe("suspended");
  });
});

describe("syncAllAccess — почасовое выравнивание", () => {
  it("гасит должников и возвращает пополнившихся за один проход", async () => {
    const debtor = await makeUser(0, 1);
    const paid = await makeUser(300, 1, { status: "suspended" });
    const untouched = await makeUser(300, 1);

    expect(await syncAllAccess(pool, wg)).toEqual({ suspended: 1, restored: 1 });
    expect((await balanceOf(debtor)).status).toBe("suspended");
    expect((await balanceOf(paid)).status).toBe("active");
    expect((await balanceOf(untouched)).status).toBe("active");
  });

  it("не трогает заблокированных", async () => {
    const id = await makeUser(300, 1, { status: "blocked" });
    expect(await syncAllAccess(pool, wg)).toEqual({ suspended: 0, restored: 0 });
    expect((await balanceOf(id)).status).toBe("blocked");
  });
});

describe("reactivate", () => {
  it("lifts suspension and re-enables peers once the balance is positive", async () => {
    const id = await makeUser(3, 1);
    await chargeDailyOnce(pool, wg);
    expect((await balanceOf(id)).status).toBe("suspended");

    await pool.query("UPDATE users SET balance = 300 WHERE id=$1", [id]);
    expect(await reactivate(pool, wg, id)).toBe(true);
    expect((await balanceOf(id)).status).toBe("active");
    expect(wg.calls).toContain("enable:client-1");
  });

  it("does nothing when the balance is still zero", async () => {
    const id = await makeUser(3, 1);
    await chargeDailyOnce(pool, wg);
    expect(await reactivate(pool, wg, id)).toBe(false);
    expect((await balanceOf(id)).status).toBe("suspended");
  });

  it("does nothing for an active account", async () => {
    const id = await makeUser(300, 1);
    expect(await reactivate(pool, wg, id)).toBe(false);
  });
});
