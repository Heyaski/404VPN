import { useCallback, useEffect, useState } from "react";
import type { MeResponse, TunnelStats, VpnStatus } from "../shared/types";
import { Dashboard } from "./screens/Dashboard";
import { Redeem } from "./screens/Redeem";
import { Settings } from "./screens/Settings";

type Tab = "home" | "settings";

export function App() {
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<VpnStatus>("disconnected");
  const [stats, setStats] = useState<TunnelStats>({ rxBytes: 0, txBytes: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [filterAvailable, setFilterAvailable] = useState(false);
  const [dnsFilter, setDnsFilter] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);
  const [needAdmin, setNeedAdmin] = useState(false);

  const refresh = useCallback(async () => {
    const token = await window.overlay.hasToken();
    setHasToken(token);
    if (!token) {
      setMe(null);
      return;
    }
    const res = await window.overlay.me();
    if (!res.ok) {
      setError(res.message);
      if (res.code === "unauthorized") {
        setHasToken(false);
        setMe(null);
      }
      return;
    }
    setMe(res.data);
    // Не трогаем error: после неудачного Connect refresh() раньше затирал
    // точный текст, и UI показывал пустую «Нажми ещё раз».
  }, []);

  useEffect(() => {
    if (!window.overlay) {
      setError("Не удалось загрузить мост приложения (preload). Переустанови 404VPN.");
      setReady(true);
      return;
    }
    void (async () => {
      const prefs = await window.overlay.getPreferences();
      setDnsFilter(prefs.dnsFilter);
      setAutoConnect(prefs.autoConnect);
      const st = await window.overlay.vpnStatus();
      setStatus(st);
      if (st === "error") {
        const last = await window.overlay.lastError();
        if (last) setError(last);
      }
      await refresh();
      setReady(true);
    })();
    return window.overlay.onStatus((s) => {
      setStatus(s);
      if (s === "connected" || s === "disconnected") {
        setError(null);
        return;
      }
      if (s === "error") {
        void window.overlay.lastError().then((msg) => {
          if (msg) setError(msg);
        });
      }
    });
  }, [refresh]);

  useEffect(() => {
    if (status !== "connected") {
      setStats({ rxBytes: 0, txBytes: 0 });
      return;
    }
    let alive = true;
    const tick = async () => {
      const res = await window.overlay.stats();
      if (alive && res.ok) setStats(res.data);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [status]);

  const onRedeem = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.overlay.redeem(code);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setHasToken(true);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async () => {
    setBusy(true);
    setNeedAdmin(false);
    try {
      if (status === "connected" || status === "connecting") {
        const res = await window.overlay.disconnect();
        if (!res.ok) setError(res.message);
        else setError(null);
      } else {
        setError(null);
        const res = await window.overlay.connect();
        if (!res.ok) {
          const detail = res.message || (await window.overlay.lastError()) || "Не удалось подключить туннель";
          setError(detail);
          setNeedAdmin(res.code === "need_admin");
        } else {
          setError(null);
          setFilterAvailable(res.filterAvailable);
          setNeedAdmin(false);
        }
      }
      const st = await window.overlay.vpnStatus();
      setStatus(st);
      if (st === "error") {
        const last = await window.overlay.lastError();
        if (last) setError(last);
      }
      // Не блокируем кнопку на api.me() — после смены маршрутов fetch может висеть десятки секунд
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onElevate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.overlay.relaunchElevated();
      if (!res.ok) setError(res.message);
      else {
        setError(
          "message" in res && res.message
            ? res.message
            : "Подтверди UAC. Откроется новое окно — подключайся уже в нём (от администратора).",
        );
        setNeedAdmin(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDnsFilter = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.overlay.setDnsFilter(enabled);
      setDnsFilter(res.prefs.dnsFilter);
      if (!res.ok) setError(res.message);
      else setFilterAvailable(true);
    } finally {
      setBusy(false);
    }
  };

  const onAutoConnect = async (enabled: boolean) => {
    const prefs = await window.overlay.setPreferences({ autoConnect: enabled });
    setAutoConnect(prefs.autoConnect);
  };

  const onUnlink = async () => {
    setBusy(true);
    try {
      await window.overlay.unlink();
      setHasToken(false);
      setMe(null);
      setTab("home");
      setStatus("disconnected");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="page">
          <div className="eyebrow">загрузка</div>
        </div>
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="app-shell">
        <Redeem busy={busy} error={error} onSubmit={onRedeem} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page">
        {tab === "home" ? (
          <Dashboard
            me={me}
            status={status}
            stats={stats}
            busy={busy}
            error={error}
            needAdmin={needAdmin}
            onToggle={() => void onToggle()}
            onElevate={() => void onElevate()}
          />
        ) : (
          <Settings
            me={me}
            busy={busy}
            dnsFilter={dnsFilter}
            autoConnect={autoConnect}
            filterAvailable={filterAvailable || dnsFilter}
            error={error}
            onDnsFilter={(v) => void onDnsFilter(v)}
            onAutoConnect={(v) => void onAutoConnect(v)}
            onUnlink={() => void onUnlink()}
          />
        )}
        <div className="tabs">
          <button
            className={`tab ${tab === "home" ? "active" : ""}`}
            onClick={() => setTab("home")}
          >
            Главная
          </button>
          <button
            className={`tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            Настройки
          </button>
        </div>
      </div>
    </div>
  );
}
