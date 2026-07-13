import { Bot, session } from 'grammy';
import { env } from './config.js';
import type { AppContext, SessionData } from './context.js';
import { NeonSessionStore } from './db/session-store.js';
import { loadUser } from './middlewares/auth.js';
import { handleStart } from './handlers/start.js';
import { handleHelp } from './handlers/help.js';
import { handleCancel, CANCEL_CB } from './handlers/common.js';
import {
  startAddPhone,
  onAddPhoneImei,
  onAddPhoneLabel,
  listPhones,
  onAddPhoneDest,
  listPrepared,
  onPreparedToWork,
  onPreparedDeleteAsk,
  onPreparedDeleteConfirm,
  onKillAsk,
  onKillConfirm,
  onAddPhoneConfirm,
  KILL_CB,
  KILLC_CB,
  ADDPH_CB,
  DEST_CB,
  PREP_CB,
  PREPDEL_CB,
  PREPDELC_CB,
} from './handlers/phones.js';
import {
  startPurchase,
  onPhoneSelected,
  onCategorySelected,
  onGameSelected,
  onAmountSelected,
  onCounter,
  onPurchaseAmount,
  onPurchaseGame,
  onResultSelected,
  onNoteRequest,
  onPurchaseNote,
  onNetSelected,
  CB,
} from './handlers/purchase.js';
import {
  showStats,
  onStatsPeriod,
  sendReportToGroup,
  STATS_CB,
  type StatsPeriod,
} from './handlers/stats.js';
import { showRecent, startDeleteLast, confirmDeleteLast, DELLAST_CB } from './handlers/recent.js';
import { exportCsv } from './handlers/export.js';
import { showPhoneList, showPhoneHistory, HIST_CB } from './handlers/history.js';
import { showVkReport } from './handlers/vk.js';
import {
  startReport,
  onReportCallback,
  onReportCustomDate,
  REP_CB,
} from './handlers/report.js';
import { notifyModerator } from './notify.js';
import type { PurchaseResultValue } from './db/schema.js';

