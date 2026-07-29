import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://vpn:x@127.0.0.1:55432/vpn",
  BOT_TOKEN: "123456:test-token",
  ROBOKASSA_LOGIN: "shop",
  ROBOKASSA_PASSWORD1: "p1",
  ROBOKASSA_PASSWORD2: "p2",
};

describe("loadConfig", () => {
  it("parses valid env with defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(8080);
    expect(c.ROBOKASSA_TEST).toBe(true);
    expect(c.REDIS_URL).toBe("redis://127.0.0.1:6379");
  });
  it("throws when BOT_TOKEN missing", () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow();
  });
  it("ROBOKASSA_TEST=0 disables test mode", () => {
    expect(loadConfig({ ...base, ROBOKASSA_TEST: "0" }).ROBOKASSA_TEST).toBe(false);
  });
});
