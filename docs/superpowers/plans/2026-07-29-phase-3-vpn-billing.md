# 404VPN — Фаза 3: активация кода, WireGuard, посуточный биллинг

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Код доступа превращается в работающий VPN: приложение активирует код → получает токен устройства → получает параметры туннеля WireGuard → подключается. Баланс списывается посуточно, при нуле доступ приостанавливается, при пополнении восстанавливается.

**Architecture:** Всё в существующем `services/core` (Node). FastAPI не вводится — второй рантайм дублировал бы модели и миграции без выигрыша. Пиры WireGuard провижинятся через **API wg-easy**, который уже развёрнут на NL-сервере (решение владельца 2026-07-29): ключи генерирует сервер, приложение получает готовый туннель по HTTPS. Доступ к wg-easy — только по локальному адресу сервера, наружу не открывается.

**Tech Stack:** тот же (Node 20, express 5, pg, BullMQ, vitest 2) + драйвер wg-easy поверх интерфейса `WgProvider`.

## Global Constraints

- Все ограничения фаз 1–2 действуют (деньги в копейках, секреты в `.env`, тесты + коммит на задачу).
- Аутентификация iOS-приложения — **токен устройства**: 32 случайных байта, в базе только SHA-256 хэш, в запросах `Authorization: Bearer <token>`. Токен выдаётся при активации кода, живёт в Keychain на устройстве.
- Mini App продолжает жить на `initData`; два способа аутентификации не смешиваются, каждый в своём middleware.
- Любое обращение к wg-easy — через интерфейс `WgProvider`, чтобы драйвер можно было заменить, не трогая бизнес-логику. В тестах — `FakeWgProvider`.
- Списание денег и изменение статуса — только внутри транзакции и только через `applyBalanceChange` (ledger — единственный источник правды по балансу).
- Новые env: `WG_EASY_URL` (например `http://host.docker.internal:51821`), `WG_EASY_PASSWORD`, `WG_ENDPOINT_HOST` (публичный адрес сервера для поля Endpoint).

---

### Task 1: Схема — токены устройств и привязка к wg-easy

**Files:** Create `db/migrations/002_devices_tokens.sql`

Миграция:

```sql
ALTER TABLE devices
  ADD COLUMN token_hash text UNIQUE,
  ADD COLUMN platform text NOT NULL DEFAULT 'ios',
  ADD COLUMN wg_client_id text,
  ADD COLUMN revoked_at timestamptz;

-- публичный ключ появляется позже момента создания устройства (при выдаче туннеля)
ALTER TABLE devices ALTER COLUMN wg_public_key DROP NOT NULL;

CREATE INDEX idx_devices_active ON devices(user_id) WHERE is_active;

INSERT INTO settings(key, value) VALUES ('max_devices_default', '5')
  ON CONFLICT (key) DO NOTHING;
```

- [x] **Step 1:** написать миграцию, применить `./db/migrate.sh`, проверить `\d devices`.
- [x] **Step 2:** commit `feat(db): device tokens, wg client binding`.

### Task 2: Токены устройств

**Files:** Create `services/core/src/device-auth.ts`, `services/core/tests/device-auth.test.ts`

**Interfaces:**
- `generateDeviceToken(): string` — 32 байта, base64url.
- `hashToken(token: string): string` — sha256 hex.
- `deviceAuth(db): express.RequestHandler` — читает `Authorization: Bearer`, находит устройство по хэшу (`revoked_at IS NULL`), кладёт `req.device = { id, userId }`, иначе 401.

- [x] **Step 1:** тесты: токен ≥ 43 символов и уникален на 1000 генераций; хэш детерминирован; middleware даёт 401 без заголовка, с мусорным токеном и с отозванным устройством; пропускает валидный.
- [x] **Step 2:** реализация. **Step 3:** тесты зелёные. **Step 4:** commit.

### Task 3: Активация кода (`POST /api/redeem`)

**Files:** Modify `services/core/src/api.ts` (или новый `src/device-api.ts`), Create `services/core/tests/redeem.test.ts`

Контракт (без авторизации — код и есть секрет; rate limit по IP):

```
POST /api/redeem  { code: "XXXX-XXXX-XXXX-XXXX", deviceName?: string }
→ 200 { token, balance, daysLeft }
→ 400 { error: "invalid_code" | "already_used" | "expired" | "revoked" }
→ 429 при превышении лимита попыток
```

Логика в одной транзакции: нормализовать код → найти по `code_hash` c `FOR UPDATE` → проверить `status='issued'` и `expires_at > now()` → создать `users` (если у кода ещё нет владельца) → `applyBalanceChange(type='code_redeem', amount=access_codes.amount)` → пометить код `redeemed` + `redeemed_by`/`redeemed_at` → создать `devices` с токеном → вернуть токен. Повторная активация того же кода → `already_used`.

