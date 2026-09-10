import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { orderQueue, users } from '../db/schema.js';
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

  if (open.length === 0) {
    await ctx.reply([...head, 'Открытых заказов нет 🎉'].join('\n'));
    return;
  }

  const shown = open.slice(0, MAX_OPEN_SHOWN);
  const lines: string[] = [];
  const allowEdit = ctx.chat?.type === 'private';
  const kb = new InlineKeyboard();

  for (const o of shown) {
    lines.push(`#${o.num} · @${o.author ?? '—'}, ${fmtMsk(o.createdAt)}`);
    lines.push(short(o.text));
    lines.push('');
    if (allowEdit) {
      kb.text(`✅ #${o.num}`, `${ORD_CB}done:${o.id}`)
        .text(`🗑 #${o.num}`, `${ORD_CB}cancel:${o.id}`)
        .row();
    }
  }
  if (open.length > shown.length) {
    lines.push(`…и ещё ${open.length - shown.length} открытых (показаны первые ${MAX_OPEN_SHOWN}).`);
  }

  await ctx.reply([...head, ...lines].join('\n'), {
    reply_markup: allowEdit ? kb : undefined,
  });
}

// Закрытие заказа: выполнен или отменён.
export async function onOrderClose(ctx: AppContext, action: string, id: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const user = ctx.dbUser;
  if (!user) return;

  const status = action === 'done' ? 'done' : 'cancelled';
  const upd = await db
    .update(orderQueue)
    .set({ status, doneBy: user.id, doneAt: new Date() })
    .where(and(eq(orderQueue.id, id), eq(orderQueue.status, 'open')))
    .returning({ num: orderQueue.num });

  if (upd.length === 0) {
    await ctx.reply('Этот заказ уже закрыт (или не найден).');
    await listOrders(ctx);
    return;
  }

  const label = status === 'done' ? '✅ выполнен' : '🗑 отменён';
  await ctx.reply(`Заказ #${upd[0]!.num} — ${label}.`);
  await listOrders(ctx);
}
