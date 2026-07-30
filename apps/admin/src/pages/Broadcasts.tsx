import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "../api";

interface Broadcast {
  id: string;
  title: string;
  message_text: string;
  target_filter: Record<string, unknown>;
  scheduled_at: string | null;
  status: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const AUDIENCES = [
  { id: "all", title: "Все", filter: { all: true } },
  { id: "active", title: "Активные", filter: { status: "active" } },
  { id: "suspended", title: "Приостановленные", filter: { status: "suspended" } },
  { id: "expiring", title: "Заканчивается баланс", filter: { days_left_lte: 3 } },
  { id: "no_account", title: "Без аккаунта", filter: { no_account: true } },
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "черновик",
  scheduled: "запланирована",
  sending: "отправляется",
  sent: "отправлена",
  failed: "ошибка",
};

export function Broadcasts() {
  const [list, setList] = useState<Broadcast[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["id"]>("all");
  const [when, setWhen] = useState("");
  const [recipients, setRecipients] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = AUDIENCES.find((a) => a.id === audience)!.filter;

  const load = useCallback(() => {
    api<{ broadcasts: Broadcast[] }>("/broadcasts")
      .then((r) => setList(r.broadcasts))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // оценка аудитории пересчитывается при смене фильтра — видно, скольким уйдёт
  useEffect(() => {
    api<{ recipients: number }>("/broadcasts/preview", {
      method: "POST",
      body: JSON.stringify({ target_filter: filter }),
    })
      .then((r) => setRecipients(r.recipients))
      .catch(() => setRecipients(null));
  }, [audience]);

  async function create(sendNow: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/broadcasts", {
        method: "POST",
        body: JSON.stringify({
          title,
          message_text: text,
          target_filter: filter,
          send_now: sendNow,
          scheduled_at: sendNow ? undefined : new Date(when).toISOString(),
        }),
      });
      setTitle("");
      setText("");
      setWhen("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api(`/broadcasts/${id}/cancel`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const canSend = text.trim().length > 0 && !busy;

  return (
    <div className="stack">
      <div className="card">
        <h3>Новая рассылка</h3>
        <input
          className="field"
          placeholder="Название (для себя)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="field"
          rows={5}
          placeholder="Текст сообщения. Отправляется как есть, без разметки."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="tile-label" style={{ marginBottom: 8 }}>кому</div>
        <div className="tabs">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              className={`tab${audience === a.id ? " active" : ""}`}
              onClick={() => setAudience(a.id)}
            >
              {a.title}
            </button>
          ))}
        </div>
        <p className="muted mono" style={{ margin: "0 0 14px", fontSize: 12 }}>
          получателей: {recipients ?? "…"} · те, кто заблокировал бота, пропускаются
        </p>

        <div className="row-actions" style={{ alignItems: "center" }}>
          <button className="btn-primary" style={{ width: "auto", padding: "10px 18px" }}
                  onClick={() => create(true)} disabled={!canSend}>
            Отправить сейчас
          </button>
          <input
            className="field-inline"
            style={{ width: 210 }}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <button className="btn-ghost" onClick={() => create(false)} disabled={!canSend || !when}>
            Запланировать
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h3>История</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>название</th>
                <th>статус</th>
                <th>когда</th>
                <th>доставлено</th>
                <th>не дошло</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={6} className="muted">Рассылок пока не было</td></tr>
              )}
              {list.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td>
                    <span className={b.status === "sent" ? "badge ok" : b.status === "failed" ? "badge danger" : "badge"}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="mono">{fmtDate(b.scheduled_at)}</td>
                  <td className="mono">{b.sent_count}</td>
                  <td className="mono">{b.failed_count || "—"}</td>
                  <td>
                    {b.status === "scheduled" && (
                      <button className="btn-ghost" onClick={() => cancel(b.id)}>Отменить</button>
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
