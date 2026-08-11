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
