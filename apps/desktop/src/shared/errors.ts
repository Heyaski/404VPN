import type { ApiErrorCode } from "./types.js";

const MESSAGES: Record<ApiErrorCode, string> = {
  invalid_code: "Такого кода не существует. Проверь символы.",
  already_used: "Этот код уже активирован.",
  expired: "Срок действия кода истёк.",
  revoked: "Код отозван.",
  too_many_attempts: "Слишком много попыток. Подожди минуту.",
  device_limit: "Достигнут лимит устройств. Отвяжи одно в приложении.",
  suspended: "Баланс закончился — пополни, чтобы подключиться.",
  blocked: "Доступ заблокирован.",
  unauthorized: "Устройство больше не привязано. Введи код заново.",
  wg_unavailable: "Сервер сейчас не выдаёт подключения. Попробуй позже.",
  network: "Нет связи с сервером",
};

export function messageForError(code: string, status = 0): string {
  if (code in MESSAGES) return MESSAGES[code as ApiErrorCode];
  if (status === 401) return MESSAGES.unauthorized;
  if (status === 402) return MESSAGES.suspended;
  if (status === 403) return MESSAGES.blocked;
  return status ? `Ошибка сервера (${status})` : MESSAGES.network;
}
