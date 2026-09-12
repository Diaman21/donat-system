import { hhmmMsk, mskIsoOfDate, daysBetweenIso, ddmmOf, addDaysIso } from '../format.js';

// Подсказка «когда и на сколько можно следующую закупку на этом телефоне».
//
// ЗАЧЕМ ПОСЛЕ ПОКУПКИ, А НЕ ДО.
// Бот — логгер: покупка совершается в App Store и только потом вбивается сюда.
// Предупреждать в момент ввода поздно — деньги уже списаны. Зато это точный
// момент, чтобы сказать, когда МОЖНО следующую: оператор как раз здесь смотрит.
//
// МОДЕЛЬ — ИЗ ДАННЫХ (197 танковых попыток, 13 смертей, расклад 12.09.2026):
//
//                        сумма за 24 ч < €120   сумма за 24 ч ≥ €120
//   интервал < 20 ч         46 · 2 💀 · 4.3%       13 · 8 💀 · 61.5%
//   интервал ≥ 20 ч        122 · 3 💀 · 2.5%       16 · 0 💀 · 0%
//
// Читается так: убивает не интервал и не сумма по отдельности, а ИХ СОЧЕТАНИЕ.
//   • Прошло ≥ 20 ч — можно любую сумму: 16 попыток выше порога, НОЛЬ смертей
//     (это обычный ритм «одна сотня в сутки»: вчерашняя €100 ещё в окне, итог
//     €200 за 24 ч — и он безопасен, 8 случаев из 8 при интервале 20–26 ч).
//   • Прошло < 20 ч — можно, ПОКА сумма за скользящие 24 ч остаётся ниже €120.
//     Три тридцатки подряд (€90) — 9 случаев, ноль смертей. Четвёртая даёт €120 —
//     единственное наблюдение, и это смерть (…3685, 01.07.2026).
//
// ⚠️ ПОТРАЧЕНО = ТОЛЬКО ✅. ⚠️ support (платёж отклонён) и 💀 long (waiver всплыл
// вместо списания) денег не списывают — в сумму окна они не входят.
//
// ⚠️ БЕЛОЕ ПЯТНО: наблюдений с суммой €106–119 у нас НЕТ ВООБЩЕ. Верхняя
// проверенная безопасная отметка — €105, первая наблюдаемая смерть по деньгам —
// ровно €120. Поэтому сравнение строгое: €120 уже считается опасным.
// Из реальных номиналов (€2/€30/€100/€105) промежуточные суммы не складываются,
// так что порог €105 и порог €120 ведут себя одинаково — берём €120.
//
// Как двигать границу: /corridor пересчитывает всю таблицу из базы. Появятся
// успешные наблюдения выше — меняется ОДНА константа ниже, а не рассуждения.

/** Сумма за скользящие 24 ч, начиная с которой риск виден в данных (строго ≥). */
export const DANGER_EUR = 120;
/** После этого интервала сумма перестаёт иметь значение (16 попыток, 0 смертей). */
export const CORRIDOR_MIN_H = 20;
/** Минимальный боевой номинал — им меряем остаток («ещё 2 тридцатки»). */
export const SMALL_EUR = 30;
/** Крупный номинал — цель протокола: втрое больше денег за тот же суточный слот. */
export const BIG_EUR = 100;
/** Отлёжка после ⚠️ support — примерно сутки (из диалога Apple, см. CLAUDE.md). */
export const SUPPORT_REST_H = 24;

// ---------------------------------------------------------------------------
// Фаза цикла телефона. Правило лимита (выше) описывает БЕЗОПАСНОСТЬ, но ничего
// не знает о СТРАТЕГИИ: на свежем телефоне €2+€30 укладывается в €120, однако
// по протоколу тридцаток там быть не должно — телефон ещё на разогреве.
//
// Длина разогрева — из данных (31 телефон, разбор 13.09.2026):
//   1 день  — 7 телефонов, средний итог €235
//   2 дня   — 14 телефонов, средний итог €462  ← и самый частый, и лучший
//   3 дня   — 4 телефона,  €281
//   4 дня   — 3 телефона,  €221
// Все рекордсмены шли ровно два дня: …8094 (€839), …5152 (€799), …1023 (€634),
// …6538 (€559) — у каждого 2×€2 за 2 дня. Логика простая: окно жизни 14 дней,
// каждый лишний день разогрева — день, потраченный на €2 вместо €100.
// ---------------------------------------------------------------------------

/** Сколько дней разогрева по €2 (по одной покупке в сутки). */
export const WARMUP_DAYS = 2;
/** На какой день после первой покупки выводится бюджет. */
export const WITHDRAW_DAYS = 14;
/** С какого дня предупреждаем о выводе (буфер). */
export const WARN_FROM_DAY = 12;

