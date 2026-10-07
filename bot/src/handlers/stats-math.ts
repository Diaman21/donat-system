// Статистика для «обучения» системы — чистые функции, без БД.
//
// Две вещи, которые добавлены по итогам аудита 07.10.2026 (хорошие практики):
//
// 1. ИНТЕРВАЛ УИЛСОНА вместо голых процентов. «42% на 19 попытках» читается
//    как закон, а на деле это «где-то от 23% до 64%». Диапазон сразу
//    показывает, где выборка мала, — это прямое продолжение правила проекта
//    «не делать выводов раньше данных». Уилсон, а не «±2σ»: он честно работает
//    на краях (0 из 5, 5 из 5), где обычная формула даёт отрицательные проценты.
//
// 2. КРИВАЯ ВЫЖИВАЕМОСТИ (Каплан–Мейер). До неё 22 телефона, выведенных вручную,
//    просто выбрасывались из «возраста до смерти». А это информация: «прожил
//    МИНИМУМ N дней и не умер». Такие наблюдения в статистике называются
//    цензурированными, и Каплан–Мейер учитывает их честно: телефон участвует
//    в расчёте, пока он «под наблюдением», и выбывает без смерти.

/** Доверительный интервал Уилсона для доли d/n, в процентах. 95% по умолчанию. */
export function wilson(d: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 100 };
  const p = d / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    lo: Math.max(0, (center - half) * 100),
    hi: Math.min(100, (center + half) * 100),
  };
}

/** «42% (23–64%)» — доля с диапазоном. «—», если наблюдений нет. */
export function fmtRate(d: number, n: number): string {
  if (n <= 0) return '—';
  const { lo, hi } = wilson(d, n);
  const r = (x: number) => Math.round(x);
  return `${r((d / n) * 100)}% (${r(lo)}–${r(hi)}%)`;
}

export interface Subject {
  /** Сколько дней телефон был под наблюдением (от первой покупки). */
  days: number;
  /** true — умер (событие), false — выбыл живым (цензура) или ещё жив. */
  died: boolean;
}

export interface KmStep {
  day: number;
  atRisk: number;
  deaths: number;
  /** Вероятность дожить ПОСЛЕ этого дня. */
  surv: number;
}

/**
 * Каплан–Мейер: шаги кривой выживаемости по дням смертей.
 * Цензурированные (выведенные/живые) уменьшают «под риском» начиная со
 * следующего дня — стандартное соглашение: в день выбытия они ещё считаются.
 */
export function kaplanMeier(subjects: Subject[]): KmStep[] {
  const days = [...new Set(subjects.filter((s) => s.died).map((s) => s.days))].sort((a, b) => a - b);
  const steps: KmStep[] = [];
  let surv = 1;
  for (const day of days) {
    const atRisk = subjects.filter((s) => s.days >= day).length;
    const deaths = subjects.filter((s) => s.died && s.days === day).length;
    if (atRisk === 0) continue;
    surv *= 1 - deaths / atRisk;
    steps.push({ day, atRisk, deaths, surv });
  }
  return steps;
}

/** Вероятность дожить до конца дня `day` по кривой. 1 — смертей до него не было. */
export function survivalAt(steps: KmStep[], day: number): number {
  let s = 1;
  for (const st of steps) {
    if (st.day > day) break;
    s = st.surv;
  }
  return s;
}

/** Сколько телефонов ещё «под наблюдением» к дню `day` — без этого кривая врёт молча. */
export function atRiskAt(subjects: Subject[], day: number): number {
  return subjects.filter((s) => s.days >= day).length;
}
