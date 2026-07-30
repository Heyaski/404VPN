import { useCallback, useEffect, useState } from "react";
import { api, type SettingsPayload } from "../api";

const LABELS: Record<string, string> = {
  device_monthly_price: "Цена устройства, ₽/мес",
  min_topup: "Минимальное пополнение, ₽",
  reminder_threshold_days: "Напоминать за, дней",
  max_devices_default: "Устройств на аккаунт",
  device_code_ttl_minutes: "Срок кода привязки, мин",
};

export function Settings() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SettingsPayload>("/settings")
      .then((r) => {
        setData(r);
        setDraft(Object.fromEntries(r.settings.map((s) => [s.key, String(s.value)])));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function save() {
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, Number(v.replace(",", "."))]),
      );
      await api("/settings", { method: "PUT", body: JSON.stringify(payload) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function savePreset(id: string, patch: Record<string, unknown>) {
    try {
      await api(`/presets/${id}`, { method: "PUT", body: JSON.stringify(patch) });
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
        <button className="btn-primary" onClick={save}>{saved ? "Сохранено" : "Сохранить"}</button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h3>Кнопки пополнения в боте</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>сумма</th>
                <th>подпись</th>
                <th>видна</th>
              </tr>
            </thead>
            <tbody>
              {data.presets.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{Number(p.amount).toFixed(0)}</td>
                  <td>{p.title}</td>
                  <td>
                    <button
                      className="btn-ghost"
                      onClick={() => savePreset(p.id, { is_active: !p.is_active })}
                    >
                      {p.is_active ? "да" : "нет"}
                    </button>
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
