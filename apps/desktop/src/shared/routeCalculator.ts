/** Порт RouteCalculator из vpn_ios/Shared/RouteCalculator.swift */

interface IPPrefix {
  bytes: number[];
  length: number;
}

export function allowedIPsExcluding(raw: string[]): string[] {
  const excluded = raw.map(parse).filter((p): p is IPPrefix => p != null);
  return (
    whole(4, cover(4, excluded)).concat(whole(16, cover(16, excluded))).map(format)
  );
}

function whole(family: number, computed: IPPrefix[]): IPPrefix[] {
  return computed.length === 0
    ? [{ bytes: Array(family).fill(0), length: 0 }]
    : computed;
}

function cover(family: number, excluded: IPPrefix[]): IPPrefix[] {
  const ofFamily = excluded.filter((e) => e.bytes.length === family);
  const result: IPPrefix[] = [];
  walk(Array(family).fill(0), 0, ofFamily, result);
  return result;
}

function walk(
  base: number[],
  length: number,
  excluded: IPPrefix[],
  result: IPPrefix[],
): void {
  const node: IPPrefix = { bytes: base, length };
  if (excluded.some((e) => covers(e, node))) return;

  const inside = excluded.filter((e) => covers(node, e));
  if (inside.length === 0) {
    result.push(node);
    return;
  }
  if (length >= base.length * 8) return;

  for (const bit of [0, 1]) {
    const child = base.slice();
    const byte = length >> 3;
    const mask = 0x80 >> (length & 7);
    if (bit === 1) child[byte] |= mask;
    else child[byte] &= ~mask;
    walk(child, length + 1, inside, result);
  }
}

function covers(outer: IPPrefix, inner: IPPrefix): boolean {
  if (outer.bytes.length !== inner.bytes.length || outer.length > inner.length) {
    return false;
  }
  for (let bit = 0; bit < outer.length; bit++) {
    const byte = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if ((outer.bytes[byte]! & mask) !== (inner.bytes[byte]! & mask)) return false;
  }
  return true;
}

function parse(raw: string): IPPrefix | null {
  const parts = raw.trim().split("/");
  if (parts.length !== 2) return null;
  const length = Number(parts[1]);
  if (!Number.isInteger(length) || length < 0) return null;
  const address = parts[0]!;
  const bytes = address.includes(":") ? parseIPv6(address) : parseIPv4(address);
  if (!bytes || length > bytes.length * 8) return null;

  const masked = bytes.slice();
  if (length < bytes.length * 8) {
    for (let bit = length; bit < bytes.length * 8; bit++) {
      masked[bit >> 3]! &= ~(0x80 >> (bit & 7));
    }
  }
  return { bytes: masked, length };
}

function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const groups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (g.length < 1 || g.length > 4) return null;
      const n = Number.parseInt(g, 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
      out.push(n);
    }
    return out;
  };

  const head = groups(halves[0]!);
  if (!head) return null;
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (!tail) return null;

  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  const all = head.concat(Array(missing).fill(0), tail);
  return all.flatMap((n) => [(n >> 8) & 0xff, n & 0xff]);
}

function format(prefix: IPPrefix): string {
  if (prefix.bytes.length === 4) {
    return `${prefix.bytes.join(".")}/${prefix.length}`;
  }

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(
      (((prefix.bytes[i]! << 8) | prefix.bytes[i + 1]!) >>> 0).toString(16),
    );
  }

  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0") {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > bestLength) {
        bestLength = i - start;
        bestStart = start;
      }
      start = -1;
    }
  }

  let address: string;
  if (bestLength > 1) {
    const head = groups.slice(0, bestStart).join(":");
    const tail = groups.slice(bestStart + bestLength).join(":");
    address = `${head}::${tail}`;
  } else {
    address = groups.join(":");
  }
  return `${address}/${prefix.length}`;
}
