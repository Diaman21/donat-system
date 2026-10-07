import type { PurchaseResultValue } from '../db/schema.js';

// Что считать ДЕНЬГАМИ и ГОЛОСАМИ — одно правило на все отчёты.
//
// Строка в `purchases` — это ПОПЫТКА покупки. Деньги списаны только у ✅:
//   ⚠️ support — платёж отклонён;
//   💀 long    — всплыл waiver ВМЕСТО списания;
//   🔐 verify  — Apple потребовал проверку, покупка не завершена.
// Голоса ВК по неудачной попытке тоже не пришли.
//
// До 07.10.2026 почти все отчёты суммировали amount по ВСЕМ строкам:
// «💵 Потрачено» в /stats показывало €13 676 при реально списанных €12 870,
// «€ до смерти» завышался на номинал убившей попытки. Правило «потрачено =
// только ✅» в документах было давно, а в коде соблюдалось только в лимите
// 24 ч, итоге недели и итоге цикла.
//
// ⚠️ СЧЁТ покупок по-прежнему по всем попыткам — это нагрузка на телефон,
// и неудачная попытка тоже нагрузка. Меняются только суммы € и голосов.
//
// Record, а не «result === 'done'»: добавится результат — проект не соберётся,
// пока не решат, списываются ли по нему деньги.

export const PAID: Record<PurchaseResultValue, boolean> = {
  done: true,
  support: false,
  long: false,
  verify: false,
};

/** Сколько € реально списано этой строкой. */
export function paidEur(p: { amount: string | number; result: PurchaseResultValue }): number {
  return PAID[p.result] ? Number(p.amount) : 0;
}

/** Сколько голосов ВК реально пришло по этой строке. */
export function paidUnits(p: { units: number | null; result: PurchaseResultValue }): number {
  return PAID[p.result] ? (p.units ?? 0) : 0;
}
