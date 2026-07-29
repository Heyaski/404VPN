import { describe, it, expect } from "vitest";
import { CODE_ALPHABET, generateCode, normalizeCode, hashCode } from "../src/codes.js";

describe("access codes", () => {
  it("alphabet is crockford base32 (no I L O U)", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const ch of "ILOU") expect(CODE_ALPHABET).not.toContain(ch);
  });
  it("generates XXXX-XXXX-XXXX-XXXX from alphabet", () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    for (const ch of code.replaceAll("-", "")) expect(CODE_ALPHABET).toContain(ch);
  });
  it("codes are unique across 1000 generations", () => {
    const s = new Set(Array.from({ length: 1000 }, generateCode));
    expect(s.size).toBe(1000);
  });
  it("normalize maps lookalikes and strips separators", () => {
    expect(normalizeCode(" abcd-efg0 h1o ")).toBe(normalizeCode("ABCDEFG0H10"));
    expect(normalizeCode("O0Il")).toBe("0011");
  });
  it("hash is deterministic sha256 hex", () => {
    const n = normalizeCode(generateCode());
    expect(hashCode(n)).toBe(hashCode(n));
    expect(hashCode(n)).toMatch(/^[0-9a-f]{64}$/);
  });
});
