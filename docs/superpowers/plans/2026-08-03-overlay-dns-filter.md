# Overlay — фильтрующий DNS. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю переключатель «блокировать рекламу и трекеры»: на NL-сервере поднимается фильтрующий резолвер, приложение выбирает, какой DNS писать в конфигурацию туннеля.

**Architecture:** AdGuard Home живёт в Docker рядом с wg-easy и доступен только внутри его сети. Адреса обоих резолверов — текстовые настройки в админке, а не константы. `POST /api/device/tunnel` отдаёт оба набора сразу (`dns` и `dnsFiltered`), поэтому переключение фильтра происходит на устройстве без похода на сервер. Текст wg-quick собирается на устройстве, так что выбор набора — это выбор одной строки в конфигурации.

**Tech Stack:** Node.js 20 + TypeScript (NodeNext ESM), express 5, pg, vitest 2, Docker Compose, AdGuard Home; Swift 5, SwiftUI, NetworkExtension, XCTest, XcodeGen.

## Global Constraints

- Спецификация: `docs/superpowers/specs/2026-08-03-ios-overlay-redesign-design.md`, разделы 5 и 6.
- **Счётчика заблокированного нет.** AdGuard Home отдаёт в `/control/stats` глобальные счётчики и топ клиентов по общему числу запросов; разбивки «сколько заблокировано у клиента» без журнала запросов не существует. Журнал выключен, поэтому карточка показывает состояние фильтра, а не число. Эндпоинта `/api/device/dns-stats` в этом плане нет.
- **Резолвер не публикуется наружу.** Порт 53 остаётся внутри docker-сети; никаких `ports:` для DNS. Открытый DNS в интернете находят за сутки и используют для усиления DDoS-атак. Веб-интерфейс AdGuard публикуется только на `127.0.0.1` и открывается через SSH-туннель.
- **wg-easy не трогаем.** Многодомным становится AdGuard, а не wg-easy: второй интерфейс меняет у wg-easy маршрут по умолчанию, а правило маскарадинга остаётся привязанным к первому, и у VPN-клиентов пропадает интернет. Правило записано в `docs/DEPLOY.md`.
- Адреса резолверов — текстовые настройки `dns_default` и `dns_filtered`, редактируются в админке. Формат — адреса через запятую (`1.1.1.1, 1.0.0.1`). Пустая строка означает «не задано».
- Фильтр **никогда не должен мешать подключению**: если `dnsFiltered` пуст, переключатель недоступен, а туннель поднимается на обычном DNS.
- Переключение фильтра меняет конфигурацию WireGuard, то есть **роняет туннель на пару секунд**. Скрыть нельзя, только предупредить в интерфейсе.
- Миграции: следующий свободный номер — `007`. Применяются через `set -a; . ./.env; set +a; ./db/migrate.sh`.
- Бэкенд-тесты: `cd services/core && npm test`. Сейчас 172 теста в 18 файлах, все зелёные.
- iOS-тесты: `xcodebuild -project vpn_ios/VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test`. Сейчас 63 теста.
- Проект iOS генерируется XcodeGen: после правки спек — `cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml`. Пересобирать надо **обе** спеки, иначе тесты пойдут по устаревшему `VPN404UI.xcodeproj`.
- Сборка проекта с туннелем из командной строки — с `CODE_SIGNING_ALLOWED=NO`: она проверяет компиляцию. Подпись и установка делаются из Xcode.
- `vpn_ios/*.xcodeproj/` в `.gitignore` — в `git add` его не включать.
- Язык интерфейса, комментариев и сообщений об ошибках — русский.

## Структура файлов

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `db/migrations/007_dns_settings.sql` | Заводит настройки `dns_default` и `dns_filtered` |

**Меняется — бэкенд:**

| Файл | Что |
|---|---|
| `services/core/src/settings.ts` | Экспортируемые `getTextSetting` и `parseDnsList` |
| `services/core/src/bot.ts` | Убирает свою локальную копию `getTextSetting` |
| `services/core/src/device-api.ts` | Ответ туннеля отдаёт `dns` из настроек и `dnsFiltered` |
| `services/core/src/admin-api.ts` | Новые ключи в `TEXT_SETTINGS` |
| `services/core/tests/helpers/testdb.ts` | Сброс новых настроек между файлами тестов |
| `apps/admin/src/pages/Settings.tsx` | Подписи к полям |
| `docker-compose.yml` | Сервис `adguard` |
| `docs/DEPLOY.md`, `docs/ARCHITECTURE.md` | Развёртывание и описание |

**Меняется — iOS:**

| Файл | Что |
|---|---|
| `vpn_ios/App/Api.swift` | Поле `dnsFiltered`, метод `wgQuick(filtered:)` вместо свойства |
| `vpn_ios/Shared/Preferences.swift` | Флаги `dnsFilter` и `dnsFilterAvailable` |
| `vpn_ios/App/TunnelProfileBuilder.swift` | Выбор набора DNS |
| `vpn_ios/App/VPNManager.swift` | Новый параметр в `install` |
| `vpn_ios/App/AppState.swift` | Прокидывает флаг, запоминает доступность фильтра |
| `vpn_ios/App/Screens/SettingsView.swift` | Переключатель с предупреждением |
| `vpn_ios/App/Screens/DashboardView.swift` | Мини-карточка состояния фильтра |

---

### Task 1: Общее чтение текстовых настроек и разбор списка адресов

