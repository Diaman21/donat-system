// 💀 со временем — по две недели с начала протокола. Чистая логика, без базы.
//
// Добавлено 12.11.2026. Владелец спросил «система как-то сдвинулась?» после смерти
// …1884. Ответ пришлось считать скриптом: с 13.08 по 27.09 — 91 попытка без
// единой 💀, с 28.09 — примерно одна в неделю. Для 🔐 такая динамика уже была
// (verify-trend.ts), для 💀 — нет. Здесь только счёт, без гипотез: «сдвинулось
// ли» видно по отрезкам, а причину ищет человек.
//
// Две недели, а не одна: попыток в неделю 10–25, 💀 — единицы; недельные доли
// прыгают от 0% к 10% от одного случая и читаются как шум.

/** Длина отрезка в днях. */
export const DEATH_BUCKET_DAYS = 14;

const DAY = 86_400_000;
const mskStart = (iso: string) => Date.parse(`${iso}T00:00:00+03:00`);
const isoMsk = (ms: number) => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);

export interface DeathAtt {
  res: string;
  at: string;
}

export interface DeathBucket {
  /** Первый день (МСК, ГГГГ-ММ-ДД). */
  from: string;
  /** Последний день (включительно). */
  to: string;
  n: number;
  deaths: number;
}

/**
 * Танковые попытки и 💀 по отрезкам с `from` (дата протокола) до `now`;
 * последний отрезок может быть неполным. Считаются все попытки, и €2 тоже:
 * смерти бывают и на разогреве, а нагрузка на телефон — любая покупка.
 */
export function deathTrend(atts: DeathAtt[], from: string, now: Date): DeathBucket[] {
  const out: DeathBucket[] = [];
  const step = DEATH_BUCKET_DAYS * DAY;
  for (let s = mskStart(from); s <= now.getTime(); s += step) {
    const inside = atts.filter((a) => {
      const t = Date.parse(a.at);
      return t >= s && t < s + step;
    });
    out.push({
      from: isoMsk(s),
      to: isoMsk(s + step - DAY),
      n: inside.length,
      deaths: inside.filter((a) => a.res === 'long').length,
    });
  }
  return out;
}
