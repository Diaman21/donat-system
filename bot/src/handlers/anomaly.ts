import { DANGER_EUR, CORRIDOR_MIN_H, WARMUP_DAYS, WITHDRAW_DAYS } from './interval.js';

// Аномалии: заметить отклонение и ИЗВЛЕЧЬ ИЗ НЕГО ЗНАНИЕ.
//
// ИДЕЯ (сформулирована владельцем 13.09.2026). Каждое случайное отклонение —
// это непреднамеренный эксперимент. Если оно прошло успешно, значит наша
// граница, возможно, слишком осторожна. Раньше такие случаи помечались как
// «нарушение» и забывались: никто не возвращался спросить «а оно выжило?
// значит ли это, что можно смелее?». Здесь мы их считаем.
//
// ДВА РАЗНЫХ СМЫСЛА, и путать их нельзя:
//   🔴 danger      — по данным это убивает, никакой ценности в повторении нет;
//   🟡 observation — отклонение в неизученную зону: полезное наблюдение;
//   ℹ️ note         — просто стоит знать.
// Если смешать, «интервал 16 ч при €60» (безобидно и полезно) будет выглядеть
// так же, как «сотня поверх сотни через 3 часа» (57% смертей) — и оператор
// перестанет читать оба.
//
// ⚠️ Бот НИКОГДА не двигает границы сам. Он только показывает, сколько
// доказательств накопилось. Решение и правка константы — за человеком.

export type Severity = 'danger' | 'observation' | 'note';

export interface Anomaly {
  severity: Severity;
  /** Что именно произошло. */
  text: string;
  /** Чем это ценно для знания (только у observation). */
  learn?: string;
}

/** Факты о только что записанной покупке — всё, что нужно для классификации. */
export interface PurchaseFacts {
  amount: number;
  result: 'done' | 'support' | 'long';
  /** Часов с предыдущей покупки на этом телефоне. null — первая. */
  gapH: number | null;
  /** Списано (✅) за 24 ч ДО этой покупки, без неё самой. */
  spent24: number;
  /** День цикла: 1 — день первой покупки. */
  dayOfCycle: number | null;
  /** Были ли боевые покупки (≥€30) ДО этой. */
  hadBattleBefore: boolean;
  internet: 'mobile' | 'wifi' | null;
  /** Танки (game_donate). У ВК методика другая — там эти правила не применимы. */
  isTank: boolean;
}

const SMALL_BATTLE = 30;
const BIG = 100;

/**
 * Классификация одной покупки. Пустой массив — всё по протоколу.
 * Чистая функция: ни БД, ни времени — только переданные факты.
 */
