import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client';
import { phones, purchases, purchaseCategories, type PurchaseResultValue } from '../db/schema';
import type { AppContext } from '../context';
import { mainMenu } from './menus';
import { requireOperator } from './start';
import { cancelKb, CANCEL_CB } from './common';
import { buildPostMortem } from './postmortem';

// Префиксы callback-данных
export const CB = {
  phone: 'pur:phone:', // + phoneId
  cat: 'pur:cat:', // + категория (code)
  result: 'pur:res:', // + done|support|long
} as const;

const RESULT_LABEL: Record<PurchaseResultValue, string> = {
  done: '✅ Выполнено',
  support: '⚠️ Ошибка (саппорт)',
  long: '💀 Телефон умер',
};

const CATEGORY_LABEL: Record<string, string> = {
  game_donate: '🎮 Донат в игре',
  vk_votes: '🗳 Голоса ВК',
};

// «➕ Закупка» — шаг 0: выбор телефона (inline-кнопки активных).
export async function startPurchase(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const active = await db.select().from(phones).where(eq(phones.status, 'active'));
  if (active.length === 0) {
    await ctx.reply('Нет активных телефонов. Сначала привяжи телефон через «➕ Телефон».');
    return;
  }

  const kb = new InlineKeyboard();
  for (const p of active) {
    const label = `…${p.imeiLast4}${p.label ? ` (${p.label})` : ''}`;
    kb.text(label, `${CB.phone}${p.id}`).row();
  }
  kb.text('✖️ Отмена', CANCEL_CB);
  await ctx.reply('С какого телефона закупка?', { reply_markup: kb });
}

// Шаг 1: выбран телефон → выбор категории.
export async function onPhoneSelected(ctx: AppContext, phoneId: string): Promise<void> {
  ctx.session.flow = { kind: 'purchase_category', phoneId };
  const cats = await db
    .select({ code: purchaseCategories.code })
    .from(purchaseCategories)
    .where(eq(purchaseCategories.isActive, true));

  const kb = new InlineKeyboard();
  for (const c of cats) {
    kb.text(CATEGORY_LABEL[c.code] ?? c.code, `${CB.cat}${c.code}`).row();
  }
  kb.text('✖️ Отмена', CANCEL_CB);
  await ctx.reply('Что закупаем?', { reply_markup: kb });
}

// Шаг 2: выбрана категория → спрашиваем игру.
export async function onCategorySelected(ctx: AppContext, code: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_category') return;
  ctx.session.flow = { kind: 'purchase_game', phoneId: flow.phoneId, categoryCode: code };
  await ctx.reply('В какой игре? (напр. «Массив») или /skip:', { reply_markup: cancelKb() });
}

// Шаг 3: игра (или /skip) → спрашиваем сумму.
export async function onPurchaseGame(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_game') return;

  const game = text.trim() === '/skip' ? null : text.trim();
  ctx.session.flow = {
    kind: 'purchase_amount',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game,
  };
  await ctx.reply('Сколько $ потрачено? (напр. 30):', { reply_markup: cancelKb() });
}

// Шаг 4: сумма → показываем кнопки результата.
export async function onPurchaseAmount(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;

  const n = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    await ctx.reply('Нужна сумма числом больше 0 (напр. 30). Попробуй ещё раз:', {
      reply_markup: cancelKb(),
    });
    return;
  }
  const amount = n.toFixed(2);

  ctx.session.flow = {
    kind: 'purchase_result',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount,
  };
  const kb = new InlineKeyboard()
    .text(RESULT_LABEL.done, `${CB.result}done`)
    .row()
    .text(RESULT_LABEL.support, `${CB.result}support`)
    .row()
    .text(RESULT_LABEL.long, `${CB.result}long`)
    .row()
    .text('✖️ Отмена', CANCEL_CB);
  await ctx.reply(`Сумма $${amount}. Результат?`, { reply_markup: kb });
}

// Шаг 5: выбран результат → сохраняем покупку.
export async function onResultSelected(ctx: AppContext, result: PurchaseResultValue): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_result') {
    await ctx.reply('Сессия ввода истекла. Начни заново: «➕ Закупка».', {
      reply_markup: mainMenu(),
    });
    return;
  }
  const user = ctx.dbUser;
  if (!user) return;

  const cat = await db
    .select()
    .from(purchaseCategories)
    .where(eq(purchaseCategories.code, flow.categoryCode))
    .limit(1);
  const category = cat[0];
  if (!category) {
    await ctx.reply('Не найдена категория в БД. Сообщи модератору.');
    ctx.session.flow = undefined;
    return;
  }

  await db.insert(purchases).values({
    phoneId: flow.phoneId,
    operatorId: user.id,
    categoryId: category.id,
    amount: flow.amount,
    result,
    game: flow.game,
  });

  const phoneId = flow.phoneId;
  ctx.session.flow = undefined;

  const parts = [
    `Записано: ${RESULT_LABEL[result]}`,
    `Сумма: $${flow.amount}`,
    flow.game ? `Игра: ${flow.game}` : null,
  ].filter(Boolean);

  // При 💀 — телефон умер (триггер). Показываем «надгробие».
  if (result === 'long') {
    const pm = await buildPostMortem(phoneId);
    if (pm) parts.push('', pm);
  }

  await ctx.reply(parts.join('\n'), { reply_markup: mainMenu() });
}
