# Деплой на сервер №2 (Ubuntu, с нуля)

1. Установить Docker и клиент Postgres:

   ```bash
   curl -fsSL https://get.docker.com | sh
   apt install -y git postgresql-client
   ```

2. Загрузить репозиторий (git clone или scp), затем `cp .env.example .env` и заполнить реальные значения: пароль БД, `BOT_TOKEN` от @BotFather, пароли Robokassa. На время проверки `ROBOKASSA_TEST=1`.

3. Собрать и запустить: `docker compose up -d --build`

4. Применить миграции:

   ```bash
   set -a; . ./.env; set +a
   DATABASE_URL="postgres://vpn:$POSTGRES_PASSWORD@127.0.0.1:55432/vpn" ./db/migrate.sh
   ```

5. В кабинете Robokassa: **Result URL** = `http://<IP_сервера>:8080/payhook/robokassa/result`, метод **POST**. Success/Fail URL — любая страница-заглушка, бизнес-логики на них нет (активация только по Result URL).

6. Проверка цикла: в боте `/start` → кнопка суммы → тестовая оплата (IsTest=1) → в чат приходит уведомление об оплате и код активации. Повторная доставка колбэка не должна дублировать зачисление. Логи: `docker compose logs -f core`.

7. Firewall: наружу открыты только 22 и 8080/tcp. После успешной проверки тестового платежа (включая параметр `Receipt` — фискализация для ИП) переключить `ROBOKASSA_TEST=0` и перезапустить: `docker compose up -d core`.
