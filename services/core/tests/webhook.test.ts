import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createWebhookApp } from "../src/webhook.js";
import { FakeWgProvider } from "../src/wg/fake.js";

const CREDS = { login: "shop", password1: "p1", password2: "p2", isTest: true };
const sign = (outSum: string, invId: number) =>
  createHash("md5").update(`${outSum}:${invId}:${CREDS.password2}`).digest("hex");

let pool: pg.Pool;
let wg: FakeWgProvider;
let server: Server;
let base: string;

async function postResult(invId: number, outSum: string, signature = sign(outSum, invId)) {
  const res = await fetch(`${base}/payhook/robokassa/result`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ OutSum: outSum, InvId: String(invId), SignatureValue: signature }),
  });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  pool = await prepareTestDb();
  wg = new FakeWgProvider();
  const app = createWebhookApp(CREDS, wg, pool);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await truncateAll(pool);
  Object.assign(wg, new FakeWgProvider());
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

async function makeSuspendedUserWithOrder(amount = 300) {
  const { rows: [t] } = await pool.query(
    "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (55,55) RETURNING id");
  const { rows: [u] } = await pool.query(
    "INSERT INTO users (balance, status) VALUES (0, 'suspended') RETURNING id");
  await pool.query(
    "INSERT INTO devices(user_id, wg_public_key, wg_client_id) VALUES ($1,'pk','client-1')", [u.id]);
  const { rows: [o] } = await pool.query(
    "INSERT INTO payment_orders(telegram_user_id, user_id, amount) VALUES ($1,$2,$3) RETURNING id",
    [t.id, u.id, amount.toFixed(2)]);
  return { userId: u.id as string, orderId: o.id as number };
}

describe("robokassa result webhook", () => {
  it("credits the balance, lifts suspension and re-enables the peer", async () => {
    const { userId, orderId } = await makeSuspendedUserWithOrder(300);
    const r = await postResult(orderId, "300.00");
    expect(r.status).toBe(200);
    expect(r.text).toBe(`OK${orderId}`);

    const { rows: [u] } = await pool.query("SELECT balance, status FROM users WHERE id=$1", [userId]);
    expect(u.balance).toBe("300.00");
    expect(u.status).toBe("active");
    expect(wg.calls).toContain("enable:client-1");
  });

  it("rejects a tampered signature without touching the balance", async () => {
    const { userId, orderId } = await makeSuspendedUserWithOrder(300);
    const r = await postResult(orderId, "300.00", "deadbeef");
    expect(r.status).toBe(400);
    const { rows: [u] } = await pool.query("SELECT balance, status FROM users WHERE id=$1", [userId]);
    expect(u.balance).toBe("0.00");
    expect(u.status).toBe("suspended");
  });

  it("stays idempotent on a repeated callback", async () => {
    const { userId, orderId } = await makeSuspendedUserWithOrder(300);
    await postResult(orderId, "300.00");
    const second = await postResult(orderId, "300.00");
    expect(second.status).toBe(200);
    const { rows: [u] } = await pool.query("SELECT balance FROM users WHERE id=$1", [userId]);
    expect(u.balance).toBe("300.00");
  });
});
