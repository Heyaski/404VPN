import { useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { Users } from "./pages/Users";
import { Codes } from "./pages/Codes";
import { Payments } from "./pages/Payments";
import { Broadcasts } from "./pages/Broadcasts";
import { Templates } from "./pages/Templates";
import { Settings } from "./pages/Settings";

const TABS = [
  { id: "dashboard", title: "Сводка" },
  { id: "users", title: "Пользователи" },
  { id: "codes", title: "Коды" },
  { id: "payments", title: "Платежи" },
  { id: "broadcasts", title: "Рассылки" },
  { id: "templates", title: "Шаблоны" },
  { id: "settings", title: "Настройки" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>("/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setToken(r.token);
      onDone();
    } catch {
      setError("Неверный пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-wrap">
      <div className="login-box card">
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
          <span style={{ color: "var(--accent)" }}>404</span>VPN
        </div>
        <div className="tile-label" style={{ marginBottom: 16 }}>панель управления</div>
        <input
          className="field"
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn-primary" onClick={submit} disabled={busy || !password}>
          {busy ? "Проверяем…" : "Войти"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<TabId>("dashboard");

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className="admin-wrap">
      <div className="topbar">
        <div style={{ fontWeight: 800, fontSize: 20 }}>
          <span style={{ color: "var(--accent)" }}>404</span>VPN
          <span className="tile-label" style={{ marginLeft: 10 }}>админка</span>
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            clearToken();
            setAuthed(false);
          }}
        >
          Выйти
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <Dashboard />}
      {tab === "users" && <Users />}
      {tab === "codes" && <Codes />}
      {tab === "payments" && <Payments />}
      {tab === "broadcasts" && <Broadcasts />}
      {tab === "templates" && <Templates />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
