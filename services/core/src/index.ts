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
void bot.launch(() => console.log("bot polling started"));

const queue = createNotifyQueue();
startNotifier(bot);
setInterval(() => void pollOutboxOnce(queue).catch(console.error), 5000);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
