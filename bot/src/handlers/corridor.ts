import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { DANGER_EUR, CORRIDOR_MIN_H, smallsLeft } from './interval.js';
import { hhmmMsk } from '../format.js';

// «/corridor» — отчёт о «зелёном коридоре», пересчитанный ИЗ БАЗЫ.
//
// Зачем отдельная команда. Пороги подсказки (интервал 20 ч, лимит €120 за сутки)
// выведены из данных на 12.09.2026. Данные копятся дальше, и граница может
// сдвинуться. Чтобы её двигали НАБЛЮДЕНИЯ, а не память, отчёт считает расклад
// заново при каждом вызове: сделали серию выше порога без смертей — это видно
// сразу, и меняется одна константа в interval.ts, а не рассуждения в документах.
//
// Отчёт ПАССИВНЫЙ (как /vk и /stats): только факты, без советов «сбавь».
//
// ⚠️ Потрачено = только ✅. ⚠️ support (платёж отклонён) и 💀 long (waiver всплыл
// вместо списания) денег не тратят и в сумму окна не входят.

interface Att {
  amt: number;
  res: string;
  spent: number; // списано за 24 ч ДО этой попытки
  gap: number | null; // часов с предыдущей покупки на этом телефоне
}

// Все танковые покупки с «сколько было потрачено за 24 ч до неё» и интервалом.
async function attempts(): Promise<Att[]> {
  const rows = (await db.execute(sql`
    select p.amount::float amt, p.result::text res,
      coalesce((select sum(q.amount) from purchases q
        join purchase_categories cq on cq.id = q.category_id
        where q.phone_id = p.phone_id and q.result = 'done' and q.id <> p.id
          and cq.code = 'game_donate'
          and q.purchased_at >  p.purchased_at - interval '24 hours'
          and q.purchased_at <= p.purchased_at), 0)::float spent,
      extract(epoch from (p.purchased_at - (select max(q.purchased_at) from purchases q
        where q.phone_id = p.phone_id and q.purchased_at < p.purchased_at)))/3600.0 gap
    from purchases p join purchase_categories c on c.id = p.category_id
    where c.code = 'game_donate'`)) as unknown as {
    amt: number;
    res: string;
    spent: number;
    gap: number | null;
  }[];
  return rows.map((r) => ({
    amt: Number(r.amt),
    res: r.res,
    spent: Number(r.spent),
    gap: r.gap == null ? null : Number(r.gap),
  }));
}

const pct = (d: number, n: number) => (n ? `${((d / n) * 100).toFixed(1)}%` : '—');

// «1 случай · 2 случая · 5 случаев»
function cases(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return `${n} случаев`;
  if (last === 1) return `${n} случай`;
  if (last >= 2 && last <= 4) return `${n} случая`;
  return `${n} случаев`;
}

