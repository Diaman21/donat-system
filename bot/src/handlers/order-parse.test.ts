import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOrder,
  describePlan,
  plural,
  plannedTotal,
  remainingLabels,
} from './order-parse.js';

// Тесты на разбор состава заказа.
//
// Зачем: ошибка здесь тихая и дорогая — заказ либо закроется раньше времени
// (позиция не куплена, а бот считает её сделанной), либо повиснет открытым
// навсегда. Проверить это в боте руками можно только реальным заказом.
//
// Модуль намеренно без зависимостей от БД, поэтому тесты гоняются в CI
// без секретов и без сети.

// ---------- parseOrder: сколько закупок ----------

test('одна позиция = одна закупка', () => {
  const p = parseOrder('Орден, ник Вася');
  assert.equal(p.total, 1);
  assert.equal(p.hintGame, 'Furious');
  assert.deepEqual(p.list, [{ label: 'орден', amount: 30, game: 'Furious' }]);
});

test('«Орден + Банки» = 2 закупки по €30', () => {
  const p = parseOrder('Орден + Банки');
  assert.equal(p.total, 2);
  assert.deepEqual(
    p.list.map((i) => [i.label, i.amount]),
    [
      ['орден', 30],
      ['банки', 30],
    ],
  );
});

test('«Орден +Прем год» = €30 + €105 (реальный заказ #5)', () => {
  const p = parseOrder('Орден +Прем год');
  assert.equal(p.total, 2);
  assert.deepEqual(
    p.list.map((i) => i.amount),
    [30, 105],
  );
});

test('позиции идут в порядке текста, а не в порядке словаря', () => {
  // «прем год» стоит в словаре первым, но в тексте он последний.
  const p = parseOrder('банки, орден, прем год');
  assert.deepEqual(
    p.list.map((i) => i.label),
    ['банки', 'орден', 'прем год'],
  );
});

test('повтор позиции считается дважды', () => {
  const p = parseOrder('Орден + Орден');
  assert.equal(p.total, 2);
});

// ---------- parseOrder: определение игры ----------

test('Massive: всё по €100', () => {
  const p = parseOrder('Массив, вип год + 1650 золота');
  assert.equal(p.hintGame, 'Massive');
  assert.equal(p.total, 2);
  assert.ok(p.list.every((i) => i.amount === 100));
});

test('«Масив» с одной «с» тоже распознаётся', () => {
  assert.equal(parseOrder('Масив вип год').hintGame, 'Massive');
});

test('игра берётся из первой позиции, если в шапке её нет', () => {
  assert.equal(parseOrder('орден').hintGame, 'Furious');
  assert.equal(parseOrder('вип год').hintGame, 'Massive');
});

// ЗАЩИТА ОТ ЛОЖНОЙ ЗАКУПКИ: один заказ — всегда одна игра.
// Ник «Золотой» в Furious-заказе не должен добавлять Massive-позицию.
test('слово чужой игры в нике не создаёт лишнюю закупку', () => {
  const p = parseOrder('Фурио, орден, ник Золотой Дракон');
  assert.equal(p.hintGame, 'Furious');
  assert.equal(p.total, 1, 'должна остаться только Furious-позиция');
  assert.deepEqual(
    p.list.map((i) => i.label),
    ['орден'],
  );
});

test('шапка игры сильнее позиций', () => {
  // «Массив» в шапке → Furious-слова игнорируем как чужие.
  const p = parseOrder('Массив. вип год. (не орден!)');
  assert.equal(p.hintGame, 'Massive');
  assert.deepEqual(
    p.list.map((i) => i.label),
    ['вип год'],
  );
});

// ---------- parseOrder: чего распознать нельзя ----------

test('незнакомый текст = 0 позиций, оператор укажет число сам', () => {
  const p = parseOrder('что-то новенькое, чего ещё нет в прайсе');
  assert.equal(p.total, 0);
  assert.equal(p.hintGame, null);
  assert.deepEqual(p.list, []);
});

test('игра известна, позиции — нет', () => {
  const p = parseOrder('Фурио, что-то новое');
  assert.equal(p.hintGame, 'Furious');
  assert.equal(p.total, 0);
});

// Регрессия: словарные регулярки объявлены с флагом /g на уровне модуля.
// Если когда-нибудь перейти с matchAll на exec/test, у них начнёт «ехать»
// lastIndex и второй разбор того же текста вернёт другой результат.
test('повторный разбор того же текста даёт тот же результат', () => {
  const text = 'Орден + Банки + Прем год';
  const a = parseOrder(text);
  const b = parseOrder(text);
  assert.deepEqual(a, b);
  assert.equal(a.total, 3);
});

// ---------- describePlan ----------

test('describePlan: сумма и число позиций', () => {
  const lines = describePlan(parseOrder('Орден + Прем год'));
  assert.equal(lines[0], '🎮 Furious');
  assert.ok(lines.at(-1)?.includes('€135'), `итог должен быть €135: ${lines.at(-1)}`);
  assert.ok(lines.at(-1)?.includes('2 закупки'));
});

test('describePlan: нераспознанный заказ просит указать количество', () => {
  const lines = describePlan(parseOrder('непонятно что'));
  assert.ok(lines[0]?.includes('распознать не удалось'));
});

// ---------- plural ----------

test('plural: русские окончания', () => {
  assert.equal(plural(1), '1 закупка');
  assert.equal(plural(2), '2 закупки');
  assert.equal(plural(4), '4 закупки');
  assert.equal(plural(5), '5 закупок');
  assert.equal(plural(11), '11 закупок'); // не «11 закупка»
  assert.equal(plural(14), '14 закупок');
  assert.equal(plural(21), '21 закупка');
  assert.equal(plural(22), '22 закупки');
});

// ---------- plannedTotal / remainingLabels ----------

test('plannedTotal: пустой состав = 1 закупка', () => {
  assert.equal(plannedTotal(null), 1);
  assert.equal(plannedTotal(undefined), 1);
  assert.equal(plannedTotal({}), 1);
  assert.equal(plannedTotal({ total: 0 }), 1);
  assert.equal(plannedTotal({ total: 3 }), 3);
});

test('remainingLabels: что осталось купить', () => {
  const items = {
    total: 3,
    list: [
      { label: 'орден', amount: 30 },
      { label: 'банки', amount: 30 },
      { label: 'прем год', amount: 105 },
    ],
  };
  assert.equal(remainingLabels(items, 0), 'орден €30 + банки €30 + прем год €105');
  assert.equal(remainingLabels(items, 1), 'банки €30 + прем год €105');
  assert.equal(remainingLabels(items, 3), '', 'всё куплено — подсказки нет');
  assert.equal(remainingLabels(items, 99), '', 'счётчик больше состава не ломает вывод');
});

test('remainingLabels: состав задан числом, без списка', () => {
  assert.equal(remainingLabels({ total: 2 }, 0), '');
  assert.equal(remainingLabels(null, 0), '');
});