Сейчас `getTextSetting` — приватная функция внутри `bot.ts`, а `device-api.ts` она тоже понадобится. Выносим в `settings.ts` и заодно добавляем разбор списка адресов — чистую функцию, которую можно проверить тестом.

**Files:**
- Modify: `services/core/src/settings.ts`
- Modify: `services/core/src/bot.ts:16-20`
- Test: `services/core/tests/settings.test.ts`

**Interfaces:**
- Consumes: `Queryable` из `settings.ts`.
- Produces: `getTextSetting(q: Queryable, key: string): Promise<string>`; `parseDnsList(raw: string): string[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `services/core/tests/settings.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { getTextSetting, parseDnsList } from "../src/settings.js";

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

describe("parseDnsList", () => {
  it("разбирает адреса через запятую", () => {
    expect(parseDnsList("1.1.1.1, 1.0.0.1")).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("пустая строка даёт пустой список", () => {
    expect(parseDnsList("")).toEqual([]);
    expect(parseDnsList("   ")).toEqual([]);
  });

  it("выбрасывает пустые элементы и лишние пробелы", () => {
    expect(parseDnsList(" 10.8.0.53 ,, ")).toEqual(["10.8.0.53"]);
  });

  it("одиночный адрес без запятых", () => {
    expect(parseDnsList("172.18.0.53")).toEqual(["172.18.0.53"]);
  });
});

describe("getTextSetting", () => {
  it("возвращает текст настройки", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='support_contact'", ["@help"]);

    expect(await getTextSetting(pool, "support_contact")).toBe("@help");
  });

  it("несуществующий ключ даёт пустую строку", async () => {
    expect(await getTextSetting(pool, "нет_такого_ключа")).toBe("");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/settings.test.ts
```

Ожидается: `does not provide an export named 'getTextSetting'`.

- [ ] **Step 3: Дописать `services/core/src/settings.ts`**

Добавить в конец файла:

```ts
/** Текстовая настройка (в jsonb лежит строка). Отсутствующий ключ — пустая строка. */
export async function getTextSetting(q: Queryable, key: string): Promise<string> {
  const { rows: [r] } = await q.query(
    "SELECT value #>> '{}' AS value FROM settings WHERE key=$1", [key]);
  return typeof r?.value === "string" ? r.value : "";
}

/** «1.1.1.1, 1.0.0.1» → ["1.1.1.1", "1.0.0.1"]. Пустая строка → пустой список. */
export function parseDnsList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Убрать дубликат из `services/core/src/bot.ts`**

Удалить локальную функцию:

```ts
async function getTextSetting(key: string): Promise<string> {
  const { rows: [r] } = await pool.query(
    "SELECT value #>> '{}' AS text FROM settings WHERE key=$1", [key]);
  return r?.text ?? "";
}
```

В импортах `bot.ts` добавить `getTextSetting` к тому, что уже берётся из `./settings.js`. Если импорта из `settings.js` в файле ещё нет — добавить строку:

```ts
import { getTextSetting } from "./settings.js";
```

Единственный вызов в файле поменять с `getTextSetting("support_contact")` на:

```ts
    const support = await getTextSetting(pool, "support_contact");
```

- [ ] **Step 5: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 178 тестов в 19 файлах, 0 провалов (172 существующих + 6 новых).

- [ ] **Step 6: Коммит**

```bash
git add services/core/src/settings.ts services/core/src/bot.ts services/core/tests/settings.test.ts
git commit -m "refactor(core): общее чтение текстовых настроек и разбор списка DNS"
```

---

### Task 2: Настройки адресов DNS в базе и админке

**Files:**
- Create: `db/migrations/007_dns_settings.sql`
- Modify: `services/core/src/admin-api.ts:26`
- Modify: `services/core/tests/helpers/testdb.ts`
- Modify: `apps/admin/src/pages/Settings.tsx:15-17`
- Test: `services/core/tests/admin-api.test.ts`

**Interfaces:**
- Produces: настройки `dns_default` и `dns_filtered` в таблице `settings`, редактируемые через `GET`/`PUT /admin/api/settings` в поле `textSettings`.

- [ ] **Step 1: Создать `db/migrations/007_dns_settings.sql`**

```sql
-- Адреса резолверов: обычного и фильтрующего рекламу с трекерами.
-- Пустая строка означает «не задано»: фильтр тогда недоступен в приложении,
-- а туннель поднимается на том DNS, который отдаёт wg-easy.
INSERT INTO settings(key, value) VALUES
  ('dns_default', '""'),
  ('dns_filtered', '""')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Применить миграцию локально**

```bash
set -a; . ./.env; set +a; ./db/migrate.sh
```

Ожидается строка о применении `007_dns_settings.sql`.

- [ ] **Step 3: Написать падающий тест**

В `services/core/tests/admin-api.test.ts` добавить внутрь блока про настройки:

```ts
  it("отдаёт и сохраняет адреса DNS", async () => {
    const saved = await call("/admin/api/settings", {
      method: "PUT",
      body: { dns_default: "1.1.1.1, 1.0.0.1", dns_filtered: "172.18.0.53" },
    });
    expect(saved.status).toBe(200);

    const { body } = await call("/admin/api/settings");
    const texts = Object.fromEntries(
      (body.textSettings as { key: string; value: string }[]).map((s) => [s.key, s.value]));
    expect(texts.dns_default).toBe("1.1.1.1, 1.0.0.1");
    expect(texts.dns_filtered).toBe("172.18.0.53");
  });
```

- [ ] **Step 4: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/admin-api.test.ts -t "адреса DNS"
```

Ожидается провал: `dns_default` не входит в `TEXT_SETTINGS`, поэтому `PUT` его игнорирует и в ответе `GET` его нет — `expected undefined to be '1.1.1.1, 1.0.0.1'`.

- [ ] **Step 5: Расширить `TEXT_SETTINGS`**

В `services/core/src/admin-api.ts` заменить строку 26:

```ts
const TEXT_SETTINGS = ["support_contact"];
```

на:

```ts
const TEXT_SETTINGS = ["support_contact", "dns_default", "dns_filtered"];
```

- [ ] **Step 6: Сбрасывать новые настройки между файлами тестов**

В `services/core/tests/helpers/testdb.ts` сброс текстовых настроек уже есть — достаточно дописать два ключа в существующий список. Заменить:

```ts
  await pool.query(
    "UPDATE settings SET value = to_jsonb(''::text) WHERE key IN ('support_contact','bot_username')");
```

на:

```ts
  await pool.query(
    `UPDATE settings SET value = to_jsonb(''::text)
     WHERE key IN ('support_contact','bot_username','dns_default','dns_filtered')`);
```

- [ ] **Step 7: Добавить подписи в админке**

В `apps/admin/src/pages/Settings.tsx` заменить:

```tsx
const TEXT_LABELS: Record<string, string> = {
  support_contact: "Контакт поддержки (@username)",
};
```

на:

```tsx
const TEXT_LABELS: Record<string, string> = {
  support_contact: "Контакт поддержки (@username)",
  dns_default: "DNS обычный (через запятую)",
  dns_filtered: "DNS с фильтром рекламы (через запятую, пусто — фильтр выключен)",
};
```

- [ ] **Step 8: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 179 тестов, 0 провалов.

- [ ] **Step 9: Коммит**

```bash
git add db/migrations/007_dns_settings.sql services/core/src/admin-api.ts services/core/tests/helpers/testdb.ts services/core/tests/admin-api.test.ts apps/admin/src/pages/Settings.tsx
git commit -m "feat(admin): адреса обычного и фильтрующего DNS в настройках"
```

---

### Task 3: Ответ туннеля отдаёт оба набора DNS

**Files:**
- Modify: `services/core/src/device-api.ts:164-193`
- Test: `services/core/tests/device-api.test.ts`

**Interfaces:**
- Consumes: `getTextSetting`, `parseDnsList` (Task 1); настройки `dns_default`, `dns_filtered` (Task 2).
- Produces: `POST /api/device/tunnel` возвращает поле `dnsFiltered: string[]` рядом с существующим `dns: string[]`. Пустой массив означает «фильтр на сервере не настроен».

- [ ] **Step 1: Написать падающий тест**

В `services/core/tests/device-api.test.ts` добавить:

```ts
  it("отдаёт пустой dnsFiltered, пока фильтр не настроен", async () => {
    const code = await makeCode();
    const { body: redeemed } = await call("/api/redeem", { method: "POST", body: { code } });

    const { status, body } = await call("/api/device/tunnel", {
      token: redeemed.token, method: "POST",
    });

    expect(status).toBe(200);
    expect(body.dnsFiltered).toEqual([]);
    expect(body.dns).toEqual(["1.1.1.1"]);
  });

  it("подставляет адреса DNS из настроек", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_default'",
                     ["9.9.9.9, 149.112.112.112"]);
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_filtered'",
                     ["172.18.0.53"]);
    const code = await makeCode();
    const { body: redeemed } = await call("/api/redeem", { method: "POST", body: { code } });

    const { body } = await call("/api/device/tunnel", { token: redeemed.token, method: "POST" });

    expect(body.dns).toEqual(["9.9.9.9", "149.112.112.112"]);
    expect(body.dnsFiltered).toEqual(["172.18.0.53"]);
  });

  it("повторный запрос туннеля тоже отдаёт оба набора", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='dns_filtered'",
                     ["172.18.0.53"]);
    const code = await makeCode();
    const { body: redeemed } = await call("/api/redeem", { method: "POST", body: { code } });
    await call("/api/device/tunnel", { token: redeemed.token, method: "POST" });

    const { body } = await call("/api/device/tunnel", { token: redeemed.token, method: "POST" });

    expect(body.dnsFiltered).toEqual(["172.18.0.53"], "второй вызов идёт другой веткой кода");
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd services/core && npx vitest run tests/device-api.test.ts -t "dnsFiltered"
```

Ожидается: `expected undefined to deeply equal []`.

- [ ] **Step 3: Переписать обработчик туннеля**

В `services/core/src/device-api.ts` заменить тело `router.post("/api/device/tunnel", ...)` целиком:

```ts
  router.post("/api/device/tunnel", async (req: DeviceRequest, res, next) => {
    try {
      const { rows: [row] } = await db.query(
        `SELECT d.wg_client_id, d.name, u.id AS user_id, u.status
         FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
        [req.device!.id]);
      if (row.status === "blocked") {
        res.status(403).json({ error: "blocked" });
        return;
      }
      if (row.status !== "active") {
        res.status(402).json({ error: "suspended" });
        return;
      }

      let tunnel;
      if (row.wg_client_id) {
        tunnel = await wg.getTunnel(row.wg_client_id);
      } else {
        const created = await wg.createClient(`404vpn-${req.device!.id.slice(0, 8)}`);
        await db.query(
          "UPDATE devices SET wg_client_id=$2, wg_public_key=$3, last_seen_at=now() WHERE id=$1",
          [req.device!.id, created.clientId, created.publicKey]);
        tunnel = created.tunnel;
      }

      // Адреса резолверов задаются в админке. dns_default пуст — оставляем то,
      // что отдал wg-easy; dns_filtered пуст — фильтр в приложении недоступен.
      const dnsDefault = parseDnsList(await getTextSetting(db, "dns_default"));
      const dnsFiltered = parseDnsList(await getTextSetting(db, "dns_filtered"));

      res.json({
        ...tunnel,
        dns: dnsDefault.length > 0 ? dnsDefault : tunnel.dns,
        dnsFiltered,
      });
    } catch (e) {
      if (e instanceof WgNotConfiguredError) {
        res.status(503).json({ error: "wg_unavailable" });
        return;
      }
      next(e);
    }
  });
```

- [ ] **Step 4: Поправить импорт**

В `services/core/src/device-api.ts` строку импорта настроек заменить:

```ts
import { getSetting } from "./settings.js";
```

на:

```ts
import { getSetting, getTextSetting, parseDnsList } from "./settings.js";
```

- [ ] **Step 5: Прогнать тесты**

```bash
cd services/core && npm test
```

Ожидается: 182 теста, 0 провалов.

- [ ] **Step 6: Коммит**

```bash
git add services/core/src/device-api.ts services/core/tests/device-api.test.ts
git commit -m "feat(api): ответ туннеля отдаёт обычный и фильтрующий DNS"
```

---

### Task 4: AdGuard Home в Docker и инструкция по развёртыванию

Инфраструктурная задача: автоматических тестов нет, проверка — команды в инструкции.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Produces: сервис `adguard` со статическим адресом в сети wg-easy; переменная `ADGUARD_IP` в `.env`.

- [ ] **Step 1: Добавить сервис в `docker-compose.yml`**

Перед блоком `networks:` добавить:

```yaml
  adguard:
    image: adguard/adguardhome:latest
    volumes:
      - adguard_work:/opt/adguardhome/work
      - adguard_conf:/opt/adguardhome/conf
    # Веб-интерфейс только на loopback — открывается через SSH-туннель.
    # Порт 53 наружу НЕ публикуется: открытый резолвер за сутки находят
    # и начинают использовать для усиления DDoS-атак.
    ports:
      - "127.0.0.1:3000:3000"
    # Статический адрес в сети wg-easy: динамический уедет при перезапуске,
    # и фильтр у всех клиентов отвалится, потому что адрес зашит в их конфиг.
    networks:
      wgnet:
        ipv4_address: ${ADGUARD_IP:?set ADGUARD_IP in .env}
    restart: unless-stopped
```

В блок `volumes:` в конце файла добавить две строки:

```yaml
  adguard_work:
  adguard_conf:
```

- [ ] **Step 2: Дописать `.env.example`**

Добавить в конец:

```bash
# Статический адрес AdGuard Home в сети wg-easy. Подсеть узнать командой:
#   docker network inspect ${WG_NETWORK:-docker-app_default} --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# Взять свободный адрес из этой подсети, например .53 — легко запомнить по номеру порта DNS.
ADGUARD_IP=172.18.0.53
```

- [ ] **Step 3: Дописать раздел в `docs/DEPLOY.md`**

Добавить в конец файла:

````markdown
## Фаза 8: фильтрующий DNS

Блокировка рекламы и трекеров на уровне DNS. Резолвер живёт рядом с wg-easy и виден только внутри docker-сети.

1. **Узнать подсеть сети wg-easy и выбрать адрес:**

   ```bash
   docker network inspect ${WG_NETWORK:-docker-app_default} --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
   ```

   Из полученной подсети взять свободный адрес и записать в `.env`:

   ```bash
   ADGUARD_IP=172.18.0.53
   ```

   > **wg-easy к чужим сетям не подключать.** Многодомным становится AdGuard. Если подключить вторым интерфейсом сам wg-easy, у него сменится маршрут по умолчанию, а маскарадинг останется на первом интерфейсе — у VPN-клиентов пропадёт интернет.

2. **Поднять контейнер:**

   ```bash
   git pull && docker compose up -d adguard && set -a; . ./.env; set +a; ./db/migrate.sh
   ```

3. **Первичная настройка через SSH-туннель** (веб-интерфейс наружу не смотрит):

   ```bash
   ssh -L 3000:127.0.0.1:3000 root@195.14.118.198
   ```

   Открыть `http://127.0.0.1:3000` в браузере и пройти мастер:

   - **Веб-интерфейс:** порт `3000`, все интерфейсы.
   - **DNS-сервер:** порт `53`, все интерфейсы. Наружу он всё равно не опубликован.
   - Задать логин и пароль администратора.

4. **Выключить журнал запросов** — это обещание в политике конфиденциальности, а не косметика. Настройки → Настройки журнала → снять «Включить журнал запросов». Там же Настройки → Общие настройки → статистику можно оставить: она агрегатная и доменов не хранит.

5. **Проверить резолв изнутри сети:**

   ```bash
   docker compose exec core sh -c "nslookup doubleclick.net $ADGUARD_IP"
   ```

   Ожидается `0.0.0.0` — домен заблокирован фильтром. Для обычного домена:

   ```bash
   docker compose exec core sh -c "nslookup example.com $ADGUARD_IP"
   ```

   Ожидается настоящий адрес.

6. **Проверить, что снаружи резолвер недоступен** (с любой другой машины):

   ```bash
   nslookup example.com 195.14.118.198
   ```

   Ожидается таймаут или отказ. Если пришёл ответ — порт 53 опубликован по ошибке, это надо чинить немедленно.

7. **Вписать адреса в админке** (Настройки → DNS): `DNS с фильтром рекламы` = значение `ADGUARD_IP`. Поле `DNS обычный` можно оставить пустым — тогда берётся тот DNS, который отдаёт wg-easy.

8. **Проверить в приложении:** Настройки → Защита → включить «Блокировать рекламу и трекеры». Туннель переподключится, после чего реклама на сайтах должна пропасть. Выключение возвращает обычный резолвер, тоже с переподключением.
````

- [ ] **Step 4: Дописать раздел в `docs/ARCHITECTURE.md`**

Найти раздел про WireGuard-провижининг и добавить после него:

```markdown
## Фильтрующий DNS

AdGuard Home в Docker рядом с wg-easy, подключён к его сети со **статическим** адресом (`ADGUARD_IP`): динамический уедет при перезапуске, а адрес зашит в конфигурации всех выданных клиентов.

Наружу резолвер не публикуется — только веб-интерфейс на `127.0.0.1:3000`, доступный через SSH-туннель. Открытый DNS в интернете находят за сутки и используют для усиления DDoS-атак.

**Журнал запросов выключен.** Для VPN-сервиса хранение истории DNS-запросов — ровно то, чего обещают не делать. Следствие: счётчика «сколько заблокировано у этого пользователя» не существует — AdGuard отдаёт только глобальные счётчики и топ клиентов по общему числу запросов, а разбивка по заблокированным доступна лишь через журнал. В приложении карточка показывает состояние фильтра, а не число.

Адреса обоих резолверов — текстовые настройки `dns_default` и `dns_filtered` в админке, формат «адреса через запятую». `POST /api/device/tunnel` отдаёт оба набора сразу, поэтому переключение фильтра происходит на устройстве без похода на сервер. Пустой `dns_filtered` означает, что фильтр не настроен: переключатель в приложении недоступен, туннель поднимается на обычном DNS. Фильтр никогда не мешает подключению.

Адреса DNS входят в конфигурацию WireGuard, поэтому переключение фильтра — это смена конфига и переподключение туннеля на пару секунд. Скрыть нельзя, интерфейс предупреждает заранее.
```

- [ ] **Step 5: Проверить, что compose-файл корректен**

```bash
docker compose config --quiet && echo "compose в порядке"
```

Ожидается `compose в порядке`. Ошибка про `ADGUARD_IP` означает, что переменная не задана в локальном `.env` — добавить туда любой адрес, локально контейнер не поднимается.

- [ ] **Step 6: Коммит**

```bash
git add docker-compose.yml .env.example docs/DEPLOY.md docs/ARCHITECTURE.md
git commit -m "feat(infra): AdGuard Home как фильтрующий резолвер"
```

---

### Task 5: Конфигурация туннеля на устройстве знает два набора DNS

**Files:**
- Modify: `vpn_ios/App/Api.swift:11-32`
- Test: `vpn_ios/Tests/ApiTests.swift`

**Interfaces:**
- Produces: `TunnelConfig.dnsFiltered: [String]`; `TunnelConfig.isFilterAvailable: Bool`; `TunnelConfig.wgQuick(filtered: Bool) -> String`. Свойство `wgQuickConfig` **удаляется** — все вызовы переходят на метод.

- [ ] **Step 1: Написать падающий тест**

В `vpn_ios/Tests/ApiTests.swift` добавить новый класс:

```swift
final class TunnelConfigDnsTests: XCTestCase {
    private func config(dns: [String], filtered: [String]) -> TunnelConfig {
        TunnelConfig(privateKey: "priv", address: "10.8.0.5/24", dns: dns, dnsFiltered: filtered,
                     peer: TunnelPeer(publicKey: "pub", presharedKey: nil,
                                      endpoint: "1.2.3.4:51820",
                                      allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))
    }

    func testPlainConfigUsesDefaultResolvers() {
        let text = config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).wgQuick(filtered: false)

        XCTAssertTrue(text.contains("DNS = 1.1.1.1"))
        XCTAssertFalse(text.contains("10.8.0.53"))
    }

    func testFilteredConfigUsesFilteringResolvers() {
        let text = config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).wgQuick(filtered: true)

        XCTAssertTrue(text.contains("DNS = 10.8.0.53"))
        XCTAssertFalse(text.contains("1.1.1.1"))
    }

    func testFilterUnavailableFallsBackToDefault() {
        let text = config(dns: ["1.1.1.1"], filtered: []).wgQuick(filtered: true)

        XCTAssertTrue(text.contains("DNS = 1.1.1.1"),
                      "фильтр не настроен на сервере — подключение всё равно должно состояться")
    }

    func testFilterAvailability() {
        XCTAssertTrue(config(dns: ["1.1.1.1"], filtered: ["10.8.0.53"]).isFilterAvailable)
        XCTAssertFalse(config(dns: ["1.1.1.1"], filtered: []).isFilterAvailable)
    }

    func testDecodesResponseWithoutDnsFiltered() throws {
        let json = """
        {"privateKey":"p","address":"10.8.0.5/24","dns":["1.1.1.1"],
         "peer":{"publicKey":"pub","presharedKey":null,"endpoint":"1.2.3.4:51820",
                 "allowedIps":["0.0.0.0/0"],"persistentKeepalive":25}}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(TunnelConfig.self, from: json)

        XCTAssertEqual(decoded.dnsFiltered, [], "старый сервер без поля не должен ломать разбор")
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd vpn_ios && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:" | head -3
```

Ожидается: `extra argument 'dnsFiltered' in call`.

- [ ] **Step 3: Переписать `TunnelConfig` в `vpn_ios/App/Api.swift`**

Заменить структуру целиком:

```swift
struct TunnelConfig: Equatable {
    let privateKey: String
    let address: String
    /// Обычные резолверы.
    let dns: [String]
    /// Резолверы с фильтром рекламы. Пусто — фильтр на сервере не настроен.
    let dnsFiltered: [String]
    let peer: TunnelPeer

    var isFilterAvailable: Bool { !dnsFiltered.isEmpty }

    /// Текст в формате wg-quick — именно его понимает WireGuardKit.
    /// Фильтр никогда не мешает подключению: если он не настроен на сервере,
    /// молча берём обычные резолверы.
    func wgQuick(filtered: Bool) -> String {
        let resolvers = filtered && isFilterAvailable ? dnsFiltered : dns

        var lines = ["[Interface]", "PrivateKey = \(privateKey)", "Address = \(address)"]
        if !resolvers.isEmpty { lines.append("DNS = \(resolvers.joined(separator: ", "))") }
        lines.append("")
        lines.append("[Peer]")
        lines.append("PublicKey = \(peer.publicKey)")
        if let psk = peer.presharedKey, !psk.isEmpty { lines.append("PresharedKey = \(psk)") }
        lines.append("AllowedIPs = \(peer.allowedIps.joined(separator: ", "))")
        lines.append("Endpoint = \(peer.endpoint)")
        if let keepalive = peer.persistentKeepalive {
            lines.append("PersistentKeepalive = \(keepalive)")
        }
        return lines.joined(separator: "\n")
    }
}

/// Разбор вынесен в расширение, чтобы у структуры остался обычный инициализатор:
/// он нужен тестам. Поле dnsFiltered необязательное — сервер мог быть не обновлён.
extension TunnelConfig: Codable {
    enum CodingKeys: String, CodingKey {
        case privateKey, address, dns, dnsFiltered, peer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        privateKey = try c.decode(String.self, forKey: .privateKey)
        address = try c.decode(String.self, forKey: .address)
        dns = try c.decode([String].self, forKey: .dns)
        dnsFiltered = try c.decodeIfPresent([String].self, forKey: .dnsFiltered) ?? []
        peer = try c.decode(TunnelPeer.self, forKey: .peer)
    }
}
```

- [ ] **Step 4: Прогнать тесты**

Компиляция упадёт: `TunnelProfileBuilder` и его тест ещё зовут `config.wgQuickConfig`. Это чинится в Task 6 — здесь достаточно убедиться, что ошибки остались только в этих двух местах.

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:" | sort -u
```

Ожидается: ошибки только в `TunnelProfileBuilder.swift` и `TunnelProfileBuilderTests.swift` про `wgQuickConfig`.

- [ ] **Step 5: Коммит вместе с Task 6**

Отдельного коммита у этой задачи нет: без Task 6 проект не собирается. Переходить к Task 6 сразу.

---

### Task 6: Выбор фильтра доходит до профиля туннеля

**Files:**
- Modify: `vpn_ios/Shared/Preferences.swift`
- Modify: `vpn_ios/App/TunnelProfileBuilder.swift`
- Modify: `vpn_ios/App/VPNManager.swift`
- Modify: `vpn_ios/App/AppState.swift`
- Test: `vpn_ios/Tests/PreferencesTests.swift`
- Test: `vpn_ios/Tests/TunnelProfileBuilderTests.swift`

**Interfaces:**
- Consumes: `TunnelConfig.wgQuick(filtered:)`, `TunnelConfig.isFilterAvailable` (Task 5).
- Produces: `Preferences.dnsFilter: Bool`, `Preferences.dnsFilterAvailable: Bool`; `TunnelProfileBuilder.settings(config:killSwitch:autoConnect:accountSuspended:dnsFilter:) -> TunnelProfileSettings`; `VPNManager.install(config:killSwitch:autoConnect:trustedNetworks:accountSuspended:dnsFilter:)`.

- [ ] **Step 1: Написать падающие тесты**

В `vpn_ios/Tests/PreferencesTests.swift` добавить:

```swift
    func testDnsFilterIsOffByDefault() {
        XCTAssertFalse(preferences.dnsFilter)
    }

    func testDnsFilterRoundTrip() {
        preferences.dnsFilter = true

        XCTAssertTrue(Preferences(defaults: defaults).dnsFilter)
    }

    func testDnsFilterAvailabilityRoundTrip() {
        preferences.dnsFilterAvailable = true

        XCTAssertTrue(Preferences(defaults: defaults).dnsFilterAvailable)
    }
```

В `vpn_ios/Tests/TunnelProfileBuilderTests.swift` заменить объявление `config` и тест про перенос конфига:

```swift
    private let config = TunnelConfig(
        privateKey: "aaa",
        address: "10.8.0.5/24",
        dns: ["1.1.1.1"],
        dnsFiltered: ["10.8.0.53"],
        peer: TunnelPeer(publicKey: "bbb", presharedKey: nil,
                         endpoint: "195.14.118.198:51820",
                         allowedIps: ["0.0.0.0/0"], persistentKeepalive: 25))
```

```swift
    func testConfigTextIsCarriedThrough() {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                     autoConnect: .off, accountSuspended: false,
                                                     dnsFilter: false)

        XCTAssertEqual(settings.wgQuickConfig, config.wgQuick(filtered: false))
    }

    func testDnsFilterSelectsFilteringResolvers() {
        let on = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                               autoConnect: .off, accountSuspended: false,
                                               dnsFilter: true)

        XCTAssertTrue(on.wgQuickConfig.contains("DNS = 10.8.0.53"))
    }

    func testDnsFilterOffKeepsPlainResolvers() {
        let off = TunnelProfileBuilder.settings(config: config, killSwitch: false,
                                                autoConnect: .off, accountSuspended: false,
                                                dnsFilter: false)

        XCTAssertTrue(off.wgQuickConfig.contains("DNS = 1.1.1.1"))
    }
