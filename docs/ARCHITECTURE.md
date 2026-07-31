# 404VPN — архитектура сервиса

VPN-сервис для iOS на базе WireGuard (сервер в Нидерландах). Доступ по уникальным кодам, Telegram-бот для пополнения баланса и получения кодов, административная панель, платежи через Robokassa (продавец — ИП, кабинет и магазин созданы).

Биллинговая модель: **баланс с посуточным списанием**, а не фиксированные тарифы-сроки.

## Компоненты

```
┌──────────────┐    ┌──────────────────────────┐    ┌─────────────────┐
│  iOS App     │◄──►│  Backend (FastAPI+Node)  │◄──►│  Admin (React)  │
└──────────────┘    │                          │    └─────────────────┘
                    │  - Balance/Billing       │
┌──────────────┐    │  - Orders/Payments       │
│ TG Mini App  │◄──►│  - Access codes          │
│ (React)      │    │  - Mini App API          │
├──────────────┤    │  - Notifications         │
│  TG Bot      │◄──►│  - Broadcast scheduler   │
│  (Node.js,   │    │  (BullMQ + Redis)        │
│  Telegraf,   │    └──────────┬───────────────┘
│  polling)    │               │
└──────────────┘    ┌──────────▼───────────────┐
                    │  Robokassa               │
                    └──────────────────────────┘
```

Границы ответственности двух бэкенд-сервисов (общая БД Supabase, но у каждой таблицы один сервис-владелец на запись):

| Сервис | Владеет |
|---|---|
| **Node.js** | Telegram-бот, API для Mini App (auth по `initData`), вебхук Robokassa, создание заказов, зачисление баланса, генерация кодов, очереди BullMQ, отправка уведомлений/рассылок |
| **FastAPI** | API для iOS (redeem, устройства, статус), WireGuard-провижининг, суточный биллинг-крон, admin API |

Деньги **входят** через Node (оплата → баланс), **тратятся** через FastAPI (списания → отключение). Оба пишут в `balance_transactions` — конкурентность решается транзакцией с блокировкой строки `users` (`SELECT ... FOR UPDATE`).

## 1. Биллинговая модель

- Цена устройства: **100 ₽/месяц**, хранится в `settings.device_monthly_price`, меняется в админке.
- Суточная ставка: `daily_rate = device_monthly_price / 30` (списание с точностью 2 знака).
- Раз в сутки биллинг-крон списывает `active_devices × daily_rate` с баланса каждого активного пользователя.
- Остаток дней (показывается в приложении и боте): `floor(balance / (active_devices × daily_rate))`.
- 0 устройств → списаний нет, баланс не тает.
- Идемпотентность крона: `users.last_charged_at` (date); списание — `UPDATE ... WHERE last_charged_at < current_date`. Если крон не работал N дней — досписывает за пропущенные дни при следующем запуске.
- **Доступ всегда следует за балансом.** Единственная функция `syncAccess` приводит аккаунт в нужное состояние: баланс больше нуля → `active` и пиры включены, ноль и меньше → `suspended` и пиры выключены в wg-easy. Её вызывают все пути, меняющие деньги: суточное списание, оплата, ручная правка баланса в админке, плюс почасовой проход `syncAllAccess` по всем расхождениям (подстраховка, если wg-easy был недоступен). Уведомление `suspended` ставится только на переходе, поэтому почасовой проход не спамит.
- Блокировка админом (`blocked`) сильнее баланса: пиры выключены, пополнение статус не меняет.
- За `reminder_threshold_days` (настройка, по умолчанию 3) дней до нуля — уведомление `low_balance` (не чаще раза в сутки, флаг `last_reminder_sent_at`).
- Каждое движение денег — строка в ledger `balance_transactions` (пополнение, суточное списание, активация кода, ручная корректировка админом, возврат). Баланс всегда сверяем по ledger.

## 2. Пополнение и коды доступа

**Оплата всегда зачисляется на аккаунт.** При первой покупке аккаунт создаётся и сразу связывается с telegram-пользователем, дальше пополнения идут на тот же баланс. Код в чат не приходит.

**Код доступа — ключ привязки устройства, а не чек об оплате.** Выпускается по кнопке в Mini App в любой момент: при установке приложения, на втором устройстве, после переустановки. Живёт `settings.device_code_ttl_minutes` (по умолчанию 30 минут), привязывает одно устройство и баланса не касается. Выпуск нового кода отзывает предыдущий невостребованный — валиден всегда ровно один.

Это решает тупик прежней схемы: раньше код выдавался только при оплате «нового» пользователя, и после отвязки последнего устройства аккаунт с деньгами становился недоступен навсегда.

Требования к кодам:

