import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, RULES } from './zones.js';
import { classifyPurchase } from './anomaly.js';

// Зоны и правила — одно определение на всю систему. Тесты сторожат, что они
// согласованы с классификатором отклонений, который видит оператор.

const a = (gap: number, spent: number, amt: number) => ({ gap, spent, amt });
const zoneOf = (x: ReturnType<typeof a>) => ZONES.filter((z) => z.test(x)).map((z) => z.key);

test('зоны не пересекаются', () => {
  for (const gap of [0.5, 3, 9.9, 10, 13.9, 14, 19.9, 20, 30, 100])
    for (const spent of [0, 30, 60, 90, 100, 105])
      for (const amt of [2, 30, 100]) {
        const z = zoneOf(a(gap, spent, amt));
        assert.ok(z.length <= 1, `gap ${gap} €${spent}+${amt}: ${z.join(',')}`);
      }
});

test('зоны: граничные точки', () => {
  assert.deepEqual(zoneOf(a(9.9, 30, 30)), ['gap-lt-10']);
  assert.deepEqual(zoneOf(a(10, 30, 30)), ['gap-10-14']);
  assert.deepEqual(zoneOf(a(14, 30, 30)), ['gap-14-20']);
  assert.deepEqual(zoneOf(a(20, 30, 30)), [], 'протокол соблюдён — не зона');
  assert.deepEqual(zoneOf(a(24, 100, 100)), ['money-over']);
  assert.deepEqual(zoneOf(a(5, 100, 30)), [], 'опасная клетка — не зона наблюдений');
});

test('правило «деньги» нарушается ровно там, где классификатор говорит «опасная клетка»', () => {
  const money = RULES.find((r) => r.key === 'money')!;
  for (const gap of [3, 19.9, 20, 30])
    for (const spent of [0, 30, 90, 100]) {
      const x = a(gap, spent, 30);
      const cls = classifyPurchase({
        amount: 30, result: 'done', gapH: gap, spent24: spent, dayOfCycle: 5,
        hadBattleBefore: true, internet: 'wifi', isPro: true, isTank: true,
      });
      assert.equal(money.violates(x, true), cls.some((c) => c.text.includes('опасная клетка')), `gap ${gap} €${spent}`);
    }
});

test('правило «пол не-Pro» совпадает с 🔴 классификатора', () => {
  const floor = RULES.find((r) => r.key === 'floor')!;
  assert.equal(floor.violates(a(3.2, 30, 30), false), true);
  assert.equal(floor.violates(a(3.2, 30, 30), true), false, 'Pro пола не имеют');
  assert.equal(floor.violates(a(10, 30, 30), false), false);
});

test('даты фиксации правил — ISO и по порядку', () => {
  for (const r of RULES) assert.match(r.since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(RULES[0]!.since < RULES[1]!.since);
});
