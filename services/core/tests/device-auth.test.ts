import { describe, it, expect } from "vitest";
import { generateDeviceToken, hashToken } from "../src/device-auth.js";

describe("device tokens", () => {
  it("generates long url-safe tokens", () => {
    const t = generateDeviceToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("tokens are unique across 1000 generations", () => {
    expect(new Set(Array.from({ length: 1000 }, generateDeviceToken)).size).toBe(1000);
  });
  it("hash is deterministic sha256 hex and differs per token", () => {
    const a = generateDeviceToken();
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toBe(hashToken(generateDeviceToken()));
  });
});