- Формат: 16 символов Crockford Base32 (без похожих символов), ~80 бит энтропии, группами `XXXX-XXXX-XXXX-XXXX`.
- В базе только SHA-256 хэш, сам код существует лишь в ответе API.
- Одноразовый (`issued → redeemed`), проверка лимита `users.max_devices` при активации.
- `/api/redeem` — rate limit 5 попыток в минуту на адрес; код в query-строке не передаётся.
- Админ может сгенерировать код с номиналом вручную (промо) — такой код без `user_id` создаёт новый аккаунт и зачисляет сумму.

**Ограничение App Store (guideline 3.1.1):** в iOS-приложении нет ни кнопок покупки, ни ссылок на бота — только поле ввода кода. Вся продажа живёт в Telegram. VPN — только через NetworkExtension, честная декларация данных (guideline 5.4).

## 2а. Реферальная программа

Код принадлежит **telegram-аккаунту**, а не VPN-аккаунту: пригласить может любой, у кого есть чат с ботом, ещё до первой оплаты. Ссылка — обычный deep link `t.me/<bot>?start=ref_<КОД>`; имя бота бэкенд узнаёт у Telegram при старте и кладёт в `settings.bot_username`.

Три начисления, все настраиваются в админке и все проходят через ledger:

- `referral_invitee_bonus` (50 ₽) — пришедшему по ссылке, сразу при переходе; ради этого ему тут же заводится аккаунт.
- `referral_inviter_bonus` (30 ₽) — пригласившему, в тот же момент.
- `referral_commission_percent` (20%) — пригласившему с **каждого** пополнения его реферала, в одной транзакции с самим платежом.

Защиты от накрутки: нельзя пригласить самого себя, нельзя быть приглашённым дважды (`telegram_users.referred_by` заполняется один раз), уникальный индекс не даёт задвоить бонус за присоединение. Начисление до первой оплаты остаётся принципиально уязвимым к массовой регистрации telegram-аккаунтов — если это начнут эксплуатировать, бонусы за присоединение ставятся в 0, а процент с пополнений остаётся.

Журнал `referral_rewards` хранит, кто, кому, за что и сколько начислил; комиссия ссылается на конкретный `payment_order`.

Каждое начисление сопровождается уведомлением: рефералу — `referral_bonus`, пригласившему — `referral_joined` и `referral_commission`.

## 2б. Удаление аккаунта

Админ может удалить аккаунт: пиры снимаются с wg-easy, устройства и журнал баланса удаляются, telegram-профиль отвязывается и **очищается от реферальной привязки** — после этого человек снова считается новым и может прийти по чужой ссылке. Собственный реферальный код профиля сохраняется, чтобы уже розданные им ссылки не сломались. Платежи остаются в отчётности с обнулённым `user_id`.

## 3. Интеграция Robokassa

Продавец — ИП ⇒ фискализация по 54-ФЗ обязательна и закладывается с первого дня: используем облачное фискальное решение Robokassa, параметр `Receipt` передаётся при создании платежа и **участвует в расчёте `SignatureValue`** (добавить его позже без переделки подписи нельзя).

Правила обработки:

- Активация/зачисление — **только по ResultURL** (подпись с `Password2`). `SuccessURL`/`FailURL` — чистый UI-редирект, никакой бизнес-логики.
- Проверки на каждый колбэк ResultURL, в этом порядке:
  1. MD5-подпись с `Password2` (+ `Shp_`-параметры, если используются);
  2. `InvId` соответствует существующему `payment_order` в статусе `pending`;
  3. `OutSum` равен `payment_orders.amount` этого заказа;
  4. атомарный переход `UPDATE payment_orders SET status='success' WHERE id=... AND status='pending'` — повторный колбэк (ретрай Robokassa) не создаст второй код и не зачислит баланс дважды; `external_order_id` под unique-констрейнтом `(provider, external_order_id)`.
- Ответ строго `OK{InvId}` — иначе Robokassa ретраит.
- Домена нет: ResultURL указывает на публичный IP сервера №2 (`http(s)://<IP>/payhook/robokassa/result`). MD5-подпись защищает целостность колбэка и без TLS; для HTTPS без домена можно выпустить бесплатный сертификат Let's Encrypt на IP-адрес (короткоживущий, с автопродлением) — для API iOS-приложения TLS в проде обязателен (требование ATS).
- Неуспешная оплата → шаблон `payment_failed` с кнопкой «Попробовать снова» (новый `payment_order`).
- Тестирование через `IsTest=1` с отдельными тестовыми паролями.

## 4. Схема БД

