# Деплой бэкенда (Ubuntu, с нуля)

> **Требование к серверу:** хостинг должен иметь доступ к `api.telegram.org` — VPS в РФ не подходит (Telegram заблокирован, бот не запустится: ETIMEDOUT). Рабочий вариант — NL-сервер, там же, где WireGuard; сервис наружу ходит только в Telegram, Robokassa сама стучится к нам. Проверка перед деплоем: `curl -sS -m 10 https://api.telegram.org/ | head -c 100` — должен вернуться ответ, а не таймаут.

1. Установить Docker и клиент Postgres:

   ```bash
   curl -fsSL https://get.docker.com | sh
   apt install -y git postgresql-client
   ```

2. Загрузить репозиторий (git clone или scp), затем `cp .env.example .env` и заполнить реальные значения: пароль БД, `BOT_TOKEN` от @BotFather, пароли Robokassa. На время проверки `ROBOKASSA_TEST=1`.

   **Пароль БД — только буквы и цифры** (сгенерировать: `openssl rand -hex 24`): спецсимволы (`@ / : # %`) ломают разбор `DATABASE_URL`. Один и тот же пароль вписать в `POSTGRES_PASSWORD` и внутрь `DATABASE_URL`. Пароль фиксируется при первом старте контейнера; чтобы сменить — `docker compose down -v` (том удалится) и поднять заново.

3. Собрать и запустить: `docker compose up -d --build`, проверить `docker compose ps` — postgres должен стать `healthy`.

4. Применить миграции:

   ```bash
   set -a; . ./.env; set +a; ./db/migrate.sh
   ```

5. В кабинете Robokassa: **Result URL** = `http://<IP_сервера>:8080/payhook/robokassa/result`, метод **POST**. Success/Fail URL — любая страница-заглушка, бизнес-логики на них нет (активация только по Result URL).

6. Проверка цикла: в боте `/start` → кнопка суммы → тестовая оплата (IsTest=1) → в чат приходит уведомление об оплате и код активации. Повторная доставка колбэка не должна дублировать зачисление. Логи: `docker compose logs -f core`.

7. Firewall: наружу открыты только 22 и 8080/tcp (после фазы 2 — 22, 80, 443; 8080 закрывается). После успешной проверки тестового платежа (включая параметр `Receipt` — фискализация для ИП) переключить `ROBOKASSA_TEST=0` и перезапустить: `docker compose up -d core`.

## Фаза 2: домен, Mini App, HTTPS

После покупки домена (нужен для Telegram Mini App — он открывается только по HTTPS):

1. **DNS:** A-запись `@` → `195.14.118.198`. Дождаться резолва: `dig +short <домен>` должен вернуть этот IP.
2. **.env на сервере** — добавить две строки:

   ```bash
   DOMAIN=<домен>
   MINIAPP_URL=https://<домен>/
   ```

