import { Bot, session } from 'grammy';
import { env } from './config';
import type { AppContext, SessionData } from './context';
import { loadUser } from './middlewares/auth';
import { handleStart } from './handlers/start';
import { BTN } from './handlers/menus';
import {
  startAddPhone,
  onAddPhoneImei,
  onAddPhoneLabel,
  listPhones,
} from './handlers/phones';
import {
  startPurchase,
  onPhoneSelected,
  onPurchaseGame,
  onPurchaseAmount,
  onResultSelected,
  CB,
} from './handlers/purchase';
import type { PurchaseResultValue } from './db/schema';

export function createBot(): Bot<AppContext> {
  if (!env.botToken) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN в .env — получи токен у @BotFather.');
  }

  const bot = new Bot<AppContext>(env.botToken);

  // Сессия (для пошагового ввода) и текущий пользователь из БД
  bot.use(session({ initial: (): SessionData => ({}) }));
  bot.use(loadUser);

  // Команды
  bot.command('start', handleStart);

  // Кнопки главного меню
  bot.hears(BTN.purchase, startPurchase);
  bot.hears(BTN.addPhone, startAddPhone);
  bot.hears(BTN.phones, listPhones);

  // Inline-callback'и
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      if (data.startsWith(CB.phone)) {
        await ctx.answerCallbackQuery();
        await onPhoneSelected(ctx, data.slice(CB.phone.length));
        return;
      }
      if (data.startsWith(CB.result)) {
        await ctx.answerCallbackQuery();
        await onResultSelected(ctx, data.slice(CB.result.length) as PurchaseResultValue);
        return;
      }
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error('Ошибка в callback:', err);
      await ctx.answerCallbackQuery({ text: 'Ошибка, попробуй заново' });
    }
  });

  // Текстовый ввод — роутинг по состоянию сессии
  bot.on('message:text', async (ctx) => {
    const flow = ctx.session.flow;
    switch (flow?.kind) {
      case 'add_phone_imei':
        return onAddPhoneImei(ctx, ctx.message.text);
      case 'add_phone_label':
        return onAddPhoneLabel(ctx, ctx.message.text);
      case 'purchase_game':
        return onPurchaseGame(ctx, ctx.message.text);
      case 'purchase_amount':
        return onPurchaseAmount(ctx, ctx.message.text);
      default:
        await ctx.reply('Не понял. Открой меню командой /start.');
    }
  });

  bot.catch((err) => {
    console.error('Ошибка при обработке апдейта:', err.error);
  });

  return bot;
}
