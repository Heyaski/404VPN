import { useCallback, useEffect, useState } from "react";
import { api, type SettingsPayload } from "../api";

const LABELS: Record<string, string> = {
  device_monthly_price: "Цена устройства, ₽/мес",
  min_topup: "Минимальное пополнение, ₽",
  reminder_threshold_days: "Напоминать за, дней",
  max_devices_default: "Устройств на аккаунт",
  device_code_ttl_minutes: "Срок кода привязки, мин",
  referral_invitee_bonus: "Бонус пришедшему по ссылке, ₽",
  referral_inviter_bonus: "Бонус пригласившему, ₽",
  referral_commission_percent: "Процент с пополнений друга, %",
};

const TEXT_LABELS: Record<string, string> = {
  support_contact: "Контакт поддержки (@username)",
  dns_default: "DNS обычный (через запятую)",
  dns_filtered: "DNS с фильтром рекламы (через запятую, пусто — фильтр выключен)",
  bypass_asns: "Номера AS в обход туннеля (по одному на строку; НЕ операторов связи — у них тысячи префиксов)",
};

/** Настройки, которые ведут списком: им нужно поле в несколько строк, а не одна. */
const MULTILINE = new Set(["bypass_asns"]);

/** Кнопки пополнения: полное редактирование — сумма, подпись, видимость, добавление, удаление. */
function PresetsCard({
  presets,
  onChanged,
  onError,
}: {
  presets: SettingsPayload["presets"];
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, { amount: string; title: string }>>({});
  const [newAmount, setNewAmount] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const valueOf = (p: SettingsPayload["presets"][number]) =>
    edits[p.id] ?? { amount: Number(p.amount).toFixed(0), title: p.title };

  async function call(path: string, init: RequestInit) {
    try {
      await api(path, init);
      setEdits({});
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3>Кнопки пополнения в боте</h3>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Эти кнопки пользователь видит в Mini App. Порядок — как в списке.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>сумма, ₽</th>
              <th>подпись</th>
              <th>видна</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {presets.map((p) => {
              const v = valueOf(p);
              const dirty = v.amount !== Number(p.amount).toFixed(0) || v.title !== p.title;
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      className="field-inline"
                      style={{ width: 80 }}
                      value={v.amount}
                      onChange={(e) => setEdits({ ...edits, [p.id]: { ...v, amount: e.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      className="field-inline"
                      style={{ width: 120 }}
                      value={v.title}
                      onChange={(e) => setEdits({ ...edits, [p.id]: { ...v, title: e.target.value } })}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-ghost"
                      onClick={() => call(`/presets/${p.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ is_active: !p.is_active }),
                      })}
                    >
                      {p.is_active ? "да" : "нет"}
                    </button>
                  </td>
                  <td>
                    <div className="row-actions">
                      {dirty && (
                        <button
                          className="btn-ghost"
                          onClick={() => call(`/presets/${p.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ amount: Number(v.amount), title: v.title }),
                          })}
                        >
                          Сохранить
                        </button>
                      )}
                      <button
                        className="btn-ghost"
                        onClick={() => call(`/presets/${p.id}`, { method: "DELETE" })}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row-actions" style={{ marginTop: 14, alignItems: "center" }}>
        <input
          className="field-inline"
          style={{ width: 80 }}
          placeholder="сумма"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />
        <input
          className="field-inline"
          style={{ width: 120 }}
          placeholder="подпись"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button
          className="btn-ghost"
          disabled={!Number(newAmount)}
          onClick={() => {
            void call("/presets", {
              method: "POST",
              body: JSON.stringify({
                amount: Number(newAmount),
                title: newTitle || `${Number(newAmount)} ₽`,
              }),
            });
            setNewAmount("");
            setNewTitle("");
          }}
        >
          Добавить кнопку
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SettingsPayload>("/settings")
      .then((r) => {
        setData(r);
        setDraft({
          ...Object.fromEntries(r.settings.map((s) => [s.key, String(s.value)])),
          ...Object.fromEntries(r.textSettings.map((s) => [s.key, s.value ?? ""])),
        });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function save() {
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(draft).map(([k, v]) =>
          k in TEXT_LABELS ? [k, v] : [k, Number(v.replace(",", "."))]),
      );
      await api("/settings", { method: "PUT", body: JSON.stringify(payload) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data) return <p className="muted">Загружаем…</p>;

  return (
    <div className="grid-2">
      <div className="card">
        <h3>Параметры сервиса</h3>
        {data.settings.map((s) => (
          <div key={s.key} style={{ marginBottom: 12 }}>
            <div className="tile-label" style={{ marginBottom: 6 }}>{LABELS[s.key] ?? s.key}</div>
            <input
              className="field-inline"
              value={draft[s.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
            />
          </div>
        ))}
        {data.textSettings.map((s) => (
          <div key={s.key} style={{ marginBottom: 12 }}>
            <div className="tile-label" style={{ marginBottom: 6 }}>{TEXT_LABELS[s.key] ?? s.key}</div>
            {MULTILINE.has(s.key) ? (
              <textarea
                className="field-inline"
                style={{ width: "100%", minHeight: 120, fontFamily: "ui-monospace, monospace" }}
                placeholder={"AS44386\nAS207986"}
                value={draft[s.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
              />
            ) : (
              <input
                className="field-inline"
                style={{ width: "100%" }}
                value={draft[s.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
              />
            )}
          </div>
        ))}
        <button className="btn-primary" onClick={save}>{saved ? "Сохранено" : "Сохранить"}</button>
        {error && <p className="error">{error}</p>}
      </div>

      <PresetsCard presets={data.presets} onChanged={load} onError={setError} />
    </div>
  );
}
