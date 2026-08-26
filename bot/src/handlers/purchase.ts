import { eq, sql } from 'drizzle-orm';
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
  cnt: 'pur:cnt:', // + inc|dec|done|noop — счётчик кол-ва (ВК-мультизакуп)
  result: 'pur:res:', // + done|support|long
  note: 'pur:note', // добавить/изменить заметку (точное совпадение)
  net: 'pur:net:', // + mobile|wifi — выбор интернета = запись покупки
} as const;

// Игры для выбора при закупке
const GAMES = ['Massive', 'Furious'] as const;

// Быстрые кнопки сумм по играм — цены в играх разные.
const GAME_AMOUNTS: Record<string, number[]> = {
  Massive: [2, 100], // €2 — разогрев (только здесь); €30 в Massive нет
  Furious: [30, 105], // большая покупка в Furious стоит €105
};

// В Furious большую покупку (€105) можно сделать ТОЛЬКО ОДИН РАЗ на телефон.
// Исторические записи шли как €100 — учитываем оба номинала.
export const FURIOUS_BIG = [100, 105];

// Была ли уже успешная большая покупка Furious на этом телефоне.
export async function hasFuriousBig(phoneId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1 from purchases
    where phone_id = ${phoneId} and game = 'Furious'
      and amount in (100, 105) and result = 'done'
    limit 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

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
    await ctx.reply('Нет активных телефонов. Сначала привяжи телефон через «➕📱 Телефон».');
    return;
  }

  const kb = new InlineKeyboard();
  for (const p of active) {
    const label = `…${p.imeiLast4}${p.label ? ` (${p.label})` : ''}`;
    kb.text(label, `${CB.phone}${p.id}`).row();
  }
  kb.text('❌ Отмена', CANCEL_CB);
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
  kb.text('❌ Отмена', CANCEL_CB);
  await ctx.reply('Что закупаем?', { reply_markup: kb });
}

// Шаг 2: выбрана категория. Для танков — спрашиваем игру; для ВК игра не нужна
// (Massive/Furious — это танки), сразу к выбору голосов/суммы.
export async function onCategorySelected(ctx: AppContext, code: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_category') return;

  if (code === 'vk_votes') {
    ctx.session.flow = {
      kind: 'purchase_amount',
      phoneId: flow.phoneId,
      categoryCode: code,
      game: null,
    };
    await askAmount(ctx);
    return;
  }

  ctx.session.flow = { kind: 'purchase_game', phoneId: flow.phoneId, categoryCode: code };
  const kb = new InlineKeyboard();
  for (const g of GAMES) kb.text(g, `${CB.game}${g}`).row();
  kb.text('✏️ Другая игра', `${CB.game}__custom`).row();
  kb.text('❌ Отмена', CANCEL_CB);
  await ctx.reply('В какой игре?', { reply_markup: kb });
}

// Шаг 3 (только танки): выбрана игра → выбор суммы (или ввод названия текстом).
export async function onGameSelected(ctx: AppContext, gameValue: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_game') return;

  if (gameValue === '__custom') {
    ctx.session.flow = {
      kind: 'purchase_game_custom',
      phoneId: flow.phoneId,
      categoryCode: flow.categoryCode,
    };
    await ctx.reply('Напиши название игры:', { reply_markup: cancelKb() });
    return;
  }

  const game = gameValue.length > 0 ? gameValue : null;
  ctx.session.flow = {
    kind: 'purchase_amount',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game,
  };
  await askAmount(ctx);
}

// Название «другой игры» текстом → к выбору суммы.
export async function onPurchaseGame(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_game_custom') return;

  const game = text.trim();
  if (game.length === 0 || game.length > 50) {
    await ctx.reply('Нужно название игры текстом (до 50 символов). Попробуй ещё раз:', {
      reply_markup: cancelKb(),
    });
    return;
  }
  ctx.session.flow = {
    kind: 'purchase_amount',
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game,
  };
  await askAmount(ctx);
}

