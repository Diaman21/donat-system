import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { showStats } from './stats.js';
import { startReport } from './report.js';
import { showRecent } from './recent.js';
import { RPT_CB } from './menus.js';

// «📊 Отчёты» (10.11.2026, просьба владельца): одна кнопка меню вместо трёх —
// «📊 Статистика», «📅 Отчёт» и «📋 Последние». Это просмотр по запросу, а в
// группу сводка и так уходит сама (12:00, по понедельникам — итог недели).
// Экраны те же, хаб только ведёт к ним; команды /stats, /period, /recent живы.
// RPT_CB и кнопка «📋 Последние записи» — в menus.ts: ей пользуются сообщения
// об ошибке (bot.ts, purchase.ts), а импорт отсюда тянул бы stats/report.

export async function showReportsHub(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const kb = new InlineKeyboard()
    .text('📊 Сводка', `${RPT_CB}stats`)
    .text('📅 По дням', `${RPT_CB}days`)
    .row()
    .text('📋 Последние записи', `${RPT_CB}recent`);
  await ctx.reply(
    '📊 Что показать?\n\n' +
      '📊 Сводка — €, покупки, телефоны (за сутки / 7 дней / всё время)\n' +
      '📅 По дням — день или период, дальше — телефоны дня\n' +
      '📋 Последние записи — 10 последних закупок',
    { reply_markup: kb },
  );
}

const ROUTES: Record<string, (ctx: AppContext) => Promise<void>> = {
  stats: showStats,
  days: startReport,
  recent: showRecent,
};

export async function onReportsCallback(ctx: AppContext, rest: string): Promise<void> {
  await ROUTES[rest]?.(ctx);
}
