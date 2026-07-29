# 404VPN — Фаза 2: Telegram Mini App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mini App внутри Telegram (баланс / пополнение / история) в дизайн-токенах 404 Studiotech + API в `services/core` с аутентификацией по `initData`, всё на одном домене за Caddy с автоматическим Let's Encrypt.

**Architecture:** Спецификация — `docs/ARCHITECTURE.md` §6, дизайн — `docs/DESIGN.md`. Хостинг-решение владельца: **купленный домен**, DNS A-запись → NL-сервер 195.14.118.198. Caddy раздаёт статику Mini App и проксирует `/api/*`, `/payhook/*` на `core:8080`. Один origin — CORS не нужен. Бот получает кнопку `web_app`.

**Tech Stack:** React 18 + Vite 5 + TypeScript (apps/miniapp), Telegram WebApp JS SDK (официальный script-тег), Caddy 2, существующий `services/core` (express 5, vitest 2).

## Global Constraints

- Все ограничения фазы 1 действуют (деньги в копейках, секреты в .env, тесты+коммит на задачу).
- Аутентификация каждого запроса `/api/*`: заголовок `X-Telegram-Init-Data`, HMAC-валидация по алгоритму Telegram (secret = HMAC_SHA256(key="WebAppData", msg=bot_token)), свежесть `auth_date` ≤ 24 ч. Запрос без валидной подписи → 401.
- UI строго по токенам `docs/DESIGN.md`: тёмная тема (`--bg #070B14`, `--accent #34D399`, Inter + IBM Plex Mono), радиус 8px, фоновая сетка.
- Новые env-переменные: `DOMAIN` (голый домен, напр. `404vpn.ru`), `MINIAPP_URL` (`https://<DOMAIN>/`). Обе опциональны для локальной разработки, обязательны в проде.
- Тексты интерфейса — русские, технический лаконичный тон (без эмодзи-шума).

---

### Task 1: Валидация initData (webapp-auth)

**Files:**
- Create: `services/core/src/webapp-auth.ts`, `services/core/tests/webapp-auth.test.ts`

**Interfaces:**
- Produces: `interface WebAppUser { telegramId: number; username?: string; firstName?: string }`; `validateInitData(initData: string, botToken: string, maxAgeSec?: number, nowMs?: number): WebAppUser | null`; `buildInitData(user: object, botToken: string, authDate: number): string` (экспорт для тестов и только для них — генерирует валидную строку тем же алгоритмом).

- [ ] **Step 1: failing tests**

```ts
import { describe, it, expect } from "vitest";
import { validateInitData, buildInitData } from "../src/webapp-auth.js";

const TOKEN = "123456:test-token";
const NOW = 1_753_800_000_000; // ms
const user = { id: 42, first_name: "Степан", username: "stepan" };

describe("validateInitData", () => {
  it("accepts freshly signed initData and extracts user", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    const r = validateInitData(initData, TOKEN, 86_400, NOW);
    expect(r).toEqual({ telegramId: 42, username: "stepan", firstName: "Степан" });
  });
  it("rejects tampered payload", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    const tampered = initData.replace("stepan", "mallory");
    expect(validateInitData(tampered, TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects wrong bot token", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 60);
    expect(validateInitData(initData, "999:other", 86_400, NOW)).toBeNull();
  });
  it("rejects stale auth_date", () => {
    const initData = buildInitData(user, TOKEN, NOW / 1000 - 90_000);
    expect(validateInitData(initData, TOKEN, 86_400, NOW)).toBeNull();
  });
  it("rejects missing hash", () => {
    expect(validateInitData("auth_date=1&user=%7B%7D", TOKEN, 86_400, NOW)).toBeNull();
  });
});
```

Run: `npx vitest run tests/webapp-auth.test.ts` → FAIL (module not found).

- [ ] **Step 2: реализация**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebAppUser { telegramId: number; username?: string; firstName?: string }

function hmacChain(botToken: string, dataCheckString: string): string {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

export function validateInitData(
  initData: string, botToken: string, maxAgeSec = 86_400, nowMs = Date.now(),
): WebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const expected = hmacChain(botToken, dataCheckString);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try { b = Buffer.from(hash, "hex"); } catch { return null; }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec) return null;
  const rawUser = params.get("user");
  if (!rawUser) return null;
  const u = JSON.parse(rawUser) as { id: number; username?: string; first_name?: string };
  return { telegramId: u.id, username: u.username, firstName: u.first_name };
}

