# Деплой на сервер №2 (Ubuntu, с нуля)

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

7. Firewall: наружу открыты только 22 и 8080/tcp. После успешной проверки тестового платежа (включая параметр `Receipt` — фискализация для ИП) переключить `ROBOKASSA_TEST=0` и перезапустить: `docker compose up -d core`.
