import type pg from "pg";
import { withTxOn } from "./db.js";
import { applyBalanceChange } from "./ledger.js";
import { getSetting } from "./settings.js";
import { daysLeft } from "./templates.js";
import type { WgProvider } from "./wg/provider.js";

const MAX_CATCHUP_DAYS = 31; // сбой планировщика не должен съесть баланс залпом

async function activeClientIds(c: pg.PoolClient, userId: string): Promise<string[]> {
  const { rows } = await c.query(
    "SELECT wg_client_id FROM devices WHERE user_id=$1 AND is_active AND revoked_at IS NULL AND wg_client_id IS NOT NULL",
    [userId],
  );
  return rows.map((r) => r.wg_client_id as string);
}

function queueNotification(c: pg.PoolClient, userId: string, key: string, payload: Record<string, unknown>) {
  // вставит строку только если у пользователя есть привязанный telegram-аккаунт
  return c.query(
    `INSERT INTO notification_outbox(telegram_user_id, template_key, payload)
     SELECT t.id, $2, $3 FROM telegram_users t WHERE t.user_id = $1`,
    [userId, key, JSON.stringify(payload)],
  );
}

/**
 * Посуточное списание. Идемпотентно в пределах календарного дня:
 * повторный вызов не спишет дважды, потому что фильтр по last_charged_at.
 */
export async function chargeDailyOnce(
  db: pg.Pool,
  wg: WgProvider,
  now: Date = new Date(),
): Promise<{ charged: number; suspended: number }> {
  const monthly = await getSetting(db, "device_monthly_price");
  const today = now.toISOString().slice(0, 10);

  const { rows: candidates } = await db.query(
    `SELECT id FROM users
     WHERE status = 'active' AND (last_charged_at IS NULL OR last_charged_at < $1::date)`,
    [today],
  );

  let charged = 0;
  let suspended = 0;

  for (const { id: userId } of candidates) {
    const outcome = await withTxOn(db, async (c) => {
      const { rows: [u] } = await c.query(
        "SELECT balance, status, last_charged_at FROM users WHERE id=$1 FOR UPDATE", [userId]);
      if (!u || u.status !== "active") return null;

      const { rows: [{ devices }] } = await c.query(
        `SELECT count(*)::int AS devices FROM devices
         WHERE user_id=$1 AND is_active AND revoked_at IS NULL`, [userId]);
      // без устройств баланс не тает и дата не проставляется — иначе пропущенные
      // дни «сгорели» бы к моменту, когда устройство появится
      if (devices === 0) return null;

      const { rows: [{ days }] } = await c.query(
        `SELECT CASE WHEN $2::date IS NULL THEN 1
                     ELSE LEAST($1::date - $2::date, $3::int) END AS days`,
        [today, u.last_charged_at, MAX_CATCHUP_DAYS]);
      if (days <= 0) return null;

      const dailyKop = Math.round((monthly * 100) / 30) * devices;
      const totalRub = (dailyKop * days) / 100;
      const { balanceAfter } = await applyBalanceChange(
        c, userId, -totalRub, "daily_charge", { devices, days });
      await c.query("UPDATE users SET last_charged_at=$2::date WHERE id=$1", [userId, today]);

      return { charged: true };
    });

    if (!outcome) continue;
    charged += 1;
    // приведение доступа в соответствие балансу — единый путь для всех триггеров
    if ((await syncAccess(db, wg, userId)) === "suspended") suspended += 1;
  }

  return { charged, suspended };
}

