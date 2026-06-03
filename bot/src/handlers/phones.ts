import { and, eq, sql } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client';
import { phones, purchases } from '../db/schema';
import type { AppContext } from '../context';
import { mainMenu } from './menus';
import { requireOperator } from './start';
import { cancelKb, CANCEL_CB } from './common';
import { buildPostMortem } from './postmortem';

export const KILL_CB = 'kill:'; // спросить подтверждение вывода телефона
export const KILLC_CB = 'killc:'; // подтвердить вывод

// «➕ Телефон» — старт привязки: спрашиваем 4 цифры IMEI.
export async function startAddPhone(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  ctx.session.flow = { kind: 'add_phone_imei' };
  await ctx.reply('Введи последние 4 цифры IMEI телефона:', { reply_markup: cancelKb() });
}

// Шаг 1: получили IMEI (4 цифры) → проверяем дубль → спрашиваем метку.
export async function onAddPhoneImei(ctx: AppContext, text: string): Promise<void> {
  const imei = text.trim();
  if (!/^\d{4}$/.test(imei)) {
    await ctx.reply('Нужны ровно 4 цифры. Попробуй ещё раз:', { reply_markup: cancelKb() });
    return;
  }

  const dup = await db
    .select({ id: phones.id })
    .from(phones)
    .where(and(eq(phones.imeiLast4, imei), eq(phones.status, 'active')))
    .limit(1);
  if (dup.length > 0) {
    await ctx.reply(
      `Телефон …${imei} уже активен. Укажи другие 4 цифры или сначала выведи тот из активных.`,
      { reply_markup: cancelKb() },
    );
    return;
  }

  ctx.session.flow = { kind: 'add_phone_label', imei };
  await ctx.reply('Метка телефона (напр. «синий iPhone») или /skip:', { reply_markup: cancelKb() });
}

// Шаг 2: метка (или /skip) → создаём телефон.
export async function onAddPhoneLabel(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'add_phone_label') return;
  const user = ctx.dbUser;
  if (!user) return;

  const label = text.trim() === '/skip' ? null : text.trim();
  ctx.session.flow = undefined;

  try {
    const rows = await db
      .insert(phones)
      .values({ imeiLast4: flow.imei, label, operatorId: user.id })
      .returning();
    const p = rows[0]!;
    await ctx.reply(`✅ Телефон привязан: …${p.imeiLast4}${p.label ? ` («${p.label}»)` : ''}`, {
      reply_markup: mainMenu(),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('лимит активных') || msg.includes('max_active')) {
      await ctx.reply('⚠️ Уже 3 активных телефона — лимит. Сначала выведи один.', {
        reply_markup: mainMenu(),
      });
    } else if (msg.includes('phones_active_imei_unique')) {
      await ctx.reply('⚠️ Телефон с такими 4 цифрами уже активен.', { reply_markup: mainMenu() });
    } else {
      console.error('Ошибка привязки телефона:', err);
      await ctx.reply('Не удалось привязать телефон. Попробуй позже.', { reply_markup: mainMenu() });
    }
  }
}

// «📱 Телефоны» — список активных со статистикой + кнопки вывода.
export async function listPhones(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const active = await db.select().from(phones).where(eq(phones.status, 'active'));
  if (active.length === 0) {
    await ctx.reply('Активных телефонов нет. Привяжи через «➕ Телефон».');
    return;
  }

  const stats = await db
    .select({
      phoneId: purchases.phoneId,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.phoneId);
  const byPhone = new Map(stats.map((s) => [s.phoneId, s]));

  const lines: string[] = [];
  const kb = new InlineKeyboard();
  for (const p of active) {
    const s = byPhone.get(p.id);
    const cnt = s?.cnt ?? 0;
    const total = s?.total ?? '0';
    const label = p.label ? ` «${p.label}»` : '';
    lines.push(`📱 …${p.imeiLast4}${label} — $${total} за ${cnt} покупок`);
    kb.text(`☠️ Вывести …${p.imeiLast4}`, `${KILL_CB}${p.id}`).row();
  }

  await ctx.reply(['Активные телефоны:', '', ...lines].join('\n'), { reply_markup: kb });
}

// Спросить подтверждение ручного вывода телефона.
export async function onKillAsk(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const rows = await db
    .select({ imei: phones.imeiLast4, label: phones.label, status: phones.status })
    .from(phones)
    .where(eq(phones.id, phoneId))
    .limit(1);
  const ph = rows[0];
  if (!ph || ph.status !== 'active') {
    await ctx.reply('Телефон уже не активен.', { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard()
    .text('✅ Вывести', `${KILLC_CB}${phoneId}`)
    .text('✖️ Отмена', CANCEL_CB);
  await ctx.reply(
    `Вывести телефон …${ph.imei}${ph.label ? ` («${ph.label}»)` : ''} из активных?`,
    { reply_markup: kb },
  );
}

// Подтверждённый ручной вывод: помечаем dead (без покупки) + показываем итог.
export async function onKillConfirm(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const upd = await db
    .update(phones)
    .set({ status: 'dead', diedAt: new Date() })
    .where(and(eq(phones.id, phoneId), eq(phones.status, 'active')))
    .returning({ imei: phones.imeiLast4 });
  if (upd.length === 0) {
    await ctx.reply('Телефон уже не активен.', { reply_markup: mainMenu() });
    return;
  }
  const pm = await buildPostMortem(phoneId);
  await ctx.reply(`☠️ Телефон …${upd[0]!.imei} выведен из активных.\n\n${pm}`, {
    reply_markup: mainMenu(),
  });
}
