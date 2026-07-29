import { useCallback, useEffect, useState } from "react";
import { api, type HistoryItem, type Me, type Presets } from "./api";
import { Balance } from "./components/Balance";
import { Topup } from "./components/Topup";
import { History } from "./components/History";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [presets, setPresets] = useState<Presets | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, presetsRes, historyRes] = await Promise.all([
        api<Me>("/me"),
        api<Presets>("/presets"),
        api<{ items: HistoryItem[] }>("/history"),
      ]);
      setMe(meRes);
      setPresets(presetsRes);
      setHistory(historyRes.items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="wrap">
      <div className="brand">
        <span>
          <span className="accent">404</span>VPN
        </span>
        <span className="eyebrow">telegram mini app</span>
      </div>

      {failed && (
        <div className="card">
          <p className="error" style={{ margin: 0 }}>
            Не удалось загрузить данные. Открой приложение из бота 404VPN.
          </p>
        </div>
      )}

      {me && <Balance me={me} />}
      {presets && <Topup presets={presets} onCreated={load} />}
      {me && <History items={history} />}
    </div>
  );
}