export async function showCorridor(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;

  const all = await attempts();
  const att = all.filter((a) => a.gap != null); // у первой покупки телефона интервала нет
  const lines: string[] = [`🟢 Зелёный коридор — пересчёт по данным`, ''];

  // ---------- 1. Расклад «интервал × сумма» ----------
  const cell = (shortGap: boolean, over: boolean) =>
    att.filter(
      (a) =>
        (a.gap! < CORRIDOR_MIN_H) === shortGap && (a.spent + a.amt >= DANGER_EUR) === over,
    );
  const row = (label: string, shortGap: boolean) => {
    const lo = cell(shortGap, false);
    const hi = cell(shortGap, true);
    const ld = lo.filter((a) => a.res === 'long').length;
    const hd = hi.filter((a) => a.res === 'long').length;
    return (
      `${label}\n` +
      `   < €${DANGER_EUR}:  ${String(lo.length).padStart(3)} поп · ${ld} 💀 · ${pct(ld, lo.length)}\n` +
      `   ≥ €${DANGER_EUR}:  ${String(hi.length).padStart(3)} поп · ${hd} 💀 · ${pct(hd, hi.length)}`
    );
  };
  lines.push(
    `📊 Интервал × сумма за 24 ч (танки, ${att.length} попыток)`,
    row(`⏱ интервал < ${CORRIDOR_MIN_H} ч`, true),
    row(`⏱ интервал ≥ ${CORRIDOR_MIN_H} ч`, false),
    '',
  );

  // ---------- 2. Перебор порогов ----------
  lines.push('💶 Где граница по деньгам (перебор порогов)');
  let best = { t: 0, lift: -1, hiD: 0, hiN: 0, loD: 0, loN: 0 };
  for (const t of [90, 100, 105, 120, 130, 140]) {
    const lo = att.filter((a) => a.spent + a.amt < t);
    const hi = att.filter((a) => a.spent + a.amt >= t);
    if (hi.length < 3 || lo.length < 3) continue;
    const ld = lo.filter((a) => a.res === 'long').length;
    const hd = hi.filter((a) => a.res === 'long').length;
    const lift = (hd / hi.length) * 100 - (ld / lo.length) * 100;
    lines.push(
      `   €${String(t).padEnd(3)} · ниже ${ld}/${lo.length} = ${pct(ld, lo.length).padStart(5)} · выше ${hd}/${hi.length} = ${pct(hd, hi.length)}`,
    );
    if (lift > best.lift) best = { t, lift, hiD: hd, hiN: hi.length, loD: ld, loN: lo.length };
  }
  lines.push(`   ➡️ резче всего разделяет €${best.t}`, '');

  // ---------- 3. Белое пятно ----------
  const gapZone = att.filter((a) => {
    const total = a.spent + a.amt;
    return total > 105 && total < DANGER_EUR;
  });
  lines.push(
    `🕳 Неизученная зона €106–€${DANGER_EUR - 1}: наблюдений ${gapZone.length}` +
      (gapZone.length ? ` (💀 ${gapZone.filter((a) => a.res === 'long').length})` : ' — граница здесь не уточнена'),
    '',
  );

  // ---------- 4. Тридцатки подряд ----------
  const st = (await db.execute(sql`
    with t as (
      select p.result::text res,
        (select count(*) from purchases q join purchase_categories cq on cq.id = q.category_id
          where q.phone_id = p.phone_id and cq.code = 'game_donate' and q.amount = 30
            and q.purchased_at >  p.purchased_at - interval '24 hours'
            and q.purchased_at <= p.purchased_at)::int n30
      from purchases p join purchase_categories c on c.id = p.category_id
      where c.code = 'game_donate' and p.amount = 30
    )
    select n30, count(*)::int cases, count(*) filter (where res='long')::int deaths
    from t group by n30 order by n30`)) as unknown as {
    n30: number;
    cases: number;
    deaths: number;
  }[];
  lines.push('🧱 Тридцатки в окне 24 ч');
  for (const r of st)
    lines.push(`   ${r.n30}×€30 · ${cases(r.cases).padStart(11)} · ${r.deaths} 💀`);
  lines.push('');

  // ---------- 5. Что можно прямо сейчас ----------
  const now = new Date();
  const live = (await db.execute(sql`
    select ph.imei_last4 imei, ph.label,
      coalesce((select sum(q.amount) from purchases q
        join purchase_categories cq on cq.id = q.category_id
        where q.phone_id = ph.id and q.result = 'done' and cq.code = 'game_donate'
          and q.purchased_at > now() - interval '24 hours'), 0)::float spent,
      (select max(q.purchased_at) from purchases q where q.phone_id = ph.id) last_at
    from phones ph where ph.status = 'active' order by ph.connected_at`)) as unknown as {
    imei: string;
    label: string | null;
    spent: number;
    last_at: string | null;
  }[];
  lines.push('📱 Сейчас на активных телефонах');
  if (live.length === 0) lines.push('   активных телефонов нет');
  for (const p of live) {
    const spent = Number(p.spent);
    const n = smallsLeft(spent);
    const free = p.last_at
      ? new Date(new Date(p.last_at).getTime() + CORRIDOR_MIN_H * 3600 * 1000)
      : null;
    const freeTxt =
      free && free > now ? `без ограничений с ${hhmmMsk(free)}` : 'ограничений нет';
    lines.push(
      `   …${p.imei}${p.label ? ` «${p.label}»` : ''}: €${spent} из €${DANGER_EUR} · ` +
        (n > 0 ? `ещё ${n}×€30` : 'лимит выбран') +
        ` · ${freeTxt}`,
    );
  }

  lines.push(
    '',
    `ℹ️ Правило подсказки: можно, если интервал ≥ ${CORRIDOR_MIN_H} ч ИЛИ сумма за 24 ч < €${DANGER_EUR}.`,
    'Если данные выше порога накопятся без смертей — порог сдвигаем.',
  );

  await ctx.reply(lines.join('\n'));
}