// Показ выбора суммы. Для танков суммы зависят от ИГРЫ (цены разные),
// для ВК — номиналы голосов из denominations категории.
async function askAmount(ctx: AppContext): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;

  const cat = await db
    .select({ denominations: purchaseCategories.denominations })
    .from(purchaseCategories)
    .where(eq(purchaseCategories.code, flow.categoryCode))
    .limit(1);
  const raw = cat[0]?.denominations;
  let denoms = Array.isArray(raw) ? [...raw] : [];
  if (flow.categoryCode === 'game_donate' && flow.game) {
    // Цены в играх отличаются, поэтому кнопки задаём по игре:
    //   Massive — €2 (разогрев, только здесь) и €100; €30 в Massive нет.
    //   Furious — €30 и €105 (большая покупка стоит 105, не 100).
    // Другая игра — общие суммы из denominations категории.
    const perGame = GAME_AMOUNTS[flow.game];
    if (perGame) denoms = [...perGame];
  }

  const kb = new InlineKeyboard();
  let isVk = false;
  for (const d of denoms) {
    if (typeof d === 'number') {
      kb.text(`€${d}`, `${CB.amount}${d}`);
    } else if (d && typeof d === 'object' && 'price' in d && 'units' in d) {
      const o = d as { units: number; price: number };
      kb.text(`${o.units} голосов · €${o.price}`, `${CB.amount}${o.price}:${o.units}`).row();
      isVk = true;
    }
  }
  kb.row().text('✏️ Другая сумма', `${CB.amount}custom`).row().text('❌ Отмена', CANCEL_CB);
  await ctx.reply(isVk ? 'Сколько голосов купил?' : 'Сколько € потрачено?', { reply_markup: kb });
}

// Шаг 4a: выбрана быстрая сумма (или «Другая») кнопкой.
export async function onAmountSelected(ctx: AppContext, value: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_amount') return;

  if (value === 'custom') {
    await ctx.reply('Введи сумму € числом (напр. 30):', { reply_markup: cancelKb() });
    return; // flow остаётся purchase_amount — ждём текст
  }
  // value может быть "0.99:10" (цена:голоса для ВК) или "30" (€ для игр)
  const [priceStr, unitsStr] = value.split(':');
  const n = Number(priceStr);
  if (!Number.isFinite(n) || n <= 0) return;
  const units = unitsStr ? Number(unitsStr) : null;

  // ВК (есть голоса) — мультизакуп: набираем кол-во одинаковых покупок счётчиком.
  if (units !== null && Number.isFinite(units)) {
    ctx.session.flow = {
      kind: 'purchase_count',
      phoneId: flow.phoneId,
      categoryCode: flow.categoryCode,
      amount: n.toFixed(2),
      unitsPer: units,
      qty: 1,
    };
    await showCounter(ctx, false);
    return;
  }

  // Танки — одна покупка, сразу к результату.
  await askResult(ctx, {
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount: n.toFixed(2),
    units: null,
    qty: 1,
  });
}

// Шаг 4b: «своя» сумма текстом (€, без голосов).
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
  await askResult(ctx, {
    phoneId: flow.phoneId,
    categoryCode: flow.categoryCode,
    game: flow.game,
    amount: n.toFixed(2),
    units: null,
    qty: 1,
  });
}

