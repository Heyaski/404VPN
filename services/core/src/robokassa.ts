import { createHash } from "node:crypto";

const md5hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

export interface RobokassaCreds {
  login: string;
  password1: string;
  password2: string;
  isTest: boolean;
}

// База подписи платёжной ссылки: MerchantLogin:OutSum:InvId[:ReceiptUrlEncoded]:Password1
export function paymentSignatureBase(
  c: RobokassaCreds, outSum: string, invId: number, encodedReceipt?: string,
): string {
  const parts = [c.login, outSum, String(invId)];
  if (encodedReceipt) parts.push(encodedReceipt);
  parts.push(c.password1);
  return parts.join(":");
}

export function buildPaymentUrl(
  c: RobokassaCreds,
  o: { invId: number; outSum: string; description: string; receipt?: unknown },
): string {
  // Receipt: в подписи — однократный url-encode, в самой ссылке — двойной (требование Robokassa)
  const encodedReceipt = o.receipt ? encodeURIComponent(JSON.stringify(o.receipt)) : undefined;
  const sig = md5hex(paymentSignatureBase(c, o.outSum, o.invId, encodedReceipt));
  const params = [
    `MerchantLogin=${encodeURIComponent(c.login)}`,
    `OutSum=${o.outSum}`,
    `InvId=${o.invId}`,
    `Description=${encodeURIComponent(o.description)}`,
    `SignatureValue=${sig}`,
  ];
  if (encodedReceipt) params.push(`Receipt=${encodeURIComponent(encodedReceipt)}`);
  if (c.isTest) params.push("IsTest=1");
  return `https://auth.robokassa.ru/Merchant/Index.aspx?${params.join("&")}`;
}

// База подписи ResultURL: OutSum:InvId:Password2
export function resultSignatureBase(c: RobokassaCreds, outSum: string, invId: string): string {
  return `${outSum}:${invId}:${c.password2}`;
}

export function verifyResultSignature(
  c: RobokassaCreds,
  q: { OutSum: string; InvId: string; SignatureValue: string },
): boolean {
  const expected = md5hex(resultSignatureBase(c, q.OutSum, q.InvId));
  return expected.toLowerCase() === (q.SignatureValue ?? "").toLowerCase();
}
