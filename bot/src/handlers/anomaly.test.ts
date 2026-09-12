import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPurchase,
  anomalyLines,
  assessZone,
  EVIDENCE_ENOUGH,
  type PurchaseFacts,
} from './anomaly.js';

// Тесты классификации аномалий.
//
// Главное, что здесь сторожится, — РАЗНИЦА МЕЖДУ danger И observation.
// «интервал 16 ч при €60» безобиден и полезен для знания, «сотня поверх сотни
// через 3 часа» убивает в 57% случаев. Если их пометить одинаково, оператор
// перестанет читать оба — и алерт станет вреднее, чем его отсутствие.

const base: PurchaseFacts = {
  amount: 30,
  result: 'done',
  gapH: 24,
  spent24: 0,
  dayOfCycle: 5,
  hadBattleBefore: true,
  internet: 'wifi',
  isTank: true,
};
const f = (over: Partial<PurchaseFacts>): PurchaseFacts => ({ ...base, ...over });

// ---------- ничего не происходит ----------

test('покупка по протоколу — отклонений нет', () => {
  assert.deepEqual(classifyPurchase(base), []);
  assert.deepEqual(anomalyLines([]), []);
});

test('ВК не проверяем — там другая методика', () => {
  // Для ВК серии покупок подряд это норма, а не аномалия.
  assert.deepEqual(classifyPurchase(f({ isTank: false, gapH: 0.1, spent24: 200 })), []);
});

// ---------- интервал и деньги ----------

test('опасная клетка помечается как danger', () => {
  const a = classifyPurchase(f({ gapH: 3, amount: 30, spent24: 100 }));
  assert.equal(a.length, 1);
  assert.equal(a[0]?.severity, 'danger');
  assert.ok(a[0]?.text.includes('€130'));
  assert.ok(a[0]?.text.includes('опасная клетка'));
  // ⚠️ Точную статистику в тексте НЕ проверяем и не пишем: она меняется
  // с каждой покупкой. «8 из 13» разошлось с данными за сутки — теперь
  // формулировка устойчива к дрейфу, а точные цифры считает /corridor.
  assert.ok(!/\d+ смерт\S* на \d+/.test(a[0]?.text ?? ''), 'зашитых чисел быть не должно');
  assert.equal(a[0]?.learn, undefined, 'у опасного нет «полезного знания»');
});

test('короткий интервал при малых деньгах — это observation, а не danger', () => {
  const a = classifyPurchase(f({ gapH: 16, amount: 30, spent24: 30 }));
  assert.equal(a.length, 1);
  assert.equal(a[0]?.severity, 'observation');
  assert.ok(a[0]?.text.includes('16.0 ч'));
  assert.ok(a[0]?.text.includes('€60'));
  assert.ok(a[0]?.learn?.includes('сдвинуть границу'));
});

test('граница 20 ч: ровно 20 — уже норма', () => {
  assert.deepEqual(classifyPurchase(f({ gapH: 20 })), []);
  assert.equal(classifyPurchase(f({ gapH: 19.9 })).length, 1);
});

test('первая покупка телефона интервалом не проверяется', () => {
  assert.deepEqual(classifyPurchase(f({ gapH: null, dayOfCycle: 1, amount: 2 })), []);
});

// ---------- фазы цикла ----------

test('боевая покупка на разогреве — danger (4 смерти из 5)', () => {
  const a = classifyPurchase(f({ amount: 100, dayOfCycle: 2, hadBattleBefore: false }));
  assert.ok(a.some((x) => x.severity === 'danger' && x.text.includes('2-й день')));
});

test('на 3-й день боевая уже норма', () => {
  const a = classifyPurchase(f({ amount: 100, dayOfCycle: 3, hadBattleBefore: false }));
  assert.ok(!a.some((x) => x.text.includes('разогрев')));
});

test('затянувшийся разогрев — note', () => {
  const a = classifyPurchase(f({ amount: 2, dayOfCycle: 5, hadBattleBefore: false }));
  assert.equal(a.length, 1);
  assert.equal(a[0]?.severity, 'note');
  assert.ok(a[0]?.text.includes('5-й день'));
});

test('работа после 14-го дня — note', () => {
  const a = classifyPurchase(f({ dayOfCycle: 16 }));
  assert.ok(a.some((x) => x.severity === 'note' && x.text.includes('просрочен')));
});

// ---------- интернет ----------

test('крупная через мобильный — observation', () => {
  const a = classifyPurchase(f({ amount: 100, internet: 'mobile' }));
  assert.ok(a.some((x) => x.severity === 'observation' && x.text.includes('мобильный')));
});

test('тридцатка через мобильный вопросов не вызывает', () => {
  assert.deepEqual(classifyPurchase(f({ amount: 30, internet: 'mobile' })), []);
});

// ---------- несколько сразу ----------

test('отклонения складываются и не затирают друг друга', () => {
  const a = classifyPurchase(
    f({ amount: 100, gapH: 2, spent24: 100, internet: 'mobile', dayOfCycle: 16 }),
  );
  assert.ok(a.length >= 3, `ожидали минимум 3 отклонения, получили ${a.length}`);
  assert.ok(a.some((x) => x.severity === 'danger'));
  assert.ok(a.some((x) => x.severity === 'note'));
});

// ---------- вывод ----------

test('anomalyLines: у observation есть строка «чем полезно»', () => {
  const lines = anomalyLines(classifyPurchase(f({ gapH: 16, spent24: 30 })));
  assert.equal(lines[0], '📋 Отклонение от протокола:');
  assert.ok(lines[1]?.startsWith('   🟡'));
  assert.ok(lines[2]?.includes('сдвинуть границу'));
});

test('anomalyLines: у danger знак другой', () => {
  const lines = anomalyLines(classifyPurchase(f({ gapH: 3, spent24: 100 })));
  assert.ok(lines[1]?.startsWith('   🔴'));
});

// ---------- накопление доказательств ----------

test('assessZone: смерти в зоне — границу не двигаем', () => {
  const z = assessZone(20, 2);
  assert.equal(z.enough, false);
  assert.equal(z.upperRiskPct, null);
  assert.ok(z.verdict.includes('не двигается'));
});

test('assessZone: правило трёх считает верхнюю оценку риска', () => {
  // 15 наблюдений без смертей → риск не выше 20%.
  const z = assessZone(15, 0);
  assert.equal(Math.round(z.upperRiskPct!), 20);
  assert.equal(z.enough, false);
  assert.ok(z.verdict.includes('нужно 15 ещё'));
});

test('assessZone: на пороге достаточности зовёт обсудить', () => {
  const z = assessZone(EVIDENCE_ENOUGH, 0);
  assert.equal(z.enough, true);
  assert.ok(z.verdict.includes('ПОРА ОБСУДИТЬ'));
  assert.equal(Math.round(z.upperRiskPct!), 10);
});

test('assessZone: пустая зона', () => {
  const z = assessZone(0, 0);
  assert.equal(z.enough, false);
  assert.ok(z.verdict.includes('наблюдений нет'));
});

// Инвариант: чем больше чистых наблюдений, тем ниже верхняя оценка риска.
test('assessZone: оценка риска монотонно падает с ростом выборки', () => {
  let prev = Infinity;
  for (const n of [5, 10, 20, 30, 60, 100]) {
    const z = assessZone(n, 0);
    assert.ok(z.upperRiskPct! < prev, `на n=${n} оценка не уменьшилась`);
    prev = z.upperRiskPct!;
  }
});
