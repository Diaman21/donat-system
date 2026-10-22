import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, tallyLines, kindOf, periodSpan, type Row } from './period-calc.js';
import { isLastDayOfMonthMsk } from '../format.js';

const r = (game: string | null, amount: number, result: Row['result'] = 'done', code = 'game_donate'): Row => ({
  game,
  code,
  amount: amount.toFixed(2),
  result,
});

test('вид покупки по прайсу; остальное — «прочее»', () => {
  assert.equal(kindOf(r('Furious', 30)), 'fur30');
  assert.equal(kindOf(r('Furious', 105)), 'fur105');
  assert.equal(kindOf(r('Massive', 100)), 'mas100');
  assert.equal(kindOf(r('Massive', 2)), 'warm2');
  assert.equal(kindOf(r('Furious', 100)), null); // не по прайсу — видно отдельно
  assert.equal(kindOf(r('Массив', 1.99)), null); // старая запись
  assert.equal(kindOf(r(null, 3.99, 'done', 'vk_votes')), null);
});

test('считаются только ✅: ⚠️/💀/🔐 денег не списали', () => {
  const t = tally([
    r('Massive', 100),
    r('Massive', 100, 'support'),
    r('Massive', 100, 'long'),
    r('Massive', 100, 'verify'),
    r('Furious', 30),
    r('Furious', 30),
  ]);
  assert.equal(t.kinds.mas100.n, 1);
  assert.equal(t.kinds.fur30.n, 2);
  assert.equal(t.kinds.fur30.eur, 60);
});

test('период — без разогрева; всё время — с разогревом и прочим', () => {
  const t = tally([
    r('Massive', 100),
    r('Furious', 105),
    r('Massive', 2),
    r('Massive', 2),
    r(null, 3.99, 'done', 'vk_votes'),
    r(null, 3.99, 'done', 'vk_votes'),
  ]);
  const period = tallyLines(t, false).join('\n');
  assert.doesNotMatch(period, /Разогрев/);
  assert.match(period, /Massive €100 ×1 — €100/);
  assert.match(period, /ВК ×2 — €7\.98/);
  assert.match(period, /Итого: 4 покупки · €212\.98 \(без разогрева\)/);
  const all = tallyLines(t, true).join('\n');
  assert.match(all, /Разогрев €2 ×2 — €4/);
  assert.match(all, /Итого: 6 покупок · €216\.98$/);
});

test('пустой период — нули, а не пустой экран', () => {
  const lines = tallyLines(tally([]), false);
  assert.match(lines.join('\n'), /Furious €30 ×0 — €0/);
  assert.match(lines.at(-1)!, /Итого: 0 покупок · €0/);
});

test('длительность периода: день начала — первый день', () => {
  const from = new Date('2026-09-21T00:00:00+03:00');
  assert.equal(periodSpan(from, new Date('2026-09-21T20:00:00+03:00')), 'с 21.09 (1 день)');
  assert.equal(periodSpan(from, new Date('2026-10-22T12:00:00+03:00')), 'с 21.09 (32 дня)');
});

test('последний день месяца по МСК', () => {
  assert.equal(isLastDayOfMonthMsk(new Date('2026-10-31T12:00:00+03:00')), true);
  assert.equal(isLastDayOfMonthMsk(new Date('2026-10-30T23:59:00+03:00')), false);
  // 30.09 21:30 UTC — это уже 01.10 по МСК
  assert.equal(isLastDayOfMonthMsk(new Date('2026-09-30T21:30:00Z')), false);
  assert.equal(isLastDayOfMonthMsk(new Date('2026-09-30T20:30:00Z')), true);
  assert.equal(isLastDayOfMonthMsk(new Date('2028-02-29T12:00:00+03:00')), true); // високосный
});
