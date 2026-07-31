import { useEffect, useState } from "react";
import { api, type Referral as ReferralData } from "../api";
import { tg } from "../telegram";

export function Referral() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<ReferralData>("/referral").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;
  const share = data.link ?? `Код: ${data.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      tg()?.HapticFeedback?.impactOccurred("light");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер недоступен — ссылку можно выделить вручную */
    }
  }

  return (
    <div className="card">
      <h2>Приглашай друзей</h2>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        Друг получает {data.inviteeBonus} ₽ сразу, ты — {data.inviterBonus} ₽ за него
        и {data.commissionPercent}% с каждого его пополнения.
      </p>

      <div className="ref-link mono">{share}</div>

      <div className="ref-stats">
        <div>
          <div className="eyebrow-inline">приглашено</div>
          <div className="ref-value mono">{data.invited}</div>
        </div>
        <div>
          <div className="eyebrow-inline">заработано</div>
          <div className="ref-value mono">{data.earned} ₽</div>
        </div>
      </div>

      <button className="btn-primary" onClick={copy}>
        {copied ? "Скопировано" : "Скопировать ссылку"}
      </button>
    </div>
  );
}