3. **Firewall:** открыть 80/tcp и 443/tcp (80 нужен Let's Encrypt для проверки домена), 8080 наружу больше не публикуется.
4. **Запуск:** `git pull && docker compose up -d --build` — Caddy сам получит и будет продлевать сертификат. Проверить: `curl -sI https://<домен>/ | head -1` → `HTTP/2 200`.
5. **Robokassa:** Result URL сменить на `https://<домен>/payhook/robokassa/result` (метод POST), проверить тестовым платежом.
6. **BotFather:** `/setmenubutton` → выбрать бота → URL `https://<домен>/` → название кнопки «Открыть 404VPN». Кнопка в `/start` появится сама из `MINIAPP_URL`.
7. **Проверка:** открыть Mini App из бота — виден баланс и история; пополнение открывает оплату Robokassa; после оплаты баланс в Mini App обновляется.

## Фаза 3: VPN по коду доступа и посуточный биллинг

1. **Дать `core` доступ к сети wg-easy** (разово). Панель слушает только `127.0.0.1` хоста, поэтому из контейнера она недоступна ни по `localhost`, ни через `host.docker.internal` — нужен общий docker-сегмент. Наш compose подключает `core` к сети wg-easy как к внешней; сам wg-easy при этом не меняется.

   > **Не подключайте wg-easy к чужой сети** (`docker network connect <сеть> wg-easy`). Второй интерфейс меняет у него маршрут по умолчанию, а правило маскарадинга остаётся привязанным к первому — у VPN-клиентов пропадает интернет. Многодомным должен становиться `core`, а не wg-easy. Если уже подключили — откатите: `docker network disconnect <сеть> wg-easy && docker restart wg-easy`.

   Узнать имя сети:

   ```bash
   docker inspect wg-easy --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```

   По умолчанию compose ждёт `docker-app_default`. Если у вас другое имя — укажите его в `.env` как `WG_NETWORK=<имя>`.

2. **Переменные в `.env`** — добавить три строки (пароль панели wg-easy тот же, которым вы входите в неё):

   ```bash
   WG_EASY_URL=http://wg-easy:51821
   WG_EASY_PASSWORD=<пароль панели wg-easy>
   WG_ENDPOINT_HOST=195.14.118.198
   ```

   Без них сервис запустится, но выдача туннелей вернёт 503 — бот и оплата продолжат работать.

3. **Обновление и миграция:**

   ```bash
   git pull && docker compose up -d --build && set -a; . ./.env; set +a; ./db/migrate.sh
   ```

4. **Проверка связи с wg-easy из контейнера** (должен вернуться 200 или 401 — значит панель доступна):

   ```bash
   docker compose exec core node -e "fetch(process.env.WG_EASY_URL+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.WG_EASY_PASSWORD})}).then(r=>console.log('wg-easy:',r.status)).catch(e=>console.log('ошибка:',e.message))"
   ```

5. **Проверка активации кода** — возьмите код, который бот присылал после оплаты:

   ```bash
   curl -s -X POST https://<домен>/api/redeem -H 'Content-Type: application/json' -d '{"code":"XXXX-XXXX-XXXX-XXXX"}'
   ```

   В ответе — `token`, `balance`, `daysLeft`. Токен сохраните, он понадобится для следующей проверки.

6. **Проверка выдачи туннеля** (подставьте токен из шага 4):

   ```bash
   curl -s -X POST https://<домен>/api/device/tunnel -H 'Authorization: Bearer <token>'
   ```

   Должен вернуться JSON с `privateKey`, `address` и блоком `peer`. Одновременно в панели wg-easy появится новый клиент с именем вида `404vpn-xxxxxxxx`.

7. **Биллинг** работает сам: списание раз в сутки, при нуле баланса пир отключается и приходит уведомление, после пополнения — включается обратно. Планировщик запускается раз в час, функции идемпотентны в пределах суток.

## Фаза 4: iOS-приложение

Проект в `vpn_ios/` генерируется **XcodeGen** — файл `.xcodeproj` в репозитории не хранится.

**Разовая подготовка машины:**

```bash
brew install xcodegen go && sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Go нужен для сборки WireGuard: библиотека `libwg-go` компилируется build-фазой таргета туннеля.

**Генерация проекта и открытие в Xcode:**

```bash
cd vpn_ios && xcodegen generate && open VPN404.xcodeproj
```

**Что нужно сделать владельцу в Apple Developer** (без этого VPN не запустится ни на устройстве, ни в TestFlight):

1. Вступить в Apple Developer Program ($99/год).
2. Создать два App ID: `co.404studio.vpn` и `co.404studio.vpn.tunnel`, обоим включить capability **Network Extensions**.
3. Создать App Group `group.co.404studio.vpn` и привязать её к обоим App ID.
4. Вписать свой **Team ID** в `vpn_ios/Local.xcconfig` (строка `DEVELOPMENT_TEAM = `). Именно там, а не в интерфейсе Xcode: проект генерируется из `project.yml`, и ручная правка настроек таргета затрётся при следующем `xcodegen generate`.
5. Открыть **`VPN404.xcodeproj`** (не `VPN404UI.xcodeproj` — тот без расширения туннеля, только для симулятора), выбрать своё устройство и запустить.

Если при установке появляется «The executable is not codesigned» — не заполнен `DEVELOPMENT_TEAM` либо собирается проект `VPN404UI` вместо `VPN404`.

**Проверка на устройстве:** ввести код доступа → приложение получит токен → нажать «Подключить» → iOS покажет системный запрос на добавление VPN-конфигурации → статус станет «подключено», трафик пойдёт через NL-сервер. Проверить можно на любом сайте, показывающем IP: он должен быть `195.14.118.198`.

**Про симулятор.** Туннель в симуляторе не работает в принципе: `NEPacketTunnelProvider` там не поднимает реальное соединение, а Go-мост не линкуется под симуляторную архитектуру. Поэтому для работы над интерфейсом есть отдельная спека без таргета туннеля:

```bash
cd vpn_ios && xcodegen generate --spec project.ui.yml && xcodebuild -project VPN404UI.xcodeproj -scheme VPN404 -destination 'id=<UDID симулятора>' test
```

Она же используется для юнит-тестов. Сам VPN проверяется только на устройстве.
