import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, type AdminCode } from "../api";

export function Codes() {
  const [codes, setCodes] = useState<AdminCode[]>([]);
  const [amount, setAmount] = useState("300");
  const [count, setCount] = useState("1");
  const [issued, setIssued] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ codes: AdminCode[] }>("/codes").then((r) => setCodes(r.codes)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ codes: string[] }>("/codes", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), count: Number(count) }),
      });
      setIssued(r.codes);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/codes/${id}/revoke`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h3>Промо-коды</h3>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
          Промо-код создаёт новый аккаунт и зачисляет номинал. Коды привязки устройств
          пользователи выпускают сами в Mini App.
        </p>
        <div className="row-actions" style={{ alignItems: "center" }}>
          <input
            className="field-inline"
            placeholder="номинал"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="field-inline"
            style={{ width: 80 }}
            placeholder="шт."
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <button className="btn-primary" style={{ width: "auto", padding: "10px 18px" }}
                  onClick={generate} disabled={busy}>
            {busy ? "Создаём…" : "Сгенерировать"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {issued.length > 0 && (
          <>
            <p className="muted" style={{ margin: "14px 0 8px", fontSize: 13 }}>
              Показаны один раз — скопируй сейчас:
            </p>
            {issued.map((c) => (
              <div className="code-value mono" key={c} style={{ fontSize: 16, marginBottom: 6 }}>
                {c}
              </div>
            ))}
            <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(issued.join("\n"))}>
              Скопировать все
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h3>Все коды</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>тип</th>
                <th>номинал</th>
                <th>статус</th>
                <th>истекает</th>
                <th>активирован</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 && (
                <tr><td colSpan={6} className="muted">Кодов пока нет</td></tr>
              )}
              {codes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="badge">{c.is_link_code ? "привязка" : "промо"}</span>
                  </td>
                  <td className="mono">{Number(c.amount) > 0 ? fmtMoney(c.amount) : "—"}</td>
                  <td>
                    <span className={c.status === "issued" ? "badge ok" : "badge"}>{c.status}</span>
                  </td>
                  <td className="mono">{fmtDate(c.expires_at)}</td>
                  <td className="mono">{fmtDate(c.redeemed_at)}</td>
                  <td>
                    {c.status === "issued" && (
                      <button className="btn-ghost" onClick={() => revoke(c.id)}>Отозвать</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
