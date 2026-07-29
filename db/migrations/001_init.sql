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
