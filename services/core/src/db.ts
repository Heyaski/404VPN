import "dotenv/config";
import pg from "pg";

// Пул создаётся из сырого env: полная zod-валидация конфига выполняется
// на старте сервиса (index.ts); модуль должен импортироваться в тестах без окружения.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
