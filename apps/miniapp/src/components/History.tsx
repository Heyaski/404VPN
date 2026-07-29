import type { HistoryItem } from "../api";

const LABELS: Record<string, string> = {
  topup: "Пополнение",
  daily_charge: "Списание за сутки",
  code_redeem: "Активация кода",
  admin_adjust: "Корректировка",
  refund: "Возврат",
  order_pending: "Счёт не оплачен",
  order_success: "Оплата",
  order_failed: "Оплата не прошла",
};

export function History({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="card">
        <h2>История</h2>
        <p className="muted" style={{ margin: 0 }}>
          Пока пусто.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>История</h2>
      {items.map((it, i) => {
        const value = Number(it.amount);
        const positive = it.kind !== "daily_charge" && value > 0;
        return (
          <div className="row" key={i}>
            <div>
              <div>{LABELS[it.kind] ?? it.kind}</div>
              <div className="when mono">
                {new Date(it.date).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                })}
              </div>
            </div>
            <div className={`amount${positive ? " plus" : ""}`}>
              {positive ? "+" : ""}
              {it.amount} ₽
            </div>
          </div>
        );
      })}
    </div>
  );
}
