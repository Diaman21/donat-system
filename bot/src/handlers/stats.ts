import { sql, type SQL } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client';
import { phones, purchases } from '../db/schema';
import type { AppContext } from '../context';
import { requireOperator } from './start';
import { env } from '../config';

export type StatsPeriod = 'all' | '24h' | '7d';
export const STATS_CB = 'stats:'; // + all|24h|7d

const PERIOD_TITLE: Record<StatsPeriod, string> = {
  all: 'за всё время',
  '24h': 'за сутки',
  '7d': 'за неделю',
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function periodFilter(period: StatsPeriod): SQL | undefined {
  if (period === '24h') return sql`${purchases.purchasedAt} >= now() - interval '24 hours'`;
  if (period === '7d') return sql`${purchases.purchasedAt} >= now() - interval '7 days'`;
  return undefined;
}

function periodKeyboard(active: StatsPeriod): InlineKeyboard {
  const mark = (p: StatsPeriod, label: string) => (p === active ? `• ${label} •` : label);
  return new InlineKeyboard()
    .text(mark('24h', 'Сутки'), `${STATS_CB}24h`)
    .text(mark('7d', 'Неделя'), `${STATS_CB}7d`)
    .text(mark('all', 'Всё'), `${STATS_CB}all`);
}

async function renderStats(period: StatsPeriod): Promise<{ text: string; kb: InlineKeyboard }> {
  const filter = periodFilter(period);

  // Покупки по результату (с учётом периода)
  const byResultQuery = db
    .select({
      result: purchases.result,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.result);
  const byResult = await (filter ? byResultQuery.where(filter) : byResultQuery);

  let totalCnt = 0;
  let totalSpent = 0;
  let done = 0;
  let support = 0;
  let long = 0;
  for (const r of byResult) {
    totalCnt += r.cnt;
    totalSpent += Number(r.total);
    if (r.result === 'done') done = r.cnt;
    else if (r.result === 'support') support = r.cnt;
    else if (r.result === 'long') long = r.cnt;
  }

  // Телефоны и «возраст до 💀» — по всему времени (текущее состояние парка)
  const allPhones = await db
    .select({ id: phones.id, imei: phones.imeiLast4, status: phones.status })
    .from(phones);
  const active = allPhones.filter((p) => p.status === 'active').length;
  const dead = allPhones.filter((p) => p.status === 'dead').length;
  const imeiById = new Map(allPhones.map((p) => [p.id, p.imei]));
  const deadIds = new Set(allPhones.filter((p) => p.status === 'dead').map((p) => p.id));

  const perPhone = await db
    .select({
      phoneId: purchases.phoneId,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.phoneId);

  const deadStats = perPhone.filter((p) => deadIds.has(p.phoneId));
  let avgDeathLine = '—';
  if (deadStats.length > 0) {
    const avgCnt = deadStats.reduce((a, p) => a + p.cnt, 0) / deadStats.length;
    const avgSpent = deadStats.reduce((a, p) => a + Number(p.total), 0) / deadStats.length;
    avgDeathLine = `${avgCnt.toFixed(1)} покупок / ${money(avgSpent)}`;
  }

  let longest: { phoneId: string; cnt: number; total: string } | null = null;
  for (const p of perPhone) {
    if (!longest || p.cnt > longest.cnt) longest = p;
  }
  let longestLine = '—';
  if (longest) {
    const imei = imeiById.get(longest.phoneId) ?? '????';
    longestLine = `…${imei}: ${longest.cnt} покупок на ${money(Number(longest.total))}`;
  }

  const text = [
    `📊 Статистика (${PERIOD_TITLE[period]})`,
    '',
    `💵 Потрачено: ${money(totalSpent)}`,
    `🛒 Покупок: ${totalCnt}  (✅ ${done} · ⚠️ ${support} · 💀 ${long})`,
    '',
    `📱 Телефоны (сейчас): ${active} активных · ${dead} умерло`,
    `🪦 Средний возраст до 💀: ${avgDeathLine}`,
    `🔥 Самая длинная серия: ${longestLine}`,
  ].join('\n');

  return { text, kb: periodKeyboard(period) };
}

// «📊 Статистика» / /stats — сводка с переключателем периода.
export async function showStats(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const { text, kb } = await renderStats('all');
  await ctx.reply(text, { reply_markup: kb });
}

// Переключение периода (callback).
export async function onStatsPeriod(ctx: AppContext, period: StatsPeriod): Promise<void> {
  const { text, kb } = await renderStats(period);
  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch {
    await ctx.reply(text, { reply_markup: kb });
  }
}

// /report — отправить сводку (за неделю) в группу.
export async function sendReportToGroup(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  if (!env.groupChatId) {
    await ctx.reply('Группа не настроена (нет TELEGRAM_GROUP_ID).');
    return;
  }
  const { text } = await renderStats('7d');
  try {
    await ctx.api.sendMessage(env.groupChatId, text);
    await ctx.reply('✅ Отчёт отправлен в группу.');
  } catch (err) {
    console.error('Не удалось отправить отчёт в группу:', err);
    await ctx.reply('Не удалось отправить в группу. Проверь, что бот в группе и ID верный.');
  }
}
