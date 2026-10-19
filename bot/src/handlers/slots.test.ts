import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneSlot, slotsToNotify, inWorkHours, type PhoneInput } from './slots.js';
import { slotOpensAt } from './interval.js';

const H = 3600 * 1000;
// 19.10.2026 15:00 МСК
const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * H);

const phone = (over: Partial<PhoneInput> = {}): PhoneInput => ({
  id: 'p1',
  imei: '5986',
  label: 'Черный 13 про',
  isPro: true,
  firstAt: new Date('2026-10-11T11:00:00Z'), // день 9
  last: { id: 'buy-1', at: ago(5), result: 'done' },
  charges: [{ at: ago(5), amount: 100 }],
  ...over,
});

test('slotOpensAt: после €100 и €100, и €30 — через 20 ч (окно доходит до €120)', () => {
  const last = { at: ago(5), result: 'done' as const };
  const charges = [{ at: ago(5), amount: 100 }];
  assert.equal(slotOpensAt(last, charges, 100, true).getTime(), ago(5).getTime() + 20 * H);
  assert.equal(slotOpensAt(last, charges, 30, true).getTime() - ago(5).getTime(), 20 * H); // €130 ≥ €120
  // После €2 тридцатка влезает сразу; у не-Pro — не раньше 10 ч.
  const warm = [{ at: ago(1), amount: 2 }];
  const l2 = { at: ago(1), result: 'done' as const };
  assert.equal(slotOpensAt(l2, warm, 30, true).getTime(), ago(1).getTime());
  assert.equal(slotOpensAt(l2, warm, 30, false).getTime(), ago(1).getTime() + 10 * H);
});

test('slotOpensAt: после ⚠️ — отлёжка сутки, даже если по деньгам можно', () => {
  const last = { at: ago(2), result: 'support' as const };
  assert.equal(slotOpensAt(last, [], 30, true).getTime(), ago(2).getTime() + 24 * H);
});

test('phoneSlot: фазы — без покупок, разогрев, боевые, пора выводить', () => {
  assert.equal(phoneSlot(phone({ firstAt: null, last: null }), NOW).phase, 'fresh');
  const warm = phoneSlot(phone({ firstAt: new Date('2026-10-18T09:00:00Z') }), NOW);
  assert.deepEqual([warm.phase, warm.day, warm.bigAt], ['warmup', 2, null]);
  const battle = phoneSlot(phone(), NOW);
  assert.equal(battle.phase, 'battle');
  assert.equal(battle.day, 9);
  assert.equal(battle.bigAt?.getTime(), ago(5).getTime() + 20 * H);
  // Первая покупка 05.10 → 19.10 прошло 14 суток: выводить, слотов нет.
  const due = phoneSlot(phone({ firstAt: new Date('2026-10-05T09:00:00Z') }), NOW);
  assert.deepEqual([due.phase, due.bigAt], ['due', null]);
});

test('slotsToNotify: только открытый слот боевого телефона и один раз на покупку', () => {
  const open = phone({ id: 'a', last: { id: 'x', at: ago(21), result: 'done' }, charges: [{ at: ago(21), amount: 100 }] });
  const closed = phone({ id: 'b' }); // €100 5 ч назад — слот ещё закрыт
  const warm = phone({ id: 'c', firstAt: new Date('2026-10-19T06:00:00Z'), last: { id: 'y', at: ago(6), result: 'done' } });
  const due = phone({ id: 'd', firstAt: new Date('2026-10-01T09:00:00Z'), last: { id: 'z', at: ago(30), result: 'done' } });
  const ids = (n: Record<string, string>) => slotsToNotify([open, closed, warm, due], n, NOW).map((s) => s.phone.id);
  assert.deepEqual(ids({}), ['a']);
  assert.deepEqual(ids({ a: 'x' }), []); // уже напомнили по этой покупке
  assert.deepEqual(ids({ a: 'старая' }), ['a']); // была новая покупка — новый слот
});

test('рабочие часы: с 09:00 до 24:00 МСК', () => {
  assert.equal(inWorkHours(new Date('2026-10-19T05:59:00Z')), false); // 08:59 МСК
  assert.equal(inWorkHours(new Date('2026-10-19T06:00:00Z')), true); // 09:00
  assert.equal(inWorkHours(new Date('2026-10-19T20:59:00Z')), true); // 23:59
  assert.equal(inWorkHours(new Date('2026-10-19T21:00:00Z')), false); // 00:00
});
