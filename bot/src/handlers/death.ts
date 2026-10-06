// Причина смерти телефона — одно место для разбора и подписей.
//
// В базе `phones.death_reason` — обычный text, а не enum, поэтому компилятор
// не знал набор значений, и ветки были написаны тернарниками в шести местах:
// «error ? … : forced ? … : —» или даже «error ? умер : выведен вручную».
// 06.10.2026 появилась третья причина — 'verify' (миграция 0014), и почти
// везде она молча стала бы «выведен вручную» или «—». Ровно так же, как
// статус prepared в своё время показывался надгробием (см. CLAUDE.md).
//
// Теперь: значение из базы разбирается здесь, а подписи — Record<DeathReason, …>.
// Добавится четвёртая причина — проект не соберётся, пока её не впишут.
//
// Модуль чистый (без БД), его можно тестировать.

export type DeathReason = 'error' | 'forced' | 'verify';

const KNOWN: Record<DeathReason, true> = { error: true, forced: true, verify: true };

/** Разбор значения из базы. Неизвестное или пустое — null (телефон не умирал). */
export function asDeathReason(s: string | null | undefined): DeathReason | null {
  // Object.hasOwn, а не `in`: `in` видит и прототип, и «toString» прошёл бы
  // как причина смерти (поймано тестом).
  return s != null && Object.hasOwn(KNOWN, s) ? (s as DeathReason) : null;
}

/** Решил ли телефон судьбу сам (Apple), а не оператор. Только такие смерти — данные о пределе. */
export const BY_APPLE: Record<DeathReason, boolean> = {
  error: true,
  forced: false,
  verify: true,
};

/** Коротко — в списках и предупреждениях. */
export const DEATH_SHORT: Record<DeathReason, string> = {
  error: 'ошибка Apple',
  forced: 'вынужденный вывод',
  verify: 'проверка данных Apple',
};

/** Полностью — в post-mortem и итоге цикла. */
export const DEATH_FULL: Record<DeathReason, string> = {
  error: '❌ ошибка Apple (достиг предела)',
  forced: '🔄 вынужденный вывод (возврат бюджета)',
  verify: '🔐 проверка данных Apple (покупки закрыты, телефон выкачен)',
};

/** Значок со словом — в сводках, где места мало. */
export const DEATH_TAG: Record<DeathReason, string> = {
  error: '❌ ошибка',
  forced: '🔄 вывод',
  verify: '🔐 проверка',
};