Rate limit: in-memory окно (5 попыток / 60 сек на IP) — достаточно для MVP, при росте вынести в Redis.

- [x] **Step 1:** тесты: успешная активация начисляет баланс и отдаёт токен; повторная активация → `already_used`; несуществующий код → `invalid_code`; протухший → `expired`; отозванный → `revoked`; 6-я попытка подряд → 429; регистр и дефисы в коде не важны.
- [x] **Step 2:** реализация. **Step 3:** тесты. **Step 4:** commit.

### Task 4: Провайдер WireGuard (интерфейс + fake + драйвер wg-easy)

**Files:** Create `services/core/src/wg/provider.ts`, `src/wg/wg-easy.ts`, `src/wg/fake.ts`, `tests/wg-easy.test.ts`

**Interfaces:**

```ts
export interface TunnelConfig {
  privateKey: string;
  address: string;              // 10.8.0.5/24
  dns: string[];
  peer: {
    publicKey: string;
    presharedKey?: string;
    endpoint: string;           // host:51820
    allowedIps: string[];
    persistentKeepalive?: number;
  };
}
export interface WgProvider {
  createClient(name: string): Promise<{ clientId: string; publicKey: string; tunnel: TunnelConfig }>;
  deleteClient(clientId: string): Promise<void>;
  setEnabled(clientId: string, enabled: boolean): Promise<void>;
  listClients(): Promise<{ clientId: string; name: string; enabled: boolean }[]>;
}
```

Драйвер wg-easy: авторизация паролем (сессионная кука), создание клиента, получение его `.conf`, парсинг `.conf` в `TunnelConfig`. Точные пути API зависят от версии wg-easy — **уточнить перед реализацией** (`docker inspect wg-easy --format '{{.Config.Image}}'`).

Парсер `.conf` тестируется отдельно и без сети — это чистая функция.

- [x] **Step 1:** тесты парсера `.conf` → `TunnelConfig` (включая `Address` с маской, несколько DNS, `AllowedIPs` с IPv6).
- [x] **Step 2:** `FakeWgProvider` для тестов бизнес-логики (счётчики вызовов, детерминированные ключи).
- [x] **Step 3:** драйвер wg-easy (сеть). **Step 4:** commit.

### Task 5: API устройства (туннель, статус, отвязка)

**Files:** Modify `services/core/src/device-api.ts`, Create `tests/device-api.test.ts`

За `deviceAuth`:

```
GET    /api/device/me      → { balance, daysLeft, devices, status, deviceName }
POST   /api/device/tunnel  → TunnelConfig  (провижинит клиента в wg-easy при первом вызове, потом отдаёт сохранённый)
DELETE /api/device         → отзывает устройство: удаляет клиента в wg-easy, revoked_at=now(), освобождает слот
```

Правила: если `users.status = 'suspended'` → `POST /api/device/tunnel` возвращает 402 с `{ error: "suspended" }` (не выдаём туннель без денег). Лимит устройств — `users.max_devices`, при превышении 409 `{ error: "device_limit" }`.

- [x] **Step 1:** тесты с `FakeWgProvider`: первый вызов туннеля провижинит и сохраняет `wg_client_id`/`wg_public_key`; повторный не создаёт второго клиента; при `suspended` → 402; сверх лимита → 409; DELETE удаляет клиента и освобождает слот.
- [x] **Step 2:** реализация. **Step 3:** тесты. **Step 4:** commit.

### Task 6: Посуточный биллинг и приостановка

**Files:** Create `services/core/src/billing.ts`, `tests/billing.test.ts`; Modify `src/index.ts` (планировщик)

**Interfaces:**
- `chargeDailyOnce(db, wg, nowDate): Promise<{ charged: number; suspended: number }>` — идемпотентно за календарный день.
- `remindLowBalanceOnce(db, nowDate): Promise<number>`
- `reactivate(db, wg, userId): Promise<void>` — вызывается после пополнения и после активации кода.

Логика списания на пользователя (в транзакции, `SELECT ... FOR UPDATE`):
`active_devices = count(devices where is_active and revoked_at is null)`; если 0 — пропускаем (баланс не тает). Иначе `daily = round(device_monthly_price*100/30)*devices` копеек; `applyBalanceChange(-daily, 'daily_charge', {devices})`; `last_charged_at = current_date`. Если новый баланс ≤ 0 → `status='suspended'`, `wg.setEnabled(clientId, false)` для всех устройств, строка в `notification_outbox` с `suspended`.

