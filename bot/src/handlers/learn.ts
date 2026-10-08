import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { attempts, type Att } from './corridor.js';
import { ZONES, RULES } from './zones.js';
import { fmtRate, kaplanMeier, survivalAt, atRiskAt, type Subject } from './stats-math.js';
import { parsePhoneModel, modelGroup } from './phone-model.js';
import { asDeathReason, BY_APPLE } from './death.js';
import { cycleDayMsk } from '../format.js';
import { WARMUP_DAYS } from './interval.js';

// «/learn» — чему научилась система. Добавлено 07.10.2026 по итогам аудита.
//
// Владелец спросил: «научилась ли система чему-то за отпуск?». Честный ответ
// оказался «она копила, а выводы делали люди», и ответ на него пришлось
// собирать скриптом задним числом. Этот отчёт делает то же самое по кнопке —
// по хорошим практикам систем, которые учатся на собственных данных:
//
//   1. ПРОВЕРКА ВНЕ ВЫБОРКИ. Правило оценивают на данных ПОСЛЕ его фиксации —
//      на них его не подгоняли. Проверка «на всей истории» льстит правилу.
//   2. РАЗРЕЗ ПО КЛАССУ АППАРАТА. Главная находка осени (Pro против не-Pro)
//      пришла из ручного разреза; среднее по зоне её прятало.
//   3. ВЫЖИВАЕМОСТЬ С ЦЕНЗУРОЙ (Каплан–Мейер). Выведенные живыми телефоны —
//      не «выжили», а «прожили минимум N дней». Раньше их просто выбрасывали.
//   4. ДИАПАЗОНЫ вместо голых процентов: «0 из 5» не значит «безопасно».
//
// Отчёт ПАССИВНЫЙ, как /corridor: факты, без советов. Границы двигает человек.

type A = Att & { gap: number };

/** Дата фиксации протокола танков (CLAUDE.md, «РАБОЧИЙ ПРОТОКОЛ ТАНКОВ»). */
const PROTOCOL_SINCE = '2026-08-13';

const isPro = (label: string | null) => modelGroup(parsePhoneModel(label)) === 'pro';
const deaths = (xs: Att[]) => xs.filter((a) => a.res === 'long').length;
const line = (xs: Att[]) => `${xs.length} поп · ${deaths(xs)} 💀 · ${fmtRate(deaths(xs), xs.length)}`;

