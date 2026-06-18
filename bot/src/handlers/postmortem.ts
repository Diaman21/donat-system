import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { phones, purchases, purchaseCategories, type PurchaseResultValue } from '../db/schema.js';
import { fmtMsk } from '../format.js';

function fmtSpan(ms: number): string {
  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}д ${hours}ч`;
  if (totalHours > 0) return `${totalHours}ч`;
  return `${Math.max(1, Math.floor(ms / 60_000))}м`;
}

const emoji = (r: PurchaseResultValue): string =>
  r === 'long' ? '💀' : r === 'support' ? '⚠️' : '✅';

// сколько последних покупок показывать в таймлайне «надгробия»
const TIMELINE = 12;

// «Надгробие» телефона: даты жизни, итог и таймлайн покупок с датами/временем.
export async function buildPostMortem(phoneId: string): Promise<string> {
  const phRows = await db.select().from(phones).where(eq(phones.id, phoneId)).limit(1);
  const ph = phRows[0];
  if (!ph) return '';

  const all = await db
    .select({
      amount: purchases.amount,
      result: purchases.result,
      at: purchases.purchasedAt,
      game: purchases.game,
      notes: purchases.notes,
      internet: purchases.internet,
      units: purchases.units,
      catCode: purchaseCategories.code,
    })
    .from(purchases)
    .innerJoin(purchaseCategories, eq(purchaseCategories.id, purchases.categoryId))
    .where(eq(purchases.phoneId, phoneId))
    .orderBy(desc(purchases.purchasedAt));

  const cnt = all.length;
  const total = all.reduce((a, p) => a + Number(p.amount), 0);
  const totalUnits = all.reduce((a, p) => a + (p.units ?? 0), 0);
  const end = ph.diedAt ?? new Date();
  const span = end.getTime() - ph.connectedAt.getTime();

  // Раздельно по типу (методики танков и ВК разные)
  const sumBy = (code: string) => {
    const rows = all.filter((p) => p.catCode === code);
    const c = rows.length;
    const sum = rows.reduce((a, p) => a + Number(p.amount), 0);
    const votes = rows.reduce((a, p) => a + (p.units ?? 0), 0);
    return { c, sum, votes };
  };
  const tanks = sumBy('game_donate');
  const vk = sumBy('vk_votes');

  // последние покупки в хронологическом порядке — с датой/временем (МСК)
  const last = all.slice(0, TIMELINE).reverse();
  const omitted = cnt - last.length;
  const timeline = last.map((p) => {
    const g = p.game ? ` ${p.game}` : '';
    const v = p.units ? ` (${p.units} гол.)` : '';
    const net = p.internet === 'mobile' ? ' 📶' : p.internet === 'wifi' ? ' 📡' : '';
    const note = p.notes ? `\n      📝 ${p.notes}` : '';
    return `  ${fmtMsk(p.at)} ${emoji(p.result)} €${p.amount}${v}${g}${net}${note}`;
  });

  const label = ph.label ? ` «${ph.label}»` : '';
  const reasonLine =
    ph.deathReason === 'error'
      ? 'Причина: ❌ ошибка Apple (достиг предела)'
      : ph.deathReason === 'forced'
        ? 'Причина: 🔄 вынужденный вывод (возврат бюджета)'
        : '';
  return [
    `🪦 Итог по телефону …${ph.imeiLast4}${label}`,
    `Подключён: ${fmtMsk(ph.connectedAt)}`,
    ph.diedAt ? `Умер: ${fmtMsk(ph.diedAt)}` : '',
    reasonLine,
    `Прожил: ${cnt} покупок на €${total.toFixed(2)} за ${fmtSpan(span)}`,
    tanks.c > 0 ? `🎮 Танки: ${tanks.c} покупок на €${tanks.sum.toFixed(2)}` : null,
    vk.c > 0 ? `🗳 ВК: ${vk.c} покупок на €${vk.sum.toFixed(2)} (${vk.votes} голосов)` : null,
    cnt > 0 ? '' : null,
    cnt > 0 ? (omitted > 0 ? `Последние ${TIMELINE} покупок:` : 'Все покупки:') : '',
    ...timeline,
    omitted > 0 ? `…и ещё ${omitted} ранее (полностью — /history).` : '',
  ]
    .filter((l) => l !== null && l !== '')
    .join('\n');
}