Догон пропущенных дней: списываем за каждый день от `last_charged_at` до сегодня (но не больше 31 за прогон, чтобы сбой планировщика не съел баланс залпом).

Напоминание: `daysLeft <= reminder_threshold_days` и `last_reminder_sent_at` не сегодня → outbox `low_balance`, отметить дату.

Реактивация: баланс > 0 и `status='suspended'` → `status='active'` + `setEnabled(true)` всем устройствам.

Планировщик: в `index.ts` — проверка раз в час, выполняем, только если `last_charged_at` пользователя < сегодня (сама функция идемпотентна, поэтому частота безопасна).

- [x] **Step 1:** тесты: списание за сутки уменьшает баланс на `цена/30 × устройства`; повторный вызов в тот же день ничего не делает; 0 устройств — без списания; уход в ноль → `suspended` + `setEnabled(false)` + outbox; догон за 3 пропущенных дня списывает трижды; напоминание не чаще раза в сутки; пополнение реактивирует и включает пиры.
- [x] **Step 2:** реализация. **Step 3:** тесты. **Step 4:** commit.

### Task 7: Интеграция реактивации в платёжный поток

**Files:** Modify `services/core/src/payments.ts`, `src/api.ts`

После успешного зачисления (`processSuccessfulPayment` → ветка `credited`) и после `redeem` — вызвать `reactivate`. В `payments.ts` провайдер прокидывается параметром, чтобы модуль оставался тестируемым.

- [x] **Step 1:** тест: пользователь в `suspended` с балансом 0 → оплата 300 ₽ → статус `active`, `setEnabled(true)` вызван.
- [x] **Step 2:** реализация. **Step 3:** тесты. **Step 4:** commit.

### Task 8: Деплой фазы 3

**Files:** Modify `docker-compose.yml` (`extra_hosts: host.docker.internal:host-gateway` для core), `.env.example`, `docs/DEPLOY.md`

- [x] **Step 1:** переменные `WG_EASY_URL`, `WG_EASY_PASSWORD`, `WG_ENDPOINT_HOST`; раздел в DEPLOY.md: применить миграцию 002, проверить доступность wg-easy из контейнера core, тест активации кода через `curl`.
- [x] **Step 2:** commit.

---

## Definition of Done (Фаза 3)

- `npx vitest run` зелёный (фазы 1–3).
- На проде: код из бота активируется запросом `POST /api/redeem`, возвращает токен; `POST /api/device/tunnel` отдаёт валидный конфиг WireGuard; клиент появляется в панели wg-easy; при обнулении баланса пир отключается, при пополнении включается обратно.

## Следующая фаза

**Фаза 4 — iOS-приложение:** NetworkExtension + WireGuardKit, экран ввода кода, экран подключения по `docs/DESIGN.md`. Prerequisite: Apple Developer Program. Фаза 5 — админка.

---

## Статус: выполнено 2026-07-29 (все 8 задач, 87 тестов зелёные)

Версия wg-easy подтверждена владельцем: **v14** — драйвер написан под её REST API
(`POST /api/session` → cookie, CRUD по `/api/wireguard/client`, `.conf` по `/configuration`).

Отклонения от плана по факту исполнения:

- `WgProvider` получил метод `getTunnel(clientId)`: приватный ключ пользователя **не сохраняется**
  в нашей БД, конфиг перезапрашивается у wg-easy при каждом обращении.
- Добавлены `NullWgProvider` и `WgNotConfiguredError`: без `WG_EASY_URL`/`WG_EASY_PASSWORD` сервис
  стартует, бот и платежи работают, а `/api/device/tunnel` честно отвечает 503. Иначе выкатка
  фазы 3 роняла бы работающий прод при незаполненном `.env`.
- Проверка лимита устройств (409 `device_limit`) не реализована: устройство создаётся один раз при
  активации кода, эндпоинта добавления второго устройства пока нет — проверка не могла бы сработать.
  Вернуть вместе с мультидевайсом.
- Реактивация вызывается из вебхука оплаты, но её сбой не приводит к ошибке ответа Robokassa;
  подстраховка — `reactivateEligible` в почасовом планировщике.
- `settings.ts` вынесен как общий помощник (`getSetting`) вместо дублирования в трёх модулях.
- `app.set("trust proxy", true)` — за Caddy иначе rate limit на `/api/redeem` считался бы по адресу
  прокси, то есть был бы общим для всех.

Не проверено (требует прода с wg-easy): реальный вызов API wg-easy v14, формат его `.conf`
на живом сервере, фактическое подключение устройства к туннелю.
