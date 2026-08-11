import type { PrefixSource } from "./source.js";

const ENDPOINT = "https://stat.ripe.net/data/announced-prefixes/data.json";
const TIMEOUT_MS = 20_000;

/**
 * Префиксы, анонсируемые автономной системой, по данным BGP.
 * Публичный API без ключа; отвечает медленно, поэтому таймаут и обход по одному.
 */
export class RipeStatSource implements PrefixSource {
  async prefixesFor(asn: number): Promise<string[]> {
    const res = await fetch(`${ENDPOINT}?resource=AS${asn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`RIPEstat AS${asn} → ${res.status}`);

    const body = (await res.json()) as { data?: { prefixes?: { prefix?: string }[] } };
    const prefixes = body.data?.prefixes;
    if (!Array.isArray(prefixes)) throw new Error(`RIPEstat AS${asn}: неожиданный ответ`);

    return prefixes.map((p) => p.prefix).filter((p): p is string => typeof p === "string");
  }
}