const H = 3600 * 1000;
const WINDOW_MS = 24 * H;

export interface Charge {
  /** Момент покупки. */
  at: Date;
  /** Списанная сумма (только ✅ — остальное денег не тратит). */
  amount: number;
}

/** Сколько списано за 24 часа, заканчивающиеся в момент `now`. */
export function spentInWindow(charges: Charge[], now: Date): number {
  const from = now.getTime() - WINDOW_MS;
  return charges
    .filter((c) => c.at.getTime() > from && c.at.getTime() <= now.getTime())
    .reduce((s, c) => s + c.amount, 0);
}

/** Влезает ли покупка на `amount`, если за окно уже потрачено `spent`. */
export function fits(spent: number, amount: number): boolean {
  // Строго меньше: €120 — это уже наблюдавшаяся смерть, а не граница «можно».
  return spent + amount < DANGER_EUR;
}

/** Сколько ещё тридцаток влезает в окно при текущей трате. */
export function smallsLeft(spent: number): number {
  let n = 0;
  while (fits(spent, (n + 1) * SMALL_EUR)) n++;
  return n;
}

/**
 * Самый ранний момент (не раньше `from`), когда покупка на `amount` влезет
 * в лимит: старые списания выпадают из 24-часового окна по одному.
 * null — если не влезет никогда (сумма больше лимита сама по себе).
 */
