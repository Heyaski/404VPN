/** Адресный префикс в байтах: 4 байта для IPv4, 16 для IPv6. */
export interface Prefix {
  bytes: number[];
  length: number;
}

/**
 * «AS12345, 200350» → [12345, 200350]. Мусор и повторы отбрасываются.
 * Разделителем считается запятая, точка с запятой, пробел или перевод строки:
 * список удобнее вести по одному номеру на строку, а не одной длинной строкой.
 */
export function parseAsnList(raw: string): number[] {
  const seen = new Set<number>();
  for (const chunk of raw.split(/[\s,;]+/)) {
    const cleaned = chunk.trim().replace(/^as/i, "");
    const n = Number(cleaned);
    if (!Number.isInteger(n) || n <= 0) continue;
    seen.add(n);
  }
  return [...seen];
}

function parseIPv4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(addr: string): number[] | null {
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[][] | null => {
    if (s === "") return [];
    const groups: number[][] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      const n = parseInt(g, 16);
      groups.push([(n >> 8) & 0xff, n & 0xff]);
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  const missing = 8 - head.length - tail.length;
  // без «::» групп должно быть ровно восемь; с ним — хотя бы одна пропущенная
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  const zeros = Array.from({ length: missing }, () => [0, 0]);
  return [...head, ...zeros, ...tail].flat();
}

/** Разбирает «10.0.0.0/8» или «2a02:6b8::/32». Биты за границей префикса обнуляются. */
export function parsePrefix(raw: string): Prefix | null {
  const [addr, lenRaw, ...rest] = raw.trim().split("/");
  if (rest.length > 0 || lenRaw === undefined || addr === undefined) return null;
  if (!/^\d{1,3}$/.test(lenRaw)) return null;

  const bytes = addr.includes(":") ? parseIPv6(addr) : parseIPv4(addr);
  if (bytes === null) return null;

  const length = Number(lenRaw);
  if (length > bytes.length * 8) return null;

  // обнуляем всё за границей префикса, чтобы одинаковые сети выглядели одинаково
  const masked = bytes.map((b, i) => {
    const bitsBefore = i * 8;
    if (bitsBefore >= length) return 0;
    const keep = Math.min(8, length - bitsBefore);
    return keep === 8 ? b : (b & ((0xff << (8 - keep)) & 0xff));
  });

  return { bytes: masked, length };
}

export function formatPrefix(p: Prefix): string {
  if (p.bytes.length === 4) return `${p.bytes.join(".")}/${p.length}`;

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((p.bytes[i] << 8) | p.bytes[i + 1]).toString(16));
  }

  // сворачиваем самую длинную цепочку нулевых групп в «::»
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0") {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > bestLen) {
        bestLen = i - start;
        bestStart = start;
      }
      start = -1;
    }
  }

  const addr =
    bestLen > 1
      ? `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLen).join(":")}`
      : groups.join(":");
  return `${addr}/${p.length}`;
}

/** Первые `outer.length` бит совпадают? Разные версии протокола не сравниваются. */
export function covers(outer: Prefix, inner: Prefix): boolean {
  if (outer.bytes.length !== inner.bytes.length) return false;
  if (outer.length > inner.length) return false;
  for (let bit = 0; bit < outer.length; bit++) {
    const byte = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if ((outer.bytes[byte] & mask) !== (inner.bytes[byte] & mask)) return false;
  }
  return true;
}

/**
 * Выбрасывает повторы и диапазоны, вложенные в другие. Слияние соседей не делаем:
 * выигрыш от него мал, а расчёт дополнения на устройстве и так даёт минимальный набор.
 */
export function aggregate(prefixes: Prefix[]): Prefix[] {
  const sorted = [...prefixes].sort(
    (a, b) => a.bytes.length - b.bytes.length || a.length - b.length,
  );
  const result: Prefix[] = [];
  for (const p of sorted) {
    if (result.some((kept) => covers(kept, p))) continue;
    result.push(p);
  }
  return result;
}
