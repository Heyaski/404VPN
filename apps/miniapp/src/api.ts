import { tg, DEV_FAKE } from "./telegram";

export interface Me {
  linked: boolean;
  balance?: string;
  devices?: number;
  status?: "active" | "suspended" | "blocked";
  daysLeft?: number | null;
}
export interface Presets {
  presets: { amount: number; title: string }[];
  minTopup: number;
}
export interface HistoryItem {
  kind: string;
  amount: string;
  date: string;
}
export interface DeviceCode {
  code: string;
  expiresInMinutes: number;
}
export interface Referral {
  code: string;
  link: string | null;
  invited: number;
  earned: string;
  inviteeBonus: number;
  inviterBonus: number;
  commissionPercent: number;
}
export interface Support {
  help: string;
  contact: string;
}

const FAKE: Record<string, unknown> = {
  "/me": { linked: true, balance: "300.00", devices: 1, status: "active", daysLeft: 90 },
  "/presets": {
    presets: [
      { amount: 100, title: "100 ₽" },
      { amount: 300, title: "300 ₽" },
      { amount: 600, title: "600 ₽" },
      { amount: 1200, title: "1200 ₽" },
    ],
    minTopup: 100,
  },
  // достаточно записей, чтобы в дев-режиме была видна свёртка списка
  "/history": {
    items: [
      { kind: "topup", amount: "600.00" },
      { kind: "daily_charge", amount: "-3.33" },
      { kind: "referral_commission", amount: "60.00" },
      { kind: "referral_bonus", amount: "30.00" },
      { kind: "admin_adjust", amount: "100.00" },
      { kind: "daily_charge", amount: "-3.33" },
      { kind: "topup", amount: "300.00" },
    ].map((it, i) => ({ ...it, date: new Date(Date.now() - i * 86_400_000).toISOString() })),
  },
  "/device-code": { code: "FQ39-5HYW-H814-R3EJ", expiresInMinutes: 30 },
  "/referral": {
    code: "AB12CD34",
    link: "https://t.me/vpn404bot?start=ref_AB12CD34",
    invited: 3,
    earned: "180.00",
    inviteeBonus: 50,
    inviterBonus: 30,
    commissionPercent: 20,
  },
  "/support": {
    help: "404VPN — быстрый VPN без профилей и настроек.\n\nПополни баланс, получи код и введи его в приложении.",
    contact: "@support404",
  },
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEV_FAKE && FAKE[path] !== undefined) return FAKE[path] as T;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": tg()?.initData ?? "",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}