export function classifyPurchase(f: PurchaseFacts): Anomaly[] {
  if (!f.isTank) return []; // у ВК своя методика, эти пороги к ней не относятся
  const out: Anomaly[] = [];
  const total = f.spent24 + f.amount;
  const short = f.gapH != null && f.gapH < CORRIDOR_MIN_H;
  const gap = f.gapH != null ? f.gapH.toFixed(1) : '—';

  // 1. Опасная клетка расклада: короткий интервал И крупная сумма за сутки.
  if (short && total >= DANGER_EUR) {
    out.push({
      severity: 'danger',
      // ⚠️ Точную статистику здесь НЕ пишем. Она меняется с каждой покупкой,
      // а зашитое в строку число молча разойдётся с данными (уже расходилось:
      // «8 из 13» стало «8 из 14» за сутки). Формулировка выбрана так, чтобы
      // оставаться верной при дрейфе; точные цифры даёт /corridor.
      text:
        `интервал ${gap} ч при сумме €${total} за 24 ч — это опасная клетка расклада, ` +
        `в ней исторически гибнет больше половины телефонов (точнее — /corridor)`,
    });
  } else if (short) {
    // 2. Короткий интервал, но денег немного — та самая неизученная зона.
    out.push({
      severity: 'observation',
      text: `интервал ${gap} ч (норма ≥ ${CORRIDOR_MIN_H} ч), сумма за 24 ч €${total}`,
      learn: 'записал как наблюдение — если телефон выживет, это довод сдвинуть границу',
    });
  }

  // 3. Боевая покупка раньше конца разогрева.
  if (f.amount >= SMALL_BATTLE && f.dayOfCycle != null && f.dayOfCycle <= WARMUP_DAYS) {
    out.push({
      severity: 'danger',
      text:
        `боевая покупка на ${f.dayOfCycle}-й день (разогрев ${WARMUP_DAYS} дня) — ` +
        `у тех, кто так делал, 4 смерти из 5`,
    });
  }

  // 4. Разогрев затянулся: боевых ещё не было, а дни идут.
  if (!f.hadBattleBefore && f.amount < SMALL_BATTLE && f.dayOfCycle != null && f.dayOfCycle > WARMUP_DAYS) {
    out.push({
      severity: 'note',
      text: `разогрев идёт ${f.dayOfCycle}-й день вместо ${WARMUP_DAYS} — окно жизни тратится на €2`,
    });
  }

  // 5. Цикл вышел за 14 дней.
  if (f.dayOfCycle != null && f.dayOfCycle > WITHDRAW_DAYS) {
    out.push({
      severity: 'note',
      text: `${f.dayOfCycle}-й день цикла — вывод бюджета просрочен`,
    });
  }

  // 6. Крупная покупка через мобильный интернет.
  if (f.amount >= BIG && f.internet === 'mobile') {
    out.push({
      severity: 'observation',
      text: `€${f.amount} через мобильный интернет (исторически 2 ✅ / 3 💀)`,
      learn: 'наблюдений мало — каждое уточняет, вредит ли мобильный на самом деле',
    });
  }

  return out;
}

const MARK: Record<Severity, string> = { danger: '🔴', observation: '🟡', note: 'ℹ️' };

/** Строки для сообщения после покупки. Пусто, если отклонений нет. */
export function anomalyLines(list: Anomaly[]): string[] {
  if (list.length === 0) return [];
  const out = ['📋 Отклонение от протокола:'];
  for (const a of list) {
    out.push(`   ${MARK[a.severity]} ${a.text}`);
    if (a.learn) out.push(`      ${a.learn}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Накопление доказательств за границами.
//
// Правило трёх: если на N наблюдениях НОЛЬ смертей, верхняя граница истинного
// риска ≈ 3/N (95% доверие). Это грубая оценка — она не учитывает, что телефоны
// разные, — но честно отвечает на вопрос «сколько ещё нужно, чтобы поверить».
// ---------------------------------------------------------------------------

/** Сколько чистых наблюдений считаем достаточным поводом ОБСУДИТЬ сдвиг. */
export const EVIDENCE_ENOUGH = 30;

export interface ZoneVerdict {
  n: number;
  deaths: number;
  /** Верхняя оценка риска в %, когда смертей нет. null — смерти были. */
  upperRiskPct: number | null;
  /** Накоплено достаточно, чтобы вынести вопрос на решение. */
  enough: boolean;
  /** Короткий вывод для человека. */
  verdict: string;
}

export function assessZone(n: number, deaths: number): ZoneVerdict {
  if (deaths > 0) {
    return {
      n,
      deaths,
      upperRiskPct: null,
      enough: false,
      verdict: `${deaths} 💀 из ${n} (${((deaths / n) * 100).toFixed(1)}%) — граница не двигается`,
    };
  }
  if (n === 0) {
    return { n, deaths, upperRiskPct: null, enough: false, verdict: 'наблюдений нет' };
  }
  const upper = (3 / n) * 100;
  const enough = n >= EVIDENCE_ENOUGH;
  return {
    n,
    deaths,
    upperRiskPct: upper,
    enough,
    verdict: enough
      ? `${n} набл · 0 💀 · риск не выше ${upper.toFixed(0)}% — ПОРА ОБСУДИТЬ сдвиг`
      : `${n} набл · 0 💀 · риск не выше ${upper.toFixed(0)}% — нужно ${EVIDENCE_ENOUGH - n} ещё`,
  };
}
