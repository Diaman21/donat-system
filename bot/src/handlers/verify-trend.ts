// 🔐 «проверка данных» — как часто она вылезает со временем. Чистая логика, без базы.
//
// Добавлено 14.10.2026, после пятого случая. До 06.10.2026 этого окна Apple не было
// ни разу (кнопка 🔐 появилась в тот же день), а с 06.10 оно стало главной причиной
// потери телефонов. Первые два случая (базовые iPhone 13, мобильный интернет, одна
// партия) подсказали гипотезу, которую следующие три опровергли (Pro Max, Wi-Fi,
// другие партии), причём 4 из 5 — при чистом протоколе коридора. Поэтому в /learn
// не гипотеза, а только динамика: доля 🔐 до и после появления и по неделям, —
// чтобы было видно, затихает ли это.

/** День, с которого 🔐 существует (первый случай, …9183). */
export const VERIFY_SINCE = '2026-10-06';

/** Крупная покупка — от €30: на разогреве €2 🔐 не встречался. */
export const VERIFY_MIN_EUR = 30;

const DAY = 86_400_000;
const mskStart = (iso: string) => Date.parse(`${iso}T00:00:00+03:00`);
const isoMsk = (ms: number) => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);

export interface TrendAtt {
  amt: number;
  res: string;
  at: string;
}

export interface Bucket {
  /** Первый день (МСК, ГГГГ-ММ-ДД). */
  from: string;
  /** Последний день (включительно). */
  to: string;
  n: number;
  verify: number;
}

export interface VerifyTrend {
  before: { n: number; verify: number };
  after: { n: number; verify: number };
  /** Недели с VERIFY_SINCE до сегодня; последняя может быть неполной. */
  weeks: Bucket[];
}

/**
 * Доля 🔐 среди крупных попыток.
 * @param from начало сравнения «до» (ГГГГ-ММ-ДД) — дата протокола, чтобы не мешать
 *             с эпохой, когда телефоны жили иначе.
 */
export function verifyTrend(atts: TrendAtt[], from: string, now: Date): VerifyTrend {
  const big = atts.filter((a) => a.amt >= VERIFY_MIN_EUR && Date.parse(a.at) >= mskStart(from));
  const since = mskStart(VERIFY_SINCE);
  const count = (xs: TrendAtt[]) => ({ n: xs.length, verify: xs.filter((a) => a.res === 'verify').length });

  const weeks: Bucket[] = [];
  for (let s = since; s <= now.getTime(); s += 7 * DAY) {
    const inWeek = big.filter((a) => {
      const t = Date.parse(a.at);
      return t >= s && t < s + 7 * DAY;
    });
    weeks.push({ from: isoMsk(s), to: isoMsk(s + 6 * DAY), ...count(inWeek) });
  }
  return {
    before: count(big.filter((a) => Date.parse(a.at) < since)),
    after: count(big.filter((a) => Date.parse(a.at) >= since)),
    weeks,
  };
}
