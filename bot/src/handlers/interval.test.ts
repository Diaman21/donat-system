import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DANGER_EUR,
  CORRIDOR_MIN_H,
  SMALL_EUR,
  spentInWindow,
  fits,
  smallsLeft,
  earliestFitting,
  dayWord,
  nextPurchaseHint,
  type Charge,
} from './interval.js';

// Тесты подсказки «когда можно следующую закупку».
//
// Модель взята из расклада по 197 танковым попыткам (12.09.2026):
//   интервал ≥ 20 ч          → сумма не важна (16 попыток выше порога, 0 💀)
//   интервал < 20 ч          → можно, пока сумма за 24 ч < €120
// Контрольные точки ниже — РЕАЛЬНЫЕ случаи из базы, и подсказка обязана
// сходиться с тем, чем они закончились.
//
// Все времена в UTC явно; МСК = UTC+3.

const at = (iso: string) => new Date(iso);
const ch = (iso: string, amount: number): Charge => ({ at: at(iso), amount });

// ---------- пороги ----------

test('пороги соответствуют раскладу из данных', () => {
  assert.equal(DANGER_EUR, 120); // первая наблюдаемая смерть по деньгам
  assert.equal(CORRIDOR_MIN_H, 20); // дальше сумма перестаёт значить
  assert.equal(SMALL_EUR, 30);
});

// ---------- сумма за окно ----------

test('spentInWindow: считает только последние 24 часа', () => {
  const charges = [
    ch('2026-09-10T08:00:00.000Z', 100), // выпало из окна
    ch('2026-09-11T09:00:00.000Z', 30),
    ch('2026-09-11T15:00:00.000Z', 30),
  ];
  assert.equal(spentInWindow(charges, at('2026-09-11T16:00:00.000Z')), 60);
});

test('spentInWindow: граница окна ровно 24 часа', () => {
  const charges = [ch('2026-09-10T12:00:00.000Z', 100)];
  // Ровно через 24 ч покупка уже НЕ в окне.
  assert.equal(spentInWindow(charges, at('2026-09-11T12:00:00.000Z')), 0);
  assert.equal(spentInWindow(charges, at('2026-09-11T11:59:00.000Z')), 100);
});

// ---------- влезает / не влезает ----------

test('fits: €120 — уже опасно, а не «можно»', () => {
  assert.equal(fits(90, 30), false, '€90 + €30 = €120 — это смерть …3685');
  assert.equal(fits(60, 30), true); // €90 — 9 случаев, 0 смертей
  assert.equal(fits(100, 30), false); // €130 — 4 смерти
  assert.equal(fits(105, 30), false); // €135 — смерть …3294
  assert.equal(fits(0, 105), true);
  assert.equal(fits(30, 100), false, '€130 при коротком интервале — 4 смерти');
});

test('smallsLeft: три тридцатки подряд можно, четвёртую нельзя', () => {
  assert.equal(smallsLeft(0), 3); // 3×€30 = €90 — проверено 9 раз
  assert.equal(smallsLeft(30), 2);
  assert.equal(smallsLeft(60), 1);
  assert.equal(smallsLeft(90), 0); // четвёртая дала бы €120
  assert.equal(smallsLeft(100), 0);
  assert.equal(smallsLeft(105), 0);
});

// ---------- когда освободится лимит ----------

test('earliestFitting: ждём, пока старое списание выпадет из окна', () => {
  // Три тридцатки: 09:00, 12:00, 15:00. Лимит выбран (€90).
  const charges = [
    ch('2026-09-11T09:00:00.000Z', 30),
    ch('2026-09-11T12:00:00.000Z', 30),
    ch('2026-09-11T15:00:00.000Z', 30),
  ];
  const t = earliestFitting(charges, 30, at('2026-09-11T15:00:00.000Z'));
  // Первая выпадает в 09:00 следующего дня → в окне остаётся €60, €30 влезает.
  assert.equal(t?.toISOString(), '2026-09-12T09:00:00.000Z');
});

test('earliestFitting: если место есть — «прямо сейчас»', () => {
  const charges = [ch('2026-09-11T09:00:00.000Z', 30)];
  const now = at('2026-09-11T10:00:00.000Z');
  assert.equal(earliestFitting(charges, 30, now)?.toISOString(), now.toISOString());
});

test('earliestFitting: крупная ждёт, пока окно опустеет почти полностью', () => {
  const charges = [ch('2026-09-11T09:00:00.000Z', 30)];
  const t = earliestFitting(charges, 100, at('2026-09-11T10:00:00.000Z'));
  // €30 + €100 = €130 не влезает; ждём выпадения тридцатки.
  assert.equal(t?.toISOString(), '2026-09-12T09:00:00.000Z');
});

test('earliestFitting: сумма больше лимита не влезет никогда', () => {
  assert.equal(earliestFitting([], 120, at('2026-09-11T10:00:00.000Z')), null);
});

// ---------- слова «сегодня / завтра» ----------

test('dayWord: сегодня / завтра / послезавтра / дата', () => {
  const base = at('2026-09-11T09:00:00.000Z'); // 12:00 МСК
  assert.equal(dayWord(at('2026-09-11T18:00:00.000Z'), base), 'сегодня');
  assert.equal(dayWord(at('2026-09-12T09:00:00.000Z'), base), 'завтра');
  assert.equal(dayWord(at('2026-09-13T09:00:00.000Z'), base), 'послезавтра');
  assert.equal(dayWord(at('2026-09-15T09:00:00.000Z'), base), '15.09');
});

