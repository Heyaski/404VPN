# 404VPN MVP — Фаза 1: фундамент и платёжный контур

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работающий платёжный контур: Postgres+Redis в Docker, Node.js-сервис с ботом (long polling), интеграцией Robokassa (подпись, идемпотентный ResultURL, Receipt/54-ФЗ), кодами доступа, журналом баланса и очередью уведомлений.

**Architecture:** Спецификация — `docs/ARCHITECTURE.md` (читать перед началом). Один Node.js-сервис `services/core` (TypeScript): express-приложение для вебхука Robokassa, Telegraf-бот в long polling, BullMQ-воркер уведомлений через outbox-таблицу. БД Postgres 16 + Redis 7 через docker compose.

**Tech Stack:** Node.js ≥20, TypeScript 5, Telegraf 4, BullMQ 5, pg 8, express 4, zod 3, vitest (тесты), tsx (dev-запуск). Postgres 16, Redis 7.

## Global Constraints

- Деньги: в БД `numeric(10,2)`; в JS никакой float-арифметики без округления — сложение только через целые копейки (`Math.round(x*100)`), запись через `.toFixed(2)`.
- Все таблицы/колонки — snake_case, id — uuid (`gen_random_uuid()`), исключение: `payment_orders.id` — integer identity (используется как `InvId` Robokassa, который обязан быть int).
- Секреты только через `.env` (в `.gitignore`), обязательные переменные валидируются zod'ом на старте — сервис падает сразу, а не в рантайме.
- Сообщения бота — без `parse_mode`, кроме кода активации (MarkdownV2, код в backticks).
- Каждая задача заканчивается зелёными тестами и коммитом.
- Фазы 2–5 — отдельные планы: Mini App (React + initData auth), FastAPI (iOS API + биллинг-крон + wg-агент), админка React, iOS-приложение. Дизайн любых UI — по `docs/DESIGN.md`.

---

### Task 1: Каркас репозитория и инфраструктура

**Files:**
- Create: `.gitignore`, `README.md`, `docker-compose.yml`, `.env.example`, `db/migrate.sh`, `db/migrations/001_init.sql`

**Interfaces:**
- Produces: схема БД целиком (все таблицы из `docs/ARCHITECTURE.md` §4 + `schema_migrations`), сиды `settings`/`topup_presets`/`notification_templates`. Контейнеры `postgres` (127.0.0.1:5432, db/user `vpn`) и `redis` (127.0.0.1:6379).

- [ ] **Step 1: .gitignore и README**

`.gitignore`:
```gitignore
.env
node_modules/
dist/
graphify-out/
.DS_Store
xcuserdata/
*.xcuserstate
```

`README.md`: одна строка названия + ссылки на `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, этот план.

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vpn
      POSTGRES_USER: vpn
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vpn -d vpn"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    restart: unless-stopped
volumes:
  pgdata:
  redisdata:
```

`.env.example`:
```bash
POSTGRES_PASSWORD=change_me
DATABASE_URL=postgres://vpn:change_me@127.0.0.1:5432/vpn
REDIS_URL=redis://127.0.0.1:6379
BOT_TOKEN=0000000000:get_from_botfather
ROBOKASSA_LOGIN=your_merchant_login
ROBOKASSA_PASSWORD1=xxx
ROBOKASSA_PASSWORD2=xxx
ROBOKASSA_TEST=1
PORT=8080
```

- [ ] **Step 3: миграция 001_init.sql**

Полная схема из `docs/ARCHITECTURE.md` §4 (та — источник истины; ниже — готовый SQL):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','blocked')),
  max_devices int NOT NULL DEFAULT 5,
  last_charged_at date,
  last_reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  wg_public_key text NOT NULL UNIQUE,
  wg_ip inet,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE telegram_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL UNIQUE,
  chat_id bigint NOT NULL,
  username text,
  user_id uuid REFERENCES users(id),
  is_blocked_bot boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_interaction_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','expired','revoked')),
  expires_at timestamptz NOT NULL,
  redeemed_by uuid REFERENCES users(id),
  redeemed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- InvId для Robokassa
  provider text NOT NULL DEFAULT 'robokassa',
  external_order_id text,
  telegram_user_id uuid REFERENCES telegram_users(id),
  user_id uuid REFERENCES users(id),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  access_code_id uuid REFERENCES access_codes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (provider, external_order_id)
);

CREATE TABLE balance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('topup','daily_charge','code_redeem','admin_adjust','refund')),
  amount numeric(10,2) NOT NULL,
  balance_after numeric(10,2) NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_balance_tx_user ON balance_transactions(user_id, created_at DESC);

