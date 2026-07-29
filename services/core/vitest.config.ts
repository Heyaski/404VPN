import { defineConfig } from "vitest/config";
// fileParallelism: false — интеграционные тесты делят одну БД vpn_test,
// параллельные TRUNCATE из разных файлов ломают друг друга
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], fileParallelism: false } });