```

В остальных тестах этого файла (`testServerAddressIsAppNameNotIP`, `testKillSwitchMapsToIncludeAllNetworks`, `testOnDemandEnabledWhenModeSet`, `testSuspendedAccountDisablesOnDemand`) добавить в каждый вызов `TunnelProfileBuilder.settings` аргумент `dnsFilter: false` последним.

В `vpn_ios/Tests/SuspendedAccountTests.swift` — то же самое: в объявление `config` добавить `dnsFiltered: []`, а во все три вызова `TunnelProfileBuilder.settings` добавить `dnsFilter: false`.

- [ ] **Step 2: Дописать `vpn_ios/Shared/Preferences.swift`**

Добавить два свойства перед блоком `private enum Key`:

```swift
    /// Включён ли фильтр рекламы и трекеров.
    var dnsFilter: Bool {
        get { defaults.bool(forKey: Key.dnsFilter) }
        nonmutating set { defaults.set(newValue, forKey: Key.dnsFilter) }
    }

    /// Настроен ли фильтр на сервере. Запоминается при получении конфигурации,
    /// чтобы экран настроек знал, показывать переключатель активным или нет,
    /// ещё до первого подключения после запуска.
    var dnsFilterAvailable: Bool {
        get { defaults.bool(forKey: Key.dnsFilterAvailable) }
        nonmutating set { defaults.set(newValue, forKey: Key.dnsFilterAvailable) }
    }
