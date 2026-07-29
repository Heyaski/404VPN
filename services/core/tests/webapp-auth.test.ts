import { describe, it, expect } from "vitest";
import { validateInitData, buildInitData } from "../src/webapp-auth.js";

const TOKEN = "123456:test-token";
const NOW = 1_753_800_000_000; // ms
const user = { id: 42, first_name: "Степан", username: "stepan" };

describe("validateInitData", () => {
  it("accepts freshly signed initData and extracts user", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    expect(validateInitData(initData, TOKEN, 86_400, NOW)).toEqual({
      telegramId: 42,
      username: "stepan",
      firstName: "Степан",
    });
  });
  it("rejects tampered payload", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    expect(validateInitData(initData.replace("stepan", "mallory"), TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects wrong bot token", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    expect(validateInitData(initData, "999:other", 86_400, NOW)).toBeNull();
  });
  it("rejects stale auth_date", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 90_000);
    expect(validateInitData(initData, TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects missing hash", () => {
    expect(validateInitData("auth_date=1&user=%7B%7D", TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects malformed hash without throwing", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60).replace(/hash=[0-9a-f]+/, "hash=zzzz");
    expect(validateInitData(initData, TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects initData without user", () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(NOW / 1000 - 60)) });
    const signed = buildInitData({ id: 1 }, TOKEN, NOW / 1000 - 60);
    params.set("hash", new URLSearchParams(signed).get("hash")!);
    expect(validateInitData(params.toString(), TOKEN, 86_400, NOW)).toBeNull();
  });
});
