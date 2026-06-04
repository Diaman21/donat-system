// Форматирование даты/времени в часовом поясе Москвы (Europe/Moscow).
// Важно: на Vercel процесс работает в UTC, поэтому время нужно
// форматировать явно, иначе оно сдвинуто на −3 часа.

const mskDateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// «04.06 14:30» (по Москве)
export function fmtMsk(d: Date): string {
  return mskDateTime.format(d).replace(',', '');
}
