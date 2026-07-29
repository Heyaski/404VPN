import { loadConfig } from "./config.js";
import { createWebhookApp } from "./webhook.js";
import { createBot } from "./bot.js";
import { createNotifyQueue, pollOutboxOnce, startNotifier } from "./notifier.js";

const cfg = loadConfig();
const creds = {
  login: cfg.ROBOKASSA_LOGIN,
  password1: cfg.ROBOKASSA_PASSWORD1,
  password2: cfg.ROBOKASSA_PASSWORD2,
  isTest: cfg.ROBOKASSA_TEST,
};

const app = createWebhookApp(creds);
app.listen(cfg.PORT, () => console.log(`webhook on :${cfg.PORT}`));

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

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