/** Напоминание «баланс заканчивается» — не чаще раза в сутки на пользователя. */
export async function remindLowBalanceOnce(db: pg.Pool, now: Date = new Date()): Promise<number> {
  const monthly = await getSetting(db, "device_monthly_price");
  const threshold = await getSetting(db, "reminder_threshold_days");
  const today = now.toISOString().slice(0, 10);

  const { rows } = await db.query(
    `SELECT u.id, u.balance,
            (SELECT count(*)::int FROM devices d
              WHERE d.user_id=u.id AND d.is_active AND d.revoked_at IS NULL) AS devices
     FROM users u
     WHERE u.status='active'
       AND (u.last_reminder_sent_at IS NULL OR u.last_reminder_sent_at::date < $1::date)`,
    [today],
  );

  let sent = 0;
  for (const row of rows) {
    if (row.devices === 0) continue;
    const left = daysLeft(Number(row.balance), row.devices, monthly);
    if (!Number.isFinite(left) || left > threshold) continue;
    await withTxOn(db, async (c) => {
      await queueNotification(c, row.id, "low_balance", { days_left: left, balance: row.balance });
      await c.query("UPDATE users SET last_reminder_sent_at=now() WHERE id=$1", [row.id]);
    });
    sent += 1;
  }
  return sent;
}

/**
 * Приводит доступ пользователя в соответствие его балансу — в обе стороны:
 * положительный баланс возвращает `active` и включает пиры, ноль и меньше даёт
 * `suspended` и гасит их. Это единственное место, где меняется доступ, поэтому
 * ручная правка баланса в админке, оплата и суточное списание ведут себя одинаково.
 *
 * `blocked` не трогаем: блокировка админом сильнее баланса, пиры остаются выключенными.
 * Возвращает итоговый статус или null, если пользователя нет.
 */
export async function syncAccess(
  db: pg.Pool,
  wg: WgProvider,
  userId: string,
): Promise<"active" | "suspended" | "blocked" | null> {
  const outcome = await withTxOn(db, async (c) => {
    const { rows: [u] } = await c.query(
      "SELECT balance, status FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!u) return null;

    const desired: "active" | "suspended" | "blocked" =
      u.status === "blocked" ? "blocked" : Number(u.balance) > 0 ? "active" : "suspended";

    const changed = desired !== u.status;
    if (changed) await c.query("UPDATE users SET status=$2 WHERE id=$1", [userId, desired]);
    // уведомляем только на переходе — иначе почасовой проход спамил бы каждый час
    if (changed && desired === "suspended") {
      await queueNotification(c, userId, "suspended", { balance: u.balance });
    }
    return { desired, changed, clientIds: await activeClientIds(c, userId) };
  });

  if (!outcome) return null;
  // сетевые вызовы — после коммита, чтобы не держать транзакцию
  const enabled = outcome.desired === "active";
  for (const clientId of outcome.clientIds) {
    await wg.setEnabled(clientId, enabled).catch((e) =>
      console.error(`не удалось ${enabled ? "включить" : "выключить"} пир ${clientId}:`, e));
  }
  return outcome.desired;
}

/**
 * Почасовой проход по всем расхождениям: и должники, у которых доступ ещё открыт,
 * и пополнившиеся, у которых он ещё закрыт. Ловит случаи, когда мгновенный вызов
 * не прошёл — например, wg-easy был недоступен.
 */
export async function syncAllAccess(
  db: pg.Pool,
  wg: WgProvider,
): Promise<{ suspended: number; restored: number }> {
  const { rows } = await db.query(
    `SELECT id, status FROM users
     WHERE (status = 'suspended' AND balance > 0)
        OR (status = 'active' AND balance <= 0)`);
  let suspended = 0;
  let restored = 0;
  for (const { id, status } of rows) {
    const next = await syncAccess(db, wg, id);
    if (next === "suspended" && status === "active") suspended += 1;
    if (next === "active" && status === "suspended") restored += 1;
  }
  return { suspended, restored };
}

/** Совместимость: пополнение возвращает доступ. Возвращает true, если статус изменился. */
export async function reactivate(db: pg.Pool, wg: WgProvider, userId: string): Promise<boolean> {
  const { rows: [before] } = await db.query("SELECT status FROM users WHERE id=$1", [userId]);
  if (!before) return false;
  const after = await syncAccess(db, wg, userId);
  return after !== before.status;
}
