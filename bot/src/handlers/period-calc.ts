import type { PurchaseResultValue } from '../db/schema.js';
import { fmtMskDate, daysBetweenIso, mskIsoOfDate } from '../format.js';
import { paidEur } from './money.js';

// Итоги отчётного периода и за всё время (22.10.2026) — чистая логика, без базы.
//
// Команда работает отчётными периодами (обычно календарный месяц) и в конце
// делит заработанное по сделанным покупкам: сколько Furious €30, Furious €105,
// Massive €100. Считаем ПОКУПКИ ✅, а не заказы: заказ бывает из нескольких
// покупок («Орден + Банки» = 2×€30). ⚠️/💀/🔐 денег не списали — не считаются.
// В периоде разогрев €2 не показываем (решение владельца), за всё время — показываем.

/** Начало первого периода, пока ни разу не обнулялись (решение владельца). */
export const FIRST_PERIOD_START = '2026-09-21T00:00:00+03:00';

export type Kind = 'fur30' | 'fur105' | 'mas100' | 'warm2';

/** Строки отчёта в постоянном порядке. Record — новый вид не потеряется молча. */
export const KIND_LABEL: Record<Kind, string> = {
  fur30: 'Furious €30',
  fur105: 'Furious €105',
  mas100: 'Massive €100',
  warm2: 'Разогрев €2',
};
const KIND_ORDER: Kind[] = ['fur30', 'fur105', 'mas100', 'warm2'];

export interface Row {
  game: string | null;
  /** Код категории: game_donate | vk_votes. */
  code: string;
  amount: string | number;
  result: PurchaseResultValue;
}

/** Вид покупки по прайсу; null — нестандартная (ВК, «✏️ Другая», старые записи). */
export function kindOf(r: Row): Kind | null {
  const a = Number(r.amount);
  if (r.code !== 'game_donate') return null;
  if (r.game === 'Furious' && a === 30) return 'fur30';
  if (r.game === 'Furious' && a === 105) return 'fur105';
  if (r.game === 'Massive' && a === 100) return 'mas100';
  if (r.game === 'Massive' && a === 2) return 'warm2';
  return null;
}

export interface Line {
  label: string;
  n: number;
  eur: number;
}

export interface Tally {
  kinds: Record<Kind, Line>;
  /** Нестандартные — по «игра €сумма», чтобы итог сходился с «💵 Потрачено». */
  other: Line[];
}

export function tally(rows: Row[]): Tally {
  const kinds = Object.fromEntries(
    KIND_ORDER.map((k) => [k, { label: KIND_LABEL[k], n: 0, eur: 0 }]),
  ) as Record<Kind, Line>;
  const other = new Map<string, Line>();
  for (const r of rows) {
    const eur = paidEur(r);
    if (eur === 0) continue; // только ✅
    const k = kindOf(r);
    if (k) {
      kinds[k].n++;
      kinds[k].eur += eur;
      continue;
    }
    const label = r.code === 'vk_votes' ? 'ВК' : `${r.game ?? 'танки'} €${Number(r.amount)}`;
    const o = other.get(label) ?? { label, n: 0, eur: 0 };
    o.n++;
    o.eur += eur;
    other.set(label, o);
  }
  return { kinds, other: [...other.values()].sort((a, b) => b.eur - a.eur) };
}

const eur = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return `€${Number.isInteger(r) ? r : r.toFixed(2)}`;
};

function word(n: number, one: string, few: string, many: string): string {
  const t = n % 100;
  const l = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (l === 1) return one;
  if (l >= 2 && l <= 4) return few;
  return many;
}

/**
 * Строки отчёта.
 * @param withWarmup показывать ли разогрев €2 (за всё время — да, в периоде — нет).
 */
export function tallyLines(t: Tally, withWarmup: boolean): string[] {
  const shown = KIND_ORDER.filter((k) => withWarmup || k !== 'warm2').map((k) => t.kinds[k]);
  const all = [...shown, ...t.other];
  const n = all.reduce((s, l) => s + l.n, 0);
  const sum = all.reduce((s, l) => s + l.eur, 0);
  return [
    ...shown.map((l) => `   ${l.label} ×${l.n} — ${eur(l.eur)}`),
    ...t.other.map((l) => `   ${l.label} ×${l.n} — ${eur(l.eur)}`),
    `   Итого: ${n} ${word(n, 'покупка', 'покупки', 'покупок')} · ${eur(sum)}` +
      (withWarmup ? '' : ' (без разогрева)'),
  ];
}

/** «с 21.09 (32 дня)» — день начала считается первым днём. */
export function periodSpan(from: Date, now: Date): string {
  const days = daysBetweenIso(mskIsoOfDate(from), mskIsoOfDate(now)) + 1;
  return `с ${fmtMskDate(from)} (${days} ${word(days, 'день', 'дня', 'дней')})`;
}