```

И два ключа внутрь `private enum Key`:

```swift
        static let dnsFilter = "dnsFilter"
        static let dnsFilterAvailable = "dnsFilterAvailable"
```

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
                         killSwitch: Bool,
                         autoConnect: AutoConnectMode,
                         accountSuspended: Bool,
                         dnsFilter: Bool) -> TunnelProfileSettings {
        TunnelProfileSettings(
            // поле только для показа: адрес подключения система берёт из конфигурации WireGuard
            serverAddress: VPNManager.displayName,
            wgQuickConfig: config.wgQuick(filtered: dnsFilter),
            includeAllNetworks: killSwitch,
            // при исчерпанном балансе сервер выключает пир: туннель не поднимется никогда,
            // а правила будут блокировать трафик — человек останется вообще без интернета
            onDemandEnabled: autoConnect != .off && !accountSuspended)
    }
}
```

- [ ] **Step 4: Расширить `install` в `vpn_ios/App/VPNManager.swift`**

Заменить сигнатуру и первый вызов внутри метода:

```swift
    func install(config: TunnelConfig,
                 killSwitch: Bool,
                 autoConnect: AutoConnectMode,
                 trustedNetworks: [String],
                 accountSuspended: Bool,
                 dnsFilter: Bool) async throws {
        let settings = TunnelProfileBuilder.settings(config: config, killSwitch: killSwitch,
                                                     autoConnect: autoConnect,
                                                     accountSuspended: accountSuspended,
                                                     dnsFilter: dnsFilter)
```

