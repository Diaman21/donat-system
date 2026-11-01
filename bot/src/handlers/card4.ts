// Последние 4 цифры карты, привязанной к телефону для оплаты (миграция 0019).
// Чистая логика, без базы.

/**
 * Разобрать ввод оператора: «2850», «2 850», «**** 2850», «*2850».
 * null — не ровно 4 цифры (полный номер карты сюда не принимаем и не храним).
 */
export function parseCardLast4(text: string): string | null {
  const s = text.replace(/[\s*•·.\-]/g, '');
  return /^\d{4}$/.test(s) ? s : null;
}

/** «Карта: 2850» или «Карта: не указана». */
export function cardLine(card: string | null): string {
  return `💳 Карта: ${card ?? 'не указана'}`;
}
