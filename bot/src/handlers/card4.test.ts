import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardLast4, cardLine } from './card4.js';

test('карта: ввод в разных видах — только 4 цифры', () => {
  assert.equal(parseCardLast4('2850'), '2850');
  assert.equal(parseCardLast4(' 28 50 '), '2850');
  assert.equal(parseCardLast4('**** 2850'), '2850');
  assert.equal(parseCardLast4('*2850'), '2850');
  assert.equal(parseCardLast4('0042'), '0042'); // ведущий ноль не теряется
  assert.equal(parseCardLast4('285'), null);
  assert.equal(parseCardLast4('28501'), null);
  assert.equal(parseCardLast4('4276 1600 1234 2850'), null); // полный номер не принимаем
  assert.equal(parseCardLast4('abcd'), null);
});

test('карта: строка на экране', () => {
  assert.equal(cardLine('2850'), '💳 Карта: 2850');
  assert.equal(cardLine(null), '💳 Карта: не указана');
});
