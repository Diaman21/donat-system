import { InlineKeyboard } from 'grammy';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { PurchaseResultValue } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { fmtMsk } from '../format.js';
import { requireOperator } from './start.js';
import { requirePrivate, cancelKb, CANCEL_CB } from './common.js';
import { mainMenu, menuFor } from './menus.js';
import {
  computeCard,
  cardLines,
  pickWithdrawCandidate,
  parseEur,
  fmtEur,
  REFUND_DELAY_H,
  type CardState,
  type RefundInput,
  type Refund,
} from './card-calc.js';

// Бюджет на карте (миграция 0017, 10.10.2026): экран «💳 Бюджет на карте»,
// ввод суммы руками, поправка возвратов, строки для сводки и подсказок.
// Расчёт — в card-calc.ts (чистая логика с тестами), здесь только база и кнопки.

export const CARD_CB = 'card:';

const H = 3600 * 1000;
// Сколько дней назад смотреть выведенные телефоны. Возврат без поправки
// приходит через 48 ч после вывода — более старые давно в балансе. Запас —
// на поправки «пришёл позже срока».
const REFUND_LOOKBACK_D = 14;

/** Состояние карты из базы. */
export async function loadCardState(now: Date = new Date()): Promise<CardState> {
  const a = (await db.execute(sql`
    select amount_eur::float amount, effective_at at from card_ledger
     where kind = 'balance' order by effective_at desc, id desc limit 1`)) as unknown as {
    amount: number;
    at: string;
  }[];
  const anchor = a[0] ? { amount: Number(a[0].amount), at: new Date(a[0].at) } : null;

  // ✅ после правки руками — по created_at: это реальное время ввода, а сумма
  // на карте вписана тоже «сейчас». purchased_at могли поправить задним числом.
  const spendRows = anchor
    ? ((await db.execute(sql`
        select amount::text amount, result::text result from purchases
         where created_at > ${anchor.at.toISOString()}`)) as unknown as {
        amount: string;
        result: PurchaseResultValue;
      }[])
    : [];

  const since = new Date((anchor?.at ?? now).getTime() - REFUND_LOOKBACK_D * 24 * H);
  const r = (await db.execute(sql`
    select ph.id phone_id, ph.imei_last4 imei, ph.label, ph.died_at,
      coalesce((select sum(q.amount) from purchases q
                 where q.phone_id = ph.id and q.result = 'done'), 0)::float paid,
      l.amount_eur::float o_amount, l.effective_at o_at
    from phones ph
    left join card_ledger l on l.phone_id = ph.id and l.kind = 'refund'
    where ph.status = 'dead' and ph.died_at > ${since.toISOString()}`)) as unknown as {
    phone_id: string;
    imei: string;
    label: string | null;
    died_at: string;
    paid: number;
    o_amount: number | null;
    o_at: string | null;
  }[];
  const refunds: RefundInput[] = r.map((x) => ({
    phoneId: x.phone_id,
    imei: x.imei,
    label: x.label,
    diedAt: new Date(x.died_at),
    paid: Number(x.paid),
    override:
      x.o_amount != null && x.o_at != null ? { amount: Number(x.o_amount), at: new Date(x.o_at) } : null,
  }));
  return computeCard(anchor, spendRows, refunds, now);
}

async function loadCandidate(now: Date) {
  const rows = (await db.execute(sql`
    select ph.imei_last4 imei, ph.label,
      (select min(q.purchased_at) from purchases q where q.phone_id = ph.id) first_at,
      coalesce((select sum(q.amount) from purchases q
                 where q.phone_id = ph.id and q.result = 'done'), 0)::float paid
    from phones ph where ph.status = 'active'`)) as unknown as {
    imei: string;
    label: string | null;
    first_at: string | null;
    paid: number;
  }[];
  return pickWithdrawCandidate(
    rows.map((p) => ({
      imei: p.imei,
      label: p.label,
      firstAt: p.first_at ? new Date(p.first_at) : null,
      paid: Number(p.paid),
    })),
    now,
  );
}

/** Блок для ежедневной сводки. */
export async function cardSummaryLines(): Promise<string[]> {
  const now = new Date();
  const [st, cand] = await Promise.all([loadCardState(now), loadCandidate(now)]);
  return cardLines(st, cand, { full: false });
}

/** Строка после ✅ покупки: сколько осталось. Пусто, пока сумма не вписана. */
export async function cardAfterPurchaseLine(): Promise<string | null> {
  const st = await loadCardState();
  return st.balance === null ? null : `💳 На карте ≈ ${fmtEur(st.balance)}`;
}

