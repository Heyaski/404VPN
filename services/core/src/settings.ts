/** Пул и клиент транзакции оба подходят — запросы к settings нужны и там, и там. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: { value?: unknown }[] }>;
}

export async function getSetting(q: Queryable, key: string): Promise<number> {
  const { rows: [r] } = await q.query("SELECT value FROM settings WHERE key=$1", [key]);
  return Number(r?.value ?? 0);
}

/** Текстовая настройка (в jsonb лежит строка). Отсутствующий ключ — пустая строка. */
export async function getTextSetting(q: Queryable, key: string): Promise<string> {
  const { rows: [r] } = await q.query(
    "SELECT value #>> '{}' AS value FROM settings WHERE key=$1", [key]);
  return typeof r?.value === "string" ? r.value : "";
}

/** «1.1.1.1, 1.0.0.1» → ["1.1.1.1", "1.0.0.1"]. Пустая строка → пустой список. */
export function parseDnsList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
