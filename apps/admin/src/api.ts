const TOKEN_KEY = "admin-token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class Unauthorized extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    throw new Unauthorized("Сессия истекла");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Ошибка ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface Stats {
  users: number;
  active: number;
  suspended: number;
  devices: number;
  balance_total: string;
  revenue_total: string;
  revenue_month: string;
  codes_issued: number;
}

export interface AdminUser {
  id: string;
  balance: string;
  status: "active" | "suspended" | "blocked";
  max_devices: number;
  devices: number;
  daysLeft: number | null;
  created_at: string;
  telegram_id: string | null;
  username: string | null;
}

export interface UserDetails {
  user: AdminUser & { last_charged_at: string | null };
  devices: {
    id: string;
    name: string;
    platform: string;
    is_active: boolean;
    revoked_at: string | null;
    wg_client_id: string | null;
    created_at: string;
    last_seen_at: string | null;
  }[];
  transactions: {
    type: string;
    amount: string;
    balance_after: string;
    meta: Record<string, unknown>;
    created_at: string;
  }[];
  telegram: { telegram_id: string; username: string | null; is_blocked_bot: boolean } | null;
}

export interface AdminCode {
  id: string;
  amount: string;
  status: string;
  expires_at: string;
  created_at: string;
  redeemed_at: string | null;
  is_link_code: boolean;
  redeemed_by: string | null;
}

export interface AdminPayment {
  id: number;
  amount: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  user_id: string | null;
  telegram_id: string | null;
  username: string | null;
}

export interface SettingsPayload {
  settings: { key: string; value: number }[];
  textSettings: { key: string; value: string }[];
  presets: { id: string; amount: string; title: string; is_active: boolean; sort_order: number }[];
}

export const fmtMoney = (v: string | number) => `${Number(v).toFixed(2)} ₽`;
export const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
