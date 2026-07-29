import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import type { InlineKeyboardButton } from "telegraf/types";
import type { Config } from "./config.js";
import { pool, withTx } from "./db.js";
import { createTopupOrder } from "./payments.js";
import { buildPaymentUrl } from "./robokassa.js";
import { renderTemplate, daysLeft } from "./templates.js";

async function getSetting(key: string): Promise<number> {
  const { rows: [r] } = await pool.query("SELECT value FROM settings WHERE key=$1", [key]);
  return Number(r?.value ?? 0);
}

async function getTemplate(key: string): Promise<string> {
  const { rows: [r] } = await pool.query(
    "SELECT text_template FROM notification_templates WHERE key=$1 AND enabled", [key]);
  return r?.text_template ?? "";
}

async function upsertTgUser(from: { id: number; username?: string }, chatId: number): Promise<string> {
  const { rows: [r] } = await pool.query(
    `INSERT INTO telegram_users(telegram_id, chat_id, username)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE
       SET chat_id=$2, username=$3, last_interaction_at=now(), is_blocked_bot=false
     RETURNING id`,
    [from.id, chatId, from.username ?? null],
  );
  return r.id;
}

async function presetsKeyboard(miniAppUrl?: string) {
  const { rows } = await pool.query(
    "SELECT amount, title FROM topup_presets WHERE is_active ORDER BY sort_order");
  const presets = rows.map((p) => Markup.button.callback(p.title, `topup:${Number(p.amount)}`));
  const keyboard: InlineKeyboardButton[][] = miniAppUrl
    ? [[Markup.button.webApp("Открыть 404VPN", miniAppUrl)]]
    : [];
  for (let i = 0; i < presets.length; i += 2) keyboard.push(presets.slice(i, i + 2));
  return Markup.inlineKeyboard(keyboard);
}

export function createBot(cfg: Config): Telegraf {
  const bot = new Telegraf(cfg.BOT_TOKEN);
  const creds = {
    login: cfg.ROBOKASSA_LOGIN, password1: cfg.ROBOKASSA_PASSWORD1,
    password2: cfg.ROBOKASSA_PASSWORD2, isTest: cfg.ROBOKASSA_TEST,
  };

  async function sendTopupLink(ctx: Context, amountRub: number) {
    if (!ctx.from || !ctx.chat) return;
    const min = await getSetting("min_topup");
    if (amountRub < min) {
      await ctx.reply(`Минимальная сумма пополнения — ${min} ₽`);
      return;
    }
    const tgUserId = await upsertTgUser(ctx.from, ctx.chat.id);
    const { rows: [link] } = await pool.query(
      "SELECT user_id FROM telegram_users WHERE id=$1", [tgUserId]);
    const { orderId } = await withTx((c) =>
      createTopupOrder(c, { telegramUserId: tgUserId, userId: link?.user_id ?? null, amountRub }));
    const url = buildPaymentUrl(creds, {
      invId: orderId, outSum: amountRub.toFixed(2), description: `Пополнение 404VPN #${orderId}`,
    });
    await ctx.reply(
      `Счёт на ${amountRub} ₽ создан.`,
      Markup.inlineKeyboard([Markup.button.url(`Оплатить ${amountRub} ₽`, url)]),
    );
  }

  bot.start(async (ctx) => {
    await upsertTgUser(ctx.from, ctx.chat.id);
    await ctx.reply(
      renderTemplate(await getTemplate("welcome"), {}), await presetsKeyboard(cfg.MINIAPP_URL));
  });

  bot.action(/^topup:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await sendTopupLink(ctx, Number(ctx.match[1]));
  });

  bot.command("balance", async (ctx) => {
    const tgUserId = await upsertTgUser(ctx.from, ctx.chat.id);
    const { rows: [link] } = await pool.query(
      `SELECT u.id, u.balance, u.status,
              (SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.is_active) AS devices
       FROM telegram_users t JOIN users u ON u.id=t.user_id WHERE t.id=$1`, [tgUserId]);
    if (!link) {
      await ctx.reply("Аккаунт ещё не активирован: пополни баланс и введи код в приложении.");
      return;
    }
    const monthly = await getSetting("device_monthly_price");
    const d = daysLeft(Number(link.balance), link.devices, monthly);
    await ctx.reply(
      `Баланс: ${link.balance} ₽\nУстройств: ${link.devices}\nОсталось: ${d === Infinity ? "∞" : `~${d} дн.`}`);
  });

  bot.hears(/^\d{2,6}$/, async (ctx) => sendTopupLink(ctx, Number(ctx.message.text)));

  return bot;
}
