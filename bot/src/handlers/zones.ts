import { CORRIDOR_MIN_H, DANGER_EUR, MIN_GAP_WEAK_H } from './interval.js';

// Зоны за границами и правила протокола — ОДНО определение на всю систему.
//
// До 07.10.2026 зоны накопления были записаны SQL-условиями прямо в
// boundaryEvidence, а их «сестра» attempts() считала интервал своим
// SQL. Два определения одной вещи — ровно та ошибка, на которой 06.10
// проверка «опровергла» верные цифры (она считала интервал иначе). Теперь
// зоны и правила — предикаты над попыткой из attempts(), и ими пользуются
// /corridor, сводка и /learn одинаково.
//
// Чистый модуль (без БД) — проверяется тестом.

/** Попытка в том виде, в каком её отдаёт attempts() (corridor.ts). */
export interface ZoneAtt {
  /** Часов с предыдущей покупки ЛЮБОЙ категории; null — первая покупка телефона. */
  gap: number | null;
  /** Списано ✅ танками за 24 ч до попытки. */
  spent: number;
  amt: number;
}

export interface Zone {
  key: string;
  label: string;
  test: (a: ZoneAtt & { gap: number }) => boolean;
}

const total = (a: ZoneAtt) => a.spent + a.amt;

/** Зоны ЗА границами протокола, где копятся «случайные эксперименты». */
export const ZONES: Zone[] = [
  {
    key: 'gap-14-20',
    label: `интервал 14–${CORRIDOR_MIN_H} ч (сумма < €${DANGER_EUR})`,
    test: (a) => a.gap >= 14 && a.gap < CORRIDOR_MIN_H && total(a) < DANGER_EUR,
  },
  {
    key: 'gap-10-14',
    label: `интервал ${MIN_GAP_WEAK_H}–14 ч (сумма < €${DANGER_EUR})`,
    test: (a) => a.gap >= MIN_GAP_WEAK_H && a.gap < 14 && total(a) < DANGER_EUR,
  },
  {
    key: 'gap-lt-10',
    label: `интервал < ${MIN_GAP_WEAK_H} ч (сумма < €${DANGER_EUR})`,
    test: (a) => a.gap < MIN_GAP_WEAK_H && total(a) < DANGER_EUR,
  },
  {
    key: 'money-over',
    label: `сумма ≥ €${DANGER_EUR} при интервале ≥ ${CORRIDOR_MIN_H} ч`,
    test: (a) => total(a) >= DANGER_EUR && a.gap >= CORRIDOR_MIN_H,
  },
];

export interface Rule {
  key: string;
  label: string;
  /**
   * С какой даты правило действует (МСК). Всё, что ПОСЛЕ, — проверка вне
   * выборки: на этих данных правило не подгоняли.
   */
  since: string;
  /** true — попытка нарушает правило. */
  violates: (a: ZoneAtt & { gap: number }, isPro: boolean) => boolean;
}

/** Правила протокола с датами фиксации — для проверки вне выборки. */
export const RULES: Rule[] = [
  {
    key: 'money',
    label: `деньги: < ${CORRIDOR_MIN_H} ч и ≥ €${DANGER_EUR} за сутки`,
    since: '2026-09-12',
    violates: (a) => a.gap < CORRIDOR_MIN_H && total(a) >= DANGER_EUR,
  },
  {
    key: 'floor',
    label: `пол не-Pro: < ${MIN_GAP_WEAK_H} ч`,
    since: '2026-10-06',
    violates: (a, isPro) => !isPro && a.gap < MIN_GAP_WEAK_H,
  },
];

/**
 * Версия правил — дата последней фиксации. Пишется в журнал подсказок
 * (advice_log.rules), чтобы потом не путать «бот не предупредил» с
 * «такого правила тогда ещё не было». Поменяли правило — добавьте его в RULES.
 */
export const RULES_VERSION = RULES.map((r) => r.since).sort().at(-1)!;
