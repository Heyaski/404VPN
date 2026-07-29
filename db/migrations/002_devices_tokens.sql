ALTER TABLE devices
  ADD COLUMN token_hash text UNIQUE,
  ADD COLUMN platform text NOT NULL DEFAULT 'ios',
  ADD COLUMN wg_client_id text,
  ADD COLUMN revoked_at timestamptz;

-- публичный ключ появляется позже создания устройства (при выдаче туннеля)
ALTER TABLE devices ALTER COLUMN wg_public_key DROP NOT NULL;

CREATE INDEX idx_devices_active ON devices(user_id) WHERE is_active;

INSERT INTO settings(key, value) VALUES ('max_devices_default', '5')
  ON CONFLICT (key) DO NOTHING;
