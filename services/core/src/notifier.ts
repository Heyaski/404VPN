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
  /** заполнены для получателей рассылки: свой текст вместо шаблона */
  broadcast_id: string | null;
  text_override: string | null;
}

export async function claimPendingOutbox(p: pg.Pool): Promise<OutboxRow[]> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `SELECT o.id, o.telegram_user_id, o.template_key, o.payload, o.broadcast_id, o.text_override,
              t.chat_id, t.is_blocked_bot
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
      // не тратим лимит Telegram на того, кто нажал /stop
      await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
      if (r.broadcast_id) {
        await pool.query(
          "UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id=$1", [r.broadcast_id]);
      }
      continue;
    }
    try {
      const jobId = outboxJobId(r.id);
      // Детерминированный jobId защищает от дублей, но задача, уже лежащая в Redis
      // как завершённая или проваленная, делает add() пустой операцией. Снимаем её,
      // чтобы возврат строки в 'pending' (в том числе руками) действительно повторял отправку.
      await queue.remove(jobId).catch(() => undefined);
      await queue.add("send", r, {
        jobId,
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

/** Счётчики рассылки ведём по факту отправки каждого получателя. */
async function countBroadcastResult(row: OutboxRow, ok: boolean): Promise<void> {
  if (!row.broadcast_id) return;
  await pool.query(
    `UPDATE broadcasts SET ${ok ? "sent_count = sent_count + 1" : "failed_count = failed_count + 1"}
     WHERE id = $1`,
    [row.broadcast_id],
  );
}

export function startNotifier(bot: Telegraf): Worker {
  const worker = new Worker<OutboxRow>(
    QUEUE,
    async (job) => {
      const r = job.data;

      // у рассылки текст свой; у транзакционных уведомлений — из шаблона
      let text = r.text_override ?? null;
      if (text === null) {
        const { rows: [tpl] } = await pool.query(
          "SELECT text_template FROM notification_templates WHERE key=$1 AND enabled", [r.template_key]);
        if (!tpl) {
          // шаблон выключен админом — считаем обработанным
          await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
          return;
        }
        text = renderTemplate(tpl.text_template, r.payload as Record<string, string | number>);
      }

      try {
        // коды в чат больше не отправляются — их выпускает Mini App по кнопке
        await bot.telegram.sendMessage(Number(r.chat_id), text);
        await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
        await countBroadcastResult(r, true);
      } catch (e: unknown) {
        const err = e as { response?: { error_code?: number } };
        if (err?.response?.error_code === 403) {
          await pool.query("UPDATE telegram_users SET is_blocked_bot=true WHERE id=$1", [r.telegram_user_id]);
          await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
          await countBroadcastResult(r, false);
          return;
        }
        throw e; // ретрай BullMQ
      }
    },
    { connection: redisConnection(), limiter: { max: 20, duration: 1000 } },
  );

  // Исчерпав ретраи, задача исчезает — без этого строка навсегда осталась бы
  // в 'queued', а рассылка не смогла бы закрыться (finishSentBroadcasts ждёт нулевой остаток).
  worker.on("failed", (job, err) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const row = job.data;
    console.error(`уведомление ${row.id} не доставлено окончательно: ${err.message}`);
    void pool
      .query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [row.id])
      .then(() => countBroadcastResult(row, false))
      .catch(console.error);
  });

  return worker;
}
