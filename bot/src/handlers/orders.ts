import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { orderQueue, purchases, users } from '../db/schema.js';
import { parseOrder, describePlan } from './order-parse.js';
import type { AppContext } from '../context.js';
import { mainMenu } from './menus.js';
import { requireOperator } from './start.js';
import { cancelKb, requirePrivate } from './common.js';
import { fmtMsk } from '../format.js';
import { env } from '../config.js';

// «📥 Заказы» — простой список задач команды: скинул текст → отметил выполненным.
// С покупками сознательно НЕ связан (чтобы не мусорить данные «зелёного коридора»).

export const ORD_CB = 'ord:'; // + done:<id> | cancel:<id>

const MAX_OPEN_SHOWN = 15; // чтобы не упереться в лимит длины сообщения
const MAX_TEXT = 150; // длинные заказы режем в списке

function short(t: string): string {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT)}…` : one;
}

// Сколько закупок нужно по заказу (из items.total; по умолчанию 1).
function plannedTotal(items: unknown): number {
  const t = (items as { total?: number } | null)?.total;
  return typeof t === 'number' && t > 0 ? t : 1;
}
// Что ещё не куплено по заказу — для подсказки «осталось…».
function remainingLabels(items: unknown, doneCount: number): string {
  const list = (items as { list?: { label: string; amount: number }[] } | null)?.list;
  if (!Array.isArray(list) || list.length === 0) return '';
  const left = list.slice(doneCount);
  return left.length ? left.map((i) => `${i.label} €${i.amount}`).join(' + ') : '';
}

// Итог по заказу после закупки.
// Закрываем ТОЛЬКО когда сделаны ВСЕ позиции и покупка успешна.
// При ⚠️/💀 счётчик не растёт: покупка была, но позиция не закрыта —
// саппорт повторяем завтра, смерть доделываем на другом телефоне.
export async function closeOrderIfDone(
  ctx: AppContext,
  orderId: string,
  result: 'done' | 'support' | 'long',
): Promise<string> {
  const user = ctx.dbUser;
  const rows = await db
    .select({ num: orderQueue.num, status: orderQueue.status, items: orderQueue.items })
    .from(orderQueue)
    .where(eq(orderQueue.id, orderId))
    .limit(1);
  const o = rows[0];
  if (!o) return '⚠️ Заказ не найден — покупка записана без привязки.';

  if (result !== 'done') {
    return `📌 Заказ #${o.num} ОСТАЛСЯ ОТКРЫТЫМ (покупка не прошла) — доделать позже.`;
  }
  if (o.status !== 'open') {
    return `📌 Заказ #${o.num} уже был закрыт ранее.`;
  }

  // Считаем успешные закупки, привязанные к этому заказу (текущая уже записана).
  const cnt = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(purchases)
    .where(and(eq(purchases.orderQueueId, orderId), eq(purchases.result, 'done')));
  const doneCount = cnt[0]?.c ?? 0;
  const total = plannedTotal(o.items);

  if (doneCount < total) {
    const left = remainingLabels(o.items, doneCount);
    return [
      `📌 Заказ #${o.num}: закупка ${doneCount} из ${total} ✅`,
      left ? `   Осталось: ${left}` : `   Осталось закупок: ${total - doneCount}`,
      '   Заказ остаётся открытым — жми «✅ Выполнить» снова.',
    ].join('\n');
  }

  await db
    .update(orderQueue)
    .set({ status: 'done', doneBy: user?.id ?? null, doneAt: new Date() })
    .where(and(eq(orderQueue.id, orderId), eq(orderQueue.status, 'open')));
  const open = await countOpen();
  return `✅ Заказ #${o.num} выполнен ПОЛНОСТЬЮ (${total} из ${total}) и закрыт.\nОткрытых осталось: ${open}.`;
}

// Кого тегать в группе — операторы и модераторы (в группе @упоминание реально пингует).
async function teamMentions(): Promise<string> {
  const team = await db
    .select({ username: users.username })
    .from(users)
    .where(and(inArray(users.role, ['operator', 'moderator']), eq(users.isActive, true)));
  return team
    .filter((u) => u.username)
    .map((u) => `@${u.username}`)
    .join(' ');
}

// Уведомление в группу о новом заказе. Ошибка отправки не должна ломать
// сохранение заказа — он уже в базе, а группа просто не получит пинг.
async function notifyGroupNewOrder(
  ctx: AppContext,
  num: number,
  body: string,
  author: string | null,
): Promise<void> {
  if (!env.groupChatId) return;
  try {
    const mentions = await teamMentions();
    const open = await countOpen();
    const text = [
      `📥 НОВЫЙ ЗАКАЗ #${num}`,
      `от @${author ?? '—'} · ${fmtMsk(new Date())}`,
      '',
      body.length > 3000 ? `${body.slice(0, 3000)}…` : body,
      '',
      mentions ? `👉 ${mentions} — в работу!` : '👉 В работу!',
      `Открытых заказов: ${open}`,
    ].join('\n');
    await ctx.api.sendMessage(env.groupChatId, text);
  } catch (err) {
    console.error('Не удалось отправить заказ в группу:', err);
  }
}

