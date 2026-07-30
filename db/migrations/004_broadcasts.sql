-- Рассылки едут через тот же outbox и ту же очередь с троттлингом, что и транзакционные
-- уведомления: текст лежит в text_override, а привязка к рассылке — в broadcast_id.
ALTER TABLE notification_outbox
  ADD COLUMN broadcast_id uuid REFERENCES broadcasts(id) ON DELETE CASCADE,
  ADD COLUMN text_override text;

-- Один получатель на рассылку: повторное разворачивание аудитории (после сбоя воркера)
-- не создаст дублей.
CREATE UNIQUE INDEX idx_outbox_broadcast_recipient
  ON notification_outbox(broadcast_id, telegram_user_id)
  WHERE broadcast_id IS NOT NULL;

CREATE INDEX idx_outbox_broadcast ON notification_outbox(broadcast_id);

-- Кнопки пополнения теперь можно добавлять и удалять из админки
ALTER TABLE topup_presets ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
