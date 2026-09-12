import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mskIsoOfDate, addDaysIso, ddmmOf, isMondayMsk } from '../format.js';

// Недельный итог — добавляется в ежедневную сводку ПО ПОНЕДЕЛЬНИКАМ.
//
// Зачем отдельным файлом: блок экспериментальный. Если окажется шумным —
// удаляется целиком одним файлом плюс три строки в api/cron-report.ts,
// без раскопок по всему проекту.
//
// Что меряем и почему именно это. Деньги в этой работе определяются не
// количеством покупок, а тем, СКОЛЬКО СУТОЧНЫХ СЛОТОВ ушло под крупные суммы:
// у телефона один слот в сутки и ~14 суток жизни, риск слота одинаков, а €100
// приносит втрое больше €30 (см. «Рабочий протокол танков» в CLAUDE.md:
// 8 крупных → €839, ноль крупных → €244). Поэтому в отчёте: сколько слотов
// было, сколько использовано и как они распределились.
//
// ⚠️ Незанятые слоты НЕ называем упущенной выгодой. Узкое место сейчас —
// количество заказов, а не количество телефонов: пустой слот чаще означает
// «не было заказа», а не «недоработали». Показываем факт, без морали.
//
// ⚠️ Деньги считаем только по ✅: ⚠️ support (платёж отклонён) и 💀 long
// (waiver вместо списания) денег не тратят.

// isMondayMsk живёт в format.ts — вместе с остальным календарём МСК и, главное,
// БЕЗ импорта БД: только так его можно покрыть тестом. Этот модуль ходит в базу,
// поэтому его самого в тестах не поднять (CI падал именно на этом, 12.09.2026).

interface WeekRow {
  eur: number;
  cnt: number;
  big: number;
  big_eur: number;
  small: number;
  small_eur: number;
  warm: number;
  slots_used: number;
  deaths: number;
  warns: number;
}

// Итоги за окно [from, to) — границы в календарных сутках МСК.
async function weekTotals(fromIso: string, toIso: string): Promise<WeekRow> {
  const r = (await db.execute(sql`
    with p as (
      select pu.*, (pu.purchased_at at time zone 'Europe/Moscow')::date d
      from purchases pu join purchase_categories c on c.id = pu.category_id
      where c.code = 'game_donate'
        and (pu.purchased_at at time zone 'Europe/Moscow')::date >= ${fromIso}::date
        and (pu.purchased_at at time zone 'Europe/Moscow')::date <  ${toIso}::date
    )
    select
      coalesce(sum(amount) filter (where result='done'), 0)::float eur,
      count(*) filter (where result='done')::int cnt,
      count(*) filter (where result='done' and amount >= 100)::int big,
      coalesce(sum(amount) filter (where result='done' and amount >= 100), 0)::float big_eur,
      count(*) filter (where result='done' and amount = 30)::int small,
      coalesce(sum(amount) filter (where result='done' and amount = 30), 0)::float small_eur,
      count(*) filter (where result='done' and amount < 30)::int warm,
      count(distinct (phone_id, d)) filter (where result='done')::int slots_used,
      count(*) filter (where result='long')::int deaths,
      count(*) filter (where result='support')::int warns
    from p`)) as unknown as WeekRow[];
  return r[0]!;
}

/**
 * Сколько суточных слотов БЫЛО доступно: для каждого телефона считаем дни
 * недели, в которые он уже начал работать и ещё не умер. Один телефон —
 * один слот в сутки (правило протокола).
 */
async function slotsAvailable(fromIso: string, toIso: string): Promise<number> {
  const r = (await db.execute(sql`
    with days as (
      select generate_series(${fromIso}::date, ${toIso}::date - 1, interval '1 day')::date d
    )
    select count(*)::int n
    from days
    join phones ph
      on (ph.connected_at at time zone 'Europe/Moscow')::date <= days.d
     and (ph.died_at is null or (ph.died_at at time zone 'Europe/Moscow')::date >= days.d)
     and ph.status <> 'prepared'`)) as unknown as { n: number }[];
  return r[0]?.n ?? 0;
}