// Ловушка: 21:30 UTC = 00:30 МСК СЛЕДУЮЩЕГО дня. Если считать день по UTC,
// слово «сегодня/завтра» ошибётся на сутки.
test('dayWord: день считается по Москве, а не по UTC', () => {
  const base = at('2026-09-11T21:30:00.000Z'); // уже 00:30 МСК 12.09
  assert.equal(dayWord(at('2026-09-11T22:00:00.000Z'), base), 'сегодня');
  assert.equal(dayWord(at('2026-09-12T22:00:00.000Z'), base), 'завтра');
});

// ---------- сообщение целиком ----------

test('после первой тридцатки: можно ещё две', () => {
  const now = at('2026-09-11T09:00:00.000Z'); // 12:00 МСК
  const lines = nextPurchaseHint({ now, charges: [ch('2026-09-11T09:00:00.000Z', 30)], result: 'done' });
  assert.equal(lines[1], '   💚 можно ещё 2 тридцатки (за 24 ч: €30 из €120)');
  // 12:00 МСК + 20 ч = 08:00 СЛЕДУЮЩЕГО дня — день обязан быть назван.
  assert.equal(lines[2], '   🟢 без ограничений с завтра 08:00 — тогда можно и крупную');
});

test('после третьей тридцатки: лимит выбран, назван час освобождения', () => {
  const charges = [
    ch('2026-09-11T09:00:00.000Z', 30),
    ch('2026-09-11T12:00:00.000Z', 30),
    ch('2026-09-11T15:00:00.000Z', 30),
  ];
  const lines = nextPurchaseHint({ now: at('2026-09-11T15:00:00.000Z'), charges, result: 'done' });
  // Первая тридцатка выпадает 12.09 в 09:00 UTC = 12:00 МСК — это раньше,
  // чем 20-часовая отметка (14:00 МСК), поэтому час назван.
  assert.equal(lines[1], '   ⛔️ лимит 24 ч выбран (€90 из €120) — тридцатка с завтра 12:00');
  assert.equal(lines[2], '   🟢 без ограничений с завтра 14:00 — тогда можно и крупную');
});

test('после сотни: на тридцатку места нет', () => {
  const now = at('2026-09-11T09:00:00.000Z');
  const lines = nextPurchaseHint({ now, charges: [ch('2026-09-11T09:00:00.000Z', 100)], result: 'done' });
  assert.ok(lines[1]?.startsWith('   ⛔️ лимит 24 ч выбран (€100 из €120)'));
  assert.ok(lines[2]?.includes('без ограничений с завтра 08:00'));
});

// КОНТРОЛЬНАЯ ТОЧКА: …3294 «Серый 12 про» — €105, затем €30 через 19.9 ч = €135 💀.
// Подсказка после €105 обязана была сказать «нельзя до 20 ч».
test('реальная смерть …3294: после €105 тридцатка не предлагается', () => {
  const now = at('2026-06-16T17:50:00.000Z');
  const lines = nextPurchaseHint({ now, charges: [ch('2026-06-16T17:50:00.000Z', 105)], result: 'done' });
  assert.ok(lines[1]?.includes('⛔️'), 'после €105 мелкую предлагать нельзя');
  assert.ok(!lines.join('\n').includes('можно ещё'));
});

// КОНТРОЛЬНАЯ ТОЧКА: …0556 — €105, затем €30 через 23.4 ч = €135, ВЫЖИЛ.
// После 20 ч сумма не важна — подсказка это и говорит.
test('реальный выживший …0556: после 20 ч ограничение снимается', () => {
  const first = ch('2026-09-07T10:15:00.000Z', 105);
  const after20h = at('2026-09-08T06:15:00.000Z'); // ровно +20 ч
  // На этот момент €105 ещё в окне, но интервал уже 20 ч — модель разрешает.
  assert.equal(spentInWindow([first], after20h), 105);
  const lines = nextPurchaseHint({ now: at('2026-09-07T10:15:00.000Z'), charges: [first], result: 'done' });
  assert.ok(lines[2]?.includes('без ограничений с завтра 09:15'));
});

test('⚠️ support: про лимит молчим, говорим про отлёжку сутки', () => {
  const now = at('2026-09-11T09:00:00.000Z'); // 12:00 МСК
  const lines = nextPurchaseHint({ now, charges: [], result: 'support' });
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '   ⚠️ платёж отклонён — отлёжка сутки, повтор с завтра 12:00');
  assert.ok(!lines.join('\n').includes('€120'), 'денег не списано — лимит ни при чём');
});

test('незакрытый заказ: просим другой телефон', () => {
  const now = at('2026-09-11T09:00:00.000Z');
  const done = nextPurchaseHint({
    now,
    charges: [ch('2026-09-11T09:00:00.000Z', 30)],
    result: 'done',
    orderStillOpen: true,
  });
  assert.ok(done.at(-1)?.includes('ДРУГОГО телефона'));
  const sup = nextPurchaseHint({ now, charges: [], result: 'support', orderStillOpen: true });
  assert.ok(sup.at(-1)?.includes('ДРУГОГО телефона'));
});

// Инвариант: подсказка никогда не должна разрешать то, что в данных убивало.
test('инвариант: предложенное количество тридцаток никогда не доводит до €120', () => {
  for (let spent = 0; spent <= 150; spent += 2) {
    const n = smallsLeft(spent);
    // Когда n = 0, ничего не предлагается — проверять нечего (лимит уже выбран).
    if (n > 0) {
      assert.ok(spent + n * SMALL_EUR < DANGER_EUR, `spent=${spent}, n=${n} — вышли за лимит`);
    }
    // И наоборот: если предложили не всё, что влезало, — это потеря денег.
    assert.ok(
      spent + (n + 1) * SMALL_EUR >= DANGER_EUR,
      `spent=${spent}: можно было предложить ещё одну`,
    );
  }
});
