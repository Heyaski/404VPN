import type pg from "pg";
import { applyBalanceChange } from "./ledger.js";
import { getSetting } from "./settings.js";

export type PaymentResult =
  | { kind: "credited"; userId: string; balanceAfter: string }
  | { kind: "already_processed" }
  | { kind: "rejected"; reason: string };

export async function createTopupOrder(
  c: pg.PoolClient,
  o: { telegramUserId: string | null; userId: string | null; amountRub: number },
): Promise<{ orderId: number }> {
  const { rows: [row] } = await c.query(
    "INSERT INTO payment_orders(telegram_user_id, user_id, amount) VALUES ($1,$2,$3) RETURNING id",
    [o.telegramUserId, o.userId, o.amountRub.toFixed(2)],
  );
  return { orderId: row.id };
}

/**
 * Находит аккаунт, на который зачислять оплату, создавая его при первой покупке.
 * Аккаунт всегда привязывается к telegram-пользователю — благодаря этому он остаётся
 * доступным, даже если все устройства отвязаны: код для нового устройства
 * выпускается в Mini App.
 */
async function ensureAccount(c: pg.PoolClient, order: {
  id: number;
  user_id: string | null;
  telegram_user_id: string | null;
}): Promise<string | null> {
  if (order.user_id) return order.user_id;
  if (!order.telegram_user_id) return null;

  const { rows: [tg] } = await c.query(
    "SELECT user_id FROM telegram_users WHERE id=$1 FOR UPDATE", [order.telegram_user_id]);
  let userId: string | null = tg?.user_id ?? null;

  if (!userId) {
    const maxDevices = await getSetting(c, "max_devices_default");
    const { rows: [created] } = await c.query(
      "INSERT INTO users (max_devices) VALUES ($1) RETURNING id", [maxDevices || 5]);
    userId = created.id as string;
    await c.query("UPDATE telegram_users SET user_id=$1 WHERE id=$2", [userId, order.telegram_user_id]);
  }

  await c.query("UPDATE payment_orders SET user_id=$1 WHERE id=$2", [userId, order.id]);
  return userId;
}

export async function processSuccessfulPayment(
  c: pg.PoolClient, invId: number, outSum: string,
): Promise<PaymentResult> {
  const { rows: [order] } = await c.query("SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE", [invId]);
  if (!order) return { kind: "rejected", reason: "unknown order" };
  if (order.status === "success") return { kind: "already_processed" };
  if (order.status !== "pending") return { kind: "rejected", reason: `order status ${order.status}` };
  if (Number(outSum).toFixed(2) !== Number(order.amount).toFixed(2))
    return { kind: "rejected", reason: "sum mismatch" };

  const userId = await ensureAccount(c, order);
  if (!userId) return { kind: "rejected", reason: "order has no account" };

  await c.query("UPDATE payment_orders SET status='success', paid_at=now() WHERE id=$1", [invId]);
  const { balanceAfter } = await applyBalanceChange(
    c, userId, Number(order.amount), "topup", { order_id: invId });

  if (order.telegram_user_id) {
    await c.query(
      "INSERT INTO notification_outbox(telegram_user_id, template_key, payload) VALUES ($1,$2,$3)",
      [order.telegram_user_id, "payment_success",
       JSON.stringify({ amount: order.amount, balance: balanceAfter })],
    );
  }

  return { kind: "credited", userId, balanceAfter };
}
