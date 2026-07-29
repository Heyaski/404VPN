import { Queue, Worker } from "bullmq";
import type { Telegraf } from "telegraf";
import type pg from "pg";
import { pool } from "./db.js";
import { loadConfig } from "./config.js";
import { renderTemplate } from "./templates.js";

const QUEUE = "tg-notify";
// BullMQ запрещает ':' в кастомных jobId (разделитель ключей Redis)
export const outboxJobId = (outboxId: string): string => `outbox-${outboxId}`;

export interface OutboxRow {
  id: string;
  telegram_user_id: string;
  template_key: string;
  payload: Record<string, unknown>;
  chat_id: string;
  is_blocked_bot: boolean;
}

export async function claimPendingOutbox(p: pg.Pool): Promise<OutboxRow[]> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `SELECT o.id, o.telegram_user_id, o.template_key, o.payload, t.chat_id, t.is_blocked_bot
       FROM notification_outbox o
       JOIN telegram_users t ON t.id = o.telegram_user_id
       WHERE o.status = 'pending'
       ORDER BY o.created_at
       LIMIT 100
       FOR UPDATE OF o SKIP LOCKED`);
    if (rows.length)
      await c.query("UPDATE notification_outbox SET status='queued' WHERE id = ANY($1)",
        [rows.map((r) => r.id)]);
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

function redisConnection() {
  const url = new URL(loadConfig().REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

export function createNotifyQueue(): Queue {
  return new Queue(QUEUE, { connection: redisConnection() });
}

export async function pollOutboxOnce(queue: Queue): Promise<number> {
  const rows = await claimPendingOutbox(pool);
  for (const r of rows) {
    if (r.is_blocked_bot) {
      await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
      continue;
    }
    try {
      await queue.add("send", r, {
        jobId: outboxJobId(r.id),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });
    } catch (e) {
      // не удалось поставить в очередь — вернуть в pending, иначе строка зависнет в queued навсегда
      await pool.query("UPDATE notification_outbox SET status='pending' WHERE id=$1", [r.id]);
      throw e;
    }
  }
  return rows.length;
}

export function startNotifier(bot: Telegraf): Worker {
  return new Worker<OutboxRow>(
    QUEUE,
    async (job) => {
      const r = job.data;
      const { rows: [tpl] } = await pool.query(
        "SELECT text_template FROM notification_templates WHERE key=$1 AND enabled", [r.template_key]);
      if (!tpl) {
        // шаблон выключен админом — считаем обработанным
        await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
        return;
      }
      try {
        // коды в чат больше не отправляются — их выпускает Mini App по кнопке
        await bot.telegram.sendMessage(Number(r.chat_id),
          renderTemplate(tpl.text_template, r.payload as Record<string, string | number>));
        await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
      } catch (e: unknown) {
        const err = e as { response?: { error_code?: number } };
        if (err?.response?.error_code === 403) {
          await pool.query("UPDATE telegram_users SET is_blocked_bot=true WHERE id=$1", [r.telegram_user_id]);
          await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
          return;
        }
        throw e; // ретрай BullMQ
      }
    },
    { connection: redisConnection(), limiter: { max: 20, duration: 1000 } },
  );
}