// Экран счётчика количества (ВК-мультизакуп): ➖ N шт ➕ / ✅ Далее.
async function showCounter(ctx: AppContext, edit: boolean): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_count') return;
  const totalEur = (Number(flow.amount) * flow.qty).toFixed(2);
  const totalVotes = flow.unitsPer * flow.qty;
  const text =
    `🗳 ${flow.unitsPer} голосов · €${flow.amount} за покупку\n` +
    `Количество покупок: ${flow.qty}\n` +
    `Итого: €${totalEur} · ${totalVotes} голосов`;
  const kb = new InlineKeyboard()
    .text('🔻', `${CB.cnt}dec`)
    .text(`${flow.qty} шт`, `${CB.cnt}noop`)
    .text('🔺', `${CB.cnt}inc`)
    .row()
    .text(`✅ Далее (${flow.qty})`, `${CB.cnt}done`)
    .row()
    .text('❌ Отмена', CANCEL_CB);
  if (edit) {
    await ctx.editMessageText(text, { reply_markup: kb }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

// Нажатия счётчика: ➕/➖ меняют кол-во на месте, «Далее» → к результату.
export async function onCounter(ctx: AppContext, action: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_count') return;

  if (action === 'inc') {
    ctx.session.flow = { ...flow, qty: Math.min(flow.qty + 1, 99) };
    await showCounter(ctx, true);
    return;
  }
  if (action === 'dec') {
    ctx.session.flow = { ...flow, qty: Math.max(flow.qty - 1, 1) };
    await showCounter(ctx, true);
    return;
  }
  if (action === 'done') {
    await ctx.editMessageReplyMarkup().catch(() => {});
    await askResult(ctx, {
      phoneId: flow.phoneId,
      categoryCode: flow.categoryCode,
      game: null,
      amount: flow.amount,
      units: flow.unitsPer,
      qty: flow.qty,
    });
  }
  // noop — просто индикатор, ничего не делаем
}

// Переход к выбору результата (для танков, ВК-мультизакупа и текстовой суммы).
async function askResult(
  ctx: AppContext,
  data: {
    phoneId: string;
    categoryCode: string;
    game: string | null;
    amount: string;
    units: number | null;
    qty: number;
  },
): Promise<void> {
  ctx.session.flow = { kind: 'purchase_result', ...data };
  const totalEur = (Number(data.amount) * data.qty).toFixed(2);
  const head =
    data.qty > 1
      ? `${data.qty} × €${data.amount} = €${totalEur}${
          data.units ? ` · ${data.units * data.qty} голосов` : ''
        }. Результат?`
      : `Сумма €${data.amount}. Результат?`;
  const kb = new InlineKeyboard()
    .text(RESULT_LABEL.done, `${CB.result}done`)
    .row()
    .text(RESULT_LABEL.support, `${CB.result}support`)
    .row()
    .text(RESULT_LABEL.long, `${CB.result}long`)
    .row()
    .text('❌ Отмена', CANCEL_CB);
  await ctx.reply(head, { reply_markup: kb });
}

// Шаг 5: выбран результат → показываем сводку на подтверждение.
export async function onResultSelected(ctx: AppContext, result: PurchaseResultValue): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_result') {
    await ctx.reply('Сессия ввода истекла. Начни заново: «🛒 Закупка».', {
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
    units: flow.units,
    qty: flow.qty,
    result,
    note: null,
  };
  await showConfirm(ctx);
}

// Итог за всё время на телефоне — контроль суммарной нагрузки в подтверждении.
async function phoneTotals(
  phoneId: string,
): Promise<{ cnt: number; eur: number; votes: number }> {
  const rows = (await db.execute(sql`
    select count(*)::int as cnt,
           coalesce(sum(amount),0)::float as eur,
           coalesce(sum(units),0)::int as votes
    from purchases where phone_id = ${phoneId}
  `)) as unknown as { cnt: number; eur: number; votes: number }[];
  return rows[0] ?? { cnt: 0, eur: 0, votes: 0 };
}

// Итог покупок за сегодня (МСК) на телефоне — для контроля темпа в подтверждении.
async function todayTally(
  phoneId: string,
): Promise<{ tank: Record<number, number>; vkCnt: number; vkVotes: number }> {
  const rows = (await db.execute(sql`
    select c.code as code, p.amount::float as amount, count(*)::int as cnt,
           coalesce(sum(p.units),0)::int as votes
    from purchases p join purchase_categories c on c.id = p.category_id
    where p.phone_id = ${phoneId}
      and (p.purchased_at at time zone 'Europe/Moscow')::date
          = (now() at time zone 'Europe/Moscow')::date
    group by c.code, p.amount
  `)) as unknown as { code: string; amount: number; cnt: number; votes: number }[];
  const tank: Record<number, number> = {};
  let vkCnt = 0;
  let vkVotes = 0;
  for (const r of rows) {
    if (r.code === 'game_donate') tank[r.amount] = (tank[r.amount] ?? 0) + r.cnt;
    else if (r.code === 'vk_votes') {
      vkCnt += r.cnt;
      vkVotes += r.votes;
    }
  }
  return { tank, vkCnt, vkVotes };
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

  // Итог за сегодня + за всё время на этом телефоне (контроль темпа и суммарной нагрузки)
  const tally = await todayTally(flow.phoneId);
  const totals = await phoneTotals(flow.phoneId);
  const tallyLines: string[] = [];
  if (flow.categoryCode === 'game_donate') {
    const a2 = tally.tank[2] ?? 0;
    const a30 = tally.tank[30] ?? 0;
    const a100 = (tally.tank[100] ?? 0) + (tally.tank[105] ?? 0);
    tallyLines.push(`📊 Сегодня на …${imei}: €2×${a2} · €30×${a30} · €100/105×${a100}`);
    const cur = Number(flow.amount);
    if (cur === 2 || cur === 30 || cur === 100 || cur === 105) {
      tallyLines.push(`   ↳ эта €${cur} будет ${(tally.tank[cur] ?? 0) + 1}-й за сегодня`);
    }
    // В Furious большая покупка — только одна на телефон.
    if (flow.game === 'Furious' && FURIOUS_BIG.includes(cur) && (await hasFuriousBig(flow.phoneId))) {
      tallyLines.push('', '❗️ На этом телефоне большая покупка в Furious УЖЕ БЫЛА — второй не бывает!');
    }
  } else if (flow.categoryCode === 'vk_votes') {
    const after = tally.vkVotes + (flow.units ?? 0) * flow.qty;
    tallyLines.push(
      `📊 Сегодня на …${imei}: 🗳 ${tally.vkCnt} покупок · ${tally.vkVotes} голосов → станет ${after}`,
    );
  }
  const willBeEur = totals.eur + Number(flow.amount) * flow.qty;
  tallyLines.push(
    `💰 Всего на …${imei}: ${totals.cnt} покупок · €${totals.eur.toFixed(2)} → станет €${willBeEur.toFixed(2)}`,
  );
  const multi = flow.qty > 1;
  const totalEur = (Number(flow.amount) * flow.qty).toFixed(2);

  let summary = [
    'Проверь и подтверди:',
    '',
    `📱 …${imei}`,
    `🗂 ${catLabel}${flow.game ? ` · ${flow.game}` : ''}`,
    multi ? `🔁 ${flow.qty} покупок подряд` : null,
    flow.units
      ? `🗳 ${flow.units}${multi ? ` × ${flow.qty} = ${flow.units * flow.qty}` : ''} голосов`
      : null,
    multi ? `💵 €${flow.amount} × ${flow.qty} = €${totalEur}` : `💵 €${flow.amount}`,
    `Результат: ${RESULT_LABEL[flow.result]}`,
    multi && flow.result !== 'done'
      ? `↳ запишем ${flow.qty - 1}×✅ + последняя ${RESULT_LABEL[flow.result]} (ошибка — у последней попытки)`
      : null,
    flow.note ? `📝 ${flow.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  if (tallyLines.length) summary += `\n\n${tallyLines.join('\n')}`;

  const kb = new InlineKeyboard()
    .text('📶 Моб. интернет', `${CB.net}mobile`)
    .text('📡 Wi-Fi', `${CB.net}wifi`)
    .row()
    .text(flow.note ? '📝 Изменить заметку' : '📝 Заметка', CB.note)
    .row()
    .text('❌ Отмена', CANCEL_CB);
  await ctx.reply(`${summary}\n\nВыбери интернет — это запишет закупку:`, { reply_markup: kb });
}

const INTERNET_LABEL: Record<string, string> = {
  mobile: '📶 моб. интернет',
  wifi: '📡 Wi-Fi',
};

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
    units: flow.units,
    qty: flow.qty,
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
    units: flow.units,
    qty: flow.qty,
    result: flow.result,
    note,
  };
  await showConfirm(ctx);
}

// Шаг 6: выбран интернет → сохраняем покупку (с заметкой и типом интернета).
export async function onNetSelected(ctx: AppContext, net: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'purchase_confirm') {
    await ctx.reply('Сессия ввода истекла. Начни заново: «🛒 Закупка».', {
      reply_markup: mainMenu(),
    });
    return;
  }
  const user = ctx.dbUser;
  if (!user) return;
  const internet = net === 'mobile' || net === 'wifi' ? net : null;

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

  // ВК-мультизакуп: пишем qty ОТДЕЛЬНЫХ строк (каждая транзакция важна для аналитики).
  // Если серия закончилась ⚠️/💀 — ошибка всегда у ПОСЛЕДНЕЙ попытки: успешные
  // пишем ✅, иначе N строк long/support исказят аналитику смертей (и триггер
  // смерти сработал бы N раз).
  const rows = Array.from({ length: flow.qty }, (_, i) => ({
    phoneId: flow.phoneId,
    operatorId: user.id,
    categoryId: category.id,
    amount: flow.amount,
    result: i < flow.qty - 1 ? ('done' as const) : flow.result,
    game: flow.game,
    notes: flow.note,
    internet,
    units: flow.units,
  }));
  await db.insert(purchases).values(rows);

  const { phoneId, result, amount, game, note, units, qty } = flow;
  ctx.session.flow = undefined;

  const multi = qty > 1;
  const totalEur = (Number(amount) * qty).toFixed(2);
  const parts = [
    multi
      ? result === 'done'
        ? `✅ Записано ${qty} покупок: ${RESULT_LABEL[result]}`
        : `✅ Записано ${qty} покупок: ${qty - 1}×✅ + 1 ${RESULT_LABEL[result]}`
      : `✅ Записано: ${RESULT_LABEL[result]}`,
    units ? `🗳 ${units}${multi ? ` × ${qty} = ${units * qty}` : ''} голосов` : null,
    multi ? `Сумма: €${amount} × ${qty} = €${totalEur}` : `Сумма: €${amount}`,
    game ? `Игра: ${game}` : null,
    internet ? `Интернет: ${INTERNET_LABEL[internet]}` : null,
    note ? `📝 ${note}` : null,
  ].filter(Boolean);

  // При 💀 — телефон умер (триггер). Показываем «надгробие».
  if (result === 'long') {
    const pm = await buildPostMortem(phoneId);
    if (pm) parts.push('', pm);
  }

  await ctx.reply(parts.join('\n'), { reply_markup: mainMenu() });
}
