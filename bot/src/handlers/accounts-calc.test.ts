import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockAlert, stockAlertText, readyPost, registeredPost } from './accounts-calc.js';

test('аккаунты: тегаем только при переходе через порог вниз', () => {
  assert.equal(stockAlert(3, 2), null);
  assert.equal(stockAlert(2, 1), 'low');
  assert.equal(stockAlert(1, 0), 'empty');
  assert.equal(stockAlert(2, 0), 'empty'); // отменили сразу два — «закончились», не «мало»
  assert.equal(stockAlert(1, 1), null);
  assert.equal(stockAlert(0, 1), null); // добавили — молчим
  assert.equal(stockAlert(1, 2), null);
});

test('аккаунты: тексты предупреждений с тегом и без', () => {
  assert.equal(stockAlertText('low', '@timka_mir'), '⚠️ Остался 1 готовый аккаунт — @timka_mir нужно сделать ещё.');
  assert.match(stockAlertText('empty', ''), /^🔴 Аккаунты закончились — нужно сделать новые\.$/);
});

test('аккаунты: пост в теме и он же после регистрации', () => {
  const a = { num: 12, text: 'acc12 / DE', author: 'timka_mir', createdAt: new Date('2026-11-01T11:20:00Z') };
  const ready = readyPost(a, 3);
  assert.match(ready, /^👤 Аккаунт #12 — готов к регистрации\nacc12 \/ DE\nдобавил @timka_mir · 01\.11 14:20\n📦 Готово к регистрации: 3$/);
  const reg = registeredPost(a, { user: 'Boris_donat', at: new Date('2026-11-01T15:05:00Z'), phone: '…8960 «Синий 12 про»' });
  assert.match(reg, /^✅ Аккаунт #12 — зарегистрирован/);
  assert.match(reg, /зарегистрировал @Boris_donat · 01\.11 18:05 · телефон …8960 «Синий 12 про»$/);
  assert.doesNotMatch(registeredPost(a, { user: null, at: new Date(), phone: null }), /телефон/);
});