CREATE TABLE topup_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(10,2) NOT NULL,
  title text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_templates (
  key text PRIMARY KEY,
  text_template text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message_text text NOT NULL,
  target_filter jsonb NOT NULL DEFAULT '{"all":true}',
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id uuid NOT NULL REFERENCES telegram_users(id),
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON notification_outbox(status) WHERE status = 'pending';

INSERT INTO settings(key, value) VALUES
  ('device_monthly_price', '100'),
  ('min_topup', '100'),
  ('reminder_threshold_days', '3');

INSERT INTO topup_presets(amount, title, sort_order) VALUES
  (100, '100 ₽', 1), (300, '300 ₽', 2), (600, '600 ₽', 3), (1200, '1200 ₽', 4);

INSERT INTO notification_templates(key, text_template) VALUES
  ('welcome', 'Привет! Это 404VPN. Открой приложение кнопкой ниже или выбери сумму пополнения.'),
  ('payment_success', 'Оплата {{amount}} ₽ получена. Баланс: {{balance}} ₽ (примерно {{days_left}} дн.)'),
  ('payment_success_code', 'Оплата {{amount}} ₽ получена. Код активации пришлю следующим сообщением — введи его в приложении 404VPN.'),
  ('payment_failed', 'Оплата не прошла. Нажми «Пополнить», чтобы попробовать ещё раз.'),
  ('low_balance', 'Баланс заканчивается: осталось примерно {{days_left}} дн. Пополни, чтобы VPN не отключился.'),
  ('suspended', 'Баланс исчерпан, доступ приостановлен. Пополни баланс — устройства подключатся снова.');
```

`db/migrate.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
dir="$(cd "$(dirname "$0")" && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in "$dir"/migrations/*.sql; do
  name="$(basename "$f")"
  if [ -z "$(psql "$DATABASE_URL" -Atc "SELECT 1 FROM schema_migrations WHERE filename='$name'")" ]; then
    echo "applying $name"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" -c "INSERT INTO schema_migrations(filename) VALUES ('$name')"
  else
    echo "skip $name (applied)"
  fi
done
echo "migrations up to date"
```

- [ ] **Step 4: проверить синтаксис**

Run: `docker compose config -q && bash -n db/migrate.sh && chmod +x db/migrate.sh`
Expected: без вывода, код 0.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md docker-compose.yml .env.example db/
git commit -m "feat: repo scaffold, docker compose (postgres+redis), full DB schema with seeds"
```

### Task 2: Поднять инфраструктуру и применить миграции

**Files:** нет новых (используется Task 1).

- [ ] **Step 1: создать .env из примера** (локально; пароль любой непустой)

Run: `[ -f .env ] || sed 's/change_me/vpn_dev_password/' .env.example > .env`

- [ ] **Step 2: поднять контейнеры**

Run: `set -a; . ./.env; set +a; docker compose up -d --wait postgres redis`
Expected: оба контейнера healthy/running.

- [ ] **Step 3: применить миграции**

Run: `set -a; . ./.env; set +a; ./db/migrate.sh`
Expected: `applying 001_init.sql` … `migrations up to date`.

- [ ] **Step 4: проверить схему и сиды**

Run: `set -a; . ./.env; set +a; psql "$DATABASE_URL" -Atc "SELECT count(*) FROM notification_templates" && psql "$DATABASE_URL" -Atc "SELECT count(*) FROM topup_presets"`
Expected: `6` и `4`.

- [ ] **Step 5: повторный запуск идемпотентен**

Run: `set -a; . ./.env; set +a; ./db/migrate.sh`
Expected: `skip 001_init.sql (applied)`.

### Task 3: Каркас Node-сервиса `services/core`

**Files:**
- Create: `services/core/package.json`, `services/core/tsconfig.json`, `services/core/vitest.config.ts`, `services/core/src/config.ts`, `services/core/src/db.ts`, `services/core/tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?)` → типизированный конфиг; `pool` (pg.Pool); `withTx(fn)` — транзакция с BEGIN/COMMIT/ROLLBACK. Все последующие задачи импортируют из `../src/*.js` (NodeNext ESM: импорты с расширением `.js`).

- [ ] **Step 1: package.json / tsconfig / vitest**

`package.json`:
```json
{
  "name": "core",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

Run: `cd services/core && npm i telegraf bullmq pg express zod dotenv && npm i -D typescript tsx vitest @types/node @types/express @types/pg`

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

- [ ] **Step 2: failing test для конфига**

`tests/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://vpn:x@127.0.0.1:5432/vpn",
  BOT_TOKEN: "123456:test-token",
  ROBOKASSA_LOGIN: "shop",
  ROBOKASSA_PASSWORD1: "p1",
  ROBOKASSA_PASSWORD2: "p2",
};

describe("loadConfig", () => {
  it("parses valid env with defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(8080);
    expect(c.ROBOKASSA_TEST).toBe(true);
    expect(c.REDIS_URL).toBe("redis://127.0.0.1:6379");
  });
  it("throws when BOT_TOKEN missing", () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow();
  });
  it("ROBOKASSA_TEST=0 disables test mode", () => {
    expect(loadConfig({ ...base, ROBOKASSA_TEST: "0" }).ROBOKASSA_TEST).toBe(false);
  });
});
```

Run: `npm test` → Expected: FAIL (`Cannot find module '../src/config.js'`).

- [ ] **Step 3: реализация**

`src/config.ts`:
```ts
import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  BOT_TOKEN: z.string().min(10),
  ROBOKASSA_LOGIN: z.string().min(1),
  ROBOKASSA_PASSWORD1: z.string().min(1),
  ROBOKASSA_PASSWORD2: z.string().min(1),
  ROBOKASSA_TEST: z
    .string()
    .default("1")
    .transform((v) => v !== "0" && v.toLowerCase() !== "false"),
  PORT: z.coerce.number().default(8080),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return Env.parse(env);
}
```

`src/db.ts`:
```ts
import pg from "pg";
import { loadConfig } from "./config.js";

export const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: тесты зелёные**

Run: `npm test` → Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add services/core
git commit -m "feat(core): service scaffold with zod config and pg pool"
```

### Task 4: Модуль Robokassa (подписи, платёжная ссылка)

**Files:**
- Create: `services/core/src/robokassa.ts`, `services/core/tests/robokassa.test.ts`

**Interfaces:**
- Produces:
  - `interface RobokassaCreds { login; password1; password2; isTest }`
  - `paymentSignatureBase(creds, outSum, invId, encodedReceipt?) → string`
  - `buildPaymentUrl(creds, {invId, outSum, description, receipt?}) → string`
  - `resultSignatureBase(creds, outSum, invId) → string`
  - `verifyResultSignature(creds, {OutSum, InvId, SignatureValue}) → boolean`

- [ ] **Step 1: failing tests**

`tests/robokassa.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  paymentSignatureBase, resultSignatureBase,
  buildPaymentUrl, verifyResultSignature,
} from "../src/robokassa.js";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const creds = { login: "shop", password1: "p1", password2: "p2", isTest: true };