// Начало суток МСК для даты «ГГГГ-ММ-ДД».
const mskStart = (iso: string) => Date.parse(`${iso}T00:00:00+03:00`);
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export async function learnLines(now: Date = new Date()): Promise<string[]> {
  const all = await attempts();
  const att = all.filter((a): a is A => a.gap != null);
  const out: string[] = [
    '📚 Чему научилась система',
    'Всё пересчитано из базы; в скобках — 95% диапазон (Уилсон).',
    '',
  ];

  // ---------- 1. Проверка вне выборки ----------
  out.push('1️⃣ Правила на данных ПОСЛЕ их фиксации (на них не подгоняли)');
  for (const r of RULES) {
    const after = att.filter((a) => Date.parse(a.at) >= mskStart(r.since));
    const bad = after.filter((a) => r.violates(a, isPro(a.label)));
    const ok = after.filter((a) => !r.violates(a, isPro(a.label)));
    out.push(
      `   ${r.label} — с ${ddmm(r.since)}, ${after.length} поп`,
      `      нарушали: ${line(bad)}`,
      `      соблюдали: ${line(ok)}`,
    );
  }
  out.push('');

  // ---------- 2. Зоны за границами — по классу аппарата ----------
  out.push('2️⃣ Зоны за границами — отдельно Pro и не-Pro');
  for (const z of ZONES) {
    const inZone = att.filter((a) => z.test(a));
    const pro = inZone.filter((a) => isPro(a.label));
    const weak = inZone.filter((a) => !isPro(a.label));
    out.push(`   ${z.label}`, `      Pro: ${line(pro)}`, `      не-Pro: ${line(weak)}`);
  }
  out.push('');

  // ---------- 3. Выживаемость (Каплан–Мейер) ----------
  const phones = (await db.execute(sql`
    select ph.label, ph.status, ph.death_reason dr, ph.died_at,
      (select min(p.purchased_at) from purchases p where p.phone_id = ph.id) first_at
    from phones ph where ph.status in ('active', 'dead')`)) as unknown as {
    label: string | null;
    status: string;
    dr: string | null;
    died_at: string | null;
    first_at: string | null;
  }[];
  const subj = (filter: (label: string | null, firstAt: number) => boolean): Subject[] =>
    phones
      .filter((p) => p.first_at && filter(p.label, Date.parse(p.first_at)))
      .map((p) => {
        const end = p.died_at ? Date.parse(p.died_at) : now.getTime();
        const dr = asDeathReason(p.dr);
        return {
          days: Math.max(0, (end - Date.parse(p.first_at!)) / 86_400_000),
          // Смерть = решение Apple (💀 или 🔐). Ручной вывод и живые — цензура.
          died: p.status === 'dead' && dr !== null && BY_APPLE[dr],
        };
      });
  const km = (label: string, s: Subject[]) => {
    const k = kaplanMeier(s);
    const at = (d: number) => `${Math.round(survivalAt(k, d) * 100)}%`;
    return `   ${label} (${s.length} тел): дожить до 3-го дня ${at(3)} · до 7-го ${at(7)} · до 14-го ${at(14)} (под наблюдением к 14-му: ${atRiskAt(s, 14)})`;
  };
  // Эпохи обязательно раздельно: до протокола (июнь–август) смертей было
  // много, и общая кривая без разбивки пугала бы цифрой, которая к нынешней
  // работе не относится. Граница — дата фиксации протокола танков.
  const protocol = mskStart(PROTOCOL_SINCE);
  out.push(
    '3️⃣ Выживаемость: вероятность НЕ получить 💀/🔐 до дня N',
    km(`до протокола`, subj((_, f) => f < protocol)),
    km(`с протокола (${ddmm(PROTOCOL_SINCE)})`, subj((_, f) => f >= protocol)),
    km('   из них Pro', subj((l, f) => f >= protocol && isPro(l))),
    km('   из них не-Pro', subj((l, f) => f >= protocol && !isPro(l))),
    '   Выведенные вручную учтены как «прожил минимум N дней», а не выброшены.',
    '',
  );

  // ---------- 4. Интернет на крупных ----------
  const big = all.filter((a) => a.amt >= 100);
  const badBig = (xs: Att[]) => xs.filter((a) => a.res === 'long' || a.res === 'verify').length;
  const net = (k: string) => big.filter((a) => a.internet === k);
  const netLine = (label: string, xs: Att[]) =>
    `   ${label}: ${xs.length} поп · 💀/🔐 ${badBig(xs)} · ${fmtRate(badBig(xs), xs.length)}`;
  out.push(
    '4️⃣ Крупные (€100+) по интернету',
    netLine('📡 Wi-Fi', net('wifi')),
    netLine('📶 мобильный', net('mobile')),
    '',
  );

  // ---------- 5. Ранние боевые: уровень телефона ----------
  // Телефон, у которого боевая (≥€30) была в первые WARMUP_DAYS дней цикла.
  const firstAt = new Map<string, string>();
  for (const a of all) {
    const f = firstAt.get(a.phoneId);
    if (!f || Date.parse(a.at) < Date.parse(f)) firstAt.set(a.phoneId, a.at);
  }
  const early = new Set(
    all
      .filter((a) => a.amt >= 30 && cycleDayMsk(firstAt.get(a.phoneId)!, new Date(a.at)) <= WARMUP_DAYS)
      .map((a) => a.phoneId),
  );
  const battled = new Set(all.filter((a) => a.amt >= 30).map((a) => a.phoneId));
  const fate = (await db.execute(sql`
    select id::text id, status, death_reason dr from phones where status = 'dead'`)) as unknown as {
    id: string;
    status: string;
    dr: string | null;
  }[];
  const appleDead = new Set(
    fate.filter((p) => { const dr = asDeathReason(p.dr); return dr !== null && BY_APPLE[dr]; }).map((p) => p.id),
  );
  const finished = new Set(fate.map((p) => p.id));
  const grp = (ids: string[]) => {
    const done = ids.filter((id) => finished.has(id));
    const d = done.filter((id) => appleDead.has(id)).length;
    return `${done.length} тел · умерли ${d} · ${fmtRate(d, done.length)}`;
  };
  out.push(
    `5️⃣ Боевые в первые ${WARMUP_DAYS} дня (завершённые циклы)`,
    `   начали рано: ${grp([...early])}`,
    `   по протоколу: ${grp([...battled].filter((id) => !early.has(id)))}`,
    '',
  );

  // ---------- 6. Журнал подсказок: следуют ли и чем кончается ----------
  // Для каждой записанной подсказки берём СЛЕДУЮЩУЮ танковую попытку на том же
  // телефоне и сравниваем её время с разрешённым (крупная — с next_big_at,
  // остальное — с next_small_at). Минута допуска — на округление ввода.
  const log = (await db.execute(sql`
    select a.created_at, a.next_small_at, a.next_big_at, p.purchased_at at,
      (select row_to_json(n) from (
         select q.amount::float amt, q.result::text res, q.purchased_at at
         from purchases q join purchase_categories cq on cq.id = q.category_id
         where q.phone_id = a.phone_id and cq.code = 'game_donate' and q.purchased_at > p.purchased_at
         order by q.purchased_at limit 1) n) nxt
    from advice_log a join purchases p on p.id = a.purchase_id
    order by a.created_at`)) as unknown as {
    created_at: string;
    next_small_at: string | null;
    next_big_at: string | null;
    nxt: { amt: number; res: string; at: string } | null;
  }[];
  out.push('6️⃣ Журнал подсказок — следуют ли им и чем кончается');
  if (log.length === 0) {
    out.push('   ведётся с 08.10.2026, записей пока нет — появятся с первыми покупками');
  } else {
    const judged = log.filter((l) => l.nxt && (l.nxt.amt >= 100 ? l.next_big_at : l.next_small_at));
    const early = judged.filter((l) => {
      const allowed = Date.parse((l.nxt!.amt >= 100 ? l.next_big_at : l.next_small_at)!);
      return Date.parse(l.nxt!.at) < allowed - 60_000;
    });
    const onTime = judged.filter((l) => !early.includes(l));
    const bad = (xs: typeof log) => xs.filter((l) => l.nxt!.res === 'long' || l.nxt!.res === 'verify').length;
    out.push(
      `   записей ${log.length} с ${ddmm(log[0]!.created_at.slice(0, 10))}, со следующей покупкой — ${judged.length}`,
      `   по правилам (не раньше разрешённого): ${onTime.length} · 💀/🔐 ${bad(onTime)} · ${fmtRate(bad(onTime), onTime.length)}`,
      `   раньше разрешённого: ${early.length} · 💀/🔐 ${bad(early)} · ${fmtRate(bad(early), early.length)}`,
    );
  }
  out.push('', '⚖️ Границы и правила меняет человек. Широкий диапазон = данных мало, выводы рано.');
  return out;
}

export async function showLearn(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const text = (await learnLines()).join('\n');
  // Тот же предохранитель, что у /corridor: Telegram молча отклоняет > 4096.
  const LIMIT = 4000;
  await ctx.reply(
    text.length <= LIMIT ? text : `${text.slice(0, LIMIT)}\n\n… отчёт обрезан (${text.length} символов).`,
  );
}
