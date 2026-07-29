import type { Me } from "../api";

function statusPill(me: Me) {
  if (me.status === "suspended") return { cls: "pill danger", text: "приостановлен" };
  if (me.status === "blocked") return { cls: "pill danger", text: "заблокирован" };
  if (me.daysLeft !== null && me.daysLeft !== undefined && me.daysLeft <= 3)
    return { cls: "pill warn", text: "мало дней" };
  return { cls: "pill ok", text: "активен" };
}

export function Balance({ me }: { me: Me }) {
  if (!me.linked) {
    return (
      <div className="card">
        <div className="eyebrow">начало работы</div>
        <p style={{ margin: "10px 0 0" }}>
          Пополни баланс — бот пришлёт код активации. Введи его в приложении 404VPN, и баланс
          привяжется к аккаунту.
        </p>
      </div>
    );
  }

  const pill = statusPill(me);
  const left =
    me.daysLeft === null || me.daysLeft === undefined
      ? "без списаний · нет устройств"
      : `≈ ${me.daysLeft} дн. · устройств: ${me.devices ?? 0}`;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="eyebrow">баланс</div>
        <span className={pill.cls}>{pill.text}</span>
      </div>
      <div className="balance-value mono" style={{ marginTop: 10 }}>
        {me.balance} ₽
      </div>
      <div className="balance-sub mono">{left}</div>
    </div>
  );
}
