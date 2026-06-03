import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { phones, purchases, type PurchaseResultValue } from '../db/schema';

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

// «Надгробие» телефона: сколько прожил, на сколько $, последовательность сумм перед смертью.
export async function buildPostMortem(phoneId: string): Promise<string> {
  const phRows = await db.select().from(phones).where(eq(phones.id, phoneId)).limit(1);
  const ph = phRows[0];
  if (!ph) return '';

  const all = await db
    .select({ amount: purchases.amount, result: purchases.result, at: purchases.purchasedAt })
    .from(purchases)
    .where(eq(purchases.phoneId, phoneId))
    .orderBy(desc(purchases.purchasedAt));

  const cnt = all.length;
  const total = all.reduce((a, p) => a + Number(p.amount), 0);
  const end = ph.diedAt ?? new Date();
  const span = end.getTime() - ph.connectedAt.getTime();

  // последние до 5 покупок в хронологическом порядке
  const lastFew = all.slice(0, 5).reverse();
  const seq = lastFew.map((p) => `$${p.amount}${emoji(p.result)}`).join(' → ');

  const label = ph.label ? ` «${ph.label}»` : '';
  return [
    `🪦 Итог по телефону …${ph.imeiLast4}${label}`,
    `Прожил: ${cnt} покупок на $${total.toFixed(2)}`,
    `Время жизни: ${fmtSpan(span)}`,
    lastFew.length > 0 ? `Перед смертью: ${seq}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
