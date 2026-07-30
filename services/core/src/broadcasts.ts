import type pg from "pg";
import { withTxOn } from "./db.js";
import { getSetting } from "./settings.js";

export interface TargetFilter {
  all?: boolean;
  status?: "active" | "suspended" | "blocked";
  no_account?: boolean;
  days_left_lte?: number;
}

/**
 * Условие выборки получателей по фильтру аудитории.
 * Возвращает фрагмент SQL и параметры, начиная с номера `from`.
 */
export function audienceClause(
  filter: TargetFilter,
  monthlyPrice: number,
  from: number,
): { sql: string; params: unknown[] } {
  if (filter.no_account) return { sql: "t.user_id IS NULL", params: [] };
  if (filter.status) return { sql: `u.status = $${from}`, params: [filter.status] };
  if (typeof filter.days_left_lte === "number") {
    // остаток дней = баланс / (устройства × суточная ставка); без устройств списаний нет,
    // поэтому такие аккаунты в выборку «скоро закончится» не попадают
    const dailyKop = Math.round((monthlyPrice * 100) / 30);
    return {
      sql: `u.id IS NOT NULL AND dev.count > 0
            AND floor((u.balance * 100) / (${dailyKop} * dev.count)) <= $${from}`,
      params: [filter.days_left_lte],
    };
  }
  return { sql: "true", params: [] };
}

/**
 * Разворачивает аудиторию рассылки в строки outbox. Идемпотентно:
 * уникальный индекс (broadcast_id, telegram_user_id) гасит повторы.
 */
export async function expandBroadcast(
  c: pg.PoolClient,
  broadcast: { id: string; message_text: string; target_filter: TargetFilter },
  monthlyPrice: number,
): Promise<number> {
  const { sql, params } = audienceClause(broadcast.target_filter ?? {}, monthlyPrice, 3);
  const { rowCount } = await c.query(
    `INSERT INTO notification_outbox(telegram_user_id, template_key, broadcast_id, text_override)
     SELECT t.id, 'broadcast', $1, $2
     FROM telegram_users t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS count FROM devices d
       WHERE d.user_id = u.id AND d.is_active AND d.revoked_at IS NULL
     ) dev ON true
     WHERE NOT t.is_blocked_bot AND (${sql})
     ON CONFLICT (broadcast_id, telegram_user_id) WHERE broadcast_id IS NOT NULL DO NOTHING`,
    [broadcast.id, broadcast.message_text, ...params],
  );
  return rowCount ?? 0;
}

/** Считает получателей, не создавая строк — для предпросмотра в админке. */
export async function countAudience(
  db: pg.Pool,
  filter: TargetFilter,
  monthlyPrice: number,
): Promise<number> {
  const { sql, params } = audienceClause(filter ?? {}, monthlyPrice, 1);
  const { rows: [row] } = await db.query(
    `SELECT count(*)::int AS n
     FROM telegram_users t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS count FROM devices d
       WHERE d.user_id = u.id AND d.is_active AND d.revoked_at IS NULL
     ) dev ON true
     WHERE NOT t.is_blocked_bot AND (${sql})`,
    params,
  );
  return row.n as number;
}

/**
 * Забирает созревшие рассылки и разворачивает их в очередь.
 * Отправку выполняет тот же воркер уведомлений (троттлинг под лимиты Telegram).
 */
export async function dispatchDueBroadcasts(db: pg.Pool, now: Date = new Date()): Promise<number> {
  const monthlyPrice = await getSetting(db, "device_monthly_price");
  const { rows: due } = await db.query(
    `SELECT id FROM broadcasts
     WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= $1`,
    [now],
  );

  let dispatched = 0;
  for (const { id } of due) {
    await withTxOn(db, async (c) => {
      // блокируем строку: два воркера не развернут одну рассылку дважды
      const { rows: [b] } = await c.query(
        "SELECT id, message_text, target_filter, status FROM broadcasts WHERE id=$1 FOR UPDATE", [id]);
      if (!b || b.status !== "scheduled") return;
      await c.query("UPDATE broadcasts SET status='sending' WHERE id=$1", [id]);
      await expandBroadcast(c, b, monthlyPrice);
    });
    dispatched += 1;
  }
  return dispatched;
}

/** Помечает завершёнными рассылки, у которых не осталось необработанных получателей. */
export async function finishSentBroadcasts(db: pg.Pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE broadcasts SET status='sent'
     WHERE status='sending'
       AND NOT EXISTS (
         SELECT 1 FROM notification_outbox o
         WHERE o.broadcast_id = broadcasts.id AND o.status IN ('pending','queued')
       )`,
  );
  return rowCount ?? 0;
}
