import { useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, type AdminPayment } from "../api";

export function Payments() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ payments: AdminPayment[] }>("/payments")
      .then((r) => setPayments(r.payments))
      .catch((e) => setError(e.message));
  }, []);

  const badge = (status: string) =>
    status === "success" ? "badge ok" : status === "failed" ? "badge danger" : "badge warn";

  return (
    <div className="card">
      {error && <p className="error">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>telegram</th>
              <th>сумма</th>
              <th>статус</th>
              <th>создан</th>
              <th>оплачен</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr><td colSpan={6} className="muted">Платежей пока нет</td></tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>{p.username ? `@${p.username}` : (p.telegram_id ?? "—")}</td>
                <td className="mono">{fmtMoney(p.amount)}</td>
                <td><span className={badge(p.status)}>{p.status}</span></td>
                <td className="mono">{fmtDate(p.created_at)}</td>
                <td className="mono">{fmtDate(p.paid_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