describe("robokassa", () => {
  it("payment signature base without receipt", () => {
    expect(paymentSignatureBase(creds, "100.00", 42)).toBe("shop:100.00:42:p1");
  });
  it("payment signature base includes url-encoded receipt", () => {
    const enc = encodeURIComponent(JSON.stringify({ items: [] }));
    expect(paymentSignatureBase(creds, "100.00", 42, enc)).toBe(`shop:100.00:42:${enc}:p1`);
  });
  it("result signature base is OutSum:InvId:Password2", () => {
    expect(resultSignatureBase(creds, "100.00", "42")).toBe("100.00:42:p2");
  });
  it("verifyResultSignature accepts correct md5 in any case", () => {
    const sig = md5("100.00:42:p2").toUpperCase();
    expect(verifyResultSignature(creds, { OutSum: "100.00", InvId: "42", SignatureValue: sig })).toBe(true);
  });
  it("verifyResultSignature rejects tampered OutSum", () => {
    const sig = md5("100.00:42:p2");
    expect(verifyResultSignature(creds, { OutSum: "999.00", InvId: "42", SignatureValue: sig })).toBe(false);
  });
  it("buildPaymentUrl contains signature and IsTest", () => {
    const url = buildPaymentUrl(creds, { invId: 42, outSum: "100.00", description: "Пополнение 404VPN" });
    expect(url.startsWith("https://auth.robokassa.ru/Merchant/Index.aspx?")).toBe(true);
    expect(url).toContain(`SignatureValue=${md5("shop:100.00:42:p1")}`);
    expect(url).toContain("IsTest=1");
    expect(url).toContain("InvId=42");
  });
});
```

Run: `npm test` → Expected: FAIL (module not found).

- [ ] **Step 2: реализация**

`src/robokassa.ts`:
```ts
import { createHash } from "node:crypto";

const md5hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

export interface RobokassaCreds {
  login: string;
  password1: string;
  password2: string;
  isTest: boolean;
}

// База подписи платёжной ссылки: MerchantLogin:OutSum:InvId[:ReceiptUrlEncoded]:Password1
export function paymentSignatureBase(
  c: RobokassaCreds, outSum: string, invId: number, encodedReceipt?: string,
): string {
  const parts = [c.login, outSum, String(invId)];
  if (encodedReceipt) parts.push(encodedReceipt);
  parts.push(c.password1);
  return parts.join(":");
}

export function buildPaymentUrl(
  c: RobokassaCreds,
  o: { invId: number; outSum: string; description: string; receipt?: unknown },
): string {
  // Receipt: в подписи — однократный url-encode, в самой ссылке — двойной (требование Robokassa)
  const encodedReceipt = o.receipt ? encodeURIComponent(JSON.stringify(o.receipt)) : undefined;
  const sig = md5hex(paymentSignatureBase(c, o.outSum, o.invId, encodedReceipt));
  const params = [
    `MerchantLogin=${encodeURIComponent(c.login)}`,
    `OutSum=${o.outSum}`,
    `InvId=${o.invId}`,
    `Description=${encodeURIComponent(o.description)}`,
    `SignatureValue=${sig}`,
  ];
  if (encodedReceipt) params.push(`Receipt=${encodeURIComponent(encodedReceipt)}`);
  if (c.isTest) params.push("IsTest=1");
  return `https://auth.robokassa.ru/Merchant/Index.aspx?${params.join("&")}`;
}

// База подписи ResultURL: OutSum:InvId:Password2
export function resultSignatureBase(c: RobokassaCreds, outSum: string, invId: string): string {
  return `${outSum}:${invId}:${c.password2}`;
}

export function verifyResultSignature(
  c: RobokassaCreds,
  q: { OutSum: string; InvId: string; SignatureValue: string },
): boolean {
  const expected = md5hex(resultSignatureBase(c, q.OutSum, q.InvId));
  return expected.toLowerCase() === (q.SignatureValue ?? "").toLowerCase();
}
```

- [ ] **Step 3: тесты зелёные** — Run: `npm test` → Expected: PASS (все).

- [ ] **Step 4: Commit** — `git add services/core && git commit -m "feat(core): robokassa signatures and payment url"`

> Формат подписи с Receipt проверить живым запросом при `IsTest=1` на этапе Task 10 — это единственное, что нельзя доказать юнит-тестом.

### Task 5: Коды доступа

**Files:**
- Create: `services/core/src/codes.ts`, `services/core/tests/codes.test.ts`

**Interfaces:**
- Produces: `CODE_ALPHABET` (Crockford Base32, без I/L/O/U), `generateCode() → "XXXX-XXXX-XXXX-XXXX"`, `normalizeCode(input) → string` (upper, убрать всё кроме [0-9A-Z], O→0, I/L→1), `hashCode(normalized) → sha256 hex`.

- [ ] **Step 1: failing tests**

`tests/codes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CODE_ALPHABET, generateCode, normalizeCode, hashCode } from "../src/codes.js";

