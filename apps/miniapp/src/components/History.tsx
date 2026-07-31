import { useState } from "react";
import type { HistoryItem } from "../api";

const LABELS: Record<string, string> = {
  topup: "Пополнение",
  daily_charge: "Списание за сутки",
  code_redeem: "Активация кода",
  admin_adjust: "Корректировка",
  refund: "Возврат",
  referral_bonus: "Реферальный бонус",
  referral_commission: "Процент с друга",
  order_pending: "Счёт не оплачен",
  order_success: "Оплата",
  order_failed: "Оплата не прошла",
};

/** Сколько строк видно сразу — остальное разворачивается по кнопке. */
const PREVIEW_COUNT = 5;

export function History({ items }: { items: HistoryItem[] }) {
  const [expanded, setExpanded] = useState(false);

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

  const visible = expanded ? items : items.slice(0, PREVIEW_COUNT);
  const hidden = items.length - visible.length;

  return (
    <div className="card">
      <h2>История</h2>
      {visible.map((it, i) => {
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

      {hidden > 0 && (
        <button className="chip" style={{ width: "100%", marginTop: 12 }} onClick={() => setExpanded(true)}>
          Показать ещё {hidden}
        </button>
      )}
      {expanded && items.length > PREVIEW_COUNT && (
        <button className="chip" style={{ width: "100%", marginTop: 12 }} onClick={() => setExpanded(false)}>
          Свернуть
        </button>
      )}
    </div>
  );
}
