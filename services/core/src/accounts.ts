import type pg from "pg";
import { getSetting } from "./settings.js";

/**
 * Находит или создаёт VPN-аккаунт для telegram-пользователя.
 * Живёт отдельным модулем, потому что нужен и оплате, и рефералам —
 * держать его в payments.ts значило бы получить цикл импортов.
 */
export async function ensureAccountForTelegram(
  c: pg.PoolClient,
  telegramUserId: string,
): Promise<string> {
  const { rows: [tg] } = await c.query(
    "SELECT user_id FROM telegram_users WHERE id=$1 FOR UPDATE", [telegramUserId]);
  if (tg?.user_id) return tg.user_id as string;

  const maxDevices = await getSetting(c, "max_devices_default");
  const { rows: [created] } = await c.query(
    "INSERT INTO users (max_devices) VALUES ($1) RETURNING id", [maxDevices || 5]);
  await c.query("UPDATE telegram_users SET user_id=$1 WHERE id=$2", [created.id, telegramUserId]);
  return created.id as string;
}

export function queueNotification(
  c: pg.PoolClient,
  telegramUserId: string,
  key: string,
  payload: Record<string, unknown>,
) {
  return c.query(
    "INSERT INTO notification_outbox(telegram_user_id, template_key, payload) VALUES ($1,$2,$3)",
    [telegramUserId, key, JSON.stringify(payload)],
  );
}
