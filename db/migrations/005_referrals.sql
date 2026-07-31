-- Реферальная программа. Код принадлежит telegram-аккаунту: пригласить может
-- любой, у кого есть чат с ботом, ещё до создания VPN-аккаунта.
ALTER TABLE telegram_users
  ADD COLUMN referral_code text UNIQUE,
  ADD COLUMN referred_by uuid REFERENCES telegram_users(id),
  ADD COLUMN referred_at timestamptz;

CREATE INDEX idx_telegram_users_referred_by ON telegram_users(referred_by);

-- Журнал начислений: сколько и за что получил пригласивший.
CREATE TABLE referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  referral_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('join', 'commission')),
  amount numeric(10,2) NOT NULL,
  payment_order_id integer REFERENCES payment_orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referral_rewards_inviter ON referral_rewards(inviter_id, created_at DESC);
-- бонус за присоединение — ровно один на пару
CREATE UNIQUE INDEX idx_referral_rewards_join ON referral_rewards(inviter_id, referral_id)
  WHERE kind = 'join';

-- Реферальные начисления — такие же движения баланса, как и все прочие
ALTER TABLE balance_transactions DROP CONSTRAINT balance_transactions_type_check;
ALTER TABLE balance_transactions ADD CONSTRAINT balance_transactions_type_check
  CHECK (type IN ('topup','daily_charge','code_redeem','admin_adjust','refund',
                  'referral_bonus','referral_commission'));

INSERT INTO settings(key, value) VALUES
  ('referral_invitee_bonus', '50'),
  ('referral_inviter_bonus', '30'),
  ('referral_commission_percent', '20')
ON CONFLICT (key) DO NOTHING;

-- Текстовые настройки: контакт поддержки и имя бота для реферальной ссылки
INSERT INTO settings(key, value) VALUES
  ('support_contact', '""'),
  ('bot_username', '""')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_templates(key, text_template) VALUES
  ('referral_bonus',
   'Тебе начислено {{amount}} ₽ по приглашению друга. Баланс: {{balance}} ₽'),
  ('referral_joined',
   'По твоей ссылке присоединился друг. Тебе начислено {{amount}} ₽. Баланс: {{balance}} ₽'),
  ('referral_commission',
   'Твой друг пополнил баланс на {{payment}} ₽ — тебе начислено {{amount}} ₽ ({{percent}}%). Баланс: {{balance}} ₽'),
  ('help',
   E'404VPN — быстрый VPN без профилей и настроек.\n\nКак начать:\n1. Пополни баланс кнопкой ниже.\n2. Открой приложение 404VPN и нажми «Получить код» в этом боте.\n3. Введи код в приложении — и нажимай «Подключить».\n\nОплата посуточная: списывается только за дни, когда есть устройства. Баланс кончился — доступ приостановится, пополнишь — вернётся.')
ON CONFLICT (key) DO NOTHING;

UPDATE notification_templates
SET text_template = E'Привет! Это 404VPN — VPN без профилей и файлов: код доступа и одна кнопка.\n\nКак это работает: пополняешь баланс, получаешь код в этом боте, вводишь его в приложении. Списывается посуточно и только за подключённые устройства — не пользуешься, баланс не тает.\n\nПриглашай друзей: за каждого получишь бонус на баланс и процент со всех его пополнений. Ссылка — в мини-приложении.\n\nВыбери сумму пополнения:',
    updated_at = now()
WHERE key = 'welcome';
