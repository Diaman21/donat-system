import { desc, eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client';
import { phones, purchases, users, type PurchaseResultValue } from '../db/schema';
import type { AppContext } from '../context';
import { mainMenu } from './menus';
import { requireOperator } from './start';
import { CANCEL_CB, requirePrivate } from './common';

export const DELLAST_CB = 'dellast:confirm';

const RESULT_EMOJI: Record<PurchaseResultValue, string> = {
  done: '✅',
  support: '⚠️',
  long: '💀',
};

function fmtTime(d: Date): string {
  // короткий формат ДД.ММ ЧЧ:ММ
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// «🧾 Последние» — последние 10 закупок (все операторы).
export async function showRecent(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const rows = await db
    .select({
      amount: purchases.amount,
      result: purchases.result,
      game: purchases.game,
      purchasedAt: purchases.purchasedAt,
      imei: phones.imeiLast4,
      username: users.username,
    })
    .from(purchases)
    .innerJoin(phones, eq(phones.id, purchases.phoneId))
    .innerJoin(users, eq(users.id, purchases.operatorId))
    .orderBy(desc(purchases.purchasedAt))
    .limit(10);

  if (rows.length === 0) {
    await ctx.reply('Покупок пока нет.');
    return;
  }

  const lines = rows.map((r) => {
    const g = r.game ? ` ${r.game}` : '';
    return `${RESULT_EMOJI[r.result]} $${r.amount} …${r.imei}${g} · @${r.username ?? '—'} · ${fmtTime(r.purchasedAt)}`;
  });

  await ctx.reply(['🧾 Последние закупки:', '', ...lines].join('\n'));
}

// «↩️ Удалить последнюю» — показать последнюю СВОЮ закупку и спросить подтверждение.
export async function startDeleteLast(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const user = ctx.dbUser;
  if (!user) return;

  const last = await lastOwnPurchase(user.id);
  if (!last) {
    await ctx.reply('У тебя нет покупок для удаления.');
    return;
  }

  const g = last.game ? ` ${last.game}` : '';
  const kb = new InlineKeyboard().text('✅ Удалить', DELLAST_CB).text('✖️ Отмена', CANCEL_CB);
  await ctx.reply(
    `Удалить твою последнюю закупку?\n\n${RESULT_EMOJI[last.result]} $${last.amount} …${last.imei}${g} · ${fmtTime(last.purchasedAt)}`,
    { reply_markup: kb },
  );
}

// Подтверждение удаления: удаляем последнюю свою покупку, при необходимости «воскрешаем» телефон.
export async function confirmDeleteLast(ctx: AppContext): Promise<void> {
  const user = ctx.dbUser;
  if (!user) return;

  const last = await lastOwnPurchase(user.id);
  if (!last) {
    await ctx.reply('Покупка уже удалена или не найдена.', { reply_markup: mainMenu() });
    return;
  }

  // Был ли этот покупкой убит телефон?
  const ph = await db
    .select({ id: phones.id, deathPurchaseId: phones.deathPurchaseId })
    .from(phones)
    .where(eq(phones.id, last.phoneId))
    .limit(1);
  const wasDeath = ph[0]?.deathPurchaseId === last.id;

  // Снимаем ссылку death_purchase_id, затем удаляем покупку
  if (wasDeath) {
    await db.update(phones).set({ deathPurchaseId: null }).where(eq(phones.id, last.phoneId));
  }
  await db.delete(purchases).where(eq(purchases.id, last.id));

  let note = '';
  if (wasDeath) {
    try {
      await db
        .update(phones)
        .set({ status: 'active', diedAt: null })
        .where(eq(phones.id, last.phoneId));
      note = `\n♻️ Телефон …${last.imei} снова активен.`;
    } catch {
      note = `\n⚠️ Телефон …${last.imei} НЕ возвращён: уже 3 активных (лимит).`;
    }
  }

  await ctx.reply(`🗑 Удалено: $${last.amount} …${last.imei}.${note}`, { reply_markup: mainMenu() });
}

async function lastOwnPurchase(userId: string) {
  const rows = await db
    .select({
      id: purchases.id,
      amount: purchases.amount,
      result: purchases.result,
      game: purchases.game,
      purchasedAt: purchases.purchasedAt,
      phoneId: purchases.phoneId,
      imei: phones.imeiLast4,
    })
    .from(purchases)
    .innerJoin(phones, eq(phones.id, purchases.phoneId))
    .where(eq(purchases.operatorId, userId))
    .orderBy(desc(purchases.purchasedAt))
    .limit(1);
  return rows[0] ?? null;
}
