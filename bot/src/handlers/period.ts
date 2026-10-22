import { InlineKeyboard, type Api } from 'grammy';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { env } from '../config.js';
import { inTopic } from '../group.js';
import { fmtMsk, fmtMskDate, isLastDayOfMonthMsk } from '../format.js';
import { requireOperator } from './start.js';
import { requirePrivate, CANCEL_CB } from './common.js';
import { mainMenu } from './menus.js';
import { tally, tallyLines, periodSpan, FIRST_PERIOD_START, type Row } from './period-calc.js';

// Отчётный период (миграция 0018, 22.10.2026): итоги с последнего обнуления,
// итоги за всё время, кнопка «✅ Расчёт произведён — обнулить», блок в сводке.
// Счёт — в period-calc.ts (чистая логика с тестами), здесь база и кнопки.

export const PER_CB = 'per:';

/** Текущий период: id строки (0 — ещё ни разу не обнулялись) и начало. */
async function currentPeriod(): Promise<{ id: number; from: Date }> {
  const r = (await db.execute(sql`
    select id::int id, started_at from report_periods order by id desc limit 1`)) as unknown as {
    id: number;
    started_at: string;
  }[];
  return r[0] ? { id: r[0].id, from: new Date(r[0].started_at) } : { id: 0, from: new Date(FIRST_PERIOD_START) };
}

// Границы периода — полуинтервал [from, to): покупка в минуту обнуления уходит
// в новый период. У открытого периода конца нет — берём «конец времён».
const OPEN_END = new Date('9999-01-01T00:00:00Z');

async function rowsSince(from: Date, to: Date | null = null): Promise<Row[]> {
  return (await db.execute(sql`
    select p.game, c.code, p.amount::text amount, p.result::text result
    from purchases p join purchase_categories c on c.id = p.category_id
    where p.purchased_at >= ${from.toISOString()} and p.purchased_at < ${(to ?? OPEN_END).toISOString()}`)) as unknown as Row[];
}

async function ordersClosedSince(from: Date, to: Date | null = null): Promise<number> {
  const r = (await db.execute(sql`
    select count(*)::int n from order_queue
    where status = 'done' and done_at >= ${from.toISOString()}
      and done_at < ${(to ?? OPEN_END).toISOString()}`)) as unknown as { n: number }[];
  return r[0]?.n ?? 0;
}

/** Строки итога периода [from, to). */
async function periodBody(from: Date, to: Date | null, now: Date): Promise<string[]> {
  const [rows, orders] = await Promise.all([rowsSince(from, to), ordersClosedSince(from, to)]);
  return [
    `📊 Отчётный период ${periodSpan(from, to ?? now)}`,
    ...tallyLines(tally(rows), false),
    `   Заказов закрыто: ${orders}`,
  ];
}

/** Блок для ежедневной сводки; в последний день месяца — одно ненавязчивое напоминание. */
export async function periodSummaryLines(now = new Date()): Promise<string[]> {
  const p = await currentPeriod();
  const lines = await periodBody(p.from, null, now);
  if (isLastDayOfMonthMsk(now)) {
    lines.push(
      '🗓 Сегодня последний день месяца. Когда подведёте итог — «📥 Заказы» → ' +
        '«📊 Итоги периода» → «✅ Расчёт произведён».',
    );
  }
  return lines;
}

// ---------- Экраны ----------

export async function showPeriod(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const now = new Date();
  const p = await currentPeriod();
  const body = await periodBody(p.from, null, now);
  const kb = new InlineKeyboard();
  if (ctx.chat?.type === 'private') {
    kb.text('✅ Расчёт произведён — обнулить', `${PER_CB}ask`).row();
  }
  kb.text('📈 За всё время', `${PER_CB}all`);
  await ctx.reply(body.join('\n'), { reply_markup: kb });
}

export async function showAllTime(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const [rows, first, orders] = await Promise.all([
    rowsSince(new Date(0)),
    db.execute(sql`select min(purchased_at) first from purchases`) as unknown as Promise<{ first: string | null }[]>,
    ordersClosedSince(new Date(0)),
  ]);
  const since = first[0]?.first ? ` (с ${fmtMskDate(new Date(first[0].first))})` : '';
  await ctx.reply(
    [`📈 За всё время${since}`, ...tallyLines(tally(rows), true), `   Заказов закрыто: ${orders}`].join('\n'),
    { reply_markup: new InlineKeyboard().text('📊 Итоги периода', `${PER_CB}show`) },
  );
}

// ---------- Обнуление ----------

async function askClose(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const now = new Date();
  const p = await currentPeriod();
  const body = await periodBody(p.from, null, now);
  // id периода в кнопке: повторное нажатие или старая кнопка не обнулят
  // уже начатый новый период.
  const kb = new InlineKeyboard()
    .text('✅ Да, обнулить', `${PER_CB}close:${p.id}`)
    .text('❌ Отмена', CANCEL_CB);
  await ctx.reply(
    [
      'Закрыть отчётный период и начать новый с этой минуты?',
      '',
      ...body,
      '',
      'Итог уйдёт в группу (📊 Сводки) — он сохранится там.',
    ].join('\n'),
    { reply_markup: kb },
  );
}

async function closePeriod(ctx: AppContext, expectedId: number): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const p = await currentPeriod();
  if (p.id !== expectedId) {
    await ctx.reply('Этот период уже закрыт — новый идёт с момента прошлого обнуления.', {
      reply_markup: mainMenu(),
    });
    return;
  }
  const now = new Date();
  // Вставка только если с момента вопроса никто не обнулил (двойное нажатие,
  // второй человек): сверяем, что последний период всё ещё тот же.
  const ins = (await db.execute(sql`
    insert into report_periods (started_at, started_by)
    select ${now.toISOString()}::timestamptz, ${ctx.dbUser?.id ?? null}::uuid
    where coalesce((select max(id) from report_periods), 0) = ${expectedId}
    returning id`)) as unknown as { id: number }[];
  if (ins.length === 0) {
    await ctx.reply('Этот период уже закрыт — новый идёт с момента прошлого обнуления.', {
      reply_markup: mainMenu(),
    });
    return;
  }

  const body = await periodBody(p.from, now, now);
  const who = ctx.dbUser?.username ? `@${ctx.dbUser.username}` : 'оператор';
  const text = [
    `🧾 Отчётный период закрыт: ${fmtMskDate(p.from)} – ${fmtMsk(now)}`,
    ...body.slice(1),
    '',
    `Обнулил ${who}. Новый период — с ${fmtMsk(now)}.`,
  ].join('\n');
  await ctx.reply(text, { reply_markup: mainMenu() });
  await postToGroup(ctx.api, text);
}

async function postToGroup(api: Api, text: string): Promise<void> {
  if (!env.groupChatId) return;
  try {
    await api.sendMessage(env.groupChatId, text, inTopic('summary'));
  } catch (err) {
    console.error('Итог периода в группу не отправлен:', err);
  }
}

/** Роутинг callback'ов «per:…». */
export async function onPeriodCallback(ctx: AppContext, rest: string): Promise<void> {
  if (rest === 'show') return showPeriod(ctx);
  if (rest === 'all') return showAllTime(ctx);
  if (rest === 'ask') return askClose(ctx);
  if (rest.startsWith('close:')) {
    const id = Number(rest.slice(6));
    if (Number.isInteger(id)) return closePeriod(ctx, id);
  }
}
