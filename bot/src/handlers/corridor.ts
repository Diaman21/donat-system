import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { DANGER_EUR, CORRIDOR_MIN_H, smallsLeft } from './interval.js';
import { assessZone, type ZoneVerdict } from './anomaly.js';
import { parsePhoneModel } from './phone-model.js';
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

/**
 * «Что можно прямо сейчас» — по каждому активному телефону: день цикла,
 * сколько списано за скользящие сутки, сколько ещё влезает, когда снимется
 * ограничение. Идёт и в `/corridor`, и в ежедневную сводку группы: утром
 * это ответ на вопрос «что делать сегодня» одним взглядом.
 */
export async function phonesNowLines(): Promise<string[]> {
  const now = new Date();
  const live = (await db.execute(sql`
    select ph.imei_last4 imei, ph.label,
      coalesce((select sum(q.amount) from purchases q
        join purchase_categories cq on cq.id = q.category_id
        where q.phone_id = ph.id and q.result = 'done' and cq.code = 'game_donate'
          and q.purchased_at > now() - interval '24 hours'), 0)::float spent,
      (select max(q.purchased_at) from purchases q where q.phone_id = ph.id) last_at,
      (select min(q.purchased_at) from purchases q where q.phone_id = ph.id) first_at
    from phones ph where ph.status = 'active' order by ph.connected_at`)) as unknown as {
    imei: string;
    label: string | null;
    spent: number;
    last_at: string | null;
    first_at: string | null;
  }[];

  if (live.length === 0) return ['📱 Активных телефонов нет.'];

  const out = ['📱 Телефоны сейчас'];
  for (const p of live) {
    const spent = Number(p.spent);
    const n = smallsLeft(spent);
    const free = p.last_at
      ? new Date(new Date(p.last_at).getTime() + CORRIDOR_MIN_H * 3600 * 1000)
      : null;
    // День цикла: вывод бюджета на 14-й день после ПЕРВОЙ покупки.
    const day = p.first_at
      ? Math.floor((now.getTime() - new Date(p.first_at).getTime()) / 86_400_000) + 1
      : null;
    const dayTxt = day ? `день ${day}/14 · ` : 'ещё не начат · ';
    const freeTxt = free && free > now ? `без ограничений с ${hhmmMsk(free)}` : 'ограничений нет';
    // Три состояния, чтобы не писать «€205 из €120» и не повторять «лимит» дважды.
    const budget =
      spent >= DANGER_EUR
        ? `€${spent} — лимит €${DANGER_EUR} превышен`
        : n > 0
          ? `€${spent} из €${DANGER_EUR} · ещё ${n}×€30`
          : `€${spent} из €${DANGER_EUR} · лимит выбран`;
    out.push(
      `   …${p.imei}${p.label ? ` «${p.label}»` : ''}\n` +
        `      ${dayTxt}${budget} · ${freeTxt}`,
    );
  }
  return out;
}

/**
 * Нарушения протокола за последние `hours` часов: покупки в опасной клетке
 * (интервал < 20 ч И сумма за 24 ч ≥ €120). Подсказка после покупки
 * предупреждает в моменте, а этот блок показывает картину постфактум —
 * чтобы отсутствие человека у бота не означало отсутствие контроля.
 */
