import type pg from "pg";
import { withTxOn } from "../db.js";
import { getTextSetting } from "../settings.js";
import { aggregate, formatPrefix, parseAsnList, parsePrefix, type Prefix } from "./prefixes.js";
import type { PrefixSource } from "./source.js";

/**
 * Тянет префиксы всех номеров из настройки и переписывает таблицу.
 *
 * Сначала собираем всё в память и только потом трогаем базу: если источник
 * упадёт на середине, прежние префиксы останутся на месте. Иначе одна
 * неудачная ночь оставит всех российских пользователей без банка.
 */
export async function importBypassPrefixes(
  db: pg.Pool,
  source: PrefixSource,
): Promise<{ asns: number; prefixes: number }> {
  const asns = parseAsnList(await getTextSetting(db, "bypass_asns"));

  const collected: { asn: number; prefix: Prefix }[] = [];
  for (const asn of asns) {
    for (const raw of await source.prefixesFor(asn)) {
      const prefix = parsePrefix(raw);
      if (prefix) collected.push({ asn, prefix });
    }
  }

  const kept = aggregate(collected.map((c) => c.prefix));
  const keptText = new Set(kept.map(formatPrefix));
  const rows = collected
    .filter((c) => keptText.has(formatPrefix(c.prefix)))
    .map((c) => ({ asn: c.asn, prefix: formatPrefix(c.prefix) }));

  await withTxOn(db, async (c) => {
    await c.query("DELETE FROM bypass_prefixes");
    for (const row of rows) {
      await c.query(
        `INSERT INTO bypass_prefixes(asn, prefix) VALUES ($1,$2)
         ON CONFLICT (asn, prefix) DO UPDATE SET updated_at=now()`,
        [row.asn, row.prefix]);
    }
  });

  return { asns: asns.length, prefixes: keptText.size };
}

/** Список префиксов для ответа приложению. */
export async function listBypassPrefixes(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query("SELECT DISTINCT prefix FROM bypass_prefixes ORDER BY prefix");
  return rows.map((r: { prefix: string }) => r.prefix);
}
