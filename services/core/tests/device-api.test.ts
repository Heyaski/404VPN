import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createDeviceRouter } from "../src/device-api.js";
import { FakeWgProvider } from "../src/wg/fake.js";
import { generateCode, hashCode, normalizeCode } from "../src/codes.js";

let pool: pg.Pool;
let wg: FakeWgProvider;
let server: Server;
let base: string;

async function startApp(opts: { redeemMaxAttempts?: number } = {}) {
  const app = express();
  app.use(createDeviceRouter(wg, pool, opts));
  const s = app.listen(0);
  await new Promise((r) => s.once("listening", r));
  return { s, url: `http://127.0.0.1:${(s.address() as { port: number }).port}` };
}

async function call(
  path: string,
  opts: { token?: string; method?: string; body?: unknown; url?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${opts.url ?? base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function makeCode(amount = 300, opts: { expiresDays?: number; status?: string } = {}) {
  const code = generateCode();
  await pool.query(
    `INSERT INTO access_codes(code_hash, amount, expires_at, status)
     VALUES ($1,$2, now() + ($3 || ' days')::interval, $4)`,
    [hashCode(normalizeCode(code)), amount, String(opts.expiresDays ?? 90), opts.status ?? "issued"],
  );
  return code;
}

async function redeemNew(): Promise<string> {
  const code = await makeCode();
  const r = await call("/api/redeem", { method: "POST", body: { code } });
  return r.body.token as string;
}

beforeAll(async () => {
  pool = await prepareTestDb();
  wg = new FakeWgProvider();
  const started = await startApp({ redeemMaxAttempts: 1000 });
  server = started.s;
  base = started.url;
});
beforeEach(async () => {
  await truncateAll(pool);
  wg = Object.assign(wg, new FakeWgProvider());
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

describe("POST /api/redeem", () => {
  it("activates a code: credits balance, returns token and days", async () => {
    const code = await makeCode(300);
    const r = await call("/api/redeem", { method: "POST", body: { code, deviceName: "iPhone 15" } });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe("300.00");
    expect(r.body.daysLeft).toBe(90);
    expect(typeof r.body.token).toBe("string");

    const { rows: [ac] } = await pool.query("SELECT status, redeemed_by FROM access_codes");
    expect(ac.status).toBe("redeemed");
    expect(ac.redeemed_by).toBeTruthy();
    const { rows: [d] } = await pool.query("SELECT name, platform FROM devices");
    expect(d.name).toBe("iPhone 15");
    expect(d.platform).toBe("ios");
    const { rows: [tx] } = await pool.query("SELECT type FROM balance_transactions");
    expect(tx.type).toBe("code_redeem");
  });

  it("accepts the code regardless of case and dashes", async () => {
    const code = await makeCode(100);
    const messy = code.toLowerCase().replace(/-/g, " ");
    expect((await call("/api/redeem", { method: "POST", body: { code: messy } })).status).toBe(200);
  });

  it("rejects a second activation of the same code", async () => {
    const code = await makeCode();
    await call("/api/redeem", { method: "POST", body: { code } });
    const r = await call("/api/redeem", { method: "POST", body: { code } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("already_used");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
    expect(rows[0].n).toBe(1);
  });

  it("rejects unknown, expired and revoked codes", async () => {
    expect((await call("/api/redeem", { method: "POST", body: { code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" } })).body.error)
      .toBe("invalid_code");
    const expired = await makeCode(100, { expiresDays: -1 });
    expect((await call("/api/redeem", { method: "POST", body: { code: expired } })).body.error)
      .toBe("expired");
    const revoked = await makeCode(100, { status: "revoked" });
    expect((await call("/api/redeem", { method: "POST", body: { code: revoked } })).body.error)
      .toBe("revoked");
  });

  it("links the telegram account that paid for the code", async () => {
    const code = await makeCode(300);
    const { rows: [t] } = await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (77,77) RETURNING id");
    const { rows: [ac] } = await pool.query("SELECT id FROM access_codes");
    await pool.query(
      "INSERT INTO payment_orders(telegram_user_id, amount, status, access_code_id) VALUES ($1,300,'success',$2)",
      [t.id, ac.id]);
    await call("/api/redeem", { method: "POST", body: { code } });
    const { rows: [linked] } = await pool.query("SELECT user_id FROM telegram_users WHERE id=$1", [t.id]);
    expect(linked.user_id).toBeTruthy();
  });

  it("rate-limits repeated attempts from one address", async () => {
    const { s, url } = await startApp({ redeemMaxAttempts: 3 });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await call("/api/redeem", { method: "POST", body: { code: "X" }, url })).status).toBe(400);
      }
      expect((await call("/api/redeem", { method: "POST", body: { code: "X" }, url })).status).toBe(429);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe("POST /api/redeem с кодом привязки", () => {
  async function makeAccountWithLinkCode(opts: { maxDevices?: number; devices?: number } = {}) {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (balance, max_devices) VALUES (300, $1) RETURNING id",
      [opts.maxDevices ?? 5]);
    for (let i = 0; i < (opts.devices ?? 0); i++) {
      await pool.query(
        "INSERT INTO devices(user_id, token_hash, wg_public_key) VALUES ($1,$2,$3)",
        [u.id, `hash-${u.id}-${i}`, `pk-${u.id}-${i}`]);
    }
    const code = generateCode();
    await pool.query(
      `INSERT INTO access_codes(code_hash, amount, expires_at, user_id)
       VALUES ($1, 0, now() + interval '30 minutes', $2)`,
      [hashCode(normalizeCode(code)), u.id]);
    return { userId: u.id as string, code };
  }

  it("binds a new device to the existing account without changing the balance", async () => {
    const { userId, code } = await makeAccountWithLinkCode();
    const r = await call("/api/redeem", { method: "POST", body: { code } });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe("300.00");
    expect(r.body.token).toBeTruthy();

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
    expect(rows[0].n).toBe(1); // новый аккаунт не создан
    const { rows: [d] } = await pool.query("SELECT user_id FROM devices");
    expect(d.user_id).toBe(userId);
    const { rows: tx } = await pool.query("SELECT count(*)::int AS n FROM balance_transactions");
    expect(tx[0].n).toBe(0); // баланс не начислялся
  });

  it("counts existing devices in the response", async () => {
    const { code } = await makeAccountWithLinkCode({ devices: 2 });
    const r = await call("/api/redeem", { method: "POST", body: { code } });
    expect(r.body.daysLeft).toBe(30); // 300 ₽ на 3 устройства
  });

  it("refuses to exceed the device limit", async () => {
    const { code } = await makeAccountWithLinkCode({ maxDevices: 2, devices: 2 });
    const r = await call("/api/redeem", { method: "POST", body: { code } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("device_limit");
  });

  it("cannot be reused", async () => {
    const { code } = await makeAccountWithLinkCode();
    await call("/api/redeem", { method: "POST", body: { code } });
    const again = await call("/api/redeem", { method: "POST", body: { code } });
    expect(again.body.error).toBe("already_used");
  });
});

describe("device endpoints", () => {
  it("401 without or with a bad token", async () => {
    expect((await call("/api/device/me")).status).toBe(401);
    expect((await call("/api/device/me", { token: "nonsense" })).status).toBe(401);
  });

  it("GET /api/device/me returns balance and days", async () => {
    const token = await redeemNew();
    const r = await call("/api/device/me", { token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ balance: "300.00", status: "active", devices: 1, daysLeft: 90 });
  });

  it("POST /api/device/tunnel provisions once and reuses the client", async () => {
    const token = await redeemNew();
    const first = await call("/api/device/tunnel", { token, method: "POST" });
    expect(first.status).toBe(200);
    expect(first.body.privateKey).toBeTruthy();
    expect(first.body.peer.endpoint).toContain(":51820");
    const { rows: [d] } = await pool.query("SELECT wg_client_id, wg_public_key FROM devices");
    expect(d.wg_client_id).toBeTruthy();
    expect(d.wg_public_key).toBeTruthy();

    const second = await call("/api/device/tunnel", { token, method: "POST" });
    expect(second.status).toBe(200);
    expect(wg.calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
    expect(wg.calls.some((c) => c.startsWith("tunnel:"))).toBe(true);
  });

  it("402 for a suspended account", async () => {
    const token = await redeemNew();
    await pool.query("UPDATE users SET status='suspended'");
    const r = await call("/api/device/tunnel", { token, method: "POST" });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe("suspended");
  });

  it("403 for a blocked account", async () => {
    const token = await redeemNew();
    await pool.query("UPDATE users SET status='blocked'");
    expect((await call("/api/device/tunnel", { token, method: "POST" })).status).toBe(403);
  });

  it("отдаёт пустой dnsFiltered, пока фильтр не настроен", async () => {
    const token = await redeemNew();

    const { status, body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(status).toBe(200);
    expect(body.dnsFiltered).toEqual([]);
    expect(body.dns).toEqual(["1.1.1.1"]);
  });

  it("подставляет адреса DNS из настроек", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_default'",
                     ["9.9.9.9, 149.112.112.112"]);
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_filtered'",
                     ["172.18.0.53"]);
    const token = await redeemNew();

    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.dns).toEqual(["9.9.9.9", "149.112.112.112"]);
    expect(body.dnsFiltered).toEqual(["172.18.0.53"]);
  });

  it("отдаёт пустой bypassRoutes, пока обход не настроен", async () => {
    const token = await redeemNew();

    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.bypassRoutes).toEqual([]);
  });

  it("отдаёт импортированные префиксы обхода", async () => {
    await pool.query(
      "INSERT INTO bypass_prefixes(asn, prefix) VALUES (1,'10.0.0.0/8'), (2,'192.168.0.0/16')");
    const token = await redeemNew();

    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.bypassRoutes.sort()).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("повторный запрос туннеля тоже отдаёт оба набора", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_filtered'",
                     ["172.18.0.53"]);
    const token = await redeemNew();
    await call("/api/device/tunnel", { token, method: "POST" });

    // второй вызов идёт другой веткой кода: клиент уже создан
    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.dnsFiltered).toEqual(["172.18.0.53"]);
  });

  it("DELETE /api/device revokes the device and removes the wg client", async () => {
    const token = await redeemNew();
    await call("/api/device/tunnel", { token, method: "POST" });
    const clientId = [...wg.clients.keys()][0];
    expect((await call("/api/device", { token, method: "DELETE" })).status).toBe(200);
    expect(wg.calls).toContain(`delete:${clientId}`);
    const { rows: [d] } = await pool.query("SELECT is_active, revoked_at FROM devices");
    expect(d.is_active).toBe(false);
    expect(d.revoked_at).toBeTruthy();
    // токен отозванного устройства больше не работает
    expect((await call("/api/device/me", { token })).status).toBe(401);
  });
});
