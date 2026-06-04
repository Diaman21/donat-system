import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { phones, purchases, purchaseCategories, type PurchaseResultValue } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { mainMenu } from './menus.js';
import { requireOperator } from './start.js';
import { cancelKb, CANCEL_CB, requirePrivate } from './common.js';
import { buildPostMortem } from './postmortem.js';

// Префиксы callback-данных
export const CB = {
  phone: 'pur:phone:', // + phoneId
  cat: 'pur:cat:', // + категория (code)
  game: 'pur:game:', // + название игры ('' = без игры)
  amount: 'pur:amt:', // + число | 'custom'
  result: 'pur:res:', // + done|support|long
  note: 'pur:note', // добавить/изменить заметку (точное совпадение)
  save: 'pur:save', // подтвердить запись (точное совпадение)
} as const;

// Игры для выбора при закупке
const GAMES = ['Massive', 'Furious'] as const;

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
  if (!(await requirePrivate(ctx))) return;
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

// Шаг 2: выбрана категория → выбор игры (кнопки).
export async function onCategorySelected(ctx: AppContext, code: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_category') return;
  ctx.session.flow = { kind: 'purchase_game', phoneId: flow.phoneId, categoryCode: code };

  const kb = new InlineKeyboard();
  for (const g of GAMES) kb.text(g, `${CB.game}${g}`).row();
  kb.text('⏭ Без игры', `${CB.game}`).row();
  kb.text('✖️ Отмена', CANCEL_CB);
  await ctx.reply('В какой игре?', { reply_markup: kb });
}

// Шаг 3: выбрана игра (или «без игры») → выбор суммы (быстрые кнопки + «Другая»).
export async function onGameSelected(ctx: AppContext, gameValue: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_game') return;

  const game = gameValue.length > 0 ? gameValue : null;
  ctx.session.flow = {
    kind: 'purchase_amount',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game,
  };

  // Быстрые суммы из denominations категории
  const cat = await db
    .select({ denominations: purchaseCategories.denominations })
    .from(purchaseCategories)
    .where(eq(purchaseCategories.code, flow.categoryCode))
    .limit(1);
  const raw = cat[0]?.denominations;
  const denoms = Array.isArray(raw) ? (raw as number[]) : [];

  const kb = new InlineKeyboard();
  for (const d of denoms) kb.text(`$${d}`, `${CB.amount}${d}`);
  kb.row().text('✏️ Другая сумма', `${CB.amount}custom`).row().text('✖️ Отмена', CANCEL_CB);
  await ctx.reply('Сколько $ потрачено?', { reply_markup: kb });
}

// Шаг 4a: выбрана быстрая сумма (или «Другая») кнопкой.
export async function onAmountSelected(ctx: AppContext, value: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;

  if (value === 'custom') {
    await ctx.reply('Введи сумму $ числом (напр. 30):', { reply_markup: cancelKb() });
    return; // flow остаётся purchase_amount — ждём текст
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return;
  await askResult(ctx, n.toFixed(2));
}

// Шаг 4b: «своя» сумма текстом.
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
  await askResult(ctx, n.toFixed(2));
}

// Переход к выбору результата (общий для быстрой суммы и текстового ввода).
async function askResult(ctx: AppContext, amount: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;
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

// Шаг 5: выбран результат → показываем сводку на подтверждение.
export async function onResultSelected(ctx: AppContext, result: PurchaseResultValue): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_result') {
    await ctx.reply('Сессия ввода истекла. Начни заново: «➕ Закупка».', {
      reply_markup: mainMenu(),
    });
    return;
  }

  ctx.session.flow = {
    kind: 'purchase_confirm',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount: flow.amount,
    result,
    note: null,
  };
  await showConfirm(ctx);
}

// Показ экрана подтверждения (с заметкой, если есть).
async function showConfirm(ctx: AppContext): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_confirm') return;

  const ph = await db
    .select({ imei: phones.imeiLast4 })
    .from(phones)
    .where(eq(phones.id, flow.phoneId))
    .limit(1);
  const imei = ph[0]?.imei ?? '????';
  const catLabel = CATEGORY_LABEL[flow.categoryCode] ?? flow.categoryCode;

  const summary = [
    'Проверь и подтверди:',
    '',
    `📱 …${imei}`,
    `🗂 ${catLabel}${flow.game ? ` · ${flow.game}` : ''}`,
    `💵 $${flow.amount}`,
    `Результат: ${RESULT_LABEL[flow.result]}`,
    flow.note ? `📝 ${flow.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const kb = new InlineKeyboard()
    .text('✅ Записать', CB.save)
    .text(flow.note ? '📝 Изменить заметку' : '📝 Заметка', CB.note)
    .row()
    .text('✖️ Отмена', CANCEL_CB);
  await ctx.reply(summary, { reply_markup: kb });
}

// «📝 Заметка» — запросить текст заметки.
export async function onNoteRequest(ctx: AppContext): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_confirm') return;
  ctx.session.flow = {
    kind: 'purchase_note',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount: flow.amount,
    result: flow.result,
  };
  await ctx.reply('Напиши заметку по закупке (логи, детали, что с саппортом и т.п.):', {
    reply_markup: cancelKb(),
  });
}

// Текст заметки → возврат к подтверждению.
export async function onPurchaseNote(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_note') return;
  const note = text.trim().length > 0 ? text.trim() : null;
  ctx.session.flow = {
    kind: 'purchase_confirm',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount: flow.amount,
    result: flow.result,
    note,
  };
  await showConfirm(ctx);
}

// Шаг 6: подтверждено → сохраняем покупку (с заметкой).
export async function onConfirmSave(ctx: AppContext): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_confirm') {
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
    result: flow.result,
    game: flow.game,
    notes: flow.note,
  });

  const { phoneId, result, amount, game, note } = flow;
  ctx.session.flow = undefined;

  const parts = [
    `✅ Записано: ${RESULT_LABEL[result]}`,
    `Сумма: $${amount}`,
    game ? `Игра: ${game}` : null,
    note ? `📝 ${note}` : null,
  ].filter(Boolean);

  // При 💀 — телефон умер (триггер). Показываем «надгробие».
  if (result === 'long') {
    const pm = await buildPostMortem(phoneId);
    if (pm) parts.push('', pm);
  }

  await ctx.reply(parts.join('\n'), { reply_markup: mainMenu() });
}
