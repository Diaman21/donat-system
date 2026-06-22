import { and, desc, eq, sql } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { phones, purchases } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { mainMenu } from './menus.js';
import { requireOperator } from './start.js';
import { cancelKb, CANCEL_CB, requirePrivate } from './common.js';
import { buildPostMortem } from './postmortem.js';
import { fmtMsk } from '../format.js';
import { HIST_CB } from './history.js';

export const KILL_CB = 'kill:'; // спросить подтверждение вывода телефона
export const KILLC_CB = 'killc:'; // подтвердить вывод
export const ADDPH_CB = 'addph:'; // подтвердить привязку при повторе 4 цифр (+ imei)
export const DEST_CB = 'dest:'; // назначение нового телефона (+ active|prepared)
export const PREP_CB = 'prep:'; // подготовленный → в работу (+ phoneId)

// «➕ Телефон» — старт привязки: спрашиваем 4 цифры IMEI.
export async function startAddPhone(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
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

  // активный дубль — нельзя (триггер БД тоже не даст 2 активных с одним IMEI)
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

  // те же 4 цифры уже были в истории (умершие) — предупреждаем, но не блокируем
  const past = await db
    .select({ label: phones.label, diedAt: phones.diedAt, deathReason: phones.deathReason })
    .from(phones)
    .where(and(eq(phones.imeiLast4, imei), eq(phones.status, 'dead')))
    .orderBy(desc(phones.diedAt));
  if (past.length > 0) {
    const p = past[0]!;
    const reason =
      p.deathReason === 'error'
        ? 'ошибка Apple'
        : p.deathReason === 'forced'
          ? 'вынужденный вывод'
          : '—';
    const when = p.diedAt ? fmtMsk(p.diedAt) : '—';
    const lbl = p.label ? ` «${p.label}»` : '';
    const more = past.length > 1 ? ` Всего таких в истории: ${past.length}.` : '';
    const kb = new InlineKeyboard()
      .text('✅ Это новый аппарат — привязать', `${ADDPH_CB}${imei}`)
      .row()
      .text('✖️ Отмена', CANCEL_CB);
    await ctx.reply(
      `⚠️ На …${imei} уже работали${lbl}: умер ${when} (${reason}).${more}\n\n` +
        'Последние 4 цифры IMEI могут совпадать у разных аппаратов. ' +
        'Это тот же телефон или новый с теми же цифрами?',
      { reply_markup: kb },
    );
    return; // ждём подтверждения кнопкой
  }

  ctx.session.flow = { kind: 'add_phone_label', imei };
  await ctx.reply('Метка телефона (напр. «синий iPhone») или /skip:', { reply_markup: cancelKb() });
}

// Подтверждение привязки при повторе 4 цифр → переходим к метке.
export async function onAddPhoneConfirm(ctx: AppContext, imei: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  if (!/^\d{4}$/.test(imei)) return;
  ctx.session.flow = { kind: 'add_phone_label', imei };
  await ctx.reply('Метка телефона (напр. «красный 11») или /skip:', { reply_markup: cancelKb() });
}

// Шаг 2: метка (или /skip) → выбор назначения (в работу / подготовленные).
export async function onAddPhoneLabel(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'add_phone_label') return;

  const label = text.trim() === '/skip' ? null : text.trim();
  ctx.session.flow = { kind: 'add_phone_dest', imei: flow.imei, label };

  const kb = new InlineKeyboard()
    .text('▶️ В работу (на закупки)', `${DEST_CB}active`)
    .row()
    .text('🧰 В подготовленные', `${DEST_CB}prepared`)
    .row()
    .text('✖️ Отмена', CANCEL_CB);
  await ctx.reply(
    'Куда добавить телефон?\n' +
      '▶️ В работу — сразу на закупки (≤3 активных).\n' +
      '🧰 Подготовленные — резерв (аккаунт/игры накачены, но пока не в работе).',
    { reply_markup: kb },
  );
}

// Шаг 3: выбрано назначение → создаём телефон с нужным статусом.
export async function onAddPhoneDest(ctx: AppContext, dest: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'add_phone_dest') return;
  const user = ctx.dbUser;
  if (!user) return;
  const status = dest === 'prepared' ? 'prepared' : 'active';
  ctx.session.flow = undefined;

  try {
    const rows = await db
      .insert(phones)
      .values({ imeiLast4: flow.imei, label: flow.label, operatorId: user.id, status })
      .returning();
    const p = rows[0]!;
    const where = status === 'prepared' ? '🧰 в подготовленные' : '▶️ в работу';
    await ctx.reply(
      `✅ Телефон …${p.imeiLast4}${p.label ? ` («${p.label}»)` : ''} добавлен ${where}.`,
      { reply_markup: mainMenu() },
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes('лимит активных') || msg.includes('max_active')) {
      await ctx.reply(
        '⚠️ Уже 3 активных телефона — в работу нельзя. Добавь в 🧰 подготовленные ' +
          '(📲 Телефон заново) или сначала выведи активный.',
        { reply_markup: mainMenu() },
      );
    } else if (msg.includes('phones_active_imei_unique')) {
      await ctx.reply('⚠️ Телефон с такими 4 цифрами уже активен.', { reply_markup: mainMenu() });
    } else {
      console.error('Ошибка добавления телефона:', err);
      await ctx.reply('Не удалось добавить телефон. Попробуй позже.', { reply_markup: mainMenu() });
    }
  }
}

