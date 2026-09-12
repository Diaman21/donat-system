import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoneModel, modelGroup } from './phone-model.js';

// Тесты разбора модели из метки телефона.
//
// Все примеры ниже — РЕАЛЬНЫЕ метки из базы (46 телефонов на 13.09.2026).
// Метки пишет человек свободным текстом, поэтому порядок слов любой, язык
// смешанный, регистр произвольный. Если разбор поедет, аналитика по моделям
// начнёт тихо врать — поэтому фиксируем каждую встреченную форму.

const name = (label: string | null | undefined) => parsePhoneModel(label).name;

test('порядок слов не важен: модель до цвета и после', () => {
  assert.equal(name('15 черный'), 'iPhone 15');
  assert.equal(name('Черный 15'), 'iPhone 15');
  assert.equal(name('13 белый'), 'iPhone 13');
  assert.equal(name('Белый 12'), 'iPhone 12');
});

test('Pro по-русски и по-английски', () => {
  assert.equal(name('Черный 14 про'), 'iPhone 14 Pro');
  assert.equal(name('Серый 12 про'), 'iPhone 12 Pro');
  assert.equal(name('iPhone 14 Pro'), 'iPhone 14 Pro');
  assert.equal(name('iPhone 11 Pro (серый)'), 'iPhone 11 Pro');
  assert.equal(name('iPhone 12 Pro (без крышки)'), 'iPhone 12 Pro');
});

// Ловушка: «про макс» обязан проверяться РАНЬШЕ «про», иначе Pro Max
// схлопнется в обычный Pro и смешает разные по силе аппараты.
test('Pro Max не путается с Pro', () => {
  assert.equal(name('Белый 12 про Макс'), 'iPhone 12 Pro Max');
  assert.equal(name('Серый 13 про макс'), 'iPhone 13 Pro Max');
  assert.equal(name('Голубой 13 про макс'), 'iPhone 13 Pro Max');
  assert.equal(name('13 про Макс зелёный'), 'iPhone 13 Pro Max');
  assert.equal(name('Серый 15 про макс'), 'iPhone 15 Pro Max');
});

test('mini, Plus, e', () => {
  assert.equal(name('Черный 12 мини'), 'iPhone 12 mini');
  assert.equal(name('Синий 14 Plus'), 'iPhone 14 Plus');
  assert.equal(name('Белый 16e'), 'iPhone 16e');
});

test('буквенные поколения XS / XR', () => {
  assert.equal(name('Золотой xs max'), 'iPhone XS Max');
  assert.equal(name('Белый Xr'), 'iPhone XR');
});

test('прочие реальные метки', () => {
  assert.equal(name('iPhone 12 (черный)'), 'iPhone 12');
  assert.equal(name('Золотой 14 про'), 'iPhone 14 Pro');
  assert.equal(name('Зелёный 13'), 'iPhone 13');
  assert.equal(name('Розовый 13'), 'iPhone 13');
  assert.equal(name('Черный 16 про'), 'iPhone 16 Pro');
  assert.equal(name('Золотой 16 про'), 'iPhone 16 Pro');
  assert.equal(name('Черный 11'), 'iPhone 11');
});

// Разбор — подсказка, а не истина: аналитика обязана пережить «не распознано».
test('нераспознанное даёт null, а не мусор', () => {
  assert.equal(name('просто телефон'), null);
  assert.equal(name(''), null);
  assert.equal(name(null), null);
  assert.equal(name(undefined), null);
});

// Число из трёх цифр — это опечатка в метке, а не поколение.
test('«красный 111» моделью не считается', () => {
  assert.equal(name('красный 111'), null);
  assert.equal(name('телефон 2024'), null);
});

test('поколение вне разумного диапазона игнорируем', () => {
  assert.equal(name('Чёрный 99'), null);
  assert.equal(name('коробка 42'), null);
});

// ---------- группы ----------

test('modelGroup: Pro-линейка отделена от базовой и компактной', () => {
  assert.equal(modelGroup(parsePhoneModel('Черный 14 про')), 'pro');
  assert.equal(modelGroup(parsePhoneModel('Серый 13 про макс')), 'pro');
  assert.equal(modelGroup(parsePhoneModel('Золотой xs max')), 'pro');
  assert.equal(modelGroup(parsePhoneModel('Черный 15')), 'base');
  assert.equal(modelGroup(parsePhoneModel('Синий 14 Plus')), 'base');
  assert.equal(modelGroup(parsePhoneModel('Черный 12 мини')), 'compact');
  assert.equal(modelGroup(parsePhoneModel('Белый 16e')), 'compact');
  assert.equal(modelGroup(parsePhoneModel('просто телефон')), 'unknown');
});

test('разбор стабилен при повторном вызове', () => {
  const a = parsePhoneModel('Белый 12 про Макс');
  const b = parsePhoneModel('Белый 12 про Макс');
  assert.deepEqual(a, b);
});
