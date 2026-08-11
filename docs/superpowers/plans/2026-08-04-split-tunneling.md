# Overlay — раздельное туннелирование. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пустить трафик к российским сервисам мимо туннеля, чтобы банки и Госуслуги работали при включённом VPN.

**Architecture:** Бэкенд раз в сутки импортирует префиксы из RIPEstat по списку номеров автономных систем и отдаёт их приложению в ответе туннеля. Приложение кладёт список как есть в системный профиль; расширение туннеля при старте считает дополнение — диапазоны, покрывающие всё, кроме исключённых, — и подменяет ими `allowedIPs` пира. Kill switch удаляется: `includeAllNetworks` загоняет в туннель весь трафик независимо от маршрутов и сделал бы обход бессмысленным.

**Tech Stack:** Node.js 20 + TypeScript (NodeNext ESM), express 5, pg, vitest 2; Swift 5, SwiftUI, NetworkExtension, WireGuardKit (вендорная копия), XCTest, XcodeGen.

## Global Constraints

- Спецификация: `docs/superpowers/specs/2026-08-04-split-tunneling-design.md`.
- **Обход невидим.** Ни переключателя, ни подписи, ни упоминаний в интерфейсе. Список всегда применяется.
- **Kill switch удаляется полностью** — переключатель, свойство `Preferences.killSwitch`, параметр в сборке профиля и его тесты.
- **`includeAllNetworks` надо явно писать `false`.** Флаг живёт в сохранённом системном профиле; у тех, кто включил kill switch до обновления, он останется и сломает обход.
- **Любая ошибка сводится к полному туннелю** — сегодняшнему поведению. Пустой список, неразобранный префикс, пустой результат расчёта: во всех случаях `0.0.0.0/0` и `::/0`.
- **Импорт не трогает таблицу, пока не получил полный ответ** от RIPEstat.
- Адреса разбираются **в байты**, дополнение и агрегация считаются обходом двоичного дерева по битам. Арифметики над 128-битными числами нет: в Swift под iOS 16 её попросту не существует.
- Настройка `bypass_asns`: номера через запятую, с префиксом `AS` или без (`AS12345, 200350`).
- Миграции: следующий свободный номер — `008`. Применяются через `set -a; . ./.env; set +a; ./db/migrate.sh`.
- Бэкенд-тесты: `cd services/core && npm test`. Сейчас 182 теста в 19 файлах.
- iOS-тесты: `xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test`. Сейчас 73 теста.
- После правки спек XcodeGen — пересобрать **обе**: `cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml`.
- Сборка проекта с туннелем из командной строки — с `CODE_SIGNING_ALLOWED=NO`.
- `vpn_ios/*.xcodeproj/` в `.gitignore` — в `git add` не включать.
- Язык комментариев и интерфейса — русский.

## Структура файлов

**Создаётся — бэкенд:**

| Файл | Ответственность |
|---|---|
| `db/migrations/008_bypass_prefixes.sql` | Настройка `bypass_asns`, таблица `bypass_prefixes` |
| `services/core/src/bypass/prefixes.ts` | Чистое: разбор адресов в байты, разбор списка номеров AS, агрегация |
| `services/core/src/bypass/source.ts` | Интерфейс источника префиксов + подставной для тестов |
| `services/core/src/bypass/ripestat.ts` | Настоящий источник: RIPEstat |
| `services/core/src/bypass/import.ts` | Импорт в таблицу и чтение списка для API |

**Меняется — бэкенд:** `admin-api.ts` (ключ в `TEXT_SETTINGS`), `device-api.ts` (`bypassRoutes` в ответе), `index.ts` (суточная задача), `tests/helpers/testdb.ts`, `apps/admin/src/pages/Settings.tsx`, `docs/DEPLOY.md`.

**Создаётся — iOS:** `vpn_ios/Shared/RouteCalculator.swift` — разбор префиксов и расчёт дополнения.

**Меняется — iOS:** `App/Api.swift` (`bypassRoutes`), `Shared/Preferences.swift` (минус `killSwitch`), `App/TunnelProfileBuilder.swift`, `App/VPNManager.swift`, `App/AppState.swift`, `App/Screens/SettingsView.swift` (минус секция kill switch), `Tunnel/PacketTunnelProvider.swift` (применение дополнения).

---

### Task 1: Чистые функции для префиксов

Разбор адресов в байты, разбор списка номеров автономных систем, агрегация по вложенности. Всё без сети и без базы.

**Files:**
- Create: `services/core/src/bypass/prefixes.ts`
- Test: `services/core/tests/bypass-prefixes.test.ts`

**Interfaces:**
- Produces: `interface Prefix { bytes: number[]; length: number }`; `parsePrefix(raw: string): Prefix | null`; `formatPrefix(p: Prefix): string`; `parseAsnList(raw: string): number[]`; `aggregate(prefixes: Prefix[]): Prefix[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `services/core/tests/bypass-prefixes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePrefix, formatPrefix, parseAsnList, aggregate } from "../src/bypass/prefixes.js";

describe("parseAsnList", () => {
  it("принимает номера с префиксом AS и без него", () => {
    expect(parseAsnList("AS12345, 200350")).toEqual([12345, 200350]);
  });

  it("не различает регистр и терпит лишние пробелы", () => {
    expect(parseAsnList(" as1 ,  As2 ")).toEqual([1, 2]);
  });

  it("выбрасывает мусор и повторы", () => {
    expect(parseAsnList("AS7, чепуха, 7, , -3")).toEqual([7]);
  });

  it("пустая строка даёт пустой список", () => {
    expect(parseAsnList("")).toEqual([]);
  });
});

describe("parsePrefix", () => {
  it("разбирает IPv4", () => {
    expect(parsePrefix("10.0.0.0/8")).toEqual({ bytes: [10, 0, 0, 0], length: 8 });
  });

  it("обнуляет биты за границей префикса", () => {
    expect(parsePrefix("10.1.2.3/8")).toEqual({ bytes: [10, 0, 0, 0], length: 8 });
  });

  it("разбирает IPv6 с сокращением", () => {
    const p = parsePrefix("2a02:6b8::/32");
    expect(p?.length).toBe(32);
    expect(p?.bytes.slice(0, 4)).toEqual([0x2a, 0x02, 0x06, 0xb8]);
    expect(p?.bytes).toHaveLength(16);
  });

  it("отвергает мусор", () => {
    expect(parsePrefix("не адрес")).toBeNull();
    expect(parsePrefix("10.0.0.0")).toBeNull();
    expect(parsePrefix("10.0.0.0/33")).toBeNull();
    expect(parsePrefix("999.0.0.0/8")).toBeNull();
  });

  it("формат — обратная операция к разбору", () => {
    expect(formatPrefix(parsePrefix("192.168.0.0/16")!)).toBe("192.168.0.0/16");
    expect(formatPrefix(parsePrefix("2a02:6b8::/32")!)).toBe("2a02:6b8::/32");
  });
});