// Только для тестов: собирает валидную initData тем же алгоритмом
export function buildInitData(user: object, botToken: string, authDate: number): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(authDate)), user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  params.set("hash", hmacChain(botToken, dataCheckString));
  return params.toString();
}
```

- [ ] **Step 3:** `npx vitest run` → все PASS.
- [ ] **Step 4:** `git add services/core && git commit -m "feat(core): telegram webapp initData validation"`

### Task 2: API для Mini App

**Files:**
- Create: `services/core/src/api.ts`, `services/core/tests/api.test.ts`
- Modify: `services/core/src/config.ts` (добавить `MINIAPP_URL: z.string().url().optional()`), `services/core/src/index.ts` (смонтировать роутер)

**Interfaces:**
- Consumes: `validateInitData` (Task 1), `createTopupOrder`/`buildPaymentUrl`/`daysLeft`/`pool`/`withTx` (фаза 1).
- Produces: `createApiRouter(botToken: string, creds: RobokassaCreds): express.Router` с маршрутами:
  - `GET /api/me` → `{ linked: boolean, balance?: string, daysLeft?: number|null, devices?: number, status?: string }` (daysLeft: null = ∞)
  - `GET /api/presets` → `{ presets: {amount: number, title: string}[], minTopup: number }`
  - `POST /api/topup` `{ amount: number }` → `{ orderId: number, paymentUrl: string }` | 400
  - `GET /api/history` → `{ items: {kind, amount, date, ...}[] }` — для привязанного: balance_transactions (50 шт.), иначе payment_orders этого telegram-аккаунта.
- Все маршруты за middleware: `X-Telegram-Init-Data` → `validateInitData` → 401 при провале; upsert `telegram_users` (chat_id = telegramId для личных чатов).

- [ ] **Step 1: failing integration tests** — через `buildInitData` из Task 1 и supertest-подобный вызов (express 5: использовать `app.listen(0)` + fetch на локальный порт; helper в тесте). Кейсы: 401 без заголовка; `/api/me` unlinked → `{linked:false}`; `/api/topup` меньше минимума → 400; `/api/topup` валидный → orderId + URL с `IsTest=1`; `/api/me` после ручной привязки user → balance/daysLeft. (Полные тела тестов — по образцу `payments.test.ts`, база `vpn_test`.)
- [ ] **Step 2: реализация** `createApiRouter` (по контрактам выше; SQL-запросы те же паттерны, что в `bot.ts`).
- [ ] **Step 3:** `npm run build && npx vitest run` → PASS.
- [ ] **Step 4:** commit `feat(core): mini app api (me, presets, topup, history) with initData auth`.

### Task 3: Каркас Mini App + дизайн-токены

**Files:**
- Create: `apps/miniapp/` (Vite react-ts: `package.json`, `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/tokens.css`, `src/api.ts`)

**Interfaces:**
- Produces: `api<T>(path, opts?)` — fetch-обёртка, шлёт `X-Telegram-Init-Data: window.Telegram.WebApp.initData`, base `/api`; `tokens.css` — CSS-переменные из `docs/DESIGN.md` (dark по умолчанию), фоновая сетка, классы `.card`, `.btn-primary`, `.mono`.
- `index.html` подключает `<script src="https://telegram.org/js/telegram-web-app.js"></script>` и Inter/IBM Plex Mono.

- [ ] **Step 1:** `npm create vite@latest apps/miniapp -- --template react-ts` + `npm i` внутри.
- [ ] **Step 2:** `tokens.css` — перенести таблицу токенов DESIGN.md в `:root`; тело: фон `--bg` + сетка `--grid-line` (background-image linear-gradient 32px), текст `--fg`, шрифты.
- [ ] **Step 3:** `src/api.ts`:

```ts
const initData = (window as any).Telegram?.WebApp?.initData ?? "";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4:** `npm run build` в apps/miniapp → сборка без ошибок. Commit `feat(miniapp): vite scaffold with 404studiotech design tokens`.

### Task 4: Экраны Mini App

**Files:**
- Modify: `apps/miniapp/src/App.tsx`; Create: `src/components/Balance.tsx`, `src/components/Topup.tsx`, `src/components/History.tsx`

Одностраничный layout (три секции, скролл), состояние через `useState`+`useEffect` без роутера:

