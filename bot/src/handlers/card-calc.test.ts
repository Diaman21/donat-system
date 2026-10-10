import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCard,
  resolveRefund,
  parseEur,
  fmtEur,
  cardLines,
  pickWithdrawCandidate,
  CARD_LOW_EUR,
  REFUND_DELAY_H,
  type RefundInput,
} from './card-calc.js';

const H = 3600 * 1000;
const T0 = new Date('2026-10-10T09:00:00Z'); // 12:00 МСК
const at = (h: number) => new Date(T0.getTime() + h * H);

const phone = (over: Partial<RefundInput> = {}): RefundInput => ({
  phoneId: 'p1',
  imei: '1234',
  label: null,
  diedAt: at(-10),
  paid: 340,
  override: null,
  ...over,
});

test('сумма руками: разные записи числа', () => {
  assert.equal(parseEur('1240'), 1240);
  assert.equal(parseEur('1 240,50'), 1240.5);
  assert.equal(parseEur('€1240.5'), 1240.5);
  assert.equal(parseEur('0'), 0);
  assert.equal(parseEur('-5'), null);
  assert.equal(parseEur('12.345'), null);
  assert.equal(parseEur('много'), null);
  assert.equal(parseEur(''), null);
});

test('формат евро: без лишних копеек', () => {
  assert.equal(fmtEur(1240), '€1240');
  assert.equal(fmtEur(1240.5), '€1240.50');
  assert.equal(fmtEur(0.1 + 0.2), '€0.30');
});

test('возврат по умолчанию: все ✅ телефона через 48 ч после вывода', () => {
  const r = resolveRefund(phone());
  assert.equal(r.amount, 340);
  assert.equal(r.at.getTime(), at(-10).getTime() + REFUND_DELAY_H * H);
  assert.equal(r.edited, false);
});

test('поправка возврата действует, старая (от прошлой жизни телефона) — нет', () => {
  const fresh = resolveRefund(phone({ override: { amount: 338, at: at(-5) } }));
  assert.equal(fresh.amount, 338);
  assert.equal(fresh.edited, true);
  // Поправка раньше вывода — телефон «воскресили» и он умер снова.
  const stale = resolveRefund(phone({ override: { amount: 0, at: at(-20) } }));
  assert.equal(stale.amount, 340);
  assert.equal(stale.edited, false);
});

test('баланс: сумма не вписана — баланса нет, но возвраты в пути видны', () => {
  const st = computeCard(null, [], [phone()], T0);
  assert.equal(st.balance, null);
  assert.equal(st.afterRefunds, null);
  assert.equal(st.transitSum, 340);
  assert.match(cardLines(st, null, { full: false }).join('\n'), /не задана/);
});

test('баланс: вычитаются только ✅, ⚠️/💀/🔐 денег не списывают', () => {
  const anchor = { amount: 1000, at: at(-30) };
  const st = computeCard(
    anchor,
    [
      { amount: '100.00', result: 'done' },
      { amount: '30.00', result: 'done' },
      { amount: '100.00', result: 'support' },
      { amount: '100.00', result: 'long' },
      { amount: '100.00', result: 'verify' },
    ],
    [],
    T0,
  );
  assert.equal(st.spent, 130);
  assert.equal(st.balance, 870);
});

test('возврат: в пути до срока, в балансе после — и только если пришёл после вписанной суммы', () => {
  const anchor = { amount: 500, at: at(-20) };
  // Выведен 10 ч назад → придёт через 38 ч: в пути.
  const inTransit = computeCard(anchor, [], [phone()], T0);
  assert.equal(inTransit.balance, 500);
  assert.equal(inTransit.transitSum, 340);
  assert.equal(inTransit.afterRefunds, 840);
  // Через 40 ч срок прошёл — возврат в балансе, в пути пусто.
  const later = computeCard(anchor, [], [phone()], at(40));
  assert.equal(later.balance, 840);
  assert.equal(later.inTransit.length, 0);
  assert.equal(later.creditedList.length, 1);
  // Вписали сумму ПОСЛЕ срока возврата — он уже в ней, второй раз не прибавляем.
  const after = computeCard({ amount: 840, at: at(39) }, [], [phone()], at(40));
  assert.equal(after.balance, 840);
});

test('«уже на карте» при вписывании суммы: поправка за секунду до — без задвоения', () => {
  const setAt = at(0);
  const marked = phone({ override: { amount: 340, at: new Date(setAt.getTime() - 1000) } });
  // Сейчас и через трое суток баланс тот же — возврат не прибавился.
  assert.equal(computeCard({ amount: 840, at: setAt }, [], [marked], at(1)).balance, 840);
  assert.equal(computeCard({ amount: 840, at: setAt }, [], [marked], at(72)).balance, 840);
});

test('поправка суммы возврата: пришло меньше — в баланс идёт поправленное', () => {
  const anchor = { amount: 500, at: at(-20) };
  const p = phone({ override: { amount: 338, at: at(38) } });
  assert.equal(computeCard(anchor, [], [p], at(40)).balance, 838);
  // Ноль — не показываем в пути.
  const zero = phone({ override: { amount: 0, at: at(38) } });
  assert.equal(computeCard(anchor, [], [zero], T0).inTransit.length, 0);
});

test('порог: красный только когда не спасают и возвраты в пути', () => {
  const low = computeCard({ amount: 200, at: at(-1) }, [], [], T0);
  const cand = { imei: '5678', label: 'Черный 13', daysPassed: 12, paid: 840 };
  const red = cardLines(low, cand, { full: false }).join('\n');
  assert.match(red, /🔴/);
  assert.match(red, /…5678/);
  const covered = computeCard({ amount: 200, at: at(-1) }, [], [phone()], T0);
  const yellow = cardLines(covered, cand, { full: false }).join('\n');
  assert.match(yellow, /🟡/);
  assert.doesNotMatch(yellow, /Кандидат/);
  const ok = computeCard({ amount: CARD_LOW_EUR, at: at(-1) }, [], [], T0);
  assert.doesNotMatch(cardLines(ok, cand, { full: false }).join('\n'), /🔴|🟡/);
});

test('кандидат на выкат: дальше всех по циклу, телефоны без ✅ не предлагаем', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  const c = pickWithdrawCandidate(
    [
      { imei: '1111', label: null, firstAt: new Date('2026-10-05T09:00:00Z'), paid: 300 },
      { imei: '2222', label: null, firstAt: new Date('2026-09-28T09:00:00Z'), paid: 900 },
      { imei: '3333', label: null, firstAt: new Date('2026-09-20T09:00:00Z'), paid: 0 },
      { imei: '4444', label: null, firstAt: null, paid: 0 },
    ],
    now,
  );
  assert.equal(c?.imei, '2222');
  assert.equal(c?.daysPassed, 12);
  assert.equal(pickWithdrawCandidate([], now), null);
});