Остальное тело метода не трогать.

- [ ] **Step 5: Прокинуть флаг в `vpn_ios/App/AppState.swift`**

Заменить тело `installTunnel(into:)`:

```swift
    /// Забирает конфигурацию туннеля и ставит её в системный профиль.
    func installTunnel(into vpn: VPNManager) async -> Bool {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let config = try await api.tunnel()
            let preferences = Preferences.shared
            // сервер мог настроить или убрать фильтр — запоминаем, чтобы экран
            // настроек знал о доступности ещё до следующего подключения
            preferences.dnsFilterAvailable = config.isFilterAvailable
            try await vpn.install(config: config,
                                  killSwitch: preferences.killSwitch,
                                  autoConnect: preferences.autoConnectMode,
                                  trustedNetworks: preferences.trustedNetworks,
                                  accountSuspended: me?.isSuspended == true,
                                  dnsFilter: preferences.dnsFilter && config.isFilterAvailable)
            return true
        } catch {
            handle(error)
            return false
        }
    }
```

- [ ] **Step 6: Прогнать тесты и собрать оба проекта**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:|Executed .* tests|TEST"
```

Ожидается: **73 теста**, 0 провалов. Разбивка: 63 существующих + 5 в `TunnelConfigDnsTests` + 3 в `PreferencesTests` + 2 новых в `TunnelProfileBuilderTests` (`testConfigTextIsCarriedThrough` не добавляется, а переписывается).

```bash
xcodebuild -project VPN404.xcodeproj -scheme VPN404 -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD"
```

Ожидается `** BUILD SUCCEEDED **`.

- [ ] **Step 7: Коммит**

```bash
git add vpn_ios/App/Api.swift vpn_ios/Shared/Preferences.swift vpn_ios/App/TunnelProfileBuilder.swift vpn_ios/App/VPNManager.swift vpn_ios/App/AppState.swift vpn_ios/Tests/ApiTests.swift vpn_ios/Tests/PreferencesTests.swift vpn_ios/Tests/TunnelProfileBuilderTests.swift vpn_ios/Tests/SuspendedAccountTests.swift
git commit -m "feat(ios): выбор фильтрующего DNS доходит до профиля туннеля"
```

---

### Task 7: Переключатель фильтра и карточка на дашборде

**Files:**
- Modify: `vpn_ios/App/Screens/SettingsView.swift`
- Modify: `vpn_ios/App/Screens/DashboardView.swift`

**Interfaces:**
- Consumes: `Preferences.dnsFilter`, `Preferences.dnsFilterAvailable` (Task 6); `AppState.installTunnel(into:)`.

- [ ] **Step 1: Добавить состояние в `SettingsView`**

К существующим `@State` добавить:

```swift
    @State private var dnsFilter: Bool = Preferences.shared.dnsFilter
    @State private var switchingFilter = false
