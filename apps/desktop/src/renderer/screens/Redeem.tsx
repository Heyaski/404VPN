import { useState } from "react";
import { formatAccessCode, isCodeComplete } from "../../shared/codeFormat";

interface Props {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => Promise<void>;
}

export function Redeem({ busy, error, onSubmit }: Props) {
  const [code, setCode] = useState("");
  const complete = isCodeComplete(code);

  return (
    <div className="page">
      <div className="eyebrow accent">инженерная студия 404</div>
      <h1 className="hero-title">
        <span className="accent">404</span>VPN
      </h1>
      <p className="soft">
        Введи код доступа — он появится в Telegram Mini App после пополнения баланса.
      </p>

      <div className="card">
        <div className="card-label">код доступа</div>
        <input
          className="input"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={code}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => setCode(formatAccessCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && complete && !busy) void onSubmit(code);
          }}
        />
      </div>

      {error ? <div className="error">{error}</div> : null}

      <button
        className="primary-btn"
        disabled={!complete || busy}
        onClick={() => void onSubmit(code)}
      >
        {busy ? "Активация…" : "Активировать"}
      </button>

      <div className="spacer" />
      <p className="muted">Код одноразовый и привязывает это устройство к аккаунту.</p>
    </div>
  );
}