describe("access codes", () => {
  it("alphabet is crockford base32 (no I L O U)", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const ch of "ILOU") expect(CODE_ALPHABET).not.toContain(ch);
  });
  it("generates XXXX-XXXX-XXXX-XXXX from alphabet", () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    for (const ch of code.replaceAll("-", "")) expect(CODE_ALPHABET).toContain(ch);
  });
  it("codes are unique across 1000 generations", () => {
    const s = new Set(Array.from({ length: 1000 }, generateCode));
    expect(s.size).toBe(1000);
  });
  it("normalize maps lookalikes and strips separators", () => {
    expect(normalizeCode(" abcd-efg0 h1o ")).toBe(normalizeCode("ABCDEFG0H10"));
    expect(normalizeCode("O0Il")).toBe("0011");
  });
  it("hash is deterministic sha256 hex", () => {
    const n = normalizeCode(generateCode());
    expect(hashCode(n)).toBe(hashCode(n));
    expect(hashCode(n)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

Run: `npm test` → Expected: FAIL (module not found).

- [ ] **Step 2: реализация**

`src/codes.ts`:
```ts
import { createHash, randomInt } from "node:crypto";

// Crockford Base32: без I, L, O, U — не путается на глаз; 16 симв. = 80 бит энтропии
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateCode(): string {
  let raw = "";
  for (let i = 0; i < 16; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return raw.match(/.{4}/g)!.join("-");
}

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function hashCode(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}
```

- [ ] **Step 3: тесты зелёные** — Run: `npm test` → Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(core): access code generation, normalization, hashing"`

### Task 6: Журнал баланса (ledger)

**Files:**
- Create: `services/core/src/ledger.ts`, `services/core/tests/helpers/testdb.ts`, `services/core/tests/ledger.test.ts`

**Interfaces:**
- Consumes: `withTx` из Task 3.
- Produces: `applyBalanceChange(client, userId, amountRub: number, type, meta) → Promise<{ balanceAfter: string }>` — блокирует строку users FOR UPDATE, пишет users.balance и строку balance_transactions. `type: "topup" | "daily_charge" | "code_redeem" | "admin_adjust" | "refund"`.
- Интеграционные тесты ходят в БД из docker compose: перед тестами `createdb vpn_test` + миграции (helper делает сам).

- [ ] **Step 1: helper тестовой БД**

`tests/helpers/testdb.ts`:
```ts
import { execSync } from "node:child_process";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://vpn:vpn_dev_password@127.0.0.1:5432/vpn";
export const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, "/vpn_test");

export async function prepareTestDb(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname='vpn_test'");
  if (!rowCount) await admin.query("CREATE DATABASE vpn_test");
  await admin.end();
  execSync("bash ../../db/migrate.sh", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe" });
  return new pg.Pool({ connectionString: TEST_URL });
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(
    "TRUNCATE users, devices, telegram_users, access_codes, payment_orders, balance_transactions, notification_outbox CASCADE",
  );
}
```

- [ ] **Step 2: failing tests**

`tests/ledger.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { applyBalanceChange } from "../src/ledger.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

describe("applyBalanceChange", () => {
  it("credits and records transaction with balance_after", async () => {
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const r = await tx((c) => applyBalanceChange(c, u.id, 300, "topup", { order_id: 1 }));
    expect(r.balanceAfter).toBe("300.00");
    const { rows: [row] } = await pool.query("SELECT * FROM balance_transactions WHERE user_id=$1", [u.id]);
    expect(row.type).toBe("topup");
    expect(row.amount).toBe("300.00");
    expect(row.balance_after).toBe("300.00");
    const { rows: [u2] } = await pool.query("SELECT balance FROM users WHERE id=$1", [u.id]);
    expect(u2.balance).toBe("300.00");
  });
  it("debits without float drift (0.1+0.2 style)", async () => {
    const { rows: [u] } = await pool.query("INSERT INTO users (balance) VALUES (0.30) RETURNING id");
    const r = await tx((c) => applyBalanceChange(c, u.id, -0.1, "daily_charge", {}));
    expect(r.balanceAfter).toBe("0.20");
  });
  it("throws for unknown user", async () => {
    await expect(
      tx((c) => applyBalanceChange(c, "00000000-0000-0000-0000-000000000000", 10, "topup", {})),
    ).rejects.toThrow(/not found/);
  });
});
```

Run: `npm test tests/ledger.test.ts` → Expected: FAIL (module not found). (Требует поднятых контейнеров из Task 2.)

- [ ] **Step 3: реализация**

`src/ledger.ts`:
```ts
import type pg from "pg";

export type TxType = "topup" | "daily_charge" | "code_redeem" | "admin_adjust" | "refund";

export async function applyBalanceChange(
  c: pg.PoolClient, userId: string, amountRub: number, type: TxType, meta: Record<string, unknown>,
): Promise<{ balanceAfter: string }> {
  const { rows: [u] } = await c.query("SELECT balance FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (!u) throw new Error(`user ${userId} not found`);
  const afterKop = Math.round(Number(u.balance) * 100) + Math.round(amountRub * 100);
  const after = (afterKop / 100).toFixed(2);
  await c.query("UPDATE users SET balance=$2 WHERE id=$1", [userId, after]);
  await c.query(
    "INSERT INTO balance_transactions(user_id, type, amount, balance_after, meta) VALUES ($1,$2,$3,$4,$5)",
    [userId, type, amountRub.toFixed(2), after, JSON.stringify(meta)],
  );
  return { balanceAfter: after };
}
```

- [ ] **Step 4: тесты зелёные** — Run: `npm test` → Expected: PASS (все файлы).
- [ ] **Step 5: Commit** — `git add services/core && git commit -m "feat(core): balance ledger with row-lock and integer-kopeck math"`

### Task 7: Заказы и идемпотентная обработка ResultURL

**Files:**
- Create: `services/core/src/payments.ts`, `services/core/src/webhook.ts`, `services/core/tests/payments.test.ts`

**Interfaces:**
- Consumes: `applyBalanceChange` (Task 6), `generateCode/normalizeCode/hashCode` (Task 5), `verifyResultSignature/buildPaymentUrl` (Task 4).
- Produces:
  - `createTopupOrder(c, { telegramUserId, userId, amountRub }) → Promise<{ orderId: number }>`
  - `processSuccessfulPayment(c, invId, outSum) → Promise<Result>` где `Result = { kind: "credited"; userId; balanceAfter } | { kind: "code_issued"; code; accessCodeId } | { kind: "already_processed" } | { kind: "rejected"; reason }`
  - `createWebhookApp(creds) → express.Express` c `POST /payhook/robokassa/result`.

- [ ] **Step 1: failing tests** (интеграционные, БД из Task 6 helper)

`tests/payments.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { createTopupOrder, processSuccessfulPayment } from "../src/payments.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

async function makeTgUser(): Promise<string> {
  const { rows: [t] } = await pool.query(
    "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (111, 111) RETURNING id");
  return t.id;
}

describe("payments", () => {
  it("linked user: payment credits balance and writes outbox", async () => {
    const tgId = await makeTgUser();
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: u.id, amountRub: 300 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "300.00"));
    expect(r.kind).toBe("credited");
    const { rows: [ob] } = await pool.query("SELECT * FROM notification_outbox");
    expect(ob.template_key).toBe("payment_success");
  });
  it("new user: payment issues access code with amount", async () => {
    const tgId = await makeTgUser();
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 150 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "150.00"));
    expect(r.kind).toBe("code_issued");
    if (r.kind !== "code_issued") throw new Error("unreachable");
    expect(r.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const { rows: [ac] } = await pool.query("SELECT * FROM access_codes");
    expect(ac.amount).toBe("150.00");
    expect(ac.status).toBe("issued");
  });
  it("duplicate callback is idempotent (single credit, single code)", async () => {
    const tgId = await makeTgUser();
    const { rows: [u] } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: u.id, amountRub: 100 }));
    await tx((c) => processSuccessfulPayment(c, orderId, "100.00"));
    const r2 = await tx((c) => processSuccessfulPayment(c, orderId, "100.00"));
    expect(r2.kind).toBe("already_processed");
    const { rows: [{ count }] } = await pool.query("SELECT count(*) FROM balance_transactions");
    expect(count).toBe("1");
  });
  it("rejects wrong OutSum", async () => {
    const tgId = await makeTgUser();
    const { orderId } = await tx((c) =>
      createTopupOrder(c, { telegramUserId: tgId, userId: null, amountRub: 100 }));
    const r = await tx((c) => processSuccessfulPayment(c, orderId, "1.00"));
    expect(r.kind).toBe("rejected");
    const { rows: [o] } = await pool.query("SELECT status FROM payment_orders WHERE id=$1", [orderId]);
    expect(o.status).toBe("pending");
  });
  it("rejects unknown order", async () => {
    const r = await tx((c) => processSuccessfulPayment(c, 999999, "100.00"));
    expect(r.kind).toBe("rejected");
  });
});
```

Run: `npm test tests/payments.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: реализация**

`src/payments.ts`:
```ts
import type pg from "pg";
import { applyBalanceChange } from "./ledger.js";
import { generateCode, normalizeCode, hashCode } from "./codes.js";

export type PaymentResult =
  | { kind: "credited"; userId: string; balanceAfter: string }
  | { kind: "code_issued"; code: string; accessCodeId: string }
  | { kind: "already_processed" }
  | { kind: "rejected"; reason: string };

export async function createTopupOrder(
  c: pg.PoolClient,
  o: { telegramUserId: string | null; userId: string | null; amountRub: number },
): Promise<{ orderId: number }> {
  const { rows: [row] } = await c.query(
    "INSERT INTO payment_orders(telegram_user_id, user_id, amount) VALUES ($1,$2,$3) RETURNING id",
    [o.telegramUserId, o.userId, o.amountRub.toFixed(2)],
  );
  return { orderId: row.id };
}

export async function processSuccessfulPayment(
  c: pg.PoolClient, invId: number, outSum: string,
): Promise<PaymentResult> {
  const { rows: [order] } = await c.query("SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE", [invId]);
  if (!order) return { kind: "rejected", reason: "unknown order" };
  if (order.status === "success") return { kind: "already_processed" };
  if (order.status !== "pending") return { kind: "rejected", reason: `order status ${order.status}` };
  if (Number(outSum).toFixed(2) !== Number(order.amount).toFixed(2))
    return { kind: "rejected", reason: "sum mismatch" };

  await c.query("UPDATE payment_orders SET status='success', paid_at=now() WHERE id=$1", [invId]);

  const notify = (key: string, payload: Record<string, unknown>) =>
    order.telegram_user_id
      ? c.query(
          "INSERT INTO notification_outbox(telegram_user_id, template_key, payload) VALUES ($1,$2,$3)",
          [order.telegram_user_id, key, JSON.stringify(payload)],
        )
      : Promise.resolve();

  if (order.user_id) {
    const { balanceAfter } = await applyBalanceChange(
      c, order.user_id, Number(order.amount), "topup", { order_id: invId });
    await notify("payment_success", { amount: order.amount, balance: balanceAfter });
    return { kind: "credited", userId: order.user_id, balanceAfter };
  }

  const code = generateCode();
  const { rows: [ac] } = await c.query(
    "INSERT INTO access_codes(code_hash, amount, expires_at) VALUES ($1,$2, now() + interval '90 days') RETURNING id",
    [hashCode(normalizeCode(code)), order.amount],
  );
  await c.query("UPDATE payment_orders SET access_code_id=$2 WHERE id=$1", [invId, ac.id]);
  await notify("payment_success_code", { amount: order.amount, code });
  return { kind: "code_issued", code, accessCodeId: ac.id };
}
```

`src/webhook.ts`:
```ts
import express from "express";
import type { RobokassaCreds } from "./robokassa.js";
import { verifyResultSignature } from "./robokassa.js";
import { withTx } from "./db.js";
import { processSuccessfulPayment } from "./payments.js";

export function createWebhookApp(creds: RobokassaCreds): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post("/payhook/robokassa/result", async (req, res) => {
    const { OutSum, InvId, SignatureValue } = req.body as Record<string, string>;
    if (!OutSum || !InvId || !SignatureValue) return res.status(400).send("bad request");
    if (!verifyResultSignature(creds, { OutSum, InvId, SignatureValue }))
      return res.status(400).send("bad sign");
    const result = await withTx((c) => processSuccessfulPayment(c, Number(InvId), OutSum));
    if (result.kind === "rejected") return res.status(400).send(result.reason);
    return res.send(`OK${InvId}`); // строгий формат ответа Robokassa
  });
  return app;
}
```

- [ ] **Step 3: тесты зелёные** — Run: `npm test` → Expected: PASS (все).
- [ ] **Step 4: Commit** — `git add services/core && git commit -m "feat(core): topup orders, idempotent robokassa result processing, webhook app"`

### Task 8: Telegram-бот (long polling, вход + пополнение + баланс)

**Files:**
- Create: `services/core/src/bot.ts`, `services/core/src/templates.ts`, `services/core/tests/templates.test.ts`

**Interfaces:**
- Consumes: `createTopupOrder` (Task 7), `buildPaymentUrl` (Task 4), `pool/withTx` (Task 3).
- Produces: `createBot(cfg) → Telegraf`; `renderTemplate(tpl, vars) → string` (подстановка `{{var}}`, plain text); `daysLeft(balanceRub, devices, monthlyPrice) → number`.
- Поведение: `/start` upsert'ит `telegram_users` + шлёт `welcome` с клавиатурой пресетов (из `topup_presets`) и кнопкой `web_app` (URL Mini App — из настройки, появится в фазе 2; пока кнопка не добавляется, если настройки нет); нажатие пресета или сообщение-число ≥ `min_topup` → `createTopupOrder` + inline-кнопка «Оплатить {N} ₽» с платёжной ссылкой; `/balance` — баланс/дни/устройства.

- [ ] **Step 1: failing tests (чистые функции)**

`tests/templates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, daysLeft } from "../src/templates.js";

describe("templates", () => {
  it("substitutes variables", () => {
    expect(renderTemplate("Баланс: {{balance}} ₽ ({{days_left}} дн.)", { balance: "300.00", days_left: 90 }))
      .toBe("Баланс: 300.00 ₽ (90 дн.)");
  });
  it("missing variable becomes empty string", () => {
    expect(renderTemplate("Код: {{code}}", {})).toBe("Код: ");
  });
});

describe("daysLeft", () => {
  it("300 rub, 1 device, 100/mo → 90 days", () => {
    expect(daysLeft(300, 1, 100)).toBe(90);
  });
  it("300 rub, 2 devices → 45 days", () => {
    expect(daysLeft(300, 2, 100)).toBe(45);
  });
  it("0 devices → Infinity (не списываем)", () => {
    expect(daysLeft(300, 0, 100)).toBe(Infinity);
  });
});
```

Run: `npm test tests/templates.test.ts` → Expected: FAIL.

- [ ] **Step 2: реализация templates**

`src/templates.ts`:
```ts
export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function daysLeft(balanceRub: number, devices: number, monthlyPrice: number): number {
  if (devices <= 0) return Infinity;
  const dailyKop = Math.round((monthlyPrice * 100) / 30) * devices;
  return Math.floor(Math.round(balanceRub * 100) / dailyKop);
}
```

- [ ] **Step 3: тесты зелёные** — Run: `npm test tests/templates.test.ts` → Expected: PASS.

- [ ] **Step 4: бот**

`src/bot.ts`:
```ts
import { Telegraf, Markup } from "telegraf";
import type { Config } from "./config.js";
import { pool, withTx } from "./db.js";
import { createTopupOrder } from "./payments.js";
import { buildPaymentUrl } from "./robokassa.js";
import { renderTemplate, daysLeft } from "./templates.js";

async function getSetting(key: string): Promise<number> {
  const { rows: [r] } = await pool.query("SELECT value FROM settings WHERE key=$1", [key]);
  return Number(r?.value ?? 0);
}

async function getTemplate(key: string): Promise<string> {
  const { rows: [r] } = await pool.query(
    "SELECT text_template FROM notification_templates WHERE key=$1 AND enabled", [key]);
  return r?.text_template ?? "";
}

async function upsertTgUser(from: { id: number; username?: string }, chatId: number): Promise<string> {
  const { rows: [r] } = await pool.query(
    `INSERT INTO telegram_users(telegram_id, chat_id, username)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE
       SET chat_id=$2, username=$3, last_interaction_at=now(), is_blocked_bot=false
     RETURNING id`,
    [from.id, chatId, from.username ?? null],
  );
  return r.id;
}

async function presetsKeyboard() {
  const { rows } = await pool.query(
    "SELECT amount, title FROM topup_presets WHERE is_active ORDER BY sort_order");
  return Markup.inlineKeyboard(
    rows.map((p) => Markup.button.callback(p.title, `topup:${Number(p.amount)}`)),
    { columns: 2 },
  );
}

export function createBot(cfg: Config): Telegraf {
  const bot = new Telegraf(cfg.BOT_TOKEN);
  const creds = {
    login: cfg.ROBOKASSA_LOGIN, password1: cfg.ROBOKASSA_PASSWORD1,
    password2: cfg.ROBOKASSA_PASSWORD2, isTest: cfg.ROBOKASSA_TEST,
  };

  async function sendTopupLink(ctx: { reply: Function; from?: any; chat?: any }, amountRub: number) {
    const min = await getSetting("min_topup");
    if (amountRub < min) return ctx.reply(`Минимальная сумма пополнения — ${min} ₽`);
    const tgUserId = await upsertTgUser(ctx.from, ctx.chat.id);
    const { rows: [link] } = await pool.query(
      "SELECT user_id FROM telegram_users WHERE id=$1", [tgUserId]);
    const { orderId } = await withTx((c) =>
      createTopupOrder(c, { telegramUserId: tgUserId, userId: link?.user_id ?? null, amountRub }));
    const url = buildPaymentUrl(creds, {
      invId: orderId, outSum: amountRub.toFixed(2), description: `Пополнение 404VPN #${orderId}`,
    });
    return ctx.reply(
      `Счёт на ${amountRub} ₽ создан.`,
      Markup.inlineKeyboard([Markup.button.url(`Оплатить ${amountRub} ₽`, url)]),
    );
  }

  bot.start(async (ctx) => {
    await upsertTgUser(ctx.from, ctx.chat.id);
    await ctx.reply(renderTemplate(await getTemplate("welcome"), {}), await presetsKeyboard());
  });

  bot.action(/^topup:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await sendTopupLink(ctx as any, Number(ctx.match[1]));
  });

  bot.command("balance", async (ctx) => {
    const tgUserId = await upsertTgUser(ctx.from, ctx.chat.id);
    const { rows: [link] } = await pool.query(
      `SELECT u.id, u.balance, u.status,
              (SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.is_active) AS devices
       FROM telegram_users t JOIN users u ON u.id=t.user_id WHERE t.id=$1`, [tgUserId]);
    if (!link) return ctx.reply("Аккаунт ещё не активирован: пополни баланс и введи код в приложении.");
    const monthly = await getSetting("device_monthly_price");
    const d = daysLeft(Number(link.balance), link.devices, monthly);
    return ctx.reply(
      `Баланс: ${link.balance} ₽\nУстройств: ${link.devices}\nОсталось: ${d === Infinity ? "∞" : `~${d} дн.`}`);
  });

  bot.hears(/^\d{2,6}$/, async (ctx) => sendTopupLink(ctx as any, Number(ctx.message.text)));

  return bot;
}
```

- [ ] **Step 5: компиляция и все тесты** — Run: `npm run build && npm test` → Expected: сборка без ошибок, тесты PASS.
- [ ] **Step 6: Commit** — `git add services/core && git commit -m "feat(core): telegraf bot: start, presets, custom amount, balance"`

### Task 9: Outbox-воркер и очередь уведомлений (BullMQ)

**Files:**
- Create: `services/core/src/notifier.ts`, `services/core/src/index.ts`, `services/core/tests/notifier.test.ts`

**Interfaces:**
- Consumes: `pool` (Task 3), `renderTemplate/daysLeft` (Task 8), Telegraf instance (Task 8).
- Produces:
  - `outboxJobId(outboxId) → "outbox:{id}"` (детерминированный jobId — повторная постановка идемпотентна).
  - `pollOutboxOnce(queue) → Promise<number>` — забирает pending-строки `FOR UPDATE SKIP LOCKED`, ставит в очередь `tg-notify`, помечает `queued`.
  - `startNotifier(bot)` — BullMQ Worker c limiter `{ max: 20, duration: 1000 }`: рендерит шаблон, шлёт plain-text сообщение; для `payment_success_code` дополнительно шлёт код вторым сообщением `` `КОД` `` (MarkdownV2); ошибка 403 → `telegram_users.is_blocked_bot=true`, outbox `failed`; успех → `sent`.
  - `src/index.ts` — точка входа: конфиг → webhook app listen(PORT) → bot.launch() → startNotifier + setInterval(pollOutbox, 5000).

- [ ] **Step 1: failing test (jobId + выборка pending)**

`tests/notifier.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { outboxJobId, claimPendingOutbox } from "../src/notifier.js";

