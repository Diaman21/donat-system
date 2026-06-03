import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { phones, purchases } from '../db/schema';
import type { AppContext } from '../context';
import { requireOperator } from './start';

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// «📊 Статистика» / /stats — сводка по покупкам и телефонам (за всё время).
export async function showStats(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  // Покупки по результату
  const byResult = await db
    .select({
      result: purchases.result,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.result);

  let totalCnt = 0;
  let totalSpent = 0;
  let done = 0;
  let support = 0;
  let long = 0;
  for (const r of byResult) {
    totalCnt += r.cnt;
    totalSpent += Number(r.total);
    if (r.result === 'done') done = r.cnt;
    else if (r.result === 'support') support = r.cnt;
    else if (r.result === 'long') long = r.cnt;
  }

  if (totalCnt === 0) {
    await ctx.reply('Пока нет ни одной покупки. Сделай первую через «➕ Закупка».');
    return;
  }

  // Все телефоны (id → imei, status)
  const allPhones = await db
    .select({ id: phones.id, imei: phones.imeiLast4, status: phones.status })
    .from(phones);
  const active = allPhones.filter((p) => p.status === 'active').length;
  const dead = allPhones.filter((p) => p.status === 'dead').length;
  const imeiById = new Map(allPhones.map((p) => [p.id, p.imei]));
  const deadIds = new Set(allPhones.filter((p) => p.status === 'dead').map((p) => p.id));

  // Покупки и сумма по каждому телефону
  const perPhone = await db
    .select({
      phoneId: purchases.phoneId,
      cnt: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${purchases.amount}), 0)`,
    })
    .from(purchases)
    .groupBy(purchases.phoneId);

  // Средний «возраст» до 💀 — по умершим телефонам
  const deadStats = perPhone.filter((p) => deadIds.has(p.phoneId));
  let avgDeathLine = '—';
  if (deadStats.length > 0) {
    const avgCnt = deadStats.reduce((a, p) => a + p.cnt, 0) / deadStats.length;
    const avgSpent = deadStats.reduce((a, p) => a + Number(p.total), 0) / deadStats.length;
    avgDeathLine = `${avgCnt.toFixed(1)} покупок / ${money(avgSpent)}`;
  }

  // Самая длинная серия покупок на одном телефоне
  let longest: { phoneId: string; cnt: number; total: string } | null = null;
  for (const p of perPhone) {
    if (!longest || p.cnt > longest.cnt) longest = p;
  }
  let longestLine = '—';
  if (longest) {
    const imei = imeiById.get(longest.phoneId) ?? '????';
    longestLine = `…${imei}: ${longest.cnt} покупок на ${money(Number(longest.total))}`;
  }

  const lines = [
    '📊 Статистика (за всё время)',
    '',
    `💵 Потрачено: ${money(totalSpent)}`,
    `🛒 Покупок: ${totalCnt}  (✅ ${done} · ⚠️ ${support} · 💀 ${long})`,
    '',
    `📱 Телефоны: ${active} активных · ${dead} умерло`,
    `🪦 Средний возраст до 💀: ${avgDeathLine}`,
    `🔥 Самая длинная серия: ${longestLine}`,
  ];

  await ctx.reply(lines.join('\n'));
}