export async function violationsLines(hours = 24): Promise<string[]> {
  const rows = (await db.execute(sql`
    with att as (
      select p.phone_id, p.purchased_at, p.amount::float amt, p.result::text res,
        coalesce((select sum(q.amount) from purchases q
          join purchase_categories cq on cq.id = q.category_id
          where q.phone_id = p.phone_id and q.result = 'done' and q.id <> p.id
            and cq.code = 'game_donate'
            and q.purchased_at >  p.purchased_at - interval '24 hours'
            and q.purchased_at <= p.purchased_at), 0)::float spent,
        extract(epoch from (p.purchased_at - (select max(q.purchased_at) from purchases q
          where q.phone_id = p.phone_id and q.purchased_at < p.purchased_at)))/3600.0 gap
      from purchases p join purchase_categories c on c.id = p.category_id
      where c.code = 'game_donate'
        and p.purchased_at > now() - (${hours} || ' hours')::interval
    )
    select ph.imei_last4 imei, ph.label, a.amt, a.spent, a.gap, a.res,
      to_char(a.purchased_at at time zone 'Europe/Moscow','HH24:MI') at
    from att a join phones ph on ph.id = a.phone_id
    where a.gap is not null and a.gap < ${CORRIDOR_MIN_H} and a.spent + a.amt >= ${DANGER_EUR}
    order by a.purchased_at`)) as unknown as {
    imei: string;
    label: string | null;
    amt: number;
    spent: number;
    gap: number;
    res: string;
    at: string;
  }[];

  if (rows.length === 0) return [];
  const out = [`⚠️ Протокол нарушен (${rows.length}) — опасная клетка расклада:`];
  for (const r of rows) {
    const mark = r.res === 'long' ? '💀' : r.res === 'support' ? '⚠️' : '✅';
    out.push(
      `   ${mark} ${r.at} …${r.imei}${r.label ? ` «${r.label}»` : ''}: ` +
        `€${Number(r.spent)} + €${Number(r.amt)} = €${Number(r.spent) + Number(r.amt)} ` +
        `через ${Number(r.gap).toFixed(1)} ч`,
    );
  }
  out.push(`   (в этой клетке исторически 8 смертей на 13 попыток)`);
  return out;
}

/**
 * Сколько «случайных экспериментов» накоплено ЗА каждой границей и что они
 * говорят. Это ответ на вопрос «может, мы слишком осторожны?»: если в зоне
 * за границей набралось много наблюдений и ни одной смерти — границу пора
 * обсуждать. Порог достаточности и оценка риска — в `anomaly.ts`.
 */
export async function boundaryEvidence(): Promise<
  { key: string; label: string; v: ZoneVerdict }[]
> {
  const zones: { key: string; label: string; where: string }[] = [
    {
      key: 'gap-14-20',
      label: `интервал 14–${CORRIDOR_MIN_H} ч (сумма < €${DANGER_EUR})`,
      where: `gap >= 14 and gap < ${CORRIDOR_MIN_H} and spent + amt < ${DANGER_EUR}`,
    },
    {
      key: 'gap-10-14',
      label: `интервал 10–14 ч (сумма < €${DANGER_EUR})`,
      where: `gap >= 10 and gap < 14 and spent + amt < ${DANGER_EUR}`,
    },
    {
      key: 'gap-lt-10',
      label: `интервал < 10 ч (сумма < €${DANGER_EUR})`,
      where: `gap < 10 and spent + amt < ${DANGER_EUR}`,
    },
    {
      key: 'money-over',
      label: `сумма ≥ €${DANGER_EUR} при интервале ≥ ${CORRIDOR_MIN_H} ч`,
      where: `spent + amt >= ${DANGER_EUR} and gap >= ${CORRIDOR_MIN_H}`,
    },
  ];

  // Запросы независимы — гоняем параллельно. На Vercel каждый запрос это
  // сетевой круг до Neon, и последовательный цикл из четырёх съедал бы
  // секунды из лимита выполнения функции.
  return Promise.all(
    zones.map(async (z) => {
      const r = (await db.execute(
        sql.raw(`
      with att as (
        select p.result::text res,
          coalesce((select sum(q.amount) from purchases q
            join purchase_categories cq on cq.id = q.category_id
            where q.phone_id = p.phone_id and q.result = 'done' and q.id <> p.id
              and cq.code = 'game_donate'
              and q.purchased_at >  p.purchased_at - interval '24 hours'
              and q.purchased_at <= p.purchased_at), 0)::float spent,
          p.amount::float amt,
          extract(epoch from (p.purchased_at - (select max(q.purchased_at) from purchases q
            where q.phone_id = p.phone_id and q.purchased_at < p.purchased_at)))/3600.0 gap
        from purchases p join purchase_categories c on c.id = p.category_id
        where c.code = 'game_donate'
      )
      select count(*)::int n, count(*) filter (where res = 'long')::int d
      from att where gap is not null and (${z.where})`),
      )) as unknown as { n: number; d: number }[];
      return { key: z.key, label: z.label, v: assessZone(r[0]?.n ?? 0, r[0]?.d ?? 0) };
    }),
  );
}

