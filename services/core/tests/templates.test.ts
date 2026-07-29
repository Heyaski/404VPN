import { describe, it, expect } from "vitest";
import { renderTemplate, daysLeft } from "../src/templates.js";

describe("templates", () => {
  it("substitutes variables", () => {
    expect(renderTemplate("Баланс: {{balance}} ₽ ({{days_left}} дн.)", { balance: "300.00", days_left: 90 }))
      .toBe("Баланс: 300.00 ₽ (90 дн.)");
  });
  it("missing variable becomes empty string", () => {
    expect(renderTemplate("Код: {{code}}", {})).toBe("Код: ");
  });
});

describe("daysLeft", () => {
  it("300 rub, 1 device, 100/mo → 90 days", () => {
    expect(daysLeft(300, 1, 100)).toBe(90);
  });
  it("300 rub, 2 devices → 45 days", () => {
    expect(daysLeft(300, 2, 100)).toBe(45);
  });
  it("0 devices → Infinity (не списываем)", () => {
    expect(daysLeft(300, 0, 100)).toBe(Infinity);
  });
});