let pool: pg.Pool;
beforeAll(async () => { pool = await prepareTestDb(); });
beforeEach(async () => { await truncateAll(pool); });
afterAll(async () => { await pool.end(); });

describe("notifier", () => {
  it("jobId is deterministic", () => {
    expect(outboxJobId("abc")).toBe("outbox:abc");
    expect(outboxJobId("abc")).toBe(outboxJobId("abc"));
  });
  it("claims pending rows once and marks them queued", async () => {
    const { rows: [t] } = await pool.query(
      "INSERT INTO telegram_users(telegram_id, chat_id) VALUES (1, 1) RETURNING id");
    await pool.query(
      "INSERT INTO notification_outbox(telegram_user_id, template_key) VALUES ($1,'payment_success')", [t.id]);
    const first = await claimPendingOutbox(pool);
    expect(first).toHaveLength(1);
    expect(first[0].chat_id).toBe("1");
    const second = await claimPendingOutbox(pool);
    expect(second).toHaveLength(0);
  });
});
```

Run: `npm test tests/notifier.test.ts` → Expected: FAIL.

- [ ] **Step 2: реализация**

`src/notifier.ts`:
```ts
import { Queue, Worker } from "bullmq";
import type { Telegraf } from "telegraf";
import type pg from "pg";
import { pool } from "./db.js";
import { loadConfig } from "./config.js";
import { renderTemplate } from "./templates.js";