/** Строка после вывода телефона: сколько и когда вернётся. */
export async function refundNoticeLine(phoneId: string): Promise<string | null> {
  const st = await loadCardState();
  const r = st.inTransit.find((x) => x.phoneId === phoneId);
  if (!r) return null;
  return (
    `💶 Вернётся на карту ≈ ${fmtEur(r.amount)} ~${fmtMsk(r.at)} (через ${REFUND_DELAY_H} ч) — ` +
    'в бюджет добавится сам. Пришло не всё или раньше — «💳 Бюджет на карте».'
  );
}

// ---------- Экран ----------

export async function showCard(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const now = new Date();
  const [st, cand] = await Promise.all([loadCardState(now), loadCandidate(now)]);
  const kb = new InlineKeyboard();
  if (ctx.chat?.type === 'private') {
    kb.text(st.balance === null ? '✏️ Вписать сумму' : '✏️ Исправить сумму', `${CARD_CB}set`).row();
    for (const r of st.inTransit) {
      kb.text(`💶 Пришёл …${r.imei}`, `${CARD_CB}arr:${r.phoneId}`)
        .text(`✏️ Возврат …${r.imei}`, `${CARD_CB}ref:${r.phoneId}`)
        .row();
    }
    for (const r of st.creditedList) kb.text(`✏️ Возврат …${r.imei}`, `${CARD_CB}ref:${r.phoneId}`).row();
  }
  const help =
    st.balance === null
      ? []
      : [
          '',
          'Покупки ✅ вычитаются сами, возвраты при выкате прибавляются сами',
          `(все ✅ телефона через ${REFUND_DELAY_H} ч). Что-то не сошлось — исправь сумму.`,
        ];
  await ctx.reply([...cardLines(st, cand, { full: true }), ...help].join('\n'), {
    // В группе — без клавиатуры меню (она мешает всем), как и в других отчётах.
    reply_markup: kb.inline_keyboard.length > 0 ? kb : menuFor(ctx),
  });
}

// ---------- Ввод суммы на карте ----------

export async function startCardSet(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  ctx.session.flow = { kind: 'card_balance' };
  await ctx.reply('Сколько сейчас на карте? Напиши число в евро (напр. 1240 или 1240,50):', {
    reply_markup: cancelKb(),
  });
}

export async function onCardBalanceText(ctx: AppContext, text: string): Promise<void> {
  const amount = parseEur(text);
  if (amount === null) {
    await ctx.reply('Нужно число в евро, напр. 1240 или 1240,50. Попробуй ещё раз:', {
      reply_markup: cancelKb(),
    });
    return;
  }
  const at = new Date();
  const st = await loadCardState(at);
  // Возвраты в пути: если какой-то уже пришёл, он сидит во вписанной сумме,
  // и прибавить его по сроку значило бы задвоить. Спрашиваем по каждому.
  if (st.inTransit.length > 0) {
    ctx.session.flow = {
      kind: 'card_balance_ask',
      amount,
      at: at.toISOString(),
      queue: st.inTransit.map((r) => r.phoneId),
      arrived: [],
    };
    await askNextRefund(ctx, st.inTransit);
    return;
  }
  await saveBalance(ctx, amount, at, []);
}

async function askNextRefund(ctx: AppContext, inTransit: Refund[]): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'card_balance_ask') return;
  const r = inTransit.find((x) => x.phoneId === flow.queue[0]);
  if (!r) {
    // Пока спрашивали, телефон «воскресили» через ↩️ — пропускаем.
    const queue = flow.queue.slice(1);
    ctx.session.flow = { ...flow, queue };
    if (queue.length > 0) return askNextRefund(ctx, inTransit);
    return finishBalance(ctx);
  }
  const kb = new InlineKeyboard()
    .text('✅ Уже на карте', `${CARD_CB}ask:y`)
    .text('⏳ Ещё в пути', `${CARD_CB}ask:n`)
    .row()
    .text('❌ Отмена', CANCEL_CB);
  await ctx.reply(
    `Возврат …${r.imei}${r.label ? ` «${r.label}»` : ''} ${fmtEur(r.amount)} (ждём ~${fmtMsk(r.at)}) ` +
      `уже пришёл и входит в ${fmtEur(flow.amount)}?`,
    { reply_markup: kb },
  );
}

export async function onCardAsk(ctx: AppContext, yes: boolean): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'card_balance_ask') {
    await ctx.reply('Ввод суммы уже завершён или отменён. Открой «💳 Бюджет на карте».', {
      reply_markup: mainMenu(),
    });
    return;
  }
  // Новый объект, а не правка на месте: сессия сохраняется в базу целиком.
  const [id, ...queue] = flow.queue;
  ctx.session.flow = { ...flow, queue, arrived: id && yes ? [...flow.arrived, id] : flow.arrived };
  if (queue.length > 0) {
    const st = await loadCardState(new Date(flow.at));
    return askNextRefund(ctx, st.inTransit);
  }
  return finishBalance(ctx);
}