```

- [ ] **Step 2: Расширить секцию защиты**

Заменить `protectionSection` целиком:

```swift
    private var protectionSection: some View {
        StatCard(label: "защита") {
            Toggle("Kill switch", isOn: $killSwitch)
                .font(.system(size: 14))
                .tint(Theme.accent)
                .onChange(of: killSwitch) { _ in persist() }
            Text("Не выпускает трафик мимо туннеля. Побочный эффект: перестают работать AirPlay, печать и устройства в локальной сети.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Divider().overlay(Theme.border).padding(.vertical, 4)

            Toggle("Блокировать рекламу и трекеры", isOn: $dnsFilter)
                .font(.system(size: 14))
                .tint(Theme.accent)
                .disabled(!Preferences.shared.dnsFilterAvailable || switchingFilter)
                .onChange(of: dnsFilter) { _ in Task { await applyDnsFilter() } }

            if Preferences.shared.dnsFilterAvailable {
                Text(switchingFilter
                     ? "Переподключаем туннель…"
                     : "Реклама и трекеры отсекаются на уровне DNS. Переключение меняет настройки соединения, поэтому туннель на пару секунд переподключится.")
                    .font(.system(size: 12))
                    .foregroundStyle(switchingFilter ? Theme.accent : Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Фильтр пока не настроен на сервере.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
```

- [ ] **Step 3: Добавить применение фильтра**

Рядом с `persist()` добавить:

```swift
    /// Фильтр меняет адреса DNS, а они входят в конфигурацию WireGuard —
    /// значит профиль надо переустановить, а поднятый туннель переподключить.
    private func applyDnsFilter() async {
        Preferences.shared.dnsFilter = dnsFilter
        guard vpn.status == .connected else { return }
        switchingFilter = true
        defer { switchingFilter = false }
        vpn.disconnect()
        guard await state.installTunnel(into: vpn) else { return }
        try? vpn.connect()
    }
```

- [ ] **Step 4: Показать состояние фильтра на дашборде**

В `vpn_ios/App/Screens/DashboardView.swift` заменить `modeRow`:

```swift
    private var modeRow: some View {
        HStack(spacing: 10) {
            MiniStat(label: "автовкл",
                     value: Preferences.shared.autoConnectMode.title,
                     tint: Preferences.shared.autoConnectMode == .off ? Theme.muted : Theme.accent)
            MiniStat(label: "фильтр",
                     value: filterLabel,
                     tint: Preferences.shared.dnsFilter ? Theme.accent : Theme.muted)
        }
    }

    private var filterLabel: String {
        guard Preferences.shared.dnsFilterAvailable else { return "недоступен" }
        return Preferences.shared.dnsFilter ? "включён" : "выключен"
    }
```

- [ ] **Step 5: Прогнать тесты и снять экраны**

```bash
cd vpn_ios && xcodegen generate && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'platform=iOS Simulator,name=iPhone 17' test 2>&1 | grep -E "error:|Executed .* tests|TEST"
```

Ожидается: 73 теста, 0 провалов.

```bash
xcrun simctl boot "iPhone 17" 2>/dev/null; APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/VPN404UI-*/Build/Products/Debug-iphonesimulator/VPN404.app | head -1) && xcrun simctl install booted "$APP" && SIMCTL_CHILD_UI_PREVIEW_HOME=1 xcrun simctl launch booted co.404studio.vpn
```

Перейти на вкладку «Настройки»: переключатель «Блокировать рекламу и трекеры» должен быть неактивен с подписью «Фильтр пока не настроен на сервере» — в симуляторе сервер не отвечал, значит доступность не выставлялась. На дашборде мини-карточка «фильтр» показывает «недоступен».

- [ ] **Step 6: Коммит**

```bash
git add vpn_ios/App/Screens/SettingsView.swift vpn_ios/App/Screens/DashboardView.swift
git commit -m "feat(ios): переключатель фильтра рекламы и его состояние на дашборде"
```

---

## Что проверяется только на живом сервере

Симулятор и юнит-тесты не покрывают главного — что фильтр действительно фильтрует. После развёртывания:

1. `nslookup doubleclick.net <ADGUARD_IP>` изнутри контейнера → `0.0.0.0`.
2. `nslookup example.com 195.14.118.198` снаружи → таймаут. Если пришёл ответ, резолвер открыт наружу и это надо чинить немедленно.
3. В приложении включить фильтр при поднятом туннеле → туннель переподключается, реклама на сайтах пропадает.
4. Выключить фильтр → возвращается обычный резолвер, тоже с переподключением.
5. Очистить `dns_filtered` в админке, переустановить конфигурацию в приложении → переключатель становится неактивным, туннель поднимается на обычном DNS.
