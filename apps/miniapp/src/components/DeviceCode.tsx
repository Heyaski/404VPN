import { useState } from "react";
import { api, type DeviceCode as DeviceCodeResponse } from "../api";
import { tg } from "../telegram";

/**
 * Код привязки устройства. Выпускается по кнопке, а не приходит сообщением:
 * так его можно получить в любой момент — например, после переустановки приложения.
 */
export function DeviceCode({ linked }: { linked: boolean }) {
  const [issued, setIssued] = useState<DeviceCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      setIssued(await api<DeviceCodeResponse>("/device-code", { method: "POST" }));
      setCopied(false);
    } catch {
      setError("Не удалось выпустить код. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      tg()?.HapticFeedback?.impactOccurred("light");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Скопируй код вручную — буфер обмена недоступен.");
    }
  }

  if (!linked) {
    return (
      <div className="card">
        <h2>Код для приложения</h2>
        <p className="muted" style={{ margin: 0 }}>
          Появится после первого пополнения баланса.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Код для приложения</h2>
      {issued ? (
        <>
          <div className="code-value mono">{issued.code}</div>
          <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Введи его в приложении 404VPN. Код действует {issued.expiresInMinutes} мин.
            и привязывает одно устройство.
          </p>
          <button className="btn-primary" onClick={copy}>
            {copied ? "Скопировано" : "Скопировать"}
          </button>
          <button
            className="chip"
            style={{ width: "100%", marginTop: 8 }}
            onClick={issue}
            disabled={busy}
          >
            {busy ? "Выпускаем…" : "Выпустить новый"}
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Нужен, чтобы войти в приложение на новом устройстве или после переустановки.
          </p>
          <button className="btn-primary" onClick={issue} disabled={busy}>
            {busy ? "Выпускаем…" : "Получить код"}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
