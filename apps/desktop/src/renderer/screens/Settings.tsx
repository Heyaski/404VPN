import { useState } from "react";
import type { MeResponse } from "../../shared/types";

interface Props {
  me: MeResponse | null;
  busy: boolean;
  dnsFilter: boolean;
  autoConnect: boolean;
  filterAvailable: boolean;
  error: string | null;
  onDnsFilter: (v: boolean) => void;
  onAutoConnect: (v: boolean) => void;
  onUnlink: () => void;
}

export function Settings({
  me,
  busy,
  dnsFilter,
  autoConnect,
  filterAvailable,
  error,
  onDnsFilter,
  onAutoConnect,
  onUnlink,
}: Props) {
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  return (
    <>
      <div className="brand-row">
        <div className="brand">
          <span className="accent">404</span>
          <span>/OVERLAY</span>
        </div>
        <div className="eyebrow">настройки</div>
      </div>

      <div className="card">
        <div className="card-label">подключение</div>
        <div className="row" style={{ marginBottom: 12 }}>
          <div>
            <div>Автоподключение</div>
            <div className="muted">При запуске приложения</div>
          </div>
          <button
            className={`toggle ${autoConnect ? "on" : ""}`}
            aria-label="Автоподключение"
            onClick={() => onAutoConnect(!autoConnect)}
          />
        </div>
        <div className="row">
          <div>
            <div>DNS-фильтр</div>
            <div className="muted">
              {filterAvailable
                ? "Блокировка рекламы через AdGuard"
                : "Включится при подключении, если настроен на сервере"}
            </div>
          </div>
          <button
            className={`toggle ${dnsFilter ? "on" : ""}`}
            aria-label="DNS-фильтр"
            disabled={busy}
            onClick={() => onDnsFilter(!dnsFilter)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-label">устройство</div>
        <div className="soft" style={{ marginBottom: 12 }}>
          {me?.deviceName ?? "Это устройство"} · статус {me?.status ?? "—"}
        </div>
        {!confirmUnlink ? (
          <button className="ghost-btn danger" disabled={busy} onClick={() => setConfirmUnlink(true)}>
            Отвязать устройство
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="muted">
              Освободит слот и остановит списание за это устройство. Потребуется новый код.
            </div>
            <button className="ghost-btn danger" disabled={busy} onClick={onUnlink}>
              {busy ? "Отвязка…" : "Подтвердить отвязку"}
            </button>
            <button className="ghost-btn" disabled={busy} onClick={() => setConfirmUnlink(false)}>
              Отмена
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-label">о приложении</div>
        <div className="soft">404VPN Desktop</div>
        <div className="muted" style={{ marginTop: 6 }}>
          Пополнение и коды — в Telegram Mini App.
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      <div className="spacer" />
    </>
  );
}
