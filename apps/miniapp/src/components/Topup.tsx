import { useState } from "react";
import { api, type Presets } from "../api";
import { tg } from "../telegram";

export function Topup({ presets, onCreated }: { presets: Presets; onCreated: () => void }) {
  const [amount, setAmount] = useState<number | null>(presets.presets[1]?.amount ?? null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = custom.trim() ? Number(custom.replace(",", ".")) : amount;
  const valid = Number.isFinite(effective) && (effective ?? 0) >= presets.minTopup;

  async function pay() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { paymentUrl } = await api<{ orderId: number; paymentUrl: string }>("/topup", {
        method: "POST",
        body: JSON.stringify({ amount: effective }),
      });
      tg()?.HapticFeedback?.impactOccurred("light");
      if (tg()) tg()!.openLink(paymentUrl);
      else window.open(paymentUrl, "_blank");
      onCreated();
    } catch {
      setError("Не удалось создать счёт. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Пополнить</h2>
      <div className="chips">
        {presets.presets.map((p) => (
          <button
            key={p.amount}
            className={`chip${!custom.trim() && amount === p.amount ? " active" : ""}`}
            onClick={() => {
              setAmount(p.amount);
              setCustom("");
            }}
          >
            {p.title}
          </button>
        ))}
      </div>
      <input
        className="field"
        inputMode="decimal"
        placeholder={`Другая сумма, от ${presets.minTopup} ₽`}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
      />
      <button className="btn-primary" disabled={!valid || busy} onClick={pay}>
        {busy ? "Создаём счёт…" : `Оплатить ${valid ? effective : presets.minTopup} ₽`}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