const QUEUE = "tg-notify";
export const outboxJobId = (outboxId: string): string => `outbox:${outboxId}`;

export interface OutboxRow {
  id: string; telegram_user_id: string; template_key: string;
  payload: Record<string, unknown>; chat_id: string; is_blocked_bot: boolean;
}

export async function claimPendingOutbox(p: pg.Pool): Promise<OutboxRow[]> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `SELECT o.id, o.telegram_user_id, o.template_key, o.payload, t.chat_id, t.is_blocked_bot
       FROM notification_outbox o
       JOIN telegram_users t ON t.id = o.telegram_user_id
       WHERE o.status = 'pending'
       ORDER BY o.created_at
       LIMIT 100
       FOR UPDATE OF o SKIP LOCKED`);
    if (rows.length)
      await c.query("UPDATE notification_outbox SET status='queued' WHERE id = ANY($1)",
        [rows.map((r) => r.id)]);
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

function redisConnection() {
  const url = new URL(loadConfig().REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

export function createNotifyQueue(): Queue {
  return new Queue(QUEUE, { connection: redisConnection() });
}

export async function pollOutboxOnce(queue: Queue): Promise<number> {
  const rows = await claimPendingOutbox(pool);
  for (const r of rows) {
    if (r.is_blocked_bot) {
      await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
      continue;
    }
    await queue.add("send", r, { jobId: outboxJobId(r.id), attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  }
  return rows.length;
}

const escapeMdV2 = (s: string) => s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);

export function startNotifier(bot: Telegraf): Worker {
  return new Worker<OutboxRow>(
    QUEUE,
    async (job) => {
      const r = job.data;
      const { rows: [tpl] } = await pool.query(
        "SELECT text_template FROM notification_templates WHERE key=$1 AND enabled", [r.template_key]);
      if (!tpl) {
        await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
        return; // шаблон выключен — считаем обработанным
      }
      try {
        await bot.telegram.sendMessage(Number(r.chat_id),
          renderTemplate(tpl.text_template, r.payload as Record<string, string | number>));
        if (r.template_key === "payment_success_code" && r.payload.code)
          await bot.telegram.sendMessage(Number(r.chat_id),
            `\`${escapeMdV2(String(r.payload.code))}\``, { parse_mode: "MarkdownV2" });
        await pool.query("UPDATE notification_outbox SET status='sent' WHERE id=$1", [r.id]);
      } catch (e: any) {
        if (e?.response?.error_code === 403) {
          await pool.query("UPDATE telegram_users SET is_blocked_bot=true WHERE id=$1", [r.telegram_user_id]);
          await pool.query("UPDATE notification_outbox SET status='failed' WHERE id=$1", [r.id]);
          return;
        }
        throw e; // ретрай BullMQ
      }
    },
    { connection: redisConnection(), limiter: { max: 20, duration: 1000 } },
  );
}
```

`src/index.ts`:
```ts
import { loadConfig } from "./config.js";
import { createWebhookApp } from "./webhook.js";
import { createBot } from "./bot.js";
import { createNotifyQueue, pollOutboxOnce, startNotifier } from "./notifier.js";

const cfg = loadConfig();
const creds = {
  login: cfg.ROBOKASSA_LOGIN, password1: cfg.ROBOKASSA_PASSWORD1,
  password2: cfg.ROBOKASSA_PASSWORD2, isTest: cfg.ROBOKASSA_TEST,
};

const app = createWebhookApp(creds);
app.listen(cfg.PORT, () => console.log(`webhook on :${cfg.PORT}`));

const bot = createBot(cfg);
void bot.launch(() => console.log("bot polling started"));

const queue = createNotifyQueue();
startNotifier(bot);
setInterval(() => void pollOutboxOnce(queue).catch(console.error), 5000);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
```

- [ ] **Step 3: сборка + все тесты** — Run: `npm run build && npm test` → Expected: PASS.
- [ ] **Step 4: Commit** — `git add services/core && git commit -m "feat(core): outbox notifier with bullmq throttling and entrypoint"`

### Task 10: Dockerfile, compose-сервис и деплой-инструкция

**Files:**
- Create: `services/core/Dockerfile`, `docs/DEPLOY.md`
- Modify: `docker-compose.yml` (добавить сервис `core`)

- [ ] **Step 1: Dockerfile (двухстадийный)**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: сервис в docker-compose.yml** (добавить в `services:`)

```yaml
  core:
    build: ./services/core
    env_file: .env
    environment:
      DATABASE_URL: postgres://vpn:${POSTGRES_PASSWORD}@postgres:5432/vpn
      REDIS_URL: redis://redis:6379
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
```

- [ ] **Step 3: проверить сборку** — Run: `docker compose build core && docker compose config -q` → Expected: успешная сборка.

- [ ] **Step 4: docs/DEPLOY.md** — пошагово для голого Ubuntu-сервера №2:

```markdown
# Деплой на сервер №2 (Ubuntu, с нуля)

1. `curl -fsSL https://get.docker.com | sh` и `apt install -y git postgresql-client`
2. Склонировать/загрузить репозиторий, `cp .env.example .env`, заполнить реальные значения
   (пароль БД, BOT_TOKEN от @BotFather, боевые/тестовые пароли Robokassa, ROBOKASSA_TEST=1).
3. `docker compose up -d --build`
4. Миграции: `set -a; . ./.env; set +a; DATABASE_URL=postgres://vpn:$POSTGRES_PASSWORD@127.0.0.1:5432/vpn ./db/migrate.sh`
5. В кабинете Robokassa: Result URL = `http://<IP_сервера>:8080/payhook/robokassa/result`, метод POST.
   Success/Fail URL — на страницу-заглушку (любой URL), логики на них нет.
6. Проверка: в боте `/start` → пресет → оплата в тест-режиме (IsTest=1) → в чат приходит
   уведомление и код. `docker compose logs -f core` для отладки.
7. Firewall: открыть только 8080/tcp (и 22). После проверки Receipt на тестовом платеже
   переключить ROBOKASSA_TEST=0.
```

- [ ] **Step 5: Commit** — `git add services/core/Dockerfile docker-compose.yml docs/DEPLOY.md && git commit -m "feat: dockerize core service, deploy guide"`

---

## Definition of Done (Фаза 1)

- `docker compose up -d` поднимает postgres, redis, core; миграции применяются идемпотентно.
- `npm test` в `services/core` зелёный (config, robokassa, codes, ledger, payments, templates, notifier).
- Тестовый платёж Robokassa (IsTest=1) проходит цикл: бот → счёт → оплата → ResultURL → зачисление/код → уведомление в чат; повторный колбэк не дублирует зачисление.

## Следующие фазы (отдельные планы)

1. **Фаза 2 — Telegram Mini App:** React + дизайн-токены `docs/DESIGN.md`, auth по initData (HMAC), экраны: баланс/пополнение/код/устройства/история; API-роуты в `services/core`; хостинг статики с HTTPS (Cloudflare Pages или домен — решение владельца).
2. **Фаза 3 — FastAPI + WireGuard:** wg-агент на NL-сервере, `POST /redeem` (rate limit), устройства, суточный биллинг-крон (списание, suspension, low_balance → outbox), сверка пиров.
3. **Фаза 4 — Админка (React):** настройки, пресеты, пользователи (корректировка баланса через ledger), коды, транзакции, шаблоны, рассылки.
4. **Фаза 5 — iOS:** NetworkExtension + WireGuardKit, ввод кода, экран подключения по `docs/DESIGN.md`. Prerequisite: Apple Developer Program.
