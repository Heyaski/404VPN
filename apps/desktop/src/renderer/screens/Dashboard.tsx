import type { MeResponse, TunnelStats, VpnStatus } from "../../shared/types";

interface Props {
  me: MeResponse | null;
  status: VpnStatus;
  stats: TunnelStats;
  busy: boolean;
  error: string | null;
  needAdmin?: boolean;
  onToggle: () => void;
  onElevate?: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function statusLabel(status: VpnStatus, suspended: boolean): { text: string; cls: string } {
  if (suspended) return { text: "приостановлен", cls: "warn" };
  if (status === "connected") return { text: "защищено", cls: "accent" };
  if (status === "connecting") return { text: "подключение", cls: "" };
  if (status === "disconnecting") return { text: "отключение", cls: "" };
  if (status === "error") return { text: "ошибка", cls: "warn" };
  return { text: "не защищено", cls: "" };
}

export function Dashboard({
  me,
  status,
  stats,
  busy,
  error,
  needAdmin,
  onToggle,
  onElevate,
}: Props) {
  const suspended = me?.status !== "active";
  const connected = status === "connected";
  const pending =
    busy || status === "connecting" || status === "disconnecting";
  const label = statusLabel(status, suspended);

  let buttonText = "Подключить";
  if (status === "connecting") buttonText = "Подключение…";
  else if (status === "disconnecting") buttonText = "Отключение…";
  else if (connected) buttonText = "Отключить";
  else if (busy) buttonText = "Подождите…";

  return (
    <>
      <div className="brand-row">
        <div className="brand">
          <span className="accent">404</span>
          <span>/OVERLAY</span>
        </div>
        <div className={`eyebrow ${label.cls}`}>
          {pending ? (
            <span className="status-pending">
              <span className="spinner" aria-hidden />
              {label.text}
            </span>
          ) : (
            label.text
          )}
        </div>
      </div>

      <button
        className={`connect-btn ${connected ? "connected" : ""} ${pending ? "pending" : ""}`}
        disabled={pending || suspended}
        onClick={onToggle}
      >
        {pending ? <span className="spinner spinner-lg" aria-hidden /> : null}
        {buttonText}
      </button>

      {suspended ? (
        <div className="warn-box">
          Баланс закончился — пополни в Telegram Mini App, чтобы снова подключиться.
        </div>
      ) : null}

      {connected ? (
        <div className="stats-grid">
          <div className="stat">
            <div className="label">принято</div>
            <div className="value mono">{formatBytes(stats.rxBytes)}</div>
          </div>
          <div className="stat">
            <div className="label">отправлено</div>
            <div className="value mono">{formatBytes(stats.txBytes)}</div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-label">баланс</div>
        <div className="row">
          <div>
            <div className="balance-value">{me ? `${me.balance} ₽` : "—"}</div>
            <div className="muted">
              {me?.daysLeft != null
                ? `≈ ${me.daysLeft} дн. при ${me.devices} устр.`
                : "нет данных о сроке"}
            </div>
          </div>
          <div className="eyebrow">{me?.deviceName ?? "устройство"}</div>
        </div>
      </div>

      {error || status === "error" ? (
        <div className="warn-box">
          {error || "Не удалось подключить туннель. Нажми «Подключить» ещё раз."}
        </div>
      ) : null}

      {needAdmin && onElevate ? (
        <button className="primary-btn" disabled={busy} onClick={onElevate}>
          Запустить от администратора
        </button>
      ) : null}

      {!connected && !error && status !== "error" && !suspended ? (
        <p className="muted">
          Запускай 404VPN сразу от администратора (ПКМ → Запуск от имени администратора).
        </p>
      ) : null}
      <div className="spacer" />
    </>
  );
}
