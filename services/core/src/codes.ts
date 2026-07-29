import { createHash, randomInt } from "node:crypto";

// Crockford Base32: без I, L, O, U — не путается на глаз; 16 симв. = 80 бит энтропии
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateCode(): string {
  let raw = "";
  for (let i = 0; i < 16; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return raw.match(/.{4}/g)!.join("-");
}

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function hashCode(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}
