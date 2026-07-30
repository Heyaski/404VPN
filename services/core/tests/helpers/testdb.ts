import { execSync } from "node:child_process";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://vpn:vpn_dev_password@127.0.0.1:55432/vpn";
export const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, "/vpn_test");

export async function prepareTestDb(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname='vpn_test'");
  if (!rowCount) await admin.query("CREATE DATABASE vpn_test");
  await admin.end();
  execSync("bash ../../db/migrate.sh", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe" });
  return new pg.Pool({ connectionString: TEST_URL });
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(
    "TRUNCATE users, devices, telegram_users, access_codes, payment_orders, balance_transactions, notification_outbox CASCADE",
  );
  // settings и topup_presets общие для всех файлов: тест, меняющий цену устройства
  // или пресет, иначе ломает расчёт дней в соседних тестах. Возвращаем к сидовым значениям.
  await pool.query(`
    UPDATE settings SET value = v.value::jsonb
    FROM (VALUES
      ('device_monthly_price', '100'),
      ('min_topup', '100'),
      ('reminder_threshold_days', '3'),
      ('max_devices_default', '5'),
      ('device_code_ttl_minutes', '30')
    ) AS v(key, value)
    WHERE settings.key = v.key
  `);
  await pool.query("TRUNCATE topup_presets");
  await pool.query(
    `INSERT INTO topup_presets(amount, title, sort_order)
     VALUES (100,'100 ₽',1), (300,'300 ₽',2), (600,'600 ₽',3), (1200,'1200 ₽',4)`,
  );
}
