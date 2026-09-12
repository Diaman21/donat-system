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

const mskDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
});

// «04.06» — только дата (по Москве)
export function fmtMskDate(d: Date): string {
  return mskDate.format(d);
}

// ---------------------------------------------------------------------------
// Календарь по МСК: работа с датами как со строками «YYYY-MM-DD».
//
// Зачем строки, а не Date: SQL-запросы группируют покупки по
// `(purchased_at at time zone 'Europe/Moscow')::date` и возвращают такие же
// строки. Сравнивать и складывать их безопаснее, чем гонять Date туда-обратно.
//
// Приём везде один: сдвигаем момент на +3 часа и дальше читаем UTC-поля.
// МСК = UTC+3 круглый год, перевода часов в России нет — поэтому это не
// хак, а корректный способ получить «московский календарь» в UTC-процессе
// (на Vercel процесс всегда в UTC).
// ---------------------------------------------------------------------------

const MSK_OFFSET_MS = 3 * 3600 * 1000;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** «YYYY-MM-DD» из года, месяца (0-based, как в Date) и дня. */
export const isoOf = (y: number, m0: number, d: number): string =>
  `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

/** Сегодняшняя дата по МСК, разобранная на части (месяц 0-based). */
export function mskNow(): { y: number; m: number; d: number } {
  const t = new Date(Date.now() + MSK_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** Календарная дата по МСК для произвольного момента: «YYYY-MM-DD». */
export function mskIsoOfDate(at: Date | string | number): string {
  const t = new Date(new Date(at).getTime() + MSK_OFFSET_MS);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** Сегодня по МСК как «YYYY-MM-DD». */
export function mskTodayIso(): string {
  return mskIsoOfDate(new Date());
}

/**
 * Понедельник ли указанный момент ПО МОСКВЕ.
 * Ловушка: 21:30 UTC воскресенья — это уже 00:30 МСК понедельника.
 */
export function isMondayMsk(at: Date = new Date()): boolean {
  const msk = new Date(new Date(at).getTime() + MSK_OFFSET_MS);
  return msk.getUTCDay() === 1; // 0 = воскресенье, 1 = понедельник
}

/** Сдвиг даты на delta суток: addDaysIso('2026-09-12', -1) → '2026-09-11'. */
export function addDaysIso(iso: string, delta: number): string {
  const dt = new Date(isoToUtcMs(iso));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

/** Полночь указанной даты в миллисекундах (для арифметики по суткам). */
export function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Сколько суток прошло от from до to (целое, может быть отрицательным). */
export function daysBetweenIso(from: string, to: string): number {
  return Math.floor((isoToUtcMs(to) - isoToUtcMs(from)) / 86400000);
}

/** «2026-09-12» → «12.09» (для заголовков и кнопок). */
export function ddmmOf(iso: string): string {
  const p = iso.split('-');
  return `${p[2]}.${p[1]}`;
}

/** Время суток по МСК: «16:21». Принимает Date или строку из БД. */
export function hhmmMsk(at: Date | string | number): string {
  const x = new Date(new Date(at).getTime() + MSK_OFFSET_MS);
  return `${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}`;
}