export function createBot(): Bot<AppContext> {
  if (!env.botToken) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN в .env — получи токен у @BotFather.');
  }

  const bot = new Bot<AppContext>(env.botToken);

  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage: new NeonSessionStore(),
    }),
  );

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
  bot.command('vk', showVkReport);
  bot.command('period', startReport);
  bot.command('phones', listPhones);
  bot.command('recent', showRecent);
  bot.command('history', showPhoneList);
  bot.command('report', sendReportToGroup);
  bot.command('export', exportCsv);
  bot.command('help', handleHelp);
  bot.command('cancel', handleCancel);

  // Кнопки главного меню. Матчим по СЛОВУ, без привязки к эмодзи —
  // чтобы старые закешированные кнопки (со старыми иконками) тоже работали
  // и смена иконок в будущем не ломала роутинг.
  bot.hears(/Закупка$/, startPurchase);
  bot.hears(/Телефон$/, startAddPhone); // «Телефон» (добавить)
  bot.hears(/Телефоны$/, listPhones); // «Телефоны» (список)
  bot.hears(/Подготовленные$/, listPrepared);
  bot.hears(/Статистика$/, showStats);
  bot.hears(/ВК$/, showVkReport);
  bot.hears(/Последние$/, showRecent);
  bot.hears(/Отчёт$/, startReport);
  bot.hears(/Удалить последнюю$/, startDeleteLast);

  // Inline-callback'и
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      await ctx.answerCallbackQuery();

      // «Отжимаем» кнопки нажатого сообщения — убираем клавиатуру, чтобы
      // нельзя было нажать повторно и было видно, что шаг пройден.
      // Исключение: переключатель периодов /stats сам редактирует это сообщение.
      // Счётчик ВК-мультизакупа (pur:cnt:) и проводник отчёта (rep:) сами
      // редактируют своё сообщение — не «отжимаем» у них клавиатуру.
      if (
        !data.startsWith(STATS_CB) &&
        !data.startsWith(CB.cnt) &&
        !data.startsWith(REP_CB)
      ) {
        await ctx.editMessageReplyMarkup().catch(() => {});
      }

      if (data === CANCEL_CB) return void (await handleCancel(ctx));
      if (data === DELLAST_CB) return void (await confirmDeleteLast(ctx));
      if (data.startsWith(STATS_CB)) {
        return void (await onStatsPeriod(ctx, data.slice(STATS_CB.length) as StatsPeriod));
      }
      // вывод телефона: killc: проверяем раньше kill:
      if (data.startsWith(KILLC_CB)) {
        return void (await onKillConfirm(ctx, data.slice(KILLC_CB.length)));
      }
      if (data.startsWith(KILL_CB)) return void (await onKillAsk(ctx, data.slice(KILL_CB.length)));
      if (data.startsWith(REP_CB)) {
        return void (await onReportCallback(ctx, data.slice(REP_CB.length)));
      }
      if (data.startsWith(HIST_CB)) {
        return void (await showPhoneHistory(ctx, data.slice(HIST_CB.length)));
      }
      if (data.startsWith(ADDPH_CB)) {
        return void (await onAddPhoneConfirm(ctx, data.slice(ADDPH_CB.length)));
      }
      if (data.startsWith(DEST_CB)) {
        return void (await onAddPhoneDest(ctx, data.slice(DEST_CB.length)));
      }
      // удаление подготовленного: prepdelc: раньше prepdel:, оба раньше prep:
      if (data.startsWith(PREPDELC_CB)) {
        return void (await onPreparedDeleteConfirm(ctx, data.slice(PREPDELC_CB.length)));
      }
      if (data.startsWith(PREPDEL_CB)) {
        return void (await onPreparedDeleteAsk(ctx, data.slice(PREPDEL_CB.length)));
      }
      if (data.startsWith(PREP_CB)) {
        return void (await onPreparedToWork(ctx, data.slice(PREP_CB.length)));
      }
      if (data.startsWith(CB.phone)) {
        return void (await onPhoneSelected(ctx, data.slice(CB.phone.length)));
      }
      if (data.startsWith(CB.cat)) {
        return void (await onCategorySelected(ctx, data.slice(CB.cat.length)));
      }
      if (data.startsWith(CB.game)) {
        return void (await onGameSelected(ctx, data.slice(CB.game.length)));
      }
      if (data.startsWith(CB.amount)) {
        return void (await onAmountSelected(ctx, data.slice(CB.amount.length)));
      }
      if (data.startsWith(CB.cnt)) {
        return void (await onCounter(ctx, data.slice(CB.cnt.length)));
      }
      if (data === CB.note) return void (await onNoteRequest(ctx));
      if (data.startsWith(CB.net)) return void (await onNetSelected(ctx, data.slice(CB.net.length)));
      if (data.startsWith(CB.result)) {
        return void (await onResultSelected(ctx, data.slice(CB.result.length) as PurchaseResultValue));
      }
    } catch (err) {
      console.error('Ошибка в callback:', err);
      await ctx.answerCallbackQuery({ text: 'Ошибка, попробуй заново' }).catch(() => {});
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
      case 'purchase_game_custom':
        return onPurchaseGame(ctx, ctx.message.text);
      case 'purchase_amount':
        return onPurchaseAmount(ctx, ctx.message.text);
      case 'purchase_note':
        return onPurchaseNote(ctx, ctx.message.text);
      case 'report_custom_date':
        return onReportCustomDate(ctx, ctx.message.text);
      default:
        await ctx.reply('Не понял. Открой меню: /start или /help.');
    }
  });

  bot.catch(async (err) => {
    console.error('Ошибка при обработке апдейта:', err.error);
    const where = err.ctx?.update?.update_id ? ` (update ${err.ctx.update.update_id})` : '';
    await notifyModerator(err.ctx.api, `⚠️ Ошибка бота${where}:\n${String(err.error).slice(0, 600)}`);
  });

  return bot;
}
