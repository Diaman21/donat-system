import { asc, eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { phones, purchases, purchaseCategories, type PurchaseResultValue } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { fmtMsk } from '../format.js';

export const HIST_CB = 'hist:'; // + phoneId

const EMOJI: Record<PurchaseResultValue, string> = {
  done: '✅',
  support: '⚠️',
  long: '💀',
};

const MAX_ITEMS = 40;

// /history — список телефонов (активные + умершие) для выбора.
export async function showPhoneList(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const all = await db
    .select({ id: phones.id, imei: phones.imeiLast4, label: phones.label, status: phones.status })
    .from(phones)
    .orderBy(asc(phones.status), asc(phones.connectedAt));

  if (all.length === 0) {
    await ctx.reply('Телефонов пока нет.');
    return;
  }

  const kb = new InlineKeyboard();
  for (const p of all) {
    const mark = p.status === 'active' ? '📱' : '🪦';
    const label = p.label ? ` (${p.label})` : '';
    kb.text(`${mark} …${p.imei}${label}`, `${HIST_CB}${p.id}`).row();
  }
  await ctx.reply('Выбери телефон — покажу его историю:', { reply_markup: kb });
}

// Таймлайн покупок конкретного телефона (с заметками).
export async function showPhoneHistory(ctx: AppContext, phoneId: string): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const phRows = await db.select().from(phones).where(eq(phones.id, phoneId)).limit(1);
  const ph = phRows[0];
  if (!ph) {
    await ctx.reply('Телефон не найден.');
    return;
  }

  const items = await db
    .select({
      amount: purchases.amount,
      result: purchases.result,
      game: purchases.game,
      at: purchases.purchasedAt,
      notes: purchases.notes,
      internet: purchases.internet,
      units: purchases.units,
      catCode: purchaseCategories.code,
    })
    .from(purchases)
    .innerJoin(purchaseCategories, eq(purchaseCategories.id, purchases.categoryId))
    .where(eq(purchases.phoneId, phoneId))
    .orderBy(asc(purchases.purchasedAt));

  const total = items.reduce((a, p) => a + Number(p.amount), 0);
  const statusLabel =
    ph.status === 'active' ? 'активен' : ph.status === 'prepared' ? 'подготовлен' : 'умер';
  const label = ph.label ? ` «${ph.label}»` : '';

  // Разбивка по типу (танки / ВК) — методики разные
  const sumBy = (code: string) => {
    const rows = items.filter((p) => p.catCode === code);
    return {
      c: rows.length,
      sum: rows.reduce((a, p) => a + Number(p.amount), 0),
      votes: rows.reduce((a, p) => a + (p.units ?? 0), 0),
    };
  };
  const tanks = sumBy('game_donate');
  const vk = sumBy('vk_votes');

  const head = [
    `📜 История …${ph.imeiLast4}${label} — ${statusLabel}`,
    `Всего: ${items.length} покупок на €${total.toFixed(2)}`,
    tanks.c > 0 ? `🎮 Танки: ${tanks.c} покупок на €${tanks.sum.toFixed(2)}` : null,
    vk.c > 0 ? `🗳 ВК: ${vk.c} покупок на €${vk.sum.toFixed(2)} (${vk.votes} голосов)` : null,
    '',
  ].filter((l) => l !== null) as string[];

  if (items.length === 0) {
    await ctx.reply([...head, 'Покупок не было.'].join('\n'));
    return;
  }

  // показываем последние MAX_ITEMS, чтобы не упереться в лимит сообщения
  const shown = items.slice(-MAX_ITEMS);
  const omitted = items.length - shown.length;

  const lines = shown.map((p) => {
    const g = p.game ? ` ${p.game}` : '';
    const v = p.units ? ` (${p.units} гол.)` : '';
    const net = p.internet === 'mobile' ? ' 📶' : p.internet === 'wifi' ? ' 📡' : '';
    const note = p.notes ? `\n    📝 ${p.notes}` : '';
    return `${fmtMsk(p.at)} ${EMOJI[p.result]} €${p.amount}${v}${g}${net}${note}`;
  });

  const tail = omitted > 0 ? ['', `…и ещё ${omitted} ранее (показаны последние ${MAX_ITEMS}).`] : [];
  await ctx.reply([...head, ...lines, ...tail].join('\n'));
}
