// Распознавание состава заказа из свободного текста.
//
// Тексты пишут разные люди, с опечатками и без пробелов («Орден+ Банки»,
// «Фурио», «Масив»), поэтому распознавание — это ПОДСКАЗКА, а не истина:
// оператор подтверждает или правит количество кнопками. Слепо доверять нельзя —
// ошибка либо закроет заказ раньше времени, либо подвесит его навсегда.
//
// Прайс (со слов оператора, 11.09.2026):
//   Furious: орден €30 · банки €30 · прем год €105
//   Massive: ВСЕ позиции по €100 («вип год», «1650 золота» — одна цена)
//
// ⚠️ ОДИН ЗАКАЗ — ВСЕГДА ОДНА ИГРА (подтверждено оператором 11.09.2026).
// Смешанных заказов не бывает. Поэтому сначала определяем игру (по слову
// «Фурио»/«Масив» в шапке, иначе по первой распознанной позиции), а потом
// считаем ТОЛЬКО позиции этой игры. Это защищает от ложных срабатываний:
// слово «золото» внутри ника в Furious-заказе не добавит лишнюю закупку.

export type Game = 'Massive' | 'Furious';

export interface OrderItem {
  label: string;
  amount: number;
  game: Game;
}
export interface OrderPlan {
  list: OrderItem[];
  total: number; // сколько закупок нужно
  hintGame: Game | null; // игра из шапки заказа (если позиции не распознались)
}

const GAME_HINT: { re: RegExp; game: Game }[] = [
  { re: /фурио|furious/i, game: 'Furious' },
  { re: /мас+ив|massive/i, game: 'Massive' }, // «Масив» и «Массив»
];

// Названия позиций различимы между играми, поэтому ищем все сразу.
// Порядок важен: более специфичные раньше («прем год» до «орден» не пересекаются,
// но «вип год» должен проверяться отдельно от «прем год»).
const VOCAB: { re: RegExp; label: string; amount: number; game: Game }[] = [
  { re: /прем\S*\s*год|премиум\s*год/gi, label: 'прем год', amount: 105, game: 'Furious' },
  { re: /вип\s*год|vip\s*год/gi, label: 'вип год', amount: 100, game: 'Massive' },
  { re: /орден/gi, label: 'орден', amount: 30, game: 'Furious' },
  { re: /банк\S*/gi, label: 'банки', amount: 30, game: 'Furious' },
  { re: /золот\S*/gi, label: 'золото', amount: 100, game: 'Massive' },
];

export function parseOrder(text: string): OrderPlan {
  const hintGame = GAME_HINT.find((g) => g.re.test(text))?.game ?? null;

  // Собираем ВСЕ совпадения с позицией в тексте, чтобы показать позиции в том же
  // порядке, в каком их написал заказчик — оператору так проще сверять.
  const found: (OrderItem & { at: number })[] = [];
  for (const it of VOCAB) {
    // Считаем КАЖДОЕ вхождение: «Орден + Орден» = две закупки.
    for (const m of text.matchAll(it.re)) {
      found.push({ label: it.label, amount: it.amount, game: it.game, at: m.index ?? 0 });
    }
  }
  found.sort((a, b) => a.at - b.at);

  // Заказ всегда в одной игре: берём её из шапки, иначе — из первой позиции,
  // и отбрасываем совпадения чужой игры как ложные.
  const game = hintGame ?? found[0]?.game ?? null;
  const list: OrderItem[] = found
    .filter((f) => f.game === game)
    .map(({ label, amount, game: g }) => ({ label, amount, game: g }));

  return { list, total: list.length, hintGame: game };
}

// «1 закупка · 2 закупки · 5 закупок»
export function plural(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return `${n} закупок`;
  if (last === 1) return `${n} закупка`;
  if (last >= 2 && last <= 4) return `${n} закупки`;
  return `${n} закупок`;
}

// Сколько закупок нужно по заказу (из items.total; по умолчанию 1).
// items приходит из jsonb-колонки, поэтому тип unknown и проверки по месту.
export function plannedTotal(items: unknown): number {
  const t = (items as { total?: number } | null)?.total;
  return typeof t === 'number' && t > 0 ? t : 1;
}

// Что ещё не куплено по заказу — для подсказки «осталось…».
export function remainingLabels(items: unknown, doneCount: number): string {
  const list = (items as { list?: { label: string; amount: number }[] } | null)?.list;
  if (!Array.isArray(list) || list.length === 0) return '';
  const left = list.slice(doneCount);
  return left.length ? left.map((i) => `${i.label} €${i.amount}`).join(' + ') : '';
}

// Человекочитаемый разбор для экрана подтверждения.
export function describePlan(p: OrderPlan): string[] {
  if (p.list.length === 0) {
    return [
      p.hintGame ? `🎮 ${p.hintGame}` : '❓ Игру распознать не удалось',
      '❓ Позиции не распознаны — укажи количество закупок кнопкой.',
    ];
  }
  const sum = p.list.reduce((a, i) => a + i.amount, 0);
  return [
    `🎮 ${p.list[0]!.game}`,
    ...p.list.map((i, n) => `  ${n + 1}. ${i.label} — €${i.amount}`),
    `Итого: ${p.list.length} ${p.list.length === 1 ? 'закупка' : 'закупки'} на €${sum}`,
  ];
}
