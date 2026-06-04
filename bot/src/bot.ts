import { Bot, session } from 'grammy';
import { env } from './config';
import type { AppContext, SessionData } from './context';
import { loadUser } from './middlewares/auth';
import { handleStart } from './handlers/start';
import { handleHelp } from './handlers/help';
import { handleCancel, CANCEL_CB } from './handlers/common';
import { BTN } from './handlers/menus';
import {
  startAddPhone,
  onAddPhoneImei,
  onAddPhoneLabel,
  listPhones,
  onKillAsk,
  onKillConfirm,
  KILL_CB,
  KILLC_CB,
} from './handlers/phones';
import {
  startPurchase,
  onPhoneSelected,
  onCategorySelected,
  onPurchaseGame,
  onPurchaseAmount,
  onResultSelected,
  CB,
} from './handlers/purchase';
import {
  showStats,
  onStatsPeriod,
  sendReportToGroup,
  STATS_CB,
  type StatsPeriod,
} from './handlers/stats';
import { showRecent, startDeleteLast, confirmDeleteLast, DELLAST_CB } from './handlers/recent';
import type { PurchaseResultValue } from './db/schema';

export function createBot(): Bot<AppContext> {
  if (!env.botToken) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN в .env — получи токен у @BotFather.');
  }

  const bot = new Bot<AppContext>(env.botToken);

  bot.use(session({ initial: (): SessionData => ({}) }));

  // В группах бот реагирует ТОЛЬКО на команды (/...) и inline-кнопки
  // (просмотр: /stats, /phones, /recent, /report). Обычные сообщения и
  // ввод-флоу в группе игнорируются — ввод ведётся в личке.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') {
      const isCommand = ctx.message?.text?.startsWith('/') ?? false;
      const isCallback = ctx.callbackQuery !== undefined;
      if (!isCommand && !isCallback) return;
    }
    await next();
  });

  bot.use(loadUser);

  // Команды
  bot.command('start', handleStart);
  bot.command('stats', showStats);
  bot.command('phones', listPhones);
  bot.command('recent', showRecent);
  bot.command('report', sendReportToGroup);
  bot.command('help', handleHelp);
  bot.command('cancel', handleCancel);

  // Кнопки главного меню
  bot.hears(BTN.purchase, startPurchase);
  bot.hears(BTN.addPhone, startAddPhone);
  bot.hears(BTN.phones, listPhones);
  bot.hears(BTN.stats, showStats);
  bot.hears(BTN.recent, showRecent);
  bot.hears(BTN.delLast, startDeleteLast);

  // Inline-callback'и
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      if (data === CANCEL_CB) {
        await ctx.answerCallbackQuery();
        await handleCancel(ctx);
        return;
      }
      if (data === DELLAST_CB) {
        await ctx.answerCallbackQuery();
        await confirmDeleteLast(ctx);
        return;
      }
      if (data.startsWith(STATS_CB)) {
        await ctx.answerCallbackQuery();
        await onStatsPeriod(ctx, data.slice(STATS_CB.length) as StatsPeriod);
        return;
      }
      // вывод телефона: killc: проверяем раньше kill:
      if (data.startsWith(KILLC_CB)) {
        await ctx.answerCallbackQuery();
        await onKillConfirm(ctx, data.slice(KILLC_CB.length));
        return;
      }
      if (data.startsWith(KILL_CB)) {
        await ctx.answerCallbackQuery();
        await onKillAsk(ctx, data.slice(KILL_CB.length));
        return;
      }
      if (data.startsWith(CB.phone)) {
        await ctx.answerCallbackQuery();
        await onPhoneSelected(ctx, data.slice(CB.phone.length));
        return;
      }
      if (data.startsWith(CB.cat)) {
        await ctx.answerCallbackQuery();
        await onCategorySelected(ctx, data.slice(CB.cat.length));
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
        await ctx.reply('Не понял. Открой меню: /start или /help.');
    }
  });

  bot.catch((err) => {
    console.error('Ошибка при обработке апдейта:', err.error);
  });

  return bot;
}
