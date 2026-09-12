import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMondayMsk } from './weekly.js';

// Тесты на определение понедельника по МСК.
//
// Зачем: от этой функции зависит, выйдет недельный итог или нет. Ошибка тихая —
// блок просто не появится (или появится не в тот день), и заметить это можно
// только через неделю. Ловушка та же, что и с «сегодня/завтра»: поздний вечер
// воскресенья по UTC — это уже понедельник по Москве.

const at = (iso: string) => new Date(iso);

test('понедельник по МСК в течение дня', () => {
  // 07.09.2026 — понедельник.
  assert.equal(isMondayMsk(at('2026-09-07T06:00:00.000Z')), true); // 09:00 МСК
  assert.equal(isMondayMsk(at('2026-09-07T09:00:00.000Z')), true); // 12:00 МСК — время сводки
  assert.equal(isMondayMsk(at('2026-09-07T18:00:00.000Z')), true); // 21:00 МСК
});

test('остальные дни недели — не понедельник', () => {
  assert.equal(isMondayMsk(at('2026-09-08T09:00:00.000Z')), false); // вторник
  assert.equal(isMondayMsk(at('2026-09-09T09:00:00.000Z')), false); // среда
  assert.equal(isMondayMsk(at('2026-09-12T09:00:00.000Z')), false); // суббота
  assert.equal(isMondayMsk(at('2026-09-13T09:00:00.000Z')), false); // воскресенье
});

// ЛОВУШКА: 21:30 UTC воскресенья = 00:30 МСК понедельника.
test('поздний вечер воскресенья по UTC — уже понедельник по МСК', () => {
  assert.equal(isMondayMsk(at('2026-09-06T21:30:00.000Z')), true, '00:30 МСК пн');
  assert.equal(isMondayMsk(at('2026-09-06T20:30:00.000Z')), false, '23:30 МСК вс');
});

// И зеркально: поздний вечер понедельника по МСК ещё понедельник,
// хотя по UTC уже вторник не наступил.
test('граница понедельник → вторник по МСК', () => {
  assert.equal(isMondayMsk(at('2026-09-07T20:59:00.000Z')), true, '23:59 МСК пн');
  assert.equal(isMondayMsk(at('2026-09-07T21:00:00.000Z')), false, '00:00 МСК вт');
});

test('ровно один понедельник на каждые 7 дней подряд', () => {
  let mondays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2026, 8, 7 + i, 9, 0, 0));
    if (isMondayMsk(d)) mondays++;
  }
  assert.equal(mondays, 1);
});
