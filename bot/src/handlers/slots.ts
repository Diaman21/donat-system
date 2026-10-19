import type { PurchaseResultValue } from '../db/schema.js';
import { cycleDayMsk, mskHour } from '../format.js';
import {
  slotOpensAt,
  withdrawStage,
  BIG_EUR,
  SMALL_EUR,
  WARMUP_DAYS,
  type Charge,
  type WithdrawStage,
} from './interval.js';

// Состояние телефона «что и когда можно» — для экрана «☎️ Телефоны» и
// напоминаний о слотах под €100 (19.10.2026). Чистая логика, без базы.
//
// ЗАЧЕМ НАПОМИНАНИЯ. Слот нельзя накопить: сутки прошли — слот сгорел вместе
// с окном жизни телефона. За две недели до 19.10 из 36 интервалов 7 были длиннее
// 28 ч, при 14 заказах за неделю. Сводка в 12:00 ловит простой только через 36 ч.

/** Рабочий день команды по МСК: напоминания только с 09:00 до 24:00 (решение владельца). */
export const WORK_FROM_H = 9;

export function inWorkHours(now: Date): boolean {
  return mskHour(now) >= WORK_FROM_H;
}

export interface PhoneInput {
  id: string;
  imei: string;
  label: string | null;
  isPro: boolean;
  /** Первая покупка (начало цикла); null — покупок не было. */
  firstAt: Date | null;
  /** Последняя попытка любой категории. */
  last: { id: string; at: Date; result: PurchaseResultValue } | null;
  /** ✅ танковые списания (хватает последних 48 ч). */
  charges: Charge[];
}

export type Phase = 'fresh' | 'warmup' | 'battle' | 'due';

export interface PhoneSlot {
  phase: Phase;
  /** День цикла (1 — день первой покупки); null — покупок не было. */
  day: number | null;
  stage: WithdrawStage;
  /** Когда можно €100 и €30 по правилам; null — фаза не боевая. */
  bigAt: Date | null;
  smallAt: Date | null;
}

/**
 * Фаза и слоты. Разогрев — дни 1…WARMUP_DAYS, боевые — дальше, «due» — прошло
 * 14 суток (тогда не покупать, а выводить: …0647 умер 17.10 на 15-й день).
 */
export function phoneSlot(p: PhoneInput, now: Date): PhoneSlot {
  if (!p.firstAt || !p.last) {
    return { phase: 'fresh', day: null, stage: 'none', bigAt: null, smallAt: null };
  }
  const day = cycleDayMsk(p.firstAt, now);
  const stage = withdrawStage(day - 1);
  if (stage === 'due') return { phase: 'due', day, stage, bigAt: null, smallAt: null };
  if (day <= WARMUP_DAYS) return { phase: 'warmup', day, stage, bigAt: null, smallAt: null };
  // Покупка, после которой телефон умер, сюда не попадёт: в работе только живые.
  const last = { at: p.last.at, result: p.last.result };
  return {
    phase: 'battle',
    day,
    stage,
    bigAt: slotOpensAt(last, p.charges, BIG_EUR, p.isPro),
    smallAt: slotOpensAt(last, p.charges, SMALL_EUR, p.isPro),
  };
}

/**
 * Телефоны, о слоте которых пора напомнить: боевая фаза, слот под €100 уже
 * открыт, и по ЭТОЙ последней покупке ещё не напоминали (одно напоминание на
 * слот; новая покупка — новый слот). Часы и наличие заказов проверяет вызывающий.
 * @param notified phoneId → id последней покупки, по которой уже напомнили.
 */
export function slotsToNotify(
  phones: PhoneInput[],
  notified: Record<string, string>,
  now: Date,
): { phone: PhoneInput; slot: PhoneSlot }[] {
  return phones
    .map((phone) => ({ phone, slot: phoneSlot(phone, now) }))
    .filter(
      ({ phone, slot }) =>
        slot.phase === 'battle' &&
        slot.bigAt !== null &&
        slot.bigAt.getTime() <= now.getTime() &&
        notified[phone.id] !== phone.last?.id,
    );
}
