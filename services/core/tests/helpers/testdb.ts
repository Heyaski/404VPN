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
}
