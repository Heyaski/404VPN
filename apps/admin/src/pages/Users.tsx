import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, type AdminUser, type UserDetails } from "../api";

function StatusBadge({ status }: { status: AdminUser["status"] }) {
  const map = {
    active: { cls: "badge ok", text: "активен" },
    suspended: { cls: "badge warn", text: "приостановлен" },
    blocked: { cls: "badge danger", text: "заблокирован" },
  } as const;
  const s = map[status];
  return <span className={s.cls}>{s.text}</span>;
}

function UserCard({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<UserDetails>(`/users/${id}`).then(setDetails).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function adjust() {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${id}/balance`, {
        method: "POST",
        body: JSON.stringify({ amount: value, note }),
      });
      setAmount("");
      setNote("");
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "active" | "blocked") {
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!details) return <div className="card">Загружаем…</div>;
  const { user, devices, transactions, telegram } = details;

  return (
    <div className="stack">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div className="tile-label">баланс</div>
            <div className="tile-value mono">{fmtMoney(user.balance)}</div>
          </div>
          <StatusBadge status={user.status} />
        </div>
        <p className="muted mono" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {user.daysLeft === null ? "без списаний" : `≈ ${user.daysLeft} дн.`} · устройств:{" "}
          {user.devices}/{user.max_devices}
          {telegram && ` · @${telegram.username ?? telegram.telegram_id}`}
        </p>
      </div>

      <div className="card">
        <h3>Корректировка баланса</h3>
        <div className="row-actions" style={{ alignItems: "center" }}>
          <input
            className="field-inline"
            placeholder="±сумма"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="field-inline"
            style={{ width: 200 }}
            placeholder="причина"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-ghost" onClick={adjust} disabled={busy || !amount}>
            Применить
          </button>
          {user.status === "blocked" ? (
            <button className="btn-ghost" onClick={() => setStatus("active")} disabled={busy}>
              Разблокировать
            </button>
          ) : (
            <button className="btn-ghost" onClick={() => setStatus("blocked")} disabled={busy}>
              Заблокировать
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h3>Устройства</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>название</th>
                <th>состояние</th>
                <th>пир</th>
                <th>создано</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">Нет устройств</td>
                </tr>
              )}
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name || "—"}</td>
                  <td>
                    <span className={d.is_active && !d.revoked_at ? "badge ok" : "badge"}>
                      {d.is_active && !d.revoked_at ? "активно" : "отвязано"}
                    </span>
                  </td>
                  <td className="mono">{d.wg_client_id ? "есть" : "нет"}</td>
                  <td className="mono">{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Движения баланса</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>тип</th>
                <th>сумма</th>
                <th>после</th>
                <th>когда</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => (
                <tr key={i}>
                  <td>{t.type}</td>
                  <td className="mono" style={{ color: Number(t.amount) > 0 ? "var(--accent)" : undefined }}>
                    {Number(t.amount) > 0 ? "+" : ""}
                    {fmtMoney(t.amount)}
                  </td>
                  <td className="mono">{fmtMoney(t.balance_after)}</td>
                  <td className="mono">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ users: AdminUser[] }>(`/users?q=${encodeURIComponent(query)}`)
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  }, [query]);
  useEffect(load, [load]);

  if (selected) {
    return (
      <div className="stack">
        <button className="btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSelected(null)}>
          ← К списку
        </button>
        <UserCard id={selected} onChanged={load} />
      </div>
    );
  }

  return (
    <div className="stack">
      <input
        className="field"
        placeholder="Поиск по username, telegram id или id аккаунта"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>telegram</th>
                <th>баланс</th>
                <th>дней</th>
                <th>устройств</th>
                <th>статус</th>
                <th>создан</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">Ничего не найдено</td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setSelected(u.id)}>
                  <td>{u.username ? `@${u.username}` : (u.telegram_id ?? "—")}</td>
                  <td className="mono">{fmtMoney(u.balance)}</td>
                  <td className="mono">{u.daysLeft ?? "∞"}</td>
                  <td className="mono">{u.devices}</td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="mono">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
