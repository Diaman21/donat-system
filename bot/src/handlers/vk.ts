import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';

// «🗳 ВК» — read-only сводка: голосов в день по каждому ВК-телефону.
// Это ПАССИВНЫЙ отчёт (смотришь сам, когда захочешь), а НЕ авто-предупреждение:
// не подсказываем «сбавь», только факты — чтобы не менять поведение закупки
// и не заморозить сбор данных о крае коридора (см. CLAUDE.md, «три коридора»).

const MAX_DAYS = 12; // последние N дней на телефон, чтобы не раздувать сообщение

interface DayRow {
  id: string;
  imei: string;
  label: string | null;
  status: string;
  d: string; // YYYY-MM-DD (МСК)
  votes: number;
  cnt: number;
  sup: number;
  dead: number;
}

export async function showVkReport(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const rows = (await db.execute(sql`
    select ph.id, ph.imei_last4 as imei, ph.label, ph.status,
           to_char((p.purchased_at at time zone 'Europe/Moscow')::date, 'DD.MM') as d,
           coalesce(sum(p.units),0)::int as votes,
           count(*)::int as cnt,
           sum(case when p.result='support' then 1 else 0 end)::int as sup,
           sum(case when p.result='long' then 1 else 0 end)::int as dead
    from purchases p
    join phones ph on ph.id = p.phone_id
    join purchase_categories c on c.id = p.category_id
    where c.code = 'vk_votes'
    group by ph.id, ph.imei_last4, ph.label, ph.status,
             (p.purchased_at at time zone 'Europe/Moscow')::date
    order by ph.status asc, ph.imei_last4 asc,
             (p.purchased_at at time zone 'Europe/Moscow')::date asc
  `)) as unknown as DayRow[];

  if (rows.length === 0) {
    await ctx.reply('🗳 ВК-покупок ещё нет — сводка появится, когда начнёшь закупать голоса.');
    return;
  }

  // Группируем по телефону, сохраняя порядок (active раньше dead).
  const phonesMap = new Map<
    string,
    { imei: string; label: string | null; status: string; days: DayRow[] }
  >();
  for (const r of rows) {
    let ph = phonesMap.get(r.id);
    if (!ph) {
      ph = { imei: r.imei, label: r.label, status: r.status, days: [] };
      phonesMap.set(r.id, ph);
    }
    ph.days.push(r);
  }

  const out: string[] = ['🗳 ВК-сводка — голосов в день (МСК)', ''];

  for (const ph of phonesMap.values()) {
    const totalVotes = ph.days.reduce((a, d) => a + d.votes, 0);
    const totalCnt = ph.days.reduce((a, d) => a + d.cnt, 0);
    const statusLabel =
      ph.status === 'active' ? 'активен' : ph.status === 'prepared' ? 'подготовлен' : '💀 умер';
    const label = ph.label ? ` «${ph.label}»` : '';

    out.push(`📱 …${ph.imei}${label} — ${statusLabel}`);
    out.push(`   всего: ${totalCnt} покупок · ${totalVotes} голосов`);

    const shown = ph.days.slice(-MAX_DAYS);
    const omitted = ph.days.length - shown.length;
    if (omitted > 0) out.push(`   …(ранее ещё ${omitted} дней)`);

    for (const d of shown) {
      const flag = d.dead ? ' 💀' : d.sup ? ' ⚠️' : '';
      out.push(`   ${d.d}: ${d.votes} гол · ${d.cnt} пок${flag}`);
    }
    out.push('');
  }

  // Ориентир по данным (без советов — просто факт для сравнения).
  out.push('ℹ️ Для сравнения: …6346 умер на 2-й день по 1000 голосов (всего 106 ВК-покупок).');

  await ctx.reply(out.join('\n'));
}