/** Телефоны, завершившие цикл за неделю. */
async function finished(fromIso: string, toIso: string) {
  return (await db.execute(sql`
    select ph.imei_last4 imei, ph.label, ph.death_reason dr,
      coalesce((select sum(p.amount) from purchases p
        where p.phone_id = ph.id and p.result = 'done'), 0)::float eur,
      round(extract(epoch from (ph.died_at - (select min(p.purchased_at) from purchases p
        where p.phone_id = ph.id)))/86400.0, 1) days
    from phones ph
    where ph.died_at is not null
      and (ph.died_at at time zone 'Europe/Moscow')::date >= ${fromIso}::date
      and (ph.died_at at time zone 'Europe/Moscow')::date <  ${toIso}::date
    order by ph.died_at`)) as unknown as {
    imei: string;
    label: string | null;
    dr: string | null;
    eur: number;
    days: number | null;
  }[];
}

const arrow = (now: number, prev: number): string => {
  if (prev === 0) return '';
  const d = ((now - prev) / prev) * 100;
  if (Math.abs(d) < 1) return ' (как на прошлой)';
  return d > 0 ? ` (↑ ${d.toFixed(0)}% к прошлой)` : ` (↓ ${Math.abs(d).toFixed(0)}% к прошлой)`;
};

/**
 * Блок недельного итога. Возвращает пустой массив в любой день кроме
 * понедельника — вызывающему не нужно знать про календарь.
 */
export async function weeklyLines(now: Date = new Date()): Promise<string[]> {
  if (!isMondayMsk(now)) return [];

  const today = mskIsoOfDate(now);
  const weekFrom = addDaysIso(today, -7); // прошедшая неделя: пн..вс
  const prevFrom = addDaysIso(today, -14);

  const [cur, prev, avail, done] = await Promise.all([
    weekTotals(weekFrom, today),
    weekTotals(prevFrom, weekFrom),
    slotsAvailable(weekFrom, today),
    finished(weekFrom, today),
  ]);

  if (cur.cnt === 0 && done.length === 0) {
    return [`📆 Неделя ${ddmmOf(weekFrom)}–${ddmmOf(addDaysIso(today, -1))}: закупок не было.`];
  }

  const out = [
    `📆 Итог недели ${ddmmOf(weekFrom)}–${ddmmOf(addDaysIso(today, -1))}`,
    `   💵 Снято: €${cur.eur.toFixed(0)}${arrow(cur.eur, prev.eur)} · ${cur.cnt} закупок`,
  ];

  // Слоты — главный показатель: их число ограничено, а цена разная.
  const usedPct = avail > 0 ? Math.round((cur.slots_used / avail) * 100) : 0;
  out.push(`   🎰 Слотов: ${cur.slots_used} из ${avail} использовано (${usedPct}%)`);
  if (cur.big + cur.small > 0) {
    out.push(
      `      крупных ${cur.big} → €${cur.big_eur.toFixed(0)} · ` +
        `тридцаток ${cur.small} → €${cur.small_eur.toFixed(0)}` +
        (cur.warm > 0 ? ` · разогрев ${cur.warm}` : ''),
    );
  }
  // Цена выбора номинала. Формулируем как справку, а НЕ как упущенную выгоду:
  // тридцатки делаются по конкретным заказам (орден/банки), заменить их сотней
  // можно только если такой заказ есть. Узкое место — заказы, а не слоты.
  if (cur.small > 0) {
    out.push(
      `      💡 слот под сотню вместо тридцатки = +€70 ` +
        `(здесь было бы +€${(cur.small * 70).toFixed(0)}, будь такие заказы)`,
    );
  }

  if (cur.deaths > 0 || cur.warns > 0) {
    out.push(`   ⚠️ За неделю: 💀 ${cur.deaths} · ⚠️ ${cur.warns}`);
  }

  if (done.length > 0) {
    out.push(`   🏁 Завершили цикл: ${done.length}`);
    for (const f of done) {
      const why = f.dr === 'error' ? '❌ ошибка' : '🔄 вывод';
      out.push(
        `      …${f.imei}${f.label ? ` «${f.label}»` : ''}: €${f.eur.toFixed(0)}` +
          (f.days != null ? ` за ${f.days} дн` : '') +
          ` · ${why}`,
      );
    }
  }

  return out;
}
