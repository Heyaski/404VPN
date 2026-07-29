export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  HapticFeedback?: { impactOccurred(style: "light" | "medium" | "heavy"): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

// Дев-режим: initData пустая вне Telegram, показываем мок-данные вместо 401
export const DEV_FAKE = import.meta.env.VITE_DEV_FAKE === "1";