async function finishBalance(ctx: AppContext): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'card_balance_ask') return;
  await saveBalance(ctx, flow.amount, new Date(flow.at), flow.arrived);
}

/**
 * Вписать сумму на карте. Возвраты, которые «уже на карте», помечаются
 * пришедшими ЗА СЕКУНДУ ДО вписанной суммы — тогда расчёт не прибавит их второй раз.
 * Всё одной транзакцией: половинчатая запись дала бы задвоение.
 */
async function saveBalance(ctx: AppContext, amount: number, at: Date, arrived: string[]): Promise<void> {
  const userId = ctx.dbUser?.id ?? null;
  const st = await loadCardState(at);
  const before = new Date(at.getTime() - 1000);
  await db.transaction(async (tx) => {
    for (const id of arrived) {
      const r = st.inTransit.find((x) => x.phoneId === id);
      if (!r) continue;
      await tx.execute(upsertRefund(id, r.amount, before, userId));
    }
    await tx.execute(sql`
      insert into card_ledger (kind, amount_eur, effective_at, created_by)
      values ('balance', ${amount}, ${at.toISOString()}, ${userId})`);
  });
  ctx.session.flow = undefined;
  await ctx.reply(`✅ Записал: на карте ${fmtEur(amount)} (${fmtMsk(at)}).`, { reply_markup: mainMenu() });
  await showCard(ctx);
}

function upsertRefund(phoneId: string, amount: number, at: Date, userId: string | null) {
  return sql`
    insert into card_ledger (kind, amount_eur, phone_id, effective_at, created_by)
    values ('refund', ${amount}, ${phoneId}, ${at.toISOString()}, ${userId})
    on conflict (phone_id) where kind = 'refund'
    do update set amount_eur = excluded.amount_eur, effective_at = excluded.effective_at,
                  created_by = excluded.created_by, updated_at = now()`;
}

// ---------- Поправка возврата ----------

async function findRefund(phoneId: string): Promise<Refund | null> {
  const st = await loadCardState();
  return [...st.inTransit, ...st.creditedList].find((r) => r.phoneId === phoneId) ?? null;
}

/** «💶 Пришёл» — деньги уже на карте, раньше срока. */
export async function onRefundArrived(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const r = await findRefund(phoneId);
  if (!r) {
    await ctx.reply('Этот возврат уже учтён.', { reply_markup: mainMenu() });
    return;
  }
  if (r.at.getTime() > Date.now()) {
    await db.execute(upsertRefund(phoneId, r.amount, new Date(), ctx.dbUser?.id ?? null));
  }
  await ctx.reply(`✅ Возврат …${r.imei} ${fmtEur(r.amount)} учтён на карте.`, { reply_markup: mainMenu() });
  await showCard(ctx);
}

export async function startRefundEdit(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const r = await findRefund(phoneId);
  if (!r) {
    await ctx.reply('Этот возврат уже не в списке.', { reply_markup: mainMenu() });
    return;
  }
  ctx.session.flow = { kind: 'card_refund', phoneId };
  await ctx.reply(
    `Сколько на самом деле вернулось (или вернётся) за …${r.imei}? Сейчас учтено ${fmtEur(r.amount)}.\n` +
      'Напиши число в евро (0 — ничего не вернулось):',
    { reply_markup: cancelKb() },
  );
}

export async function onCardRefundText(ctx: AppContext, text: string): Promise<void> {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'card_refund') return;
  const amount = parseEur(text);
  if (amount === null) {
    await ctx.reply('Нужно число в евро, напр. 338 или 0. Попробуй ещё раз:', { reply_markup: cancelKb() });
    return;
  }
  const r = await findRefund(flow.phoneId);
  ctx.session.flow = undefined;
  if (!r) {
    await ctx.reply('Этот возврат уже не в списке.', { reply_markup: mainMenu() });
    return;
  }
  // Срок не трогаем: правится только сумма.
  await db.execute(upsertRefund(flow.phoneId, amount, r.at, ctx.dbUser?.id ?? null));
  await ctx.reply(`✅ Возврат …${r.imei}: ${fmtEur(r.amount)} → ${fmtEur(amount)}.`, { reply_markup: mainMenu() });
  await showCard(ctx);
}

/** Роутинг callback'ов «card:…». */
export async function onCardCallback(ctx: AppContext, rest: string): Promise<void> {
  if (rest === 'set') return startCardSet(ctx);
  if (rest === 'ask:y') return onCardAsk(ctx, true);
  if (rest === 'ask:n') return onCardAsk(ctx, false);
  if (rest.startsWith('arr:')) return onRefundArrived(ctx, rest.slice(4));
  if (rest.startsWith('ref:')) return startRefundEdit(ctx, rest.slice(4));
}