// «📝 Заказ» — попросить текст заказа.
export async function startAddOrder(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  ctx.session.flow = { kind: 'order_text' };
  await ctx.reply('Скинь текст заказа (как пришёл — можно просто скопировать):', {
    reply_markup: cancelKb(),
  });
}

// Текст заказа → сохраняем.
export async function onOrderText(ctx: AppContext, text: string): Promise<void> {
  const user = ctx.dbUser;
  if (!user) return;
  const body = text.trim();
  if (body.length === 0) {
    await ctx.reply('Пустой заказ не сохраню. Пришли текст:', { reply_markup: cancelKb() });
    return;
  }
  ctx.session.flow = undefined;

  const ins = await db
    .insert(orderQueue)
    .values({ text: body, createdBy: user.id })
    .returning({ num: orderQueue.num });

  const num = ins[0]!.num;
  await notifyGroupNewOrder(ctx, num, body, user.username);

  const open = await countOpen();
  await ctx.reply(
    `✅ Заказ #${num} добавлен.\nОткрытых сейчас: ${open}.\n📢 Отправил в группу с тегами.`,
    { reply_markup: mainMenu() },
  );
}

async function countOpen(): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(orderQueue)
    .where(eq(orderQueue.status, 'open'));
  return r[0]?.c ?? 0;
}

