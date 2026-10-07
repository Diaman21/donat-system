import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, fmtRate, kaplanMeier, survivalAt, atRiskAt, type Subject } from './stats-math.js';

// ---------- интервал Уилсона ----------

test('wilson: 8 из 19 (опасная клетка 07.10) — примерно 23–64%', () => {
  const { lo, hi } = wilson(8, 19);
  assert.equal(Math.round(lo), 23);
  assert.equal(Math.round(hi), 64);
});

test('wilson: 0 из 5 — это НЕ «безопасно», верх около 43%', () => {
  // Ровно случай отпуска: 5 нарушений опасной клетки, ни одной смерти.
  const { lo, hi } = wilson(0, 5);
  assert.equal(lo, 0);
  assert.ok(hi > 40 && hi < 46, `верх ${hi}`);
});

test('wilson: на краях не уходит за 0 и 100', () => {
  assert.equal(wilson(5, 5).hi, 100);
  assert.ok(wilson(5, 5).lo > 50);
  assert.equal(wilson(0, 0).lo, 0);
  assert.equal(wilson(0, 0).hi, 100);
});

test('wilson: больше наблюдений — уже диапазон', () => {
  const small = wilson(3, 10);
  const big = wilson(30, 100);
  assert.ok(big.hi - big.lo < small.hi - small.lo);
});

test('fmtRate: формат и пустая выборка', () => {
  assert.equal(fmtRate(8, 19), '42% (23–64%)');
  assert.equal(fmtRate(0, 0), '—');
});

// ---------- Каплан–Мейер ----------

test('kaplanMeier: без цензуры совпадает с простой долей', () => {
  // 4 телефона, двое умерли на 3-й и 5-й день, двое дожили до 14.
  const s: Subject[] = [
    { days: 3, died: true },
    { days: 5, died: true },
    { days: 14, died: false },
    { days: 14, died: false },
  ];
  const km = kaplanMeier(s);
  assert.equal(survivalAt(km, 2), 1);
  assert.equal(survivalAt(km, 3), 0.75);
  assert.equal(survivalAt(km, 13), 0.5);
});

test('kaplanMeier: выведенный живым НЕ считается ни смертью, ни выжившим до конца', () => {
  // Двое выведены на 2-й день живыми, третий умер на 10-й.
  // Простая доля сказала бы «1 из 3 умер» (33%). Но после 2-го дня под
  // наблюдением остался один телефон — и он умер: выживаемость к 10-му = 0.
  const s: Subject[] = [
    { days: 2, died: false },
    { days: 2, died: false },
    { days: 10, died: true },
  ];
  const km = kaplanMeier(s);
  assert.equal(survivalAt(km, 9), 1);
  assert.equal(survivalAt(km, 10), 0);
  assert.equal(atRiskAt(s, 10), 1, 'и честно видно: под наблюдением всего один');
});

test('kaplanMeier: в день выбытия цензурированный ещё под риском', () => {
  const s: Subject[] = [
    { days: 5, died: true },
    { days: 5, died: false },
  ];
  // На 5-й день под риском двое, умер один → 0.5.
  assert.equal(survivalAt(kaplanMeier(s), 5), 0.5);
});

test('kaplanMeier: смертей нет — кривая пустая, выживаемость 1', () => {
  const km = kaplanMeier([{ days: 14, died: false }]);
  assert.deepEqual(km, []);
  assert.equal(survivalAt(km, 14), 1);
});

test('kaplanMeier: выживаемость не растёт со временем', () => {
  const s: Subject[] = Array.from({ length: 30 }, (_, i) => ({ days: (i % 14) + 1, died: i % 3 === 0 }));
  const km = kaplanMeier(s);
  for (let i = 1; i < km.length; i++) assert.ok(km[i]!.surv <= km[i - 1]!.surv);
});
