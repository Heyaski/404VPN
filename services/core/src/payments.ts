import type pg from "pg";
import { applyBalanceChange } from "./ledger.js";
import { generateCode, normalizeCode, hashCode } from "./codes.js";

export type PaymentResult =
  | { kind: "credited"; userId: string; balanceAfter: string }
  | { kind: "code_issued"; code: string; accessCodeId: string }
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

export async function processSuccessfulPayment(
  c: pg.PoolClient, invId: number, outSum: string,
): Promise<PaymentResult> {
  const { rows: [order] } = await c.query("SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE", [invId]);
  if (!order) return { kind: "rejected", reason: "unknown order" };
  if (order.status === "success") return { kind: "already_processed" };
  if (order.status !== "pending") return { kind: "rejected", reason: `order status ${order.status}` };
  if (Number(outSum).toFixed(2) !== Number(order.amount).toFixed(2))
    return { kind: "rejected", reason: "sum mismatch" };

  await c.query("UPDATE payment_orders SET status='success', paid_at=now() WHERE id=$1", [invId]);

  const notify = (key: string, payload: Record<string, unknown>) =>
    order.telegram_user_id
      ? c.query(
          "INSERT INTO notification_outbox(telegram_user_id, template_key, payload) VALUES ($1,$2,$3)",
          [order.telegram_user_id, key, JSON.stringify(payload)],
        )
      : Promise.resolve();

  if (order.user_id) {
    const { balanceAfter } = await applyBalanceChange(
      c, order.user_id, Number(order.amount), "topup", { order_id: invId });
    await notify("payment_success", { amount: order.amount, balance: balanceAfter });
    return { kind: "credited", userId: order.user_id, balanceAfter };
  }

  const code = generateCode();
  const { rows: [ac] } = await c.query(
    "INSERT INTO access_codes(code_hash, amount, expires_at) VALUES ($1,$2, now() + interval '90 days') RETURNING id",
    [hashCode(normalizeCode(code)), order.amount],
  );
  await c.query("UPDATE payment_orders SET access_code_id=$2 WHERE id=$1", [invId, ac.id]);
  await notify("payment_success_code", { amount: order.amount, code });
  return { kind: "code_issued", code, accessCodeId: ac.id };
}
