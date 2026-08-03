-- Адреса резолверов: обычного и фильтрующего рекламу с трекерами.
-- Пустая строка означает «не задано»: фильтр тогда недоступен в приложении,
-- а туннель поднимается на том DNS, который отдаёт wg-easy.
INSERT INTO settings(key, value) VALUES
  ('dns_default', '""'),
  ('dns_filtered', '""')
ON CONFLICT (key) DO NOTHING;
