import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Template {
  key: string;
  text_template: string;
  enabled: boolean;
  updated_at: string;
}

const DESCRIPTIONS: Record<string, string> = {
  welcome: "Первое сообщение после /start",
  payment_success: "Баланс пополнен",
  payment_success_code: "Устаревший: код больше не приходит в чат",
  payment_failed: "Оплата не прошла",
  low_balance: "Баланс скоро закончится",
  suspended: "Доступ приостановлен из-за нуля на балансе",
};

/** Какие переменные доступны в каком шаблоне — подставляются при отправке. */
const VARIABLES: Record<string, string[]> = {
  payment_success: ["{{amount}}", "{{balance}}"],
  payment_success_code: ["{{amount}}", "{{code}}"],
  low_balance: ["{{days_left}}", "{{balance}}"],
  suspended: ["{{balance}}"],
};

function preview(text: string): string {
  const sample: Record<string, string> = {
    amount: "300.00",
    balance: "296.67",
    days_left: "3",
    code: "FQ39-5HYW-H814-R3EJ",
    expires_at: "28.10.2026",
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => sample[k] ?? "");
}

export function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ templates: Template[] }>("/templates")
      .then((r) => {
        setTemplates(r.templates);
        setDraft(Object.fromEntries(r.templates.map((t) => [t.key, t.text_template])));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function save(key: string, patch: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/templates/${key}`, { method: "PUT", body: JSON.stringify(patch) });
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {templates.map((t) => (
        <div className="card" key={t.key}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>{DESCRIPTIONS[t.key] ?? t.key}</h3>
              <div className="tile-label" style={{ marginTop: 4 }}>{t.key}</div>
            </div>
            <button className="btn-ghost" onClick={() => save(t.key, { enabled: !t.enabled })}>
              {t.enabled ? "включён" : "выключен"}
            </button>
          </div>

          <textarea
            className="field"
            rows={3}
            style={{ marginTop: 12 }}
            value={draft[t.key] ?? ""}
            onChange={(e) => setDraft({ ...draft, [t.key]: e.target.value })}
          />

          {VARIABLES[t.key] && (
            <p className="muted mono" style={{ margin: "0 0 8px", fontSize: 12 }}>
              переменные: {VARIABLES[t.key].join(" · ")}
            </p>
          )}
          <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Так увидит пользователь: {preview(draft[t.key] ?? "")}
          </p>

          <button
            className="btn-ghost"
            onClick={() => save(t.key, { text_template: draft[t.key] })}
            disabled={draft[t.key] === t.text_template || !(draft[t.key] ?? "").trim()}
          >
            {savedKey === t.key ? "Сохранено" : "Сохранить"}
          </button>
        </div>
      ))}
    </div>
  );
}
