import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createAdminRouter } from "../src/admin-api.js";
import { issueAdminToken, verifyAdminToken } from "../src/admin-auth.js";
import { FakeWgProvider } from "../src/wg/fake.js";

const PASSWORD = "super-secret-admin";

let pool: pg.Pool;
let wg: FakeWgProvider;
let server: Server;
let base: string;
let token: string;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; auth?: string | null } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = opts.auth === undefined ? token : opts.auth;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function makeUser(balance = 300, opts: { status?: string; clientId?: string } = {}) {
  const { rows: [u] } = await pool.query(
    "INSERT INTO users (balance, status) VALUES ($1,$2) RETURNING id",
    [balance.toFixed(2), opts.status ?? "active"]);
  await pool.query(
    "INSERT INTO devices(user_id, token_hash, wg_client_id) VALUES ($1,$2,$3)",
    [u.id, `hash-${u.id}`, opts.clientId ?? "client-1"]);
  return u.id as string;
}

beforeAll(async () => {
  pool = await prepareTestDb();
  wg = new FakeWgProvider();
  const app = express();
  app.use(createAdminRouter(PASSWORD, wg, pool));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  token = issueAdminToken(PASSWORD);
});
beforeEach(async () => {
  await truncateAll(pool);
  Object.assign(wg, new FakeWgProvider());
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

describe("admin tokens", () => {
  it("accepts a freshly issued token", () => {
    expect(verifyAdminToken(issueAdminToken(PASSWORD), PASSWORD)).toBe(true);
  });
  it("rejects a token signed with another password", () => {
    expect(verifyAdminToken(issueAdminToken("other-password"), PASSWORD)).toBe(false);
  });
  it("rejects an expired token", () => {
    const past = issueAdminToken(PASSWORD, Date.now() - 24 * 3600_000);
    expect(verifyAdminToken(past, PASSWORD)).toBe(false);
  });
  it("rejects garbage", () => {
    for (const bad of ["", "nodot", "abc.def", "123.zz"]) {
      expect(verifyAdminToken(bad, PASSWORD)).toBe(false);
    }
  });
});

describe("login", () => {
  it("returns a working token for the right password", async () => {
    const r = await call("/admin/api/login", { method: "POST", body: { password: PASSWORD }, auth: null });
    expect(r.status).toBe(200);
    expect(verifyAdminToken(r.body.token, PASSWORD)).toBe(true);
  });
  it("401 for a wrong password", async () => {
    const r = await call("/admin/api/login", { method: "POST", body: { password: "nope" }, auth: null });
    expect(r.status).toBe(401);
  });
  it("protects every other route", async () => {
    expect((await call("/admin/api/stats", { auth: null })).status).toBe(401);
    expect((await call("/admin/api/users", { auth: "bogus" })).status).toBe(401);
  });
});

describe("stats and users", () => {
  it("reports totals", async () => {
    await makeUser(300);
    await makeUser(0, { status: "suspended", clientId: "client-2" });
    const r = await call("/admin/api/stats");
    expect(r.body).toMatchObject({ users: 2, active: 1, suspended: 1, devices: 2 });
    expect(r.body.balance_total).toBe("300.00");
  });

  it("lists users with days left", async () => {
    await makeUser(300);
    const r = await call("/admin/api/users");
    expect(r.body.users).toHaveLength(1);
    expect(r.body.users[0]).toMatchObject({ balance: "300.00", devices: 1, daysLeft: 90 });
  });

  it("finds a user by telegram username", async () => {
    const id = await makeUser(100);
    await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id, username, user_id) VALUES (1,1,'stepan',$1)", [id]);
    expect((await call("/admin/api/users?q=step")).body.users).toHaveLength(1);
    expect((await call("/admin/api/users?q=nobody")).body.users).toHaveLength(0);
  });

  it("returns user details with devices and transactions", async () => {
    const id = await makeUser(300);
    await pool.query(
      "INSERT INTO balance_transactions(user_id, type, amount, balance_after) VALUES ($1,'topup',300,300)", [id]);
    const r = await call(`/admin/api/users/${id}`);
    expect(r.body.devices).toHaveLength(1);
    expect(r.body.transactions).toHaveLength(1);
  });

  it("404 for an unknown user", async () => {
    expect((await call("/admin/api/users/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

describe("manual balance adjustment", () => {
  it("credits through the ledger and lifts suspension", async () => {
    const id = await makeUser(0, { status: "suspended" });
    const r = await call(`/admin/api/users/${id}/balance`, {
      method: "POST", body: { amount: 500, note: "компенсация" },
    });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe("500.00");

    const { rows: [tx] } = await pool.query("SELECT type, meta FROM balance_transactions");
    expect(tx.type).toBe("admin_adjust");
    expect(tx.meta.note).toBe("компенсация");
    const { rows: [u] } = await pool.query("SELECT status FROM users WHERE id=$1", [id]);
    expect(u.status).toBe("active");
    expect(wg.calls).toContain("enable:client-1");
  });

  it("allows debiting", async () => {
    const id = await makeUser(300);
    const r = await call(`/admin/api/users/${id}/balance`, { method: "POST", body: { amount: -100 } });
    expect(r.body.balance).toBe("200.00");
  });

  it("rejects zero and non-numeric amounts", async () => {
    const id = await makeUser(300);
    expect((await call(`/admin/api/users/${id}/balance`, { method: "POST", body: { amount: 0 } })).status).toBe(400);
    expect((await call(`/admin/api/users/${id}/balance`, { method: "POST", body: { amount: "сто" } })).status).toBe(400);
  });
});

describe("blocking", () => {
  it("blocks a user and disables their peers", async () => {
    const id = await makeUser(300);
    const r = await call(`/admin/api/users/${id}/status`, { method: "POST", body: { status: "blocked" } });
    expect(r.body.status).toBe("blocked");
    expect(wg.calls).toContain("disable:client-1");
  });

  it("unblocking with a positive balance restores active and enables peers", async () => {
    const id = await makeUser(300, { status: "blocked" });
    const r = await call(`/admin/api/users/${id}/status`, { method: "POST", body: { status: "active" } });
    expect(r.body.status).toBe("active");
    expect(wg.calls).toContain("enable:client-1");
  });

  it("unblocking with a zero balance lands in suspended, not active", async () => {
    const id = await makeUser(0, { status: "blocked" });
    const r = await call(`/admin/api/users/${id}/status`, { method: "POST", body: { status: "active" } });
    expect(r.body.status).toBe("suspended");
    expect(wg.calls).toContain("disable:client-1");
  });

  it("rejects an unknown status", async () => {
    const id = await makeUser(300);
    expect((await call(`/admin/api/users/${id}/status`, { method: "POST", body: { status: "hmm" } })).status).toBe(400);
  });
});

describe("promo codes", () => {
  it("generates codes with a face value and returns them once", async () => {
    const r = await call("/admin/api/codes", { method: "POST", body: { amount: 300, count: 3 } });
    expect(r.status).toBe(200);
    expect(r.body.codes).toHaveLength(3);
    for (const code of r.body.codes) {
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    }
    const { rows } = await pool.query("SELECT amount, user_id FROM access_codes");
    expect(rows).toHaveLength(3);
    expect(rows[0].amount).toBe("300.00");
    expect(rows[0].user_id).toBeNull(); // промо-код не привязан к аккаунту
  });

  it("rejects a non-positive amount", async () => {
    expect((await call("/admin/api/codes", { method: "POST", body: { amount: 0 } })).status).toBe(400);
  });

  it("revokes an issued code and refuses twice", async () => {
    const issued = await call("/admin/api/codes", { method: "POST", body: { amount: 100 } });
    expect(issued.status).toBe(200);
    const { rows: [ac] } = await pool.query("SELECT id FROM access_codes");
    expect((await call(`/admin/api/codes/${ac.id}/revoke`, { method: "POST" })).status).toBe(200);
    expect((await call(`/admin/api/codes/${ac.id}/revoke`, { method: "POST" })).status).toBe(400);
  });
});

describe("settings", () => {
  it("returns editable settings and presets", async () => {
    const r = await call("/admin/api/settings");
    const keys = r.body.settings.map((s: { key: string }) => s.key);
    expect(keys).toContain("device_monthly_price");
    expect(r.body.presets).toHaveLength(4);
  });

  it("updates the device price", async () => {
    expect((await call("/admin/api/settings", { method: "PUT", body: { device_monthly_price: 150 } })).status).toBe(200);
    const { rows: [s] } = await pool.query("SELECT value FROM settings WHERE key='device_monthly_price'");
    expect(Number(s.value)).toBe(150);
  });

  it("ignores unknown keys and rejects an empty payload", async () => {
    expect((await call("/admin/api/settings", { method: "PUT", body: { secret: 1 } })).status).toBe(400);
  });

  it("edits a topup preset", async () => {
    const { rows: [p] } = await pool.query("SELECT id FROM topup_presets ORDER BY sort_order LIMIT 1");
    expect((await call(`/admin/api/presets/${p.id}`, {
      method: "PUT", body: { amount: 150, title: "150 ₽", is_active: false },
    })).status).toBe(200);
    const { rows: [updated] } = await pool.query("SELECT amount, title, is_active FROM topup_presets WHERE id=$1", [p.id]);
    expect(updated.amount).toBe("150.00");
    expect(updated.is_active).toBe(false);
  });
});

describe("payments", () => {
  it("lists orders with the telegram account", async () => {
    const { rows: [t] } = await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id, username) VALUES (9,9,'buyer') RETURNING id");
    await pool.query(
      "INSERT INTO payment_orders(telegram_user_id, amount, status) VALUES ($1, 300, 'success')", [t.id]);
    const r = await call("/admin/api/payments");
    expect(r.body.payments).toHaveLength(1);
    expect(r.body.payments[0].username).toBe("buyer");
  });
});
