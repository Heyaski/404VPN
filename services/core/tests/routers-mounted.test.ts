import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createApiRouter } from "../src/api.js";
import { createDeviceRouter } from "../src/device-api.js";
import { FakeWgProvider } from "../src/wg/fake.js";
import { buildInitData } from "../src/webapp-auth.js";
import { generateCode, hashCode, normalizeCode } from "../src/codes.js";

/**
 * Регрессия: оба роутера смонтированы на одном приложении, как в проде.
 * Проверка initData у Mini App не должна перехватывать маршруты устройства
 * (`/api/redeem`, `/api/device/*`) — они авторизуются токеном устройства.
 */
const TOKEN = "123456:test-token";
const CREDS = { login: "shop", password1: "p1", password2: "p2", isTest: true };

let pool: pg.Pool;
let server: Server;
let base: string;

beforeAll(async () => {
  pool = await prepareTestDb();
  const app = express();
  app.use(createApiRouter(TOKEN, CREDS, pool));
  app.use(createDeviceRouter(new FakeWgProvider(), pool, { redeemMaxAttempts: 1000 }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe("both routers on one app", () => {
  it("/api/redeem is reachable without telegram initData", async () => {
    const code = generateCode();
    await pool.query(
      "INSERT INTO access_codes(code_hash, amount, expires_at) VALUES ($1, 300, now() + interval '90 days')",
      [hashCode(normalizeCode(code))]);
    const r = await post("/api/redeem", { code });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
  });

  it("an unknown code still answers from the device router, not the miniapp guard", async () => {
    const r = await post("/api/redeem", { code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_code");
  });

  it("/api/device/* is guarded by the device token, not by initData", async () => {
    const r = await fetch(`${base}/api/device/me`);
    expect(r.status).toBe(401);
    // с валидной initData, но без токена устройства — всё равно 401
    const withInitData = await fetch(`${base}/api/device/me`, {
      headers: { "X-Telegram-Init-Data": buildInitData({ id: 1 }, TOKEN, Date.now() / 1000) },
    });
    expect(withInitData.status).toBe(401);
  });

  it("miniapp routes still require initData", async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    const ok = await fetch(`${base}/api/me`, {
      headers: { "X-Telegram-Init-Data": buildInitData({ id: 2 }, TOKEN, Date.now() / 1000) },
    });
    expect(ok.status).toBe(200);
  });
});
