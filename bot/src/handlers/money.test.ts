import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAID, paidEur, paidUnits } from './money.js';

// Деньги и голоса — только по ✅. До 07.10.2026 «💵 Потрачено» в /stats
// суммировало все попытки и показывало €13 676 вместо списанных €12 870.

test('деньги списаны только у ✅', () => {
  assert.equal(paidEur({ amount: '100.00', result: 'done' }), 100);
  assert.equal(paidEur({ amount: '100.00', result: 'support' }), 0, 'платёж отклонён');
  assert.equal(paidEur({ amount: '100.00', result: 'long' }), 0, 'waiver вместо списания');
  assert.equal(paidEur({ amount: '30.00', result: 'verify' }), 0, 'покупка не завершена');
});

test('голоса ВК пришли только по ✅', () => {
  assert.equal(paidUnits({ units: 40, result: 'done' }), 40);
  assert.equal(paidUnits({ units: 40, result: 'support' }), 0);
  assert.equal(paidUnits({ units: null, result: 'done' }), 0);
});

test('ровно один результат списывает деньги', () => {
  // Если когда-нибудь появится второй — это осознанное решение, а не случайность.
  assert.deepEqual(
    Object.entries(PAID).filter(([, v]) => v).map(([k]) => k),
    ['done'],
  );
});

test('реальный случай: убившая попытка не входит в «€ до смерти»', () => {
  // …9445: €2 + €2 + €30 ✅, затем €30 💀 → списано €34, а не €64.
  const rows = [
    { amount: 2, result: 'done' as const },
    { amount: 2, result: 'done' as const },
    { amount: 30, result: 'done' as const },
    { amount: 30, result: 'long' as const },
  ];
  assert.equal(rows.reduce((a, p) => a + paidEur(p), 0), 34);
});