- **Balance**: крупный баланс (Inter 800) + моно-подпись `~N ДН.` / `∞`; для `linked:false` — интро-карточка «Пополни баланс — бот пришлёт код активации для приложения».
- **Topup**: кнопки пресетов из `/api/presets` + поле произвольной суммы (min из ответа); по нажатию `POST /api/topup` → `Telegram.WebApp.openLink(paymentUrl)`.
- **History**: список `/api/history`, суммы моноширинные, `+` зелёным (`--accent`), `-` обычным.
- `Telegram.WebApp.ready()` + `expand()` на старте; MainButton не используем (кнопки в вёрстке).

- [ ] **Step 1:** реализовать компоненты по контрактам API Task 2.
- [ ] **Step 2:** `npm run build` — без ошибок; визуальная проверка `npm run dev` (initData пуст — API вернёт 401, для дев-режима добавить заглушку `VITE_DEV_FAKE=1`, показывающую мок-данные).
- [ ] **Step 3:** commit `feat(miniapp): balance, topup, history screens`.

### Task 5: Caddy, домен, прод-сборка

**Files:**
- Create: `infra/caddy/Dockerfile`, `infra/caddy/Caddyfile`
- Modify: `docker-compose.yml` (сервис `caddy`), `.env.example` (`DOMAIN=`, `MINIAPP_URL=`)

`infra/caddy/Dockerfile` (двухстадийный — собирает статику miniapp и кладёт в Caddy):

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY apps/miniapp/package*.json ./
RUN npm ci
COPY apps/miniapp ./
RUN npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/app
```

`infra/caddy/Caddyfile`:

```
{$DOMAIN} {
	encode gzip
	handle /payhook/* {
		reverse_proxy core:8080
	}
	handle /api/* {
		reverse_proxy core:8080
	}
	handle {
		root * /srv/app
		try_files {path} /index.html
		file_server
	}
}
```

compose-сервис (`build.context: .`, `dockerfile: infra/caddy/Dockerfile`, ports 80/443, `environment: DOMAIN=${DOMAIN}`, volumes `caddy_data:/data`, depends_on core). Порт `core` 8080 наружу больше не публикуем (заменить `ports` на `expose`).

- [ ] **Step 1:** файлы выше; `docker compose config -q`.
- [ ] **Step 2:** `docker compose build caddy` — успешная сборка.
- [ ] **Step 3:** commit `feat: caddy with auto-https serving miniapp and proxying api/payhook`.

### Task 6: Кнопка Mini App в боте

**Files:**
- Modify: `services/core/src/bot.ts` (в `/start` при заданном `cfg.MINIAPP_URL` добавить первой строкой клавиатуры `Markup.button.webApp("Открыть 404VPN", cfg.MINIAPP_URL)`), `services/core/tests/config.test.ts` (кейс: MINIAPP_URL опционален, парсится).

- [ ] **Step 1:** тест конфига → FAIL; правка config (уже в Task 2) + bot.ts; `npm run build && npx vitest run` → PASS.
- [ ] **Step 2:** commit `feat(core): web_app button in bot start`.

### Task 7: Деплой фазы 2

**Files:**
- Modify: `docs/DEPLOY.md` (раздел «Фаза 2: домен и Mini App»)

Шаги для владельца (документируются, выполняются вручную):

1. Купить домен, A-запись `@` → `195.14.118.198` (TTL любой; дождаться резолва: `dig +short <домен>`).
2. В `.env` на сервере: `DOMAIN=<домен>`, `MINIAPP_URL=https://<домен>/`.
3. Открыть 80/443 в firewall, `git pull && docker compose up -d --build` — Caddy сам получит сертификат.
4. Robokassa: Result URL → `https://<домен>/payhook/robokassa/result` (проверить тестовым платежом).
5. BotFather: `/setmenubutton` → URL `https://<домен>/` (кнопка меню бота), плюс кнопка в `/start` появится сама.
6. Проверка: открыть Mini App из бота, увидеть баланс, пополнить, увидеть транзакцию в истории.

- [ ] **Step 1:** дописать DEPLOY.md, commit `docs: phase-2 deploy (domain, caddy, botfather)`.

---

## Definition of Done (Фаза 2)

- Все тесты `services/core` зелёные (включая webapp-auth и api).
- `docker compose build` собирает caddy (со статикой miniapp) и core.
- На проде: Mini App открывается из бота по HTTPS, показывает баланс/историю, пополнение открывает оплату Robokassa, после оплаты баланс в Mini App обновляется.