/**
 * Блок для ежедневной сводки: появляется, ТОЛЬКО когда какая-то граница
 * накопила достаточно чистых наблюдений. В остальные дни молчит —
 * иначе превратится в фон, который перестают читать.
 */
export async function boundaryShiftLines(): Promise<string[]> {
  const ready = (await boundaryEvidence()).filter((z) => z.v.enough);
  if (ready.length === 0) return [];
  const out = ['📈 Граница может сдвинуться — накопились данные:'];
  for (const z of ready) out.push(`   • ${z.label}: ${z.v.verdict}`);
  out.push('   Полный расклад — /corridor. Порог меняется вручную, бот сам не двигает.');
  return out;
}

/** Итоги по моделям телефонов — модель разбирается из текстовой метки. */
export async function modelLines(): Promise<string[]> {
  const rows = (await db.execute(sql`
    select ph.label, ph.death_reason dr,
      coalesce((select sum(p.amount) from purchases p
        where p.phone_id = ph.id and p.result = 'done'), 0)::float eur
    from phones ph where ph.status = 'dead'`)) as unknown as {
    label: string | null;
    dr: string | null;
    eur: number;
  }[];
  if (rows.length === 0) return [];

  const agg = new Map<string, { n: number; eur: number; err: number }>();
  for (const r of rows) {
    const key = parsePhoneModel(r.label).name ?? '(модель не распознана)';
    const a = agg.get(key) ?? { n: 0, eur: 0, err: 0 };
    a.n++;
    a.eur += Number(r.eur);
    if (r.dr === 'error') a.err++;
    agg.set(key, a);
  }

  const out = ['📱 Итог цикла по моделям (завершённые)'];
  const sorted = [...agg.entries()].sort((a, b) => b[1].eur / b[1].n - a[1].eur / a[1].n);
  for (const [m, a] of sorted.slice(0, 10)) {
    out.push(
      `   ${m}: ${a.n} шт · средний €${Math.round(a.eur / a.n)}` + (a.err ? ` · 💀 ${a.err}` : ''),
    );
  }
  out.push('   ⚠️ По 1–3 телефона на модель — это наблюдения, а не закон.');
  return out;
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

  // ---------- 5. Накопленные доказательства за границами ----------
  lines.push('🧪 Что накоплено ЗА границами (случайные эксперименты)');
  for (const z of await boundaryEvidence()) lines.push(`   ${z.label}\n      ${z.v.verdict}`);
  lines.push('');

  // ---------- 6. Модели ----------
  lines.push(...(await modelLines()), '');

  // ---------- 7. Что можно прямо сейчас ----------
  lines.push(...(await phonesNowLines()));

  lines.push(
    '',
    `ℹ️ Правило подсказки: можно, если интервал ≥ ${CORRIDOR_MIN_H} ч ИЛИ сумма за 24 ч < €${DANGER_EUR}.`,
    'Если данные выше порога накопятся без смертей — порог сдвигаем.',
  );

  // Отчёт растёт вместе с числом моделей и зон. Telegram молча отклонит
  // сообщение длиннее 4096 символов, поэтому режем сами и говорим об этом
  // вслух — молчаливая потеря хвоста хуже, чем видимая обрезка.
  const text = lines.join('\n');
  const LIMIT = 4000;
  await ctx.reply(
    text.length <= LIMIT
      ? text
      : `${text.slice(0, LIMIT)}\n\n… отчёт обрезан (${text.length} символов при лимите 4096).`,
  );
}
