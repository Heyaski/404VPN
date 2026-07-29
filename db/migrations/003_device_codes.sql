-- Код доступа перестаёт быть «чеком об оплате» и становится ключом привязки устройства.
-- user_id — аккаунт, к которому код привяжет устройство (баланс при этом не меняется).
-- NULL сохраняет прежнее поведение: код создаёт новый аккаунт и зачисляет amount.
ALTER TABLE access_codes ADD COLUMN user_id uuid REFERENCES users(id);

CREATE INDEX idx_access_codes_pending ON access_codes(user_id) WHERE status = 'issued';

INSERT INTO settings(key, value) VALUES ('device_code_ttl_minutes', '30')
  ON CONFLICT (key) DO NOTHING;

-- Шаблон про код в сообщении больше не нужен: код выпускается в Mini App по кнопке
UPDATE notification_templates SET enabled = false WHERE key = 'payment_success_code';
