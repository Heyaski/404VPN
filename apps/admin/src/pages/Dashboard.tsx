import { useEffect, useState } from "react";
import { api, fmtMoney, type Stats } from "../api";

const TILES: { key: keyof Stats; label: string; money?: boolean }[] = [
  { key: "revenue_month", label: "выручка за месяц", money: true },
  { key: "revenue_total", label: "выручка всего", money: true },
  { key: "balance_total", label: "на балансах", money: true },
  { key: "users", label: "пользователей" },
  { key: "active", label: "активных" },
  { key: "suspended", label: "приостановлено" },
  { key: "devices", label: "устройств" },
  { key: "codes_issued", label: "кодов не активировано" },
];

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>("/stats").then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Загружаем…</p>;

  return (
    <div className="tiles">
      {TILES.map((t) => (
        <div className="card" key={t.key}>
          <div className="tile-label">{t.label}</div>
          <div className="tile-value mono">
            {t.money ? fmtMoney(stats[t.key] as string) : stats[t.key]}
          </div>
        </div>
      ))}
    </div>
  );
}
