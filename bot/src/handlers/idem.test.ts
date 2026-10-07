import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newIdem, idemKeys } from './idem.js';

// Ключ идемпотентности: повтор того же потока даёт ТЕ ЖЕ ключи (дубль
// не пройдёт), новый поток — другие (настоящая покупка запишется).

test('один поток — одни и те же ключи при повторе', () => {
  const idem = newIdem();
  assert.deepEqual(idemKeys(idem, 1), idemKeys(idem, 1));
  assert.deepEqual(idemKeys(idem, 3), idemKeys(idem, 3));
});

test('мультизакуп: у каждой строки свой ключ', () => {
  const keys = idemKeys(newIdem(), 5);
  assert.equal(keys.length, 5);
  assert.equal(new Set(keys).size, 5, 'строки одной записи не должны конфликтовать друг с другом');
});

test('разные потоки — разные ключи (две настоящие покупки запишутся обе)', () => {
  const a = idemKeys(newIdem(), 1)[0];
  const b = idemKeys(newIdem(), 1)[0];
  assert.notEqual(a, b);
});

test('ключ — UUID с номером строки', () => {
  const [k] = idemKeys(newIdem(), 1);
  assert.match(k!, /^[0-9a-f-]{36}:0$/);
});
