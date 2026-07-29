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
  "/history": {
    items: [{ kind: "topup", amount: "300.00", date: new Date().toISOString() }],
  },
  "/device-code": { code: "FQ39-5HYW-H814-R3EJ", expiresInMinutes: 30 },
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
