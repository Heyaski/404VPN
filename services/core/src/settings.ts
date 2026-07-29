/** Пул и клиент транзакции оба подходят — запросы к settings нужны и там, и там. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: { value?: unknown }[] }>;
}

export async function getSetting(q: Queryable, key: string): Promise<number> {
  const { rows: [r] } = await q.query("SELECT value FROM settings WHERE key=$1", [key]);
  return Number(r?.value ?? 0);
}