// «🧰 Подготовленные» — резерв телефонов + кнопка ввода в работу.
export async function listPrepared(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const prep = await db
    .select()
    .from(phones)
    .where(eq(phones.status, 'prepared'))
    .orderBy(desc(phones.createdAt));
  if (prep.length === 0) {
    await ctx.reply('Подготовленных телефонов нет. Добавь через «📲 Телефон» → «🧰 В подготовленные».');
    return;
  }

  const allowWork = ctx.chat?.type === 'private';
  const lines = prep.map((p) => `🧰 …${p.imeiLast4}${p.label ? ` «${p.label}»` : ''}`);
  const kb = new InlineKeyboard();
  if (allowWork) {
    for (const p of prep) kb.text(`▶️ В работу …${p.imeiLast4}`, `${PREP_CB}${p.id}`).row();
  }
  await ctx.reply(['🧰 Подготовленные телефоны:', '', ...lines].join('\n'), {
    reply_markup: allowWork ? kb : undefined,
  });
}

// «▶️ В работу» — перевод подготовленного телефона в активные (лимит ≤3).
export async function onPreparedToWork(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  try {
    const upd = await db
      .update(phones)
      .set({ status: 'active', connectedAt: new Date() })
      .where(and(eq(phones.id, phoneId), eq(phones.status, 'prepared')))
      .returning({ imei: phones.imeiLast4 });
    if (upd.length === 0) {
      await ctx.reply('Телефон не найден среди подготовленных.', { reply_markup: mainMenu() });
      return;
    }
    await ctx.reply(`▶️ Телефон …${upd[0]!.imei} введён в работу (отсчёт жизни — с этого момента).`, {
      reply_markup: mainMenu(),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('лимит активных') || msg.includes('max_active')) {
      await ctx.reply('⚠️ Уже 3 активных телефона. Сначала выведи один.', { reply_markup: mainMenu() });
    } else {
      console.error('Ошибка ввода в работу:', err);
      await ctx.reply('Не удалось ввести в работу. Попробуй позже.', { reply_markup: mainMenu() });
    }
  }
}

// «☎️ Телефоны» — список активных со статистикой + кнопки вывода.
export async function listPhones(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const active = await db.select().from(phones).where(eq(phones.status, 'active'));
  if (active.length === 0) {
    await ctx.reply('Активных телефонов нет. Привяжи через «📲 Телефон».');
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

  // Кнопки вывода — только в личке (в группе список только для просмотра)
  const allowKill = ctx.chat?.type === 'private';

  const lines: string[] = [];
  const kb = new InlineKeyboard();
  for (const p of active) {
    const s = byPhone.get(p.id);
    const cnt = s?.cnt ?? 0;
    const total = s?.total ?? '0';
    const label = p.label ? ` «${p.label}»` : '';
    lines.push(`📱 …${p.imeiLast4}${label} — €${total} за ${cnt} покупок`);
    // у каждого: подробная инфо (история+разбивка) и вывод
    kb.text(`📜 …${p.imeiLast4}`, `${HIST_CB}${p.id}`);
    if (allowKill) kb.text(`☠️ Вывести …${p.imeiLast4}`, `${KILL_CB}${p.id}`);
    kb.row();
  }

  await ctx.reply(['Активные телефоны:', '', ...lines].join('\n'), { reply_markup: kb });
}

// Спросить подтверждение ручного вывода телефона.
export async function onKillAsk(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
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
    `Вынужденно вывести телефон …${ph.imei}${ph.label ? ` («${ph.label}»)` : ''} из активных?\n` +
      'Это для возврата бюджета (НЕ ошибка Apple) — в аналитике помечается как искусственная смерть.',
    { reply_markup: kb },
  );
}

// Подтверждённый ручной вывод: помечаем dead с причиной 'forced' + показываем итог.
export async function onKillConfirm(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const upd = await db
    .update(phones)
    .set({ status: 'dead', diedAt: new Date(), deathReason: 'forced' })
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
