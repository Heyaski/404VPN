import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { buildInitData } from "../src/webapp-auth.js";
import { createApiRouter } from "../src/api.js";

const TOKEN = "123456:test-token";
const CREDS = { login: "shop", password1: "p1", password2: "p2", isTest: true };

let pool: pg.Pool;
let server: Server;
let base: string;

function initDataFor(id: number, username = "stepan"): string {
  return buildInitData({ id, first_name: "Степан", username }, TOKEN, Date.now() / 1000 - 30);
}

async function call(path: string, opts: { initData?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.initData !== undefined) headers["X-Telegram-Init-Data"] = opts.initData;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  pool = await prepareTestDb();
  const app = express();
  app.use(createApiRouter(TOKEN, CREDS, pool));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
beforeEach(async () => {
  await truncateAll(pool);
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

describe("api auth", () => {
  it("401 without initData header", async () => {
    expect((await call("/me")).status).toBe(401);
  });
  it("401 with forged initData", async () => {
    const forged = buildInitData({ id: 7 }, "wrong:token", Date.now() / 1000);
    expect((await call("/me", { initData: forged })).status).toBe(401);
  });
  it("valid initData registers telegram_users row", async () => {
    await call("/me", { initData: initDataFor(555) });
    const { rows } = await pool.query("SELECT telegram_id, chat_id, username FROM telegram_users");
    expect(rows).toHaveLength(1);
    expect(rows[0].telegram_id).toBe("555");
    expect(rows[0].username).toBe("stepan");
  });
});

describe("GET /me", () => {
  it("returns linked:false for a user without account", async () => {
    const r = await call("/me", { initData: initDataFor(1) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ linked: false });
  });
  it("returns balance and daysLeft for a linked user with devices", async () => {
    await call("/me", { initData: initDataFor(2) });
    const { rows: [u] } = await pool.query("INSERT INTO users (balance) VALUES (300) RETURNING id");
    await pool.query("INSERT INTO devices (user_id, wg_public_key) VALUES ($1,'pk-1')", [u.id]);
    await pool.query("UPDATE telegram_users SET user_id=$1 WHERE telegram_id=2", [u.id]);
    const r = await call("/me", { initData: initDataFor(2) });
    expect(r.body).toMatchObject({ linked: true, balance: "300.00", devices: 1, daysLeft: 90, status: "active" });
  });
  it("daysLeft is null (infinite) with zero devices", async () => {
    await call("/me", { initData: initDataFor(3) });
    const { rows: [u] } = await pool.query("INSERT INTO users (balance) VALUES (300) RETURNING id");
    await pool.query("UPDATE telegram_users SET user_id=$1 WHERE telegram_id=3", [u.id]);
    expect((await call("/me", { initData: initDataFor(3) })).body).toMatchObject({ daysLeft: null });
  });
});

describe("GET /presets", () => {
  it("returns seeded presets and min topup", async () => {
    const r = await call("/presets", { initData: initDataFor(4) });
    expect(r.body.minTopup).toBe(100);
    expect(r.body.presets).toHaveLength(4);
    expect(r.body.presets[0]).toEqual({ amount: 100, title: "100 ₽" });
  });
});

describe("POST /topup", () => {
  it("rejects amount below minimum", async () => {
    const r = await call("/topup", { initData: initDataFor(5), method: "POST", body: { amount: 50 } });
    expect(r.status).toBe(400);
    const { rows } = await pool.query("SELECT * FROM payment_orders");
    expect(rows).toHaveLength(0);
  });
  it("rejects non-numeric amount", async () => {
    const r = await call("/topup", { initData: initDataFor(5), method: "POST", body: { amount: "сто" } });
    expect(r.status).toBe(400);
  });
  it("creates a pending order and returns a payment url", async () => {
    const r = await call("/topup", { initData: initDataFor(6), method: "POST", body: { amount: 300 } });
    expect(r.status).toBe(200);
    expect(r.body.orderId).toBeGreaterThan(0);
    expect(r.body.paymentUrl).toContain(`InvId=${r.body.orderId}`);
    expect(r.body.paymentUrl).toContain("IsTest=1");
    const { rows: [o] } = await pool.query("SELECT * FROM payment_orders");
    expect(o.amount).toBe("300.00");
    expect(o.status).toBe("pending");
  });
  it("links the order to the account when the user is linked", async () => {
    await call("/me", { initData: initDataFor(7) });
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    await pool.query("UPDATE telegram_users SET user_id=$1 WHERE telegram_id=7", [u.id]);
    await call("/topup", { initData: initDataFor(7), method: "POST", body: { amount: 100 } });
    const { rows: [o] } = await pool.query("SELECT user_id FROM payment_orders");
    expect(o.user_id).toBe(u.id);
  });
});

describe("GET /history", () => {
  it("lists balance transactions for a linked user", async () => {
    await call("/me", { initData: initDataFor(8) });
    const { rows: [u] } = await pool.query("INSERT INTO users (balance) VALUES (300) RETURNING id");
    await pool.query("UPDATE telegram_users SET user_id=$1 WHERE telegram_id=8", [u.id]);
    await pool.query(
      "INSERT INTO balance_transactions(user_id, type, amount, balance_after) VALUES ($1,'topup',300,300)", [u.id]);
    const r = await call("/history", { initData: initDataFor(8) });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ kind: "topup", amount: "300.00" });
  });
  it("lists pending orders for an unlinked user", async () => {
    await call("/topup", { initData: initDataFor(9), method: "POST", body: { amount: 100 } });
    const r = await call("/history", { initData: initDataFor(9) });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ kind: "order_pending", amount: "100.00" });
  });
});