// «📥 Заказы» — открытые заказы + счётчики выполненных.
export async function listOrders(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const open = await db
    .select({
      id: orderQueue.id,
      num: orderQueue.num,
      text: orderQueue.text,
      createdAt: orderQueue.createdAt,
      author: users.username,
      items: orderQueue.items,
      // сколько закупок по заказу уже успешно сделано
      doneCount: sql<number>`(select count(*)::int from ${purchases}
        where ${purchases.orderQueueId} = ${orderQueue.id}
          and ${purchases.result} = 'done')`,
    })
    .from(orderQueue)
    .leftJoin(users, eq(users.id, orderQueue.createdBy))
    .where(eq(orderQueue.status, 'open'))
    .orderBy(asc(orderQueue.createdAt));

  // Счётчики выполненных: сегодня / за неделю / всего (по МСК-суткам)
  const done = await db
    .select({
      today: sql<number>`count(*) filter (
        where (${orderQueue.doneAt} at time zone 'Europe/Moscow')::date
            = (now() at time zone 'Europe/Moscow')::date)::int`,
      week: sql<number>`count(*) filter (
        where ${orderQueue.doneAt} >= now() - interval '7 days')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(orderQueue)
    .where(eq(orderQueue.status, 'done'));
  const d = done[0] ?? { today: 0, week: 0, total: 0 };

  const head = [
    `📥 Заказы — открыто: ${open.length}`,
    `✅ выполнено: сегодня ${d.today} · за неделю ${d.week} · всего ${d.total}`,
    '',
  ];

  const allowEdit = ctx.chat?.type === 'private';
  const kb = new InlineKeyboard();

  if (open.length === 0) {
    if (allowEdit) kb.text('➕ Добавить заказ', `${ORD_CB}add`);
    await ctx.reply([...head, 'Открытых заказов нет 🎉'].join('\n'), {
      reply_markup: allowEdit ? kb : undefined,
    });
    return;
  }

  const shown = open.slice(0, MAX_OPEN_SHOWN);
  const lines: string[] = [];

  for (const o of shown) {
    // Прогресс показываем только когда состав уже подтверждён и он многошаговый
    const total = o.items ? plannedTotal(o.items) : 0;
    const prog = total > 1 ? `  ·  ${o.doneCount} из ${total} ✅` : '';
    lines.push(`#${o.num} · @${o.author ?? '—'}, ${fmtMsk(o.createdAt)}${prog}`);
    lines.push(short(o.text));
    lines.push('');
    if (allowEdit) {
      // «Выполнить» запускает обычную цепочку закупки; заказ закроется в конце,
      // и только если покупка прошла успешно.
      kb.text(`✅ Выполнить #${o.num}`, `${ORD_CB}done:${o.id}`)
        .text(`🗑 #${o.num}`, `${ORD_CB}cancel:${o.id}`)
        .row();
    }
  }
  if (open.length > shown.length) {
    lines.push(`…и ещё ${open.length - shown.length} открытых (показаны первые ${MAX_OPEN_SHOWN}).`);
  }
  if (allowEdit) kb.text('➕ Добавить заказ', `${ORD_CB}add`);

  await ctx.reply([...head, ...lines].join('\n'), {
    reply_markup: allowEdit ? kb : undefined,
  });
}

// «✅ Выполнить» — НЕ закрывает заказ сразу, а готовит запуск цепочки закупки.
// Заказ закроется в самом конце (onNetSelected → closeOrderIfDone) и только при ✅.
//
// Возвращает true, если можно запускать закупку. Саму закупку вызывает bot.ts —
// специально, чтобы orders.ts не импортировал purchase.ts: там уже есть импорт
// closeOrderIfDone отсюда, и вышел бы циклический импорт (на Vercel-ESM опасно).
export async function onOrderExecute(ctx: AppContext, id: string): Promise<boolean> {
  if (!(await requirePrivate(ctx))) return false;
  if (!(await requireOperator(ctx))) return false;

  const rows = await db
    .select({
      num: orderQueue.num,
      text: orderQueue.text,
      status: orderQueue.status,
      items: orderQueue.items,
    })
    .from(orderQueue)
    .where(eq(orderQueue.id, id))
    .limit(1);
  const o = rows[0];
  if (!o) {
    await ctx.reply('Заказ не найден.');
    await listOrders(ctx);
    return false;
  }
  if (o.status !== 'open') {
    await ctx.reply('Этот заказ уже закрыт.');
    await listOrders(ctx);
    return false;
  }

  // Состав ещё не подтверждён — показываем распознанное и ждём подтверждения.
  // Слепо доверять парсеру нельзя: ошибка либо закроет заказ рано, либо подвесит.
  if (!o.items) {
    const plan = parseOrder(o.text);
    const kb = new InlineKeyboard();
    if (plan.total > 0) kb.text(`✅ Верно, ${plan.total} — начать`, `${ORD_CB}plan:${id}:0`).row();
    for (const n of [1, 2, 3, 4]) kb.text(`${n}`, `${ORD_CB}plan:${id}:${n}`);
    kb.row().text('⬅️ Назад к заказам', `${ORD_CB}list`);
    await ctx.reply(
      [
        `▶️ Заказ #${o.num}`,
        short(o.text),
        '',
        ...describePlan(plan),
        '',
        plan.total > 0
          ? 'Если распознал верно — жми «✅ Верно». Иначе выбери число закупок.'
          : 'Выбери, сколько закупок нужно по этому заказу.',
      ].join('\n'),
      { reply_markup: kb },
    );
    return false; // закупку пока не начинаем
  }

  // Состав уже известен — показываем прогресс и идём к закупке.
  const cnt = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(purchases)
    .where(and(eq(purchases.orderQueueId, id), eq(purchases.result, 'done')));
  const doneCount = cnt[0]?.c ?? 0;
  const total = plannedTotal(o.items);
  const left = remainingLabels(o.items, doneCount);

  ctx.session.pendingOrderId = id;
  await ctx.reply(
    [
      `▶️ Заказ #${o.num} — закупка ${doneCount + 1} из ${total}`,
      short(o.text),
      left ? `\nСейчас покупаем: ${left.split(' + ')[0]}` : '',
      '\nЗаписываем закупку.',
    ].join('\n'),
  );
  return true;
}

// Подтверждение состава заказа: n=0 — принять распознанное, n>0 — задать вручную.
// Возвращает true, если можно запускать закупку.
export async function onOrderPlan(ctx: AppContext, id: string, n: number): Promise<boolean> {
  if (!(await requirePrivate(ctx))) return false;
  if (!(await requireOperator(ctx))) return false;

  const rows = await db
    .select({ num: orderQueue.num, text: orderQueue.text, status: orderQueue.status })
    .from(orderQueue)
    .where(eq(orderQueue.id, id))
    .limit(1);
  const o = rows[0];
  if (!o || o.status !== 'open') {
    await ctx.reply('Заказ не найден или уже закрыт.');
    await listOrders(ctx);
    return false;
  }

  const plan = parseOrder(o.text);
  const total = n > 0 ? n : plan.total;
  if (total < 1) {
    await ctx.reply('Не понял количество. Выбери числом.');
    return false;
  }
  // Если оператор задал число вручную и оно не совпало с разбором — разбивку
  // не сохраняем, чтобы не показывать неверные подсказки «осталось…».
  const items = { total, list: n > 0 && n !== plan.total ? [] : plan.list };

  await db.update(orderQueue).set({ items }).where(eq(orderQueue.id, id));
  ctx.session.pendingOrderId = id;
  await ctx.reply(`✅ Заказ #${o.num}: ${total} ${total === 1 ? 'закупка' : 'закупки'}. Начинаем первую.`);
  return true;
}

// «🗑 Отменить» — заказ отменён без закупки (клиент отвалился, ошиблись при вводе).
export async function onOrderCancel(ctx: AppContext, id: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const user = ctx.dbUser;
  if (!user) return;

  const upd = await db
    .update(orderQueue)
    .set({ status: 'cancelled', doneBy: user.id, doneAt: new Date() })
    .where(and(eq(orderQueue.id, id), eq(orderQueue.status, 'open')))
    .returning({ num: orderQueue.num });

  if (upd.length === 0) {
    await ctx.reply('Этот заказ уже закрыт (или не найден).');
    return void (await listOrders(ctx));
  }
  await ctx.reply(`🗑 Заказ #${upd[0]!.num} отменён.`);
  await listOrders(ctx);
}