export function earliestFitting(charges: Charge[], amount: number, from: Date): Date | null {
  if (amount >= DANGER_EUR) return null;
  if (fits(spentInWindow(charges, from), amount)) return from;
  // Окно «отпускает» ровно в моменты `покупка + 24 ч` — их и перебираем.
  const candidates = charges
    .map((c) => new Date(c.at.getTime() + WINDOW_MS))
    .filter((t) => t.getTime() > from.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  for (const t of candidates) {
    if (fits(spentInWindow(charges, t), amount)) return t;
  }
  return null;
}

// «сегодня» / «завтра» / «послезавтра» / «15.09» — по московскому календарю.
// Считаем от момента покупки, а не от «сейчас»: сообщение остаётся верным,
// даже если его перечитают позже.
export function dayWord(target: Date, from: Date): string {
  const iso = mskIsoOfDate(target);
  const diff = daysBetweenIso(mskIsoOfDate(from), iso);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  return ddmmOf(iso);
}

/** «завтра 19:47» — время со словом дня, если это не сегодня. */
function when(t: Date, from: Date): string {
  const w = dayWord(t, from);
  return w === 'сегодня' ? hhmmMsk(t) : `${w} ${hhmmMsk(t)}`;
}

function plural30(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return `${n} тридцаток`;
  if (last === 1) return `${n} тридцатку`;
  if (last >= 2 && last <= 4) return `${n} тридцатки`;
  return `${n} тридцаток`;
}

export interface HintInput {
  /** Момент только что записанной покупки. */
  now: Date;
  /** Списания на этом телефоне за последние 24 ч, ВКЛЮЧАЯ только что записанное. */
  charges: Charge[];
  /** Результат записанной покупки. */
  result: 'done' | 'support';
  /** По заказу остались позиции. */
  orderStillOpen?: boolean;
  /** День цикла: 1 — день первой покупки на телефоне. null, если неизвестен. */
  dayOfCycle?: number | null;
  /** Была ли на телефоне хоть одна боевая покупка (≥ €30). */
  hadBattle?: boolean;
}

/** Строки подсказки для сообщения после записи покупки. */
export function nextPurchaseHint(input: HintInput): string[] {
  const {
    now,
    charges,
    result,
    orderStillOpen = false,
    dayOfCycle = null,
    hadBattle = true,
  } = input;
  const lines = ['⏳ Следующая закупка на этом телефоне:'];

  // ⚠️ support — платёж отклонён, телефон жив, но нужна отлёжка ~сутки.
  // Денег не списано, поэтому про лимит говорить нечего.
  if (result === 'support') {
    const rest = new Date(now.getTime() + SUPPORT_REST_H * H);
    lines.push(`   ⚠️ платёж отклонён — отлёжка сутки, повтор с ${when(rest, now)}`);
    if (orderStillOpen) lines.push('   ↪️ Позицию заказа можно закрыть с ДРУГОГО телефона.');
    return lines;
  }

  // ---------- РАЗОГРЕВ ----------
  // Телефон на разогреве, пока не было ни одной боевой покупки и идут первые
  // WARMUP_DAYS суток. Здесь правило лимита €120 НЕ применяем: €2 + €30 в него
  // укладывается, но тридцатке на разогреве не место — это вопрос стратегии,
  // а не безопасности. Ровно на этом подсказка и ошибалась до 13.09.2026.
  if (!hadBattle && dayOfCycle != null && dayOfCycle <= WARMUP_DAYS) {
    const tomorrow = new Date(now.getTime() + 24 * H); // разогрев — одна €2 в сутки
    if (dayOfCycle < WARMUP_DAYS) {
      const battleFrom = ddmmOf(addDaysIso(mskIsoOfDate(now), WARMUP_DAYS + 1 - dayOfCycle));
      lines.push(
        `   🔥 Разогрев, день ${dayOfCycle} из ${WARMUP_DAYS} — по одной €2 в сутки`,
        `   🟢 следующая €2 — ${when(tomorrow, now)}`,
        `   📅 Боевые суммы (€100/€105) — с ${battleFrom}`,
      );
    } else {
      lines.push(
        `   🔥 Разогрев завершён — ${WARMUP_DAYS} дня по €2, как у лучших циклов`,
        `   🟢 первая боевая — ${when(tomorrow, now)}, лучше сразу €100/€105`,
        '   💡 Слот в сутках один, сотня даёт втрое больше тридцатки',
      );
    }
    if (orderStillOpen) {
      lines.push('   ↪️ Остальные позиции заказа — с ДРУГОГО телефона, не с этого.');
    }
    return lines;
  }

  const spent = spentInWindow(charges, now);
  const free = new Date(now.getTime() + CORRIDOR_MIN_H * H); // после 20 ч сумма не важна
  const n = smallsLeft(spent);

  // ---------- РАЗОГРЕВ ЗАТЯНУЛСЯ ----------
  // Боевых покупок ещё не было, а дней уже больше нормы. Каждый такой день —
  // день из четырнадцати, потраченный на €2 вместо €100. Тридцатки здесь НЕ
  // предлагаем: первая боевая покупка должна быть крупной, иначе слот уходит
  // втрое дешевле, а дней в окне и так осталось меньше.
  if (!hadBattle && dayOfCycle != null && dayOfCycle > WARMUP_DAYS) {
    const bigFitsNow = fits(spent, BIG_EUR);
    const bigAt = bigFitsNow ? null : earliestFitting(charges, BIG_EUR, now);
    lines.push(
      `   🔥 Разогрев идёт ${dayOfCycle}-й день вместо ${WARMUP_DAYS} — пора на €100/€105`,
      bigFitsNow
        ? `   🟢 крупную можно прямо сейчас (за 24 ч: €${spent} из €${DANGER_EUR})`
        : `   🟢 крупную — с ${when(bigAt ?? free, now)}`,
    );
    if (orderStillOpen) {
      lines.push('   ↪️ Остальные позиции заказа — с ДРУГОГО телефона, не с этого.');
    }
    return lines;
  }

  if (n > 0) {
    lines.push(`   💚 можно ещё ${plural30(n)} (за 24 ч: €${spent} из €${DANGER_EUR})`);
  } else {
    const small = earliestFitting(charges, SMALL_EUR, now);
    // Если тридцатка влезет раньше 20-часовой отметки — называем этот час:
    // окно освободится, когда из него выпадет самое старое списание.
    const earlier = small && small.getTime() < free.getTime();
    lines.push(
      earlier
        ? `   ⛔️ лимит 24 ч выбран (€${spent} из €${DANGER_EUR}) — тридцатка с ${when(small, now)}`
        : `   ⛔️ лимит 24 ч выбран (€${spent} из €${DANGER_EUR})`,
    );
  }
  lines.push(`   🟢 без ограничений с ${when(free, now)} — тогда можно и крупную`);

  // Конец цикла: бюджет выводится на 14-й день. Громкий блок есть в сводке
  // группы, но здесь он попадает оператору прямо в момент работы с телефоном.
  if (dayOfCycle != null && dayOfCycle >= WITHDRAW_DAYS) {
    lines.push(`   🔴 День ${dayOfCycle} из ${WITHDRAW_DAYS} — ПОРА ВЫВОДИТЬ бюджет`);
  } else if (dayOfCycle != null && dayOfCycle >= WARN_FROM_DAY) {
    lines.push(
      `   📅 День ${dayOfCycle} из ${WITHDRAW_DAYS} — вывод бюджета через ` +
        `${WITHDRAW_DAYS - dayOfCycle} дн, слоты не тратить зря`,
    );
  }

  if (orderStillOpen) {
    lines.push('   ↪️ Остальные позиции заказа — с ДРУГОГО телефона, не с этого.');
  }
  return lines;
}
