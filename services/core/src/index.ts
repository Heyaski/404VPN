import { loadConfig } from "./config.js";
import { pool } from "./db.js";
import { createWebhookApp } from "./webhook.js";
import { createApiRouter } from "./api.js";
import { createDeviceRouter } from "./device-api.js";
import { createBot } from "./bot.js";
import { createNotifyQueue, pollOutboxOnce, startNotifier } from "./notifier.js";
import { chargeDailyOnce, remindLowBalanceOnce, reactivateEligible } from "./billing.js";
import { NullWgProvider, type WgProvider } from "./wg/provider.js";
import { WgEasyProvider } from "./wg/wg-easy.js";

const cfg = loadConfig();
const creds = {
  login: cfg.ROBOKASSA_LOGIN,
  password1: cfg.ROBOKASSA_PASSWORD1,
  password2: cfg.ROBOKASSA_PASSWORD2,
  isTest: cfg.ROBOKASSA_TEST,
};

const wg: WgProvider =
  cfg.WG_EASY_URL && cfg.WG_EASY_PASSWORD
    ? new WgEasyProvider(cfg.WG_EASY_URL, cfg.WG_EASY_PASSWORD, cfg.WG_ENDPOINT_HOST)
    : new NullWgProvider();
if (wg instanceof NullWgProvider)
  console.warn("WG_EASY_URL/WG_EASY_PASSWORD не заданы — выдача туннелей отключена (503)");

const app = createWebhookApp(creds, wg);
app.use(createApiRouter(cfg.BOT_TOKEN, creds));
app.use(createDeviceRouter(wg));
app.listen(cfg.PORT, () => console.log(`webhook + api on :${cfg.PORT}`));

const bot = createBot(cfg);

// Недоступность Telegram не должна ронять сервис (вебхук оплаты обязан жить):
// пробуем запустить polling с экспоненциальным бэкоффом.
function launchBotWithRetry(attempt = 0): void {
  bot.launch(() => console.log("bot polling started")).catch((e: Error) => {
    const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(attempt, 4));
    console.error(`bot launch failed: ${e.message}; retry in ${delayMs / 1000}s`);
    setTimeout(() => launchBotWithRetry(attempt + 1), delayMs);
  });
}
launchBotWithRetry();

const queue = createNotifyQueue();
startNotifier(bot);
setInterval(() => void pollOutboxOnce(queue).catch(console.error), 5000);

// Биллинг: раз в час. Сами функции идемпотентны в пределах суток,
// поэтому частый запуск безопасен и переживает простой сервиса.
async function billingTick(): Promise<void> {
  const charged = await chargeDailyOnce(pool, wg);
  const reminded = await remindLowBalanceOnce(pool);
  const revived = await reactivateEligible(pool, wg);
  if (charged.charged || reminded || revived)
    console.log(`billing: charged=${charged.charged} suspended=${charged.suspended} reminded=${reminded} reactivated=${revived}`);
}
void billingTick().catch(console.error);
setInterval(() => void billingTick().catch(console.error), 3_600_000);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
