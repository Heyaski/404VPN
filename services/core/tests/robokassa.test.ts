import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  paymentSignatureBase, resultSignatureBase,
  buildPaymentUrl, verifyResultSignature,
} from "../src/robokassa.js";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const creds = { login: "shop", password1: "p1", password2: "p2", isTest: true };

describe("robokassa", () => {
  it("payment signature base without receipt", () => {
    expect(paymentSignatureBase(creds, "100.00", 42)).toBe("shop:100.00:42:p1");
  });
  it("payment signature base includes url-encoded receipt", () => {
    const enc = encodeURIComponent(JSON.stringify({ items: [] }));
    expect(paymentSignatureBase(creds, "100.00", 42, enc)).toBe(`shop:100.00:42:${enc}:p1`);
  });
  it("result signature base is OutSum:InvId:Password2", () => {
    expect(resultSignatureBase(creds, "100.00", "42")).toBe("100.00:42:p2");
  });
  it("verifyResultSignature accepts correct md5 in any case", () => {
    const sig = md5("100.00:42:p2").toUpperCase();
    expect(verifyResultSignature(creds, { OutSum: "100.00", InvId: "42", SignatureValue: sig })).toBe(true);
  });
  it("verifyResultSignature rejects tampered OutSum", () => {
    const sig = md5("100.00:42:p2");
    expect(verifyResultSignature(creds, { OutSum: "999.00", InvId: "42", SignatureValue: sig })).toBe(false);
  });
  it("buildPaymentUrl contains signature and IsTest", () => {
    const url = buildPaymentUrl(creds, { invId: 42, outSum: "100.00", description: "Пополнение 404VPN" });
    expect(url.startsWith("https://auth.robokassa.ru/Merchant/Index.aspx?")).toBe(true);
    expect(url).toContain(`SignatureValue=${md5("shop:100.00:42:p1")}`);
    expect(url).toContain("IsTest=1");
    expect(url).toContain("InvId=42");
  });
});