describe("aggregate", () => {
  const p = (s: string) => parsePrefix(s)!;

  it("убирает вложенные диапазоны", () => {
    const result = aggregate([p("10.0.0.0/8"), p("10.1.0.0/16")]);
    expect(result.map(formatPrefix)).toEqual(["10.0.0.0/8"]);
  });

  it("убирает повторы", () => {
    const result = aggregate([p("10.0.0.0/8"), p("10.0.0.0/8")]);
    expect(result).toHaveLength(1);
  });

  it("оставляет непересекающиеся", () => {
    const result = aggregate([p("10.0.0.0/8"), p("192.168.0.0/16")]);
    expect(result).toHaveLength(2);
  });

  it("не смешивает версии протокола", () => {
    const result = aggregate([p("0.0.0.0/0"), p("2a02:6b8::/32")]);
    // IPv6 не вложен в IPv4-диапазон, несмотря на нулевую длину
    expect(result).toHaveLength(2);
  });

  it("пустой вход даёт пустой выход", () => {
    expect(aggregate([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/bypass-prefixes.test.ts
```

Ожидается: `Failed to load ../src/bypass/prefixes.js`.

- [ ] **Step 3: Создать `services/core/src/bypass/prefixes.ts`**

```ts
/** Адресный префикс в байтах: 4 байта для IPv4, 16 для IPv6. */
export interface Prefix {
  bytes: number[];
  length: number;
}

/** «AS12345, 200350» → [12345, 200350]. Мусор и повторы отбрасываются. */
export function parseAsnList(raw: string): number[] {
  const seen = new Set<number>();
  for (const chunk of raw.split(",")) {
    const cleaned = chunk.trim().replace(/^as/i, "");
    const n = Number(cleaned);
    if (!Number.isInteger(n) || n <= 0) continue;
    seen.add(n);
  }
  return [...seen];
}

function parseIPv4(addr: string): number[] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(addr: string): number[] | null {
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[][] | null => {
    if (s === "") return [];
    const groups: number[][] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      const n = parseInt(g, 16);
      groups.push([(n >> 8) & 0xff, n & 0xff]);
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  const missing = 8 - head.length - tail.length;
  // без «::» группы должны быть все восемь; с ним — хотя бы одна пропущенная
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

  const zeros = Array.from({ length: missing }, () => [0, 0]);
  return [...head, ...zeros, ...tail].flat();
}

/** Разбирает «10.0.0.0/8» или «2a02:6b8::/32». Биты за границей префикса обнуляются. */
export function parsePrefix(raw: string): Prefix | null {
  const [addr, lenRaw, ...rest] = raw.trim().split("/");
  if (rest.length > 0 || lenRaw === undefined || addr === undefined) return null;
  if (!/^\d{1,3}$/.test(lenRaw)) return null;

  const bytes = addr.includes(":") ? parseIPv6(addr) : parseIPv4(addr);
  if (bytes === null) return null;

  const length = Number(lenRaw);
  if (length > bytes.length * 8) return null;

  // обнуляем всё за границей префикса, чтобы одинаковые сети выглядели одинаково
  const masked = bytes.map((b, i) => {
    const bitsBefore = i * 8;
    if (bitsBefore >= length) return 0;
    const keep = Math.min(8, length - bitsBefore);
    return keep === 8 ? b : b & (0xff << (8 - keep)) & 0xff;
  });

  return { bytes: masked, length };
}

export function formatPrefix(p: Prefix): string {
  if (p.bytes.length === 4) return `${p.bytes.join(".")}/${p.length}`;

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((p.bytes[i] << 8) | p.bytes[i + 1]).toString(16));
  }
  // сворачиваем самую длинную цепочку нулевых групп в «::»
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0") {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > bestLen) {
        bestLen = i - start;
        bestStart = start;
      }
      start = -1;
    }
  }
  let addr: string;
  if (bestLen > 1) {
    addr = `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLen).join(":")}`;
  } else {
    addr = groups.join(":");
  }
  return `${addr}/${p.length}`;
}

/** Первые `length` бит адреса совпадают с префиксом? */
export function covers(outer: Prefix, inner: Prefix): boolean {
  if (outer.bytes.length !== inner.bytes.length) return false;
  if (outer.length > inner.length) return false;
  for (let bit = 0; bit < outer.length; bit++) {
    const byte = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if ((outer.bytes[byte] & mask) !== (inner.bytes[byte] & mask)) return false;
  }
  return true;
}

/**
 * Выбрасывает повторы и диапазоны, вложенные в другие. Слияние соседей не делаем:
 * выигрыш от него мал, а расчёт дополнения на устройстве и так даёт минимальный набор.
 */
export function aggregate(prefixes: Prefix[]): Prefix[] {
  const sorted = [...prefixes].sort((a, b) =>
    a.bytes.length - b.bytes.length || a.length - b.length);
  const result: Prefix[] = [];
  for (const p of sorted) {
    if (result.some((kept) => covers(kept, p))) continue;
    result.push(p);
  }
  return result;
}
```

- [ ] **Step 4: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 196 тестов в 20 файлах, 0 провалов (182 существующих + 14 новых).

- [ ] **Step 5: Коммит**

```bash
git add services/core/src/bypass/prefixes.ts services/core/tests/bypass-prefixes.test.ts
git commit -m "feat(core): разбор и агрегация адресных префиксов"
```

---

### Task 2: Источник префиксов и импорт в базу

**Files:**
- Create: `db/migrations/008_bypass_prefixes.sql`
- Create: `services/core/src/bypass/source.ts`
- Create: `services/core/src/bypass/ripestat.ts`
- Create: `services/core/src/bypass/import.ts`
- Modify: `services/core/tests/helpers/testdb.ts`
- Test: `services/core/tests/bypass-import.test.ts`

**Interfaces:**
- Consumes: `parsePrefix`, `formatPrefix`, `parseAsnList`, `aggregate`, `Prefix` (Task 1); `getTextSetting` из `settings.ts`.
- Produces: `interface PrefixSource { prefixesFor(asn: number): Promise<string[]> }`; `class FakePrefixSource`; `class RipeStatSource`; `importBypassPrefixes(db, source): Promise<{ asns: number; prefixes: number }>`; `listBypassPrefixes(db): Promise<string[]>`.

- [ ] **Step 1: Создать `db/migrations/008_bypass_prefixes.sql`**

```sql
-- Префиксы сервисов, трафик к которым идёт мимо туннеля. Импортируются из
-- RIPEstat по номерам автономных систем из настройки bypass_asns.
CREATE TABLE IF NOT EXISTS bypass_prefixes (
  asn        integer     NOT NULL,
  prefix     text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asn, prefix)
);

-- Пустая строка означает «обход выключен»: приложение получит пустой список
-- и поднимет полный туннель, как до появления этой возможности.
INSERT INTO settings(key, value) VALUES ('bypass_asns', '""')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Применить миграцию**

```bash
set -a; . ./.env; set +a; ./db/migrate.sh
```

Ожидается строка о применении `008_bypass_prefixes.sql`.

- [ ] **Step 3: Дописать сброс в `services/core/tests/helpers/testdb.ts`**

В функции `truncateAll` в строку `TRUNCATE users, devices, ...` добавить `bypass_prefixes` перед `CASCADE`. И в запрос сброса текстовых настроек добавить ключ: список `('support_contact','bot_username','dns_default','dns_filtered')` заменить на `('support_contact','bot_username','dns_default','dns_filtered','bypass_asns')`.

- [ ] **Step 4: Написать падающий тест**

Создать `services/core/tests/bypass-import.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { FakePrefixSource } from "../src/bypass/source.js";
import { importBypassPrefixes, listBypassPrefixes } from "../src/bypass/import.js";

let pool: pg.Pool;

beforeAll(async () => {
  pool = await prepareTestDb();
});

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function setAsns(value: string) {
  await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='bypass_asns'", [value]);
}

describe("importBypassPrefixes", () => {
  it("складывает префиксы всех номеров из настройки", async () => {
    await setAsns("AS1, AS2");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8"], 2: ["192.168.0.0/16"] });

    const stats = await importBypassPrefixes(pool, source);

    expect(stats).toEqual({ asns: 2, prefixes: 2 });
    expect((await listBypassPrefixes(pool)).sort())
      .toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("пустая настройка очищает таблицу", async () => {
    await setAsns("AS1");
    await importBypassPrefixes(pool, new FakePrefixSource({ 1: ["10.0.0.0/8"] }));

    await setAsns("");
    const stats = await importBypassPrefixes(pool, new FakePrefixSource({}));

    expect(stats).toEqual({ asns: 0, prefixes: 0 });
    expect(await listBypassPrefixes(pool)).toEqual([]);
  });

  it("ошибка источника не трогает уже импортированное", async () => {
    await setAsns("AS1");
    await importBypassPrefixes(pool, new FakePrefixSource({ 1: ["10.0.0.0/8"] }));

    await setAsns("AS1, AS2");
    const failing = new FakePrefixSource({ 1: ["10.0.0.0/8"] }, { failOn: [2] });
    await expect(importBypassPrefixes(pool, failing)).rejects.toThrow();

    // одна неудачная ночь не должна оставлять пользователей без обхода
    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("выбрасывает неразобранные префиксы, остальные сохраняет", async () => {
    await setAsns("AS1");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8", "чепуха", "10.0.0.0/99"] });

    await importBypassPrefixes(pool, source);

    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("схлопывает вложенные диапазоны разных номеров", async () => {
    await setAsns("AS1, AS2");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8"], 2: ["10.1.0.0/16"] });

    await importBypassPrefixes(pool, source);

    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("пустой список при нетронутой таблице", async () => {
    expect(await listBypassPrefixes(pool)).toEqual([]);
  });
});
```

- [ ] **Step 5: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/bypass-import.test.ts
```

Ожидается: `Failed to load ../src/bypass/source.js`.

- [ ] **Step 6: Создать `services/core/src/bypass/source.ts`**

```ts
/** Откуда берутся префиксы автономной системы. Реализаций две: RIPEstat и подставная. */
export interface PrefixSource {
  prefixesFor(asn: number): Promise<string[]>;
}

/** Источник для тестов: отдаёт заранее заданное, умеет падать на указанных номерах. */
export class FakePrefixSource implements PrefixSource {
  asked: number[] = [];

  constructor(
    private readonly data: Record<number, string[]>,
    private readonly opts: { failOn?: number[] } = {},
  ) {}

  async prefixesFor(asn: number): Promise<string[]> {
    this.asked.push(asn);
    if (this.opts.failOn?.includes(asn)) throw new Error(`источник упал на AS${asn}`);
    return this.data[asn] ?? [];
  }
}
```

- [ ] **Step 7: Создать `services/core/src/bypass/ripestat.ts`**

```ts
import type { PrefixSource } from "./source.js";

const ENDPOINT = "https://stat.ripe.net/data/announced-prefixes/data.json";
const TIMEOUT_MS = 20_000;

/**
 * Префиксы, анонсируемые автономной системой, по данным BGP.
 * Публичный API без ключа; отвечает медленно, поэтому таймаут и обход по одному.
 */
export class RipeStatSource implements PrefixSource {
  async prefixesFor(asn: number): Promise<string[]> {
    const res = await fetch(`${ENDPOINT}?resource=AS${asn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`RIPEstat AS${asn} → ${res.status}`);

    const body = (await res.json()) as { data?: { prefixes?: { prefix?: string }[] } };
    const prefixes = body.data?.prefixes;
    if (!Array.isArray(prefixes)) throw new Error(`RIPEstat AS${asn}: неожиданный ответ`);

    return prefixes.map((p) => p.prefix).filter((p): p is string => typeof p === "string");
  }
}
```

- [ ] **Step 8: Создать `services/core/src/bypass/import.ts`**

```ts
import type pg from "pg";
import { withTxOn } from "../db.js";
import { getTextSetting } from "../settings.js";
import { aggregate, formatPrefix, parseAsnList, parsePrefix, type Prefix } from "./prefixes.js";
import type { PrefixSource } from "./source.js";

/**
 * Тянет префиксы всех номеров из настройки и переписывает таблицу.
 *
 * Сначала собираем всё в память и только потом трогаем базу: если источник
 * упадёт на середине, прежние префиксы останутся на месте. Иначе одна
 * неудачная ночь оставит всех российских пользователей без банка.
 */
export async function importBypassPrefixes(
  db: pg.Pool,
  source: PrefixSource,
): Promise<{ asns: number; prefixes: number }> {
  const asns = parseAsnList(await getTextSetting(db, "bypass_asns"));

  const collected: { asn: number; prefix: Prefix }[] = [];
  for (const asn of asns) {
    for (const raw of await source.prefixesFor(asn)) {
      const prefix = parsePrefix(raw);
      if (prefix) collected.push({ asn, prefix });
    }
  }

  const kept = aggregate(collected.map((c) => c.prefix));
  const keptText = new Set(kept.map(formatPrefix));
  const rows = collected
    .filter((c) => keptText.has(formatPrefix(c.prefix)))
    .map((c) => ({ asn: c.asn, prefix: formatPrefix(c.prefix) }));

  await withTxOn(db, async (c) => {
    await c.query("DELETE FROM bypass_prefixes");
    for (const row of rows) {
      await c.query(
        `INSERT INTO bypass_prefixes(asn, prefix) VALUES ($1,$2)
         ON CONFLICT (asn, prefix) DO UPDATE SET updated_at=now()`,
        [row.asn, row.prefix]);
    }
  });

  return { asns: asns.length, prefixes: keptText.size };
}

/** Список префиксов для ответа приложению. */
export async function listBypassPrefixes(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query("SELECT DISTINCT prefix FROM bypass_prefixes ORDER BY prefix");
  return rows.map((r: { prefix: string }) => r.prefix);
}
```

- [ ] **Step 9: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 202 теста в 21 файле, 0 провалов (196 + 6 новых).

- [ ] **Step 10: Коммит**

```bash
git add db/migrations/008_bypass_prefixes.sql services/core/src/bypass services/core/tests/bypass-import.test.ts services/core/tests/helpers/testdb.ts
git commit -m "feat(core): импорт префиксов автономных систем из RIPEstat"
```

---

### Task 3: `bypassRoutes` в ответе туннеля и настройка в админке

**Files:**
- Modify: `services/core/src/device-api.ts`
- Modify: `services/core/src/admin-api.ts`
- Modify: `apps/admin/src/pages/Settings.tsx`
- Test: `services/core/tests/device-api.test.ts`

**Interfaces:**
- Consumes: `listBypassPrefixes` (Task 2).
- Produces: `POST /api/device/tunnel` возвращает `bypassRoutes: string[]`. Пустой массив означает «обход не настроен».

- [ ] **Step 1: Написать падающий тест**

В `services/core/tests/device-api.test.ts` добавить внутрь того же блока, где лежат тесты про `dnsFiltered`:

```ts
  it("отдаёт пустой bypassRoutes, пока обход не настроен", async () => {
    const token = await redeemNew();

    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.bypassRoutes).toEqual([]);
  });

  it("отдаёт импортированные префиксы обхода", async () => {
    await pool.query(
      "INSERT INTO bypass_prefixes(asn, prefix) VALUES (1,'10.0.0.0/8'), (2,'192.168.0.0/16')");
    const token = await redeemNew();

    const { body } = await call("/api/device/tunnel", { token, method: "POST" });

    expect(body.bypassRoutes.sort()).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/device-api.test.ts -t "bypassRoutes"
```

Ожидается: `expected undefined to deeply equal []`.

- [ ] **Step 3: Дописать обработчик туннеля**

В `services/core/src/device-api.ts` в обработчике `POST /api/device/tunnel` строку с `const dnsFiltered = ...` дополнить снизу:

```ts
      const bypassRoutes = await listBypassPrefixes(db);
```

и расширить тело ответа:

```ts
      res.json({
        ...tunnel,
        dns: dnsDefault.length > 0 ? dnsDefault : tunnel.dns,
        dnsFiltered,
        bypassRoutes,
      });
```

Добавить импорт в начало файла:

```ts
import { listBypassPrefixes } from "./bypass/import.js";
```

- [ ] **Step 4: Добавить ключ в админку**

В `services/core/src/admin-api.ts` заменить:

```ts
const TEXT_SETTINGS = ["support_contact", "dns_default", "dns_filtered"];
```

на:

```ts
const TEXT_SETTINGS = ["support_contact", "dns_default", "dns_filtered", "bypass_asns"];
```

В `apps/admin/src/pages/Settings.tsx` в `TEXT_LABELS` добавить строку:

```tsx
  bypass_asns: "Номера AS в обход туннеля (через запятую; НЕ операторов связи — у них тысячи префиксов)",
```

- [ ] **Step 5: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 204 теста, 0 провалов.

- [ ] **Step 6: Коммит**

```bash
git add services/core/src/device-api.ts services/core/src/admin-api.ts services/core/tests/device-api.test.ts apps/admin/src/pages/Settings.tsx
git commit -m "feat(api): ответ туннеля отдаёт префиксы обхода"
```

---

### Task 4: Суточный импорт и инструкция

**Files:**
- Modify: `services/core/src/index.ts`
- Modify: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: `importBypassPrefixes`, `RipeStatSource` (Task 2).

- [ ] **Step 1: Добавить задачу в `services/core/src/index.ts`**

Рядом с существующим `billingTick` (там, где `setInterval(... 3_600_000)`) добавить:

```ts
const prefixSource = new RipeStatSource();

async function bypassTick(): Promise<void> {
  const { asns, prefixes } = await importBypassPrefixes(pool, prefixSource);
  if (asns > 0) console.log(`обход: ${prefixes} префиксов из ${asns} автономных систем`);
}

// раз в сутки; первый прогон — через минуту после старта, чтобы не задерживать подъём
setTimeout(() => void bypassTick().catch(console.error), 60_000);
setInterval(() => void bypassTick().catch(console.error), 86_400_000);
```

И импорты в начало файла:

```ts
import { importBypassPrefixes } from "./bypass/import.js";
import { RipeStatSource } from "./bypass/ripestat.js";
```

- [ ] **Step 2: Проверить, что сервис собирается**

```bash
cd services/core && npx tsc --noEmit
```

Ожидается: без ошибок.

- [ ] **Step 3: Дописать раздел в `docs/DEPLOY.md`**

Добавить в конец файла:

````markdown
## Фаза 9: раздельное туннелирование

Трафик к российским сервисам идёт мимо туннеля, поэтому банки и Госуслуги работают при включённом VPN.

```bash
git pull && docker compose up -d --build core caddy && set -a; . ./.env; set +a; ./db/migrate.sh
```

Дальше в админке в поле «Номера AS в обход туннеля» перечислить автономные системы нужных сервисов через запятую.

> **Операторов связи не вписывать.** У Ростелекома, МТС и Билайна тысячи префиксов. Попытка захватить через Ростелеком Госуслуги раздувает список на порядок и замедляет старт туннеля у всех. Брать надо автономные системы самих сервисов — узнать их можно поиском по названию компании на `bgp.he.net` или `stat.ripe.net`.

Импорт запускается через минуту после старта сервиса и дальше раз в сутки. Посмотреть, что получилось:

```bash
docker compose logs core | grep "обход:"
```

```bash
docker compose exec postgres psql -U vpn -d vpn -c "SELECT asn, count(*) FROM bypass_prefixes GROUP BY asn ORDER BY 2 DESC"
```

Если у какого-то номера сотни префиксов — почти наверняка это оператор связи, и его надо убрать.

**Что проверить на устройстве** (симулятор не годится — там нет ни туннеля, ни банковских приложений):

1. Туннель поднят, сайт с определением адреса показывает Нидерланды.
2. Банковское приложение при этом работает.
3. То же самое на сотовой сети, а не только по Wi-Fi. Если на сотовой банк не открывается — это известное ограничение с IPv6, описанное в спецификации; сообщите, будем разбираться отдельно.
````

- [ ] **Step 4: Коммит**

```bash
git add services/core/src/index.ts docs/DEPLOY.md
git commit -m "feat(core): суточный импорт префиксов обхода"
```

---

### Task 5: Расчёт дополнения на устройстве

Чистая функция: на входе исключаемые префиксы, на выходе диапазоны, покрывающие всё остальное. Обход двоичного дерева по битам — одинаково работает для обеих версий протокола.

**Files:**
- Create: `vpn_ios/Shared/RouteCalculator.swift`
- Test: `vpn_ios/Tests/RouteCalculatorTests.swift`

**Interfaces:**
- Produces: `struct IPPrefix: Equatable { let bytes: [UInt8]; let length: Int }`; `RouteCalculator.parse(_ raw: String) -> IPPrefix?`; `RouteCalculator.format(_ prefix: IPPrefix) -> String`; `RouteCalculator.allowedIPs(excluding raw: [String]) -> [String]`.

- [ ] **Step 1: Написать падающий тест**

Создать `vpn_ios/Tests/RouteCalculatorTests.swift`:

```swift
import XCTest
@testable import VPN404

final class RouteCalculatorTests: XCTestCase {
    func testEmptyExclusionsGiveWholeInternet() {
        XCTAssertEqual(RouteCalculator.allowedIPs(excluding: []), ["0.0.0.0/0", "::/0"])
    }

    func testGarbageIsIgnored() {
        XCTAssertEqual(RouteCalculator.allowedIPs(excluding: ["не адрес", "10.0.0.0/99"]),
                       ["0.0.0.0/0", "::/0"],
                       "мусор не должен превращаться в отсутствие маршрутов")
    }

    func testExcludingHalfGivesOtherHalf() {
        let result = RouteCalculator.allowedIPs(excluding: ["0.0.0.0/1"])

        XCTAssertEqual(result.filter { !$0.contains(":") }, ["128.0.0.0/1"])
    }

    func testExcludedRangeIsNotCovered() {
        let result = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
        let ipv4 = result.filter { !$0.contains(":") }

        XCTAssertFalse(ipv4.contains("10.0.0.0/8"))
        XCTAssertFalse(ipv4.contains("0.0.0.0/0"))
        XCTAssertTrue(ipv4.contains("11.0.0.0/8"), "соседний диапазон должен остаться в туннеле")
        XCTAssertTrue(ipv4.contains("192.0.0.0/2") || ipv4.contains("128.0.0.0/1"))
    }

    func testExcludingEverythingLeavesNothingForThatFamily() {
        let result = RouteCalculator.allowedIPs(excluding: ["0.0.0.0/0"])

        XCTAssertEqual(result.filter { !$0.contains(":") }, [String]())
        XCTAssertEqual(result.filter { $0.contains(":") }, ["::/0"], "IPv6 не затронут")
    }

    func testIPv6ExclusionAffectsOnlyIPv6() {
        let result = RouteCalculator.allowedIPs(excluding: ["2000::/3"])

        XCTAssertTrue(result.contains("0.0.0.0/0"), "IPv4 остаётся целым")
        XCTAssertFalse(result.contains("::/0"))
        XCTAssertTrue(result.contains("::/1"))
    }

    func testNestedExclusionsCollapse() {
        let broad = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
        let withNested = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8", "10.1.0.0/16"])

        XCTAssertEqual(broad, withNested, "вложенный диапазон ничего не добавляет")
    }

    func testParseAndFormatRoundTrip() {
        XCTAssertEqual(RouteCalculator.format(RouteCalculator.parse("192.168.0.0/16")!),
                       "192.168.0.0/16")
        XCTAssertEqual(RouteCalculator.format(RouteCalculator.parse("2a02:6b8::/32")!),
                       "2a02:6b8::/32")
    }

    func testParseMasksHostBits() {
        XCTAssertEqual(RouteCalculator.parse("10.1.2.3/8"), RouteCalculator.parse("10.0.0.0/8"))
    }

    /// Результат должен покрывать ровно то, что не исключено: проверяем выборочные адреса.
    func testCoverageIsExact() {
        let result = RouteCalculator.allowedIPs(excluding: ["10.0.0.0/8"])
            .filter { !$0.contains(":") }
            .compactMap(RouteCalculator.parse)

        func covered(_ address: String) -> Bool {
            guard let probe = RouteCalculator.parse("\(address)/32") else { return false }
            return result.contains { RouteCalculator.covers($0, probe) }
        }

        XCTAssertFalse(covered("10.5.5.5"), "исключённый адрес не должен идти в туннель")
        XCTAssertTrue(covered("9.255.255.255"))
        XCTAssertTrue(covered("11.0.0.0"))
        XCTAssertTrue(covered("8.8.8.8"))
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd vpn_ios && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:" | head -3
```

Ожидается: `cannot find 'RouteCalculator' in scope`.

- [ ] **Step 3: Создать `vpn_ios/Shared/RouteCalculator.swift`**

```swift
import Foundation

/// Адресный префикс в байтах: 4 байта для IPv4, 16 для IPv6.
struct IPPrefix: Equatable {
    let bytes: [UInt8]
    let length: Int
}

/// Считает, какие диапазоны должны идти через туннель: всё, кроме исключённых.
///
/// Обход двоичного дерева по битам адреса, а не арифметика над числами:
/// для IPv6 нужна 128-битная арифметика, которой в Swift под iOS 16 нет,
/// а побитовый обход одинаково работает для обеих версий протокола
/// и сразу даёт минимальный набор диапазонов.
enum RouteCalculator {
    /// Диапазоны для `AllowedIPs`. Мусор во входе отбрасывается молча:
    /// испорченный префикс не должен оставлять человека без маршрутов вообще.
    static func allowedIPs(excluding raw: [String]) -> [String] {
        let excluded = raw.compactMap(parse)
        return (cover(family: 4, excluded: excluded) + cover(family: 16, excluded: excluded))
            .map(format)
    }

    private static func cover(family: Int, excluded: [IPPrefix]) -> [IPPrefix] {
        let ofFamily = excluded.filter { $0.bytes.count == family }
        var result: [IPPrefix] = []
        walk(base: [UInt8](repeating: 0, count: family), length: 0,
             excluded: ofFamily, into: &result)
        return result
    }

    /// Рекурсивно: узел целиком исключён — не отдаём ничего; под узлом нет
    /// исключений — отдаём его целиком; иначе делим пополам и спускаемся.
    private static func walk(base: [UInt8], length: Int,
                             excluded: [IPPrefix], into result: inout [IPPrefix]) {
        let node = IPPrefix(bytes: base, length: length)

        if excluded.contains(where: { covers($0, node) }) { return }

        let inside = excluded.filter { covers(node, $0) }
        if inside.isEmpty {
            result.append(node)
            return
        }

        // сюда не попасть: под узлом максимальной длины исключений быть уже не может
        guard length < base.count * 8 else { return }

        for bit in [UInt8(0), UInt8(1)] {
            var child = base
            let byte = length >> 3
            let mask = UInt8(0x80) >> (length & 7)
            if bit == 1 { child[byte] |= mask } else { child[byte] &= ~mask }
            walk(base: child, length: length + 1, excluded: inside, into: &result)
        }
    }

    /// Первые `outer.length` бит совпадают? Разные версии протокола не сравниваются.
    static func covers(_ outer: IPPrefix, _ inner: IPPrefix) -> Bool {
        guard outer.bytes.count == inner.bytes.count, outer.length <= inner.length else { return false }
        for bit in 0..<outer.length {
            let byte = bit >> 3
            let mask = UInt8(0x80) >> (bit & 7)
            if (outer.bytes[byte] & mask) != (inner.bytes[byte] & mask) { return false }
        }
        return true
    }

    static func parse(_ raw: String) -> IPPrefix? {
        let parts = raw.trimmingCharacters(in: .whitespaces).split(separator: "/")
        guard parts.count == 2, let length = Int(parts[1]), length >= 0 else { return nil }

        let address = String(parts[0])
        guard let bytes = address.contains(":") ? parseIPv6(address) : parseIPv4(address),
              length <= bytes.count * 8
        else { return nil }

        // обнуляем всё за границей префикса, чтобы одинаковые сети совпадали
        var masked = bytes
        for bit in length..<(bytes.count * 8) {
            masked[bit >> 3] &= ~(UInt8(0x80) >> (bit & 7))
        }
        return IPPrefix(bytes: masked, length: length)
    }

    private static func parseIPv4(_ address: String) -> [UInt8]? {
        let parts = address.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var bytes: [UInt8] = []
        for part in parts {
            guard part.count <= 3, let n = UInt16(part), n <= 255 else { return nil }
            bytes.append(UInt8(n))
        }
        return bytes
    }

    private static func parseIPv6(_ address: String) -> [UInt8]? {
        let halves = address.components(separatedBy: "::")
        guard halves.count <= 2 else { return nil }

        func groups(_ s: String) -> [UInt16]? {
            if s.isEmpty { return [] }
            var out: [UInt16] = []
            for g in s.split(separator: ":", omittingEmptySubsequences: false) {
                guard g.count >= 1, g.count <= 4, let n = UInt16(g, radix: 16) else { return nil }
                out.append(n)
            }
            return out
        }

        guard let head = groups(halves[0]),
              let tail = halves.count == 2 ? groups(halves[1]) : []
        else { return nil }

        let missing = 8 - head.count - tail.count
        if halves.count == 1 ? missing != 0 : missing < 0 { return nil }

        let all = head + [UInt16](repeating: 0, count: missing) + tail
        return all.flatMap { [UInt8($0 >> 8), UInt8($0 & 0xff)] }
    }

    static func format(_ prefix: IPPrefix) -> String {
        if prefix.bytes.count == 4 {
            return prefix.bytes.map(String.init).joined(separator: ".") + "/\(prefix.length)"
        }

        var groups: [String] = []
        for i in stride(from: 0, to: 16, by: 2) {
            groups.append(String((UInt16(prefix.bytes[i]) << 8) | UInt16(prefix.bytes[i + 1]), radix: 16))
        }

        // сворачиваем самую длинную цепочку нулевых групп в «::»
        var bestStart = -1, bestLength = 0, start = -1
        for i in 0...groups.count {
            if i < groups.count && groups[i] == "0" {
                if start == -1 { start = i }
            } else if start != -1 {
                if i - start > bestLength { bestLength = i - start; bestStart = start }
                start = -1
            }
        }

        let address: String
        if bestLength > 1 {
            let head = groups[0..<bestStart].joined(separator: ":")
            let tail = groups[(bestStart + bestLength)...].joined(separator: ":")
            address = "\(head)::\(tail)"
        } else {
            address = groups.joined(separator: ":")
        }
        return "\(address)/\(prefix.length)"
    }
}
```

- [ ] **Step 4: Прогнать тесты**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:|Executed .* tests|TEST"
```

Ожидается: 83 теста, 0 провалов (73 существующих + 10 новых).

- [ ] **Step 5: Коммит**

```bash
git add vpn_ios/Shared/RouteCalculator.swift vpn_ios/Tests/RouteCalculatorTests.swift
git commit -m "feat(ios): расчёт маршрутов в обход исключённых подсетей"
```

---

### Task 6: Удаление kill switch

**Files:**
- Modify: `vpn_ios/Shared/Preferences.swift`
- Modify: `vpn_ios/App/TunnelProfileBuilder.swift`
- Modify: `vpn_ios/App/VPNManager.swift`
- Modify: `vpn_ios/App/AppState.swift`
- Modify: `vpn_ios/App/Screens/SettingsView.swift`
- Test: `vpn_ios/Tests/PreferencesTests.swift`
- Test: `vpn_ios/Tests/TunnelProfileBuilderTests.swift`
- Test: `vpn_ios/Tests/SuspendedAccountTests.swift`

**Interfaces:**
- Produces: `TunnelProfileSettings` без поля `includeAllNetworks`; `TunnelProfileBuilder.settings(config:autoConnect:accountSuspended:dnsFilter:)`; `VPNManager.install(config:autoConnect:trustedNetworks:accountSuspended:dnsFilter:)`; `VPNManager.applyPreferences(autoConnect:trustedNetworks:accountSuspended:)`.

- [ ] **Step 1: Написать тест на явное выключение флага**

В `vpn_ios/Tests/TunnelProfileBuilderTests.swift` удалить тест `testKillSwitchMapsToIncludeAllNetworks` целиком и добавить вместо него:

```swift
    func testAllNetworksFlagIsAlwaysOff() {
        let settings = TunnelProfileBuilder.settings(config: config,
                                                     autoConnect: .always,
                                                     accountSuspended: false,
                                                     dnsFilter: false)

        XCTAssertFalse(settings.includeAllNetworks,
                       "флаг живёт в сохранённом профиле: его надо явно гасить, а не просто не выставлять")
    }
```

- [ ] **Step 2: Убрать `killSwitch` из `vpn_ios/Shared/Preferences.swift`**

Удалить свойство:

```swift
    /// По умолчанию выключен: includeAllNetworks ломает AirPlay, печать и локальную сеть.
    var killSwitch: Bool {
        get { defaults.bool(forKey: Key.killSwitch) }
        nonmutating set { defaults.set(newValue, forKey: Key.killSwitch) }
    }
```

и строку `static let killSwitch = "killSwitch"` из `private enum Key`.

- [ ] **Step 3: Переписать `vpn_ios/App/TunnelProfileBuilder.swift`**

```swift
import Foundation

/// Что именно записать в системный профиль туннеля.
struct TunnelProfileSettings: Equatable {
    var serverAddress: String
    var wgQuickConfig: String
    var includeAllNetworks: Bool
    var onDemandEnabled: Bool
}

/// Решение отделено от его применения: `VPNManager` только раскладывает эти значения
/// по `NETunnelProviderManager`, а сама логика проверяется тестом.
enum TunnelProfileBuilder {
    static func settings(config: TunnelConfig,
                         autoConnect: AutoConnectMode,
                         accountSuspended: Bool,
                         dnsFilter: Bool) -> TunnelProfileSettings {
        TunnelProfileSettings(
            // поле только для показа: адрес подключения система берёт из конфигурации WireGuard
            serverAddress: VPNManager.displayName,
            wgQuickConfig: config.wgQuick(filtered: dnsFilter),
            // Всегда false, и это не формальность. Флаг загоняет в туннель весь трафик
            // независимо от маршрутов, то есть убивает обход российских сервисов.
            // Он живёт в сохранённом профиле, поэтому у тех, кто включал kill switch
            // до обновления, его надо явно погасить.
            includeAllNetworks: false,
            // при исчерпанном балансе сервер выключает пир: туннель не поднимется никогда,
            // а правила будут блокировать трафик — человек останется вообще без интернета
            onDemandEnabled: autoConnect != .off && !accountSuspended)
    }
}
```

- [ ] **Step 4: Убрать параметр из `vpn_ios/App/VPNManager.swift`**

В `install` убрать параметр `killSwitch: Bool` из сигнатуры и из вызова `TunnelProfileBuilder.settings`. В `applyPreferences` убрать параметр `killSwitch: Bool` и строку, которая пишет `includeAllNetworks`, заменив её на явное выключение:

```swift
    /// Обновляет правила у уже установленного профиля, не трогая конфигурацию.
    /// Нужно, когда человек поменял настройки или когда баланс ушёл в ноль.
    func applyPreferences(autoConnect: AutoConnectMode,
                          trustedNetworks: [String],
                          accountSuspended: Bool) async {
        guard let manager else { return }
        // гасим флаг и здесь: профиль мог быть сохранён ещё со времён kill switch
        (manager.protocolConfiguration as? NETunnelProviderProtocol)?.includeAllNetworks = false
        manager.onDemandRules = OnDemandRules.rules(mode: autoConnect, trustedNetworks: trustedNetworks)
        manager.isOnDemandEnabled = autoConnect != .off && !accountSuspended
        try? await manager.saveToPreferences()
        try? await manager.loadFromPreferences()
    }
```

- [ ] **Step 5: Поправить вызовы в `vpn_ios/App/AppState.swift`**

В `installTunnel(into:)` убрать строку `killSwitch: preferences.killSwitch,` из вызова `vpn.install`. В `syncProfileWithAccount(vpn:)` убрать `killSwitch: preferences.killSwitch,` из вызова `vpn.applyPreferences`.

- [ ] **Step 6: Убрать переключатель из `vpn_ios/App/Screens/SettingsView.swift`**

Удалить `@State private var killSwitch: Bool = Preferences.shared.killSwitch`. В `protectionSection` удалить `Toggle("Kill switch", ...)` вместе с его `.onChange` и абзацем про AirPlay, а также разделитель `Divider()` перед фильтром — секция начинается сразу с фильтра рекламы. В `persist()` удалить строку `preferences.killSwitch = killSwitch` и аргумент `killSwitch: killSwitch` из вызова `applyPreferences`.

- [ ] **Step 7: Поправить остальные тесты**

В `vpn_ios/Tests/PreferencesTests.swift` удалить тест `testKillSwitchIsOffByDefault`.

В `vpn_ios/Tests/TunnelProfileBuilderTests.swift` и `vpn_ios/Tests/SuspendedAccountTests.swift` во всех вызовах `TunnelProfileBuilder.settings` убрать аргумент `killSwitch: false,`. В `SuspendedAccountTests` тест `testKillSwitchIsIndependentOfSuspension` удалить целиком — проверять больше нечего.

- [ ] **Step 8: Прогнать тесты и собрать оба проекта**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:|Executed .* tests|TEST"
```

Ожидается: 81 тест, 0 провалов (83 минус три удалённых плюс один новый).

```bash
xcodebuild -project VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD"
```

Ожидается `** BUILD SUCCEEDED **`.

- [ ] **Step 9: Коммит**

```bash
git add vpn_ios/Shared/Preferences.swift vpn_ios/App/TunnelProfileBuilder.swift vpn_ios/App/VPNManager.swift vpn_ios/App/AppState.swift vpn_ios/App/Screens/SettingsView.swift vpn_ios/Tests/PreferencesTests.swift vpn_ios/Tests/TunnelProfileBuilderTests.swift vpn_ios/Tests/SuspendedAccountTests.swift
git commit -m "feat(ios): убрать kill switch, флаг includeAllNetworks гасится явно"
```

---

### Task 7: Префиксы обхода доходят до туннеля

**Files:**
- Modify: `vpn_ios/App/Api.swift`
- Modify: `vpn_ios/App/VPNManager.swift`
- Modify: `vpn_ios/Tunnel/PacketTunnelProvider.swift`
- Test: `vpn_ios/Tests/ApiTests.swift`

**Interfaces:**
- Consumes: `RouteCalculator.allowedIPs(excluding:)` (Task 5).
- Produces: `TunnelConfig.bypassRoutes: [String]`; ключ `"bypassRoutes"` в `providerConfiguration` — массив строк.

- [ ] **Step 1: Написать падающий тест**

В `vpn_ios/Tests/ApiTests.swift` в класс `TunnelConfigDnsTests` добавить:

```swift
    func testDecodesBypassRoutes() throws {
        let json = """
        {"privateKey":"p","address":"10.8.0.5/24","dns":["1.1.1.1"],
         "bypassRoutes":["10.0.0.0/8"],
         "peer":{"publicKey":"pub","presharedKey":null,"endpoint":"1.2.3.4:51820",
                 "allowedIps":["0.0.0.0/0"],"persistentKeepalive":25}}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(TunnelConfig.self, from: json)

        XCTAssertEqual(decoded.bypassRoutes, ["10.0.0.0/8"])
    }

    func testMissingBypassRoutesDecodeAsEmpty() throws {
        let json = """
        {"privateKey":"p","address":"10.8.0.5/24","dns":["1.1.1.1"],
         "peer":{"publicKey":"pub","presharedKey":null,"endpoint":"1.2.3.4:51820",
                 "allowedIps":["0.0.0.0/0"],"persistentKeepalive":25}}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(TunnelConfig.self, from: json)

        XCTAssertEqual(decoded.bypassRoutes, [], "старый сервер без поля не должен ломать разбор")
    }
```

- [ ] **Step 2: Добавить поле в `vpn_ios/App/Api.swift`**

В структуру `TunnelConfig` добавить свойство после `dnsFiltered`:

```swift
    /// Подсети, трафик к которым идёт мимо туннеля. Пусто — обход не настроен.
    let bypassRoutes: [String]
```

В `enum CodingKeys` добавить `bypassRoutes`, а в `init(from:)` — строку:

```swift
        bypassRoutes = try c.decodeIfPresent([String].self, forKey: .bypassRoutes) ?? []
```

- [ ] **Step 3: Класть список в профиль в `vpn_ios/App/VPNManager.swift`**

В методе `install` заменить строку с `providerConfiguration`:

```swift
        // Конфиг лежит в системном хранилище профиля, а не в файлах приложения.
        // Префиксы обхода кладём списком как есть: дополнение к ним считает
        // расширение при старте, поэтому в профиле лежат сотни строк, а не тысячи.
        proto.providerConfiguration = [
            "wgQuickConfig": settings.wgQuickConfig,
            "bypassRoutes": config.bypassRoutes,
        ]
```

- [ ] **Step 4: Применить дополнение в `vpn_ios/Tunnel/PacketTunnelProvider.swift`**

В `startTunnel` после получения `configuration` и перед вызовом `adapter.start` вставить:

```swift
        // Маршруты в обход туннеля: пир получает всё, кроме исключённых подсетей.
        // Пустой список или неудачный расчёт означают полный туннель — то есть
        // поведение до появления обхода, а не отсутствие связи.
        let bypass = proto.providerConfiguration?["bypassRoutes"] as? [String] ?? []
        let ranges = bypass.isEmpty
            ? []
            : RouteCalculator.allowedIPs(excluding: bypass).compactMap { IPAddressRange(from: $0) }

        var patched = configuration
        if !ranges.isEmpty, !configuration.peers.isEmpty {
            var peers = configuration.peers
            peers[0].allowedIPs = ranges
            patched = TunnelConfiguration(name: configuration.name,
                                          interface: configuration.interface,
                                          peers: peers)
        } else if !bypass.isEmpty {
            NSLog("[Overlay] обход не применён — поднимаем полный туннель")
        }
```

и заменить в вызове адаптера `tunnelConfiguration: configuration` на `tunnelConfiguration: patched`.

- [ ] **Step 5: Прогнать тесты и собрать проект с туннелем**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:|Executed .* tests|TEST"
```

Ожидается: 83 теста, 0 провалов.

```bash
xcodebuild -project VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD"
```

Ожидается `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Коммит**

```bash
git add vpn_ios/App/Api.swift vpn_ios/App/VPNManager.swift vpn_ios/Tunnel/PacketTunnelProvider.swift vpn_ios/Tests/ApiTests.swift
git commit -m "feat(ios): трафик к исключённым подсетям идёт мимо туннеля"
```

---

## Что проверяется только на устройстве

Ни симулятор, ни юнит-тесты не покажут главного — что обход действительно работает:

1. Туннель поднят, сайт с определением адреса показывает Нидерланды.
2. Банковское приложение при этом работает.
3. То же самое на сотовой сети, а не только по Wi-Fi. Если на сотовой банк не открывается — сработало известное ограничение с IPv6 из раздела 5 спецификации.
4. У того, кто раньше включал kill switch, после обновления обход тоже работает: это проверка на явное гашение `includeAllNetworks` в уже сохранённом профиле.
5. Пустое поле «Номера AS» в админке → приложение поднимает полный туннель, всё как до появления обхода.
