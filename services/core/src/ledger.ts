import type pg from "pg";

export type TxType = "topup" | "daily_charge" | "code_redeem" | "admin_adjust" | "refund";

export async function applyBalanceChange(
  c: pg.PoolClient, userId: string, amountRub: number, type: TxType, meta: Record<string, unknown>,
): Promise<{ balanceAfter: string }> {
  const { rows: [u] } = await c.query("SELECT balance FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (!u) throw new Error(`user ${userId} not found`);
  const afterKop = Math.round(Number(u.balance) * 100) + Math.round(amountRub * 100);
  const after = (afterKop / 100).toFixed(2);
  await c.query("UPDATE users SET balance=$2 WHERE id=$1", [userId, after]);
  await c.query(
    "INSERT INTO balance_transactions(user_id, type, amount, balance_after, meta) VALUES ($1,$2,$3,$4,$5)",
    [userId, type, amountRub.toFixed(2), after, JSON.stringify(meta)],
  );
  return { balanceAfter: after };
}
