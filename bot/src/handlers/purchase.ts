import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client';
import { phones, purchases, purchaseCategories, type PurchaseResultValue } from '../db/schema';
import type { AppContext } from '../context';
import { mainMenu } from './menus';
import { requireOperator } from './start';

// Префиксы callback-данных
export const CB = {
  phone: 'pur:phone:', // + phoneId
  result: 'pur:res:', // + done|support|long
} as const;

const RESULT_LABEL: Record<PurchaseResultValue, string> = {
  done: '✅ Выполнено',
  support: '⚠️ Ошибка (саппорт)',
  long: '💀 Телефон умер',
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
  await ctx.reply('С какого телефона закупка?', { reply_markup: kb });
}

// Шаг 1: выбран телефон → спрашиваем игру.
export async function onPhoneSelected(ctx: AppContext, phoneId: string): Promise<void> {
  ctx.session.flow = { kind: 'purchase_game', phoneId };
  await ctx.reply('В какой игре? (напр. «Массив») или /skip:');
}

// Шаг 2: игра (или /skip) → спрашиваем сумму.
export async function onPurchaseGame(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_game') return;

  const game = text.trim() === '/skip' ? null : text.trim();
  ctx.session.flow = { kind: 'purchase_amount', phoneId: flow.phoneId, game };
  await ctx.reply('Сколько $ потрачено? (напр. 30):');
}

// Шаг 3: сумма → показываем кнопки результата.
export async function onPurchaseAmount(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;

  const n = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    await ctx.reply('Нужна сумма числом больше 0 (напр. 30). Попробуй ещё раз:');
    return;
  }
  const amount = n.toFixed(2);

  ctx.session.flow = { kind: 'purchase_result', phoneId: flow.phoneId, game: flow.game, amount };
  const kb = new InlineKeyboard()
    .text(RESULT_LABEL.done, `${CB.result}done`)
    .row()
    .text(RESULT_LABEL.support, `${CB.result}support`)
    .row()
    .text(RESULT_LABEL.long, `${CB.result}long`);
  await ctx.reply(`Сумма $${amount}. Результат?`, { reply_markup: kb });
}

// Шаг 4: выбран результат → сохраняем покупку.
export async function onResultSelected(ctx: AppContext, result: PurchaseResultValue): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_result') {
    await ctx.reply('Сессия ввода истекла. Начни заново: «➕ Закупка».', { reply_markup: mainMenu() });
    return;
  }
  const user = ctx.dbUser;
  if (!user) return;

  // Категория по умолчанию — game_donate
  const cat = await db
    .select()
    .from(purchaseCategories)
    .where(eq(purchaseCategories.code, 'game_donate'))
    .limit(1);
  const category = cat[0];
  if (!category) {
    await ctx.reply('Не найдена категория game_donate в БД. Сообщи модератору.');
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

  ctx.session.flow = undefined;

  const parts = [
    `Записано: ${RESULT_LABEL[result]}`,
    `Сумма: $${flow.amount}`,
    flow.game ? `Игра: ${flow.game}` : null,
  ].filter(Boolean);

  if (result === 'long') {
    parts.push('', '💀 Телефон помечен мёртвым и выведен из активных.');
  }

  await ctx.reply(parts.join('\n'), { reply_markup: mainMenu() });
}
