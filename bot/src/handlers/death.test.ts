import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asDeathReason, BY_APPLE, DEATH_SHORT, DEATH_FULL, DEATH_TAG } from './death.js';

// Причина смерти в базе — обычный text, поэтому разбор и подписи собраны
// в одном модуле. Главное, что здесь сторожится: новая причина 'verify'
// (🔐 проверка данных, 06.10.2026) НЕ превращается в «вывод вручную».

test('asDeathReason: все три причины из базы распознаются', () => {
  assert.equal(asDeathReason('error'), 'error');
  assert.equal(asDeathReason('forced'), 'forced');
  assert.equal(asDeathReason('verify'), 'verify');
});

test('asDeathReason: пусто или мусор — null, а не «вывод вручную»', () => {
  assert.equal(asDeathReason(null), null);
  assert.equal(asDeathReason(undefined), null);
  assert.equal(asDeathReason(''), null);
  assert.equal(asDeathReason('Error'), null);
  // Защита от прототипа: `in` на обычном объекте видит toString и прочее.
  assert.equal(asDeathReason('toString'), null);
});

test('verify — решение Apple, а не оператора', () => {
  // Иначе в списке телефонов он показывался бы «выведен (вручную)»,
  // а в аналитике смешался бы с искусственными forced-выводами.
  assert.equal(BY_APPLE.verify, true);
  assert.equal(BY_APPLE.error, true);
  assert.equal(BY_APPLE.forced, false);
});

test('подписи у трёх причин разные во всех видах', () => {
  for (const map of [DEATH_SHORT, DEATH_FULL, DEATH_TAG]) {
    const vals = Object.values(map);
    assert.equal(new Set(vals).size, vals.length, 'две причины выглядят одинаково');
  }
  assert.ok(DEATH_TAG.verify.includes('🔐'));
  assert.ok(!DEATH_FULL.verify.includes('вручную'));
});