```sql
users (
  id uuid pk,
  balance numeric(10,2) default 0,
  status text default 'active',       -- active / suspended / blocked
  max_devices int default 5,
  last_charged_at date,
  last_reminder_sent_at timestamptz,
  created_at timestamptz
)

devices (
  id uuid pk,
  user_id uuid fk -> users.id,
  name text,
  wg_public_key text unique,          -- приватный ключ генерируется на устройстве и не покидает его
  wg_ip inet,
  is_active boolean default true,
  created_at timestamptz, last_seen_at timestamptz
)

access_codes (
  id uuid pk,
  code_hash text unique,              -- храним хэш, не сам код
  amount numeric(10,2),               -- номинал в рублях
  status text default 'issued',       -- issued / redeemed / expired / revoked
  expires_at timestamptz,
  redeemed_by uuid fk -> users.id,
  redeemed_at timestamptz,
  created_by uuid,                    -- админ, если сгенерирован вручную
  created_at timestamptz
)

payment_orders (
  id uuid pk,
  provider text default 'robokassa',
  external_order_id text,             -- unique (provider, external_order_id)
  telegram_user_id uuid fk nullable,
  user_id uuid fk nullable,           -- заполнен для привязанных пользователей
  amount numeric(10,2),
  status text,                        -- pending / success / failed
  access_code_id uuid fk nullable,    -- только для пути «новый пользователь»
  created_at timestamptz, paid_at timestamptz
)

balance_transactions (
  id uuid pk,
  user_id uuid fk -> users.id,
  type text,                          -- topup / daily_charge / code_redeem / admin_adjust / refund
  amount numeric(10,2),               -- со знаком: пополнение +, списание -
  balance_after numeric(10,2),
  meta jsonb,                         -- {order_id | code_id | admin_id | devices_count}
  created_at timestamptz
)

topup_presets (                        -- кнопки сумм в боте, CRUD в админке
  id uuid pk, amount numeric(10,2), title text,
  is_active boolean, sort_order int
)

settings (                             -- key-value, редактируется в админке
  key text pk, value jsonb, updated_at timestamptz
  -- device_monthly_price: 100, min_topup: 100, reminder_threshold_days: 3
)

telegram_users (
  id uuid pk,
  telegram_id bigint unique, chat_id bigint, username text,
  user_id uuid fk nullable,           -- метка «основной аккаунт»; история покупок — через payment_orders
  is_blocked_bot boolean default false,
  first_seen_at timestamptz, last_interaction_at timestamptz
)

notification_templates (
  key text pk,                        -- payment_success / payment_failed / low_balance / suspended / welcome
  text_template text,                 -- переменные: {{balance}}, {{days_left}}, {{code}}, {{amount}}
  enabled boolean default true, updated_at timestamptz
)

broadcasts (
  id uuid pk, title text, message_text text,
  target_filter jsonb,                -- {"status":"active"} / {"all":true} / {"days_left_lte":3}
  scheduled_at timestamptz,
  status text,                        -- draft / scheduled / sending / sent / failed
  sent_count int default 0, failed_count int default 0,
  created_by uuid, created_at timestamptz
)

notification_outbox (                  -- транзакционные уведомления из FastAPI к Node
  id uuid pk, telegram_user_id uuid, template_key text,
  payload jsonb, status text default 'pending', created_at timestamptz
)
```

Связь «кто что купил» идёт через `payment_orders` и `access_codes.redeemed_by`, а не через жёсткую 1:1 связь `telegram_users.user_id` — один TG-аккаунт может покупать коды для разных людей.

## 5. WireGuard-провижининг

На NL-сервере — лёгкий HTTP-агент (свой, ~100 строк, или wg-easy API):

- Эндпоинты: `POST /peers` (public key + allowed IP), `DELETE /peers/{pubkey}`, `GET /peers` (для сверки).
- Аутентификация: длинный токен + allowlist IP бэкенда (или mTLS).
- Ключи: пара генерируется **на устройстве**, на сервер передаётся только публичный ключ. Готовые конфиги с приватными ключами сервер не раздаёт.
- Suspension = удаление peer'ов; возобновление = повторное добавление по сохранённым публичным ключам.
- Раз в сутки — сверка: список peer'ов на сервере == активные `devices` активных пользователей.

## 6. Telegram: Mini App + бот

Основной интерфейс в Telegram — **Mini App** (Telegram Web App): React-приложение в дизайн-токенах студии (см. `docs/DESIGN.md`), открывается кнопкой у бота.

**Mini App (экраны):**

