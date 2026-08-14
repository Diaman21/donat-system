import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { phones, purchases, purchaseCategories, users } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { env } from '../config.js';

export type StatsPeriod = 'all' | '24h' | '7d';
export const STATS_CB = 'stats:'; // + all|24h|7d

const PERIOD_TITLE: Record<StatsPeriod, string> = {
  all: 'за всё время',
  '24h': 'за сутки',
  '7d': 'за неделю',
};

function money(n: number): string {
  return `€${n.toFixed(2)}`;
}

// Вывод бюджета — на 14-й день после ПЕРВОЙ покупки на телефон.
// Предупреждаем заранее, с 12-го дня (буфер на всякий случай).
const WITHDRAW_DAYS = 14;
const WARN_FROM_DAY = 12;

// Громкий блок «пора выводить бюджет» — для верха ежедневного отчёта.
// Появляется ТОЛЬКО когда есть активные телефоны на 12+ дне.
// Тегаем операторов/модераторов, чтобы Telegram прислал уведомление.
async function withdrawalAlerts(): Promise<string[]> {
  const rows = (await db.execute(sql`
    select ph.imei_last4 as imei, ph.label,
      to_char((min(p.purchased_at) at time zone 'Europe/Moscow')::date, 'YYYY-MM-DD') as first_day
    from phones ph join purchases p on p.phone_id = ph.id
    where ph.status = 'active'
    group by ph.id, ph.imei_last4, ph.label
  `)) as unknown as { imei: string; label: string | null; first_day: string }[];

  const pad = (n: number) => String(n).padStart(2, '0');
  const t = new Date(Date.now() + 3 * 3600 * 1000); // МСК
  const todayUTC = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

  const alerts: { line: string; days: number }[] = [];
  for (const r of rows) {
    const [fy, fm, fd] = r.first_day.split('-').map(Number);
    const firstUTC = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
    const days = Math.floor((todayUTC - firstUTC) / 86400000);
    if (days < WARN_FROM_DAY) continue;
    const wd = new Date(firstUTC + WITHDRAW_DAYS * 86400000);
    const wl = `${pad(wd.getUTCDate())}.${pad(wd.getUTCMonth() + 1)}`;
    const label = r.label ? ` «${r.label}»` : '';
    let line: string;
    if (days >= WITHDRAW_DAYS)
      line = `🔴🔴 …${r.imei}${label} — ${days}-й день, ПРОСРОЧЕНО! (вывод был ${wl})`;
    else if (days === WITHDRAW_DAYS - 1)
      line = `🔴 …${r.imei}${label} — 13-й день, ВЫВОД ЗАВТРА (${wl})`;
    else line = `🟠 …${r.imei}${label} — ${days}-й день, вывод ${wl}`;
    alerts.push({ line, days });
  }
  if (alerts.length === 0) return [];
  alerts.sort((a, b) => b.days - a.days);

  const team = await db
    .select({ username: users.username })
    .from(users)
    .where(and(inArray(users.role, ['operator', 'moderator']), eq(users.isActive, true)));
  const mentions = team
    .filter((u) => u.username)
    .map((u) => `@${u.username}`)
    .join(' ');

  return [
    '‼️‼️ ВЫВОД БЮДЖЕТА ‼️‼️',
    ...alerts.map((a) => a.line),
    mentions ? `👉 ${mentions} — не пропустите вывод!` : '👉 Не пропустите вывод!',
    '➖➖➖➖➖➖➖➖➖➖',
    '',
  ];
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

export async function renderStats(
  period: StatsPeriod,
): Promise<{ text: string; kb: InlineKeyboard }> {
  const filter = periodFilter(period);

  // Громкий блок «пора выводить бюджет» — всегда наверху (не зависит от периода)
  const alertLines = await withdrawalAlerts();

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

  // Всего голосов ВК куплено (с учётом периода)
  const votesQuery = db
    .select({ votes: sql<number>`coalesce(sum(${purchases.units}), 0)::int` })
    .from(purchases);
  const votesRes = await (filter ? votesQuery.where(filter) : votesQuery);
  const totalVotes = votesRes[0]?.votes ?? 0;

  // Телефоны и «возраст до 💀» — по всему времени (текущее состояние парка)
  const allPhones = await db
    .select({
      id: phones.id,
      imei: phones.imeiLast4,
      status: phones.status,
      deathReason: phones.deathReason,
    })
    .from(phones);
  const active = allPhones.filter((p) => p.status === 'active').length;
  const dead = allPhones.filter((p) => p.status === 'dead').length;
  const deadError = allPhones.filter((p) => p.status === 'dead' && p.deathReason === 'error').length;
  const deadForced = allPhones.filter(
    (p) => p.status === 'dead' && p.deathReason === 'forced',
  ).length;
  const imeiById = new Map(allPhones.map((p) => [p.id, p.imei]));
  // Для «возраста до 💀» берём только естественные смерти (ошибка Apple),
  // вынужденные выводы (forced) — искусственные, искажают порог.
  const deadIds = new Set(
    allPhones.filter((p) => p.status === 'dead' && p.deathReason === 'error').map((p) => p.id),
  );

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
    avgDeathLine = `${avgCnt.toFixed(1)} покупок / ${money(avgSpent)} (по ошибкам Apple)`;
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

  // Разбивка ПО ТИПУ (🎮 Танки / 🗳 ВК) — методики разные, считаем раздельно
  const byCatQuery = db
    .select({
      code: purchaseCategories.code,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
      votes: sql<number>`coalesce(sum(${purchases.units}), 0)::int`,
    })
    .from(purchases)
    .innerJoin(purchaseCategories, eq(purchaseCategories.id, purchases.categoryId))
    .groupBy(purchaseCategories.code);
  const byCat = await (filter ? byCatQuery.where(filter) : byCatQuery);
  const catName = (c: string) =>
    c === 'game_donate' ? '🎮 Танки' : c === 'vk_votes' ? '🗳 ВК' : c;
  const catLines =
    byCat.length > 0
      ? byCat
          .sort((a, b) => Number(b.total) - Number(a.total))
          .map((c) => {
            const v = c.votes > 0 ? ` · ${c.votes} гол.` : '';
            return `  • ${catName(c.code)}: ${money(Number(c.total))} (${c.cnt})${v}`;
          })
      : ['  —'];

  // Разбивка по играм (с учётом периода)
  const byGameQuery = db
    .select({
      game: purchases.game,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.game);
  const byGame = await (filter ? byGameQuery.where(filter) : byGameQuery);
  const gameLines =
    byGame.length > 0
      ? byGame
          .sort((a, b) => Number(b.total) - Number(a.total))
          .map((g) => `  • ${g.game ?? 'без игры'}: ${money(Number(g.total))} (${g.cnt})`)
      : ['  —'];

  // Разбивка по типу интернета (с учётом периода) — аргумент коридора
  const byNetQuery = db
    .select({
      internet: purchases.internet,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.internet);
  const byNet = await (filter ? byNetQuery.where(filter) : byNetQuery);
  const netLabel = (n: string | null) =>
    n === 'mobile' ? '📶 моб.' : n === 'wifi' ? '📡 Wi-Fi' : '— не указан';
  const netLines =
    byNet.length > 0
      ? byNet
          .sort((a, b) => Number(b.total) - Number(a.total))
          .map((n) => `  • ${netLabel(n.internet)}: ${money(Number(n.total))} (${n.cnt})`)
      : ['  —'];

  // Разбивка по операторам (с учётом периода)
  const byOperatorQuery = db
    .select({
      username: users.username,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.operatorId))
    .groupBy(users.username);
  const byOperator = await (filter ? byOperatorQuery.where(filter) : byOperatorQuery);
  const operatorLines =
    byOperator.length > 0
      ? byOperator
          .sort((a, b) => Number(b.total) - Number(a.total))
          .map((o) => `  • @${o.username ?? '—'}: ${money(Number(o.total))} (${o.cnt})`)
      : ['  —'];

  const text = [
    ...alertLines,
    `📊 Статистика (${PERIOD_TITLE[period]})`,
    '',
    `💵 Потрачено: ${money(totalSpent)}`,
    `🛒 Покупок: ${totalCnt}  (✅ ${done} · ⚠️ ${support} · 💀 ${long})`,
    totalVotes > 0 ? `🗳 Голосов ВК куплено: ${totalVotes}` : null,
    '',
    `📱 Телефоны (сейчас): ${active} активных · ${dead} умерло (❌ ${deadError} ошибка · 🔄 ${deadForced} вынужд.)`,
    `🪦 Средний возраст до 💀: ${avgDeathLine}`,
    `🔥 Самая длинная серия: ${longestLine}`,
    '',
    '📂 По типу (методики разные):',
    ...catLines,
    '',
    '🎮 По играм:',
    ...gameLines,
    '',
    '🌐 По интернету:',
    ...netLines,
    '',
    '👤 По операторам:',
    ...operatorLines,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { text, kb: periodKeyboard(period) };
}

// «📊 Статистика» / /stats — сводка с переключателем периода.
export async function showStats(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const { text, kb } = await renderStats('all');
  await ctx.reply(text, { reply_markup: kb });
}

// Переключение периода (callback).
// Роль проверяем и здесь: в группе кнопки видны всем участникам.
export async function onStatsPeriod(ctx: AppContext, period: StatsPeriod): Promise<void> {
  if (!(await requireOperator(ctx))) return;
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
