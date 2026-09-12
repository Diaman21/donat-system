import { mskIsoOfDate, daysBetweenIso, ddmmOf, hhmmMsk } from '../format.js';

// Подсказка «когда можно следующую закупку на этом телефоне».
//
// ЗАЧЕМ ИМЕННО ПОСЛЕ ПОКУПКИ, А НЕ ДО.
// Бот — логгер: покупка совершается в App Store, и только потом вбивается сюда.
// Предупреждать в момент ввода бессмысленно — деньги уже списаны. Зато это
// точный момент, чтобы сказать, когда МОЖНО следующую: оператор как раз здесь
// и смотрит.
//
// ЧИСЛА — ИЗ ДАННЫХ, а не из головы (см. «Рабочий протокол танков» в CLAUDE.md):
//   < 20 ч  — зона риска: смертность 13–36% (чем короче, тем хуже);
//   20–36 ч — «зелёный коридор»: 1 смерть на 69 покупок (1.4%);
//   22–28 ч — рабочий оптимум протокола;
//   > 36 ч  — безопасно, но убыточно: за 14 дней влезает 7 покупок вместо 12.
// Поэтому «не раньше» = 20 ч, а «лучше всего» = 22–28 ч.
//
// ⚠️ Это НЕ общий совет «сбавь темп» — такие советы отложены осознанно (они меняют
// поведение оператора, телефоны перестают доходить до края, и коридор не уточнить).
// Здесь подсказка узкая: одно конкретное правило, один телефон, конкретное время.

export const CORRIDOR_MIN_H = 20; // раньше — зона риска
export const OPT_FROM_H = 22; // рабочий оптимум протокола
export const OPT_TO_H = 28;

const H = 3600 * 1000;

export interface NextWindow {
  notBefore: Date;
  optFrom: Date;
  optTo: Date;
}

export function nextPurchaseWindow(at: Date): NextWindow {
  const t = at.getTime();
  return {
    notBefore: new Date(t + CORRIDOR_MIN_H * H),
    optFrom: new Date(t + OPT_FROM_H * H),
    optTo: new Date(t + OPT_TO_H * H),
  };
}

// «сегодня» / «завтра» / «послезавтра» / «15.09» — по московскому календарю.
// Считаем от даты покупки (from), а не от «сейчас»: сообщение пишется сразу
// после записи, и так оно остаётся верным, даже если его перечитают позже.
export function dayWord(target: Date, from: Date): string {
  const iso = mskIsoOfDate(target);
  const diff = daysBetweenIso(mskIsoOfDate(from), iso);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  return ddmmOf(iso);
}

// Диапазон вида «завтра 21:47–03:47» или «завтра 21:47 — послезавтра 03:47».
function range(a: Date, b: Date, from: Date): string {
  const sameDay = mskIsoOfDate(a) === mskIsoOfDate(b);
  return sameDay
    ? `${dayWord(a, from)} ${hhmmMsk(a)}–${hhmmMsk(b)}`
    : `${dayWord(a, from)} ${hhmmMsk(a)} — ${dayWord(b, from)} ${hhmmMsk(b)}`;
}

// Готовые строки для сообщения после записи покупки.
// orderStillOpen — по заказу остались позиции: подсказываем делать их с ДРУГОГО
// телефона. Именно здесь чаще всего и нарушался протокол: заказ «Орден + Банки»
// = 2×€30, и обе позиции уходили на один телефон в один вечер.
export function nextPurchaseHint(at: Date, orderStillOpen = false): string[] {
  const w = nextPurchaseWindow(at);
  const lines = [
    '⏳ Следующая закупка на этом телефоне:',
    `   🟢 лучше всего: ${range(w.optFrom, w.optTo, at)}`,
    `   ⛔️ не раньше ${dayWord(w.notBefore, at)} ${hhmmMsk(w.notBefore)} (раньше — зона риска)`,
  ];
  if (orderStillOpen) {
    lines.push('   ↪️ Остальные позиции заказа — с ДРУГОГО телефона, не с этого.');
  }
  return lines;
}