- Главная: баланс, остаток дней, число устройств, кнопка «Пополнить».
- Пополнение: пресеты из `topup_presets` + произвольная сумма (минимум `settings.min_topup`) → создание `payment_order` → открытие платёжной ссылки Robokassa (`Telegram.WebApp.openLink`).
- Код активации: после первой оплаты — экран с кодом (моноширинно, кнопка «Скопировать»).
- Устройства: список, удаление (снятие peer'а, освобождение слота).
- История: `balance_transactions` пользователя.

**Аутентификация Mini App:** каждый запрос к API несёт `initData`; бэкенд валидирует HMAC-SHA256-подпись строкой бота (`hash` + свежесть `auth_date`, окно 24 ч). Запросы без валидной подписи отклоняются — `initData` нельзя подделать без токена бота.

**Требование Telegram:** Mini App открывается только по **HTTPS-URL**. Без домена: статика Mini App — на бесплатном хостинге с HTTPS (Cloudflare Pages / GitHub Pages), API — на IP сервера №2 с Let's Encrypt IP-сертификатом + CORS. С доменом всё проще (одна точка). Решение — за владельцем.

**Бот (остаётся для):**

- Точка входа: `/start` → приветствие + кнопка `web_app` «Открыть 404VPN».
- Все уведомления (оплата, low_balance, suspended) и рассылки — сообщениями в чат.
- Fallback-команды `/balance`, `/devices` для тех, у кого Mini App недоступен.
- Режим **long polling** — вебхук для бота не нужен. Запускается ровно один инстанс (иначе Telegram вернёт конфликт `getUpdates`).
- Уведомления шлются без `parse_mode` (plain text) — нечему ломаться на спецсимволах; код активации — отдельным сообщением в MarkdownV2-monospace.

## 7. Уведомления и рассылки

- Очередь BullMQ + Redis, троттлинг под лимиты Telegram (~30 msg/сек суммарно, 1 msg/сек на чат).
- Рассылки: админ задаёт текст, `target_filter`, `scheduled_at`. Воркер разворачивает получателей в задачи с **детерминированными `jobId` = `{broadcast_id}:{telegram_id}`** — повторная постановка после падения/рестарта идемпотентна, дублей и потерянных хвостов нет.
- `is_blocked_bot = true` — пропуск без траты лимита; ошибка блокировки при отправке — выставление флага.
- Транзакционные уведомления из FastAPI (списание, suspended, low_balance) — через `notification_outbox`: FastAPI пишет строку в той же транзакции, что и бизнес-операцию, Node-воркер забирает и отправляет.

## 8. Админка (React)

- **Настройки**: цена устройства/мес, мин. пополнение, порог напоминания.
- **Пресеты пополнения**: CRUD.
- **Пользователи**: баланс, остаток дней, устройства, статус; ручная корректировка баланса (тип `admin_adjust`, всегда через ledger), блокировка.
- **Коды**: генерация с номиналом, список со статусами, отзыв (`revoked`).
- **Транзакции**: `payment_orders` + `balance_transactions` с фильтрами.
- **Шаблоны уведомлений**: редактор с переменными и live-превью.
- **Рассылки**: композер, аудитория, расписание, статистика sent/failed/blocked.
- **Пользователи бота**: `telegram_users` со связкой и блокировкой.

## 9. Развёртывание с нуля

Ничего, кроме двух серверов, нет — поднимаем так:

**Сервер №2 (бэкенд):** Docker + docker compose. Стек: `postgres:16` (вместо облачного Supabase — это тот же Postgres; при желании позже переключаемся на Supabase заменой `DATABASE_URL`), `redis:7`, сервис Node.js, сервис FastAPI, статика админки. Секреты — в `.env` на сервере, в git не попадают.

**Сервер №1 (NL, WireGuard):** уже работает; добавляется только wg-агент (раздел 5), API агента закрыт firewall'ом — доступ только с IP сервера №2.

**Prerequisites, которые нужно оформить:**

- Аккаунт **Apple Developer Program** ($99/год) — без него не получить entitlement NetworkExtension, не собрать VPN на устройство и не выложить в App Store/TestFlight. Нужен к этапу iOS-приложения; бэкенд и бот делаются без него.
- Токен бота у @BotFather.
- Реквизиты Robokassa (MerchantLogin, Password1/Password2 боевые и тестовые) — уже есть.

## Принятые решения

- Universal Links не используются: активация кода — только ручной ввод; бот — long polling; ResultURL — по IP.
- В Telegram — Mini App (React) как основной интерфейс + бот для уведомлений. Решено (2026-07-29): **покупается домен**; Mini App-статика и API живут на одном домене за Caddy (автоматический Let's Encrypt), A-запись → NL-сервер. План: `docs/superpowers/plans/2026-07-29-phase-2-miniapp.md`.
- Минимальная сумма пополнения — 100 ₽ (настройка `min_topup`).
- При 0 устройств баланс не списывается.
- Цена устройства — 100 ₽/мес (настройка `device_monthly_price`).
