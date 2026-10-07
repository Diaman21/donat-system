import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imeiRepeatNotice } from './phone-dup.js';

// Предупреждение о повторе 4 цифр IMEI. Главное, что сторожится: совпадение
// с РЕЗЕРВОМ больше не проходит молча (так появился дубль …3977, 07.10.2026),
// и в каждом случае совет один, без «возьми» и «не бери» в одном сообщении.

const dead = { label: '13 красный', when: '03.10.2026 10:00', reason: 'вынужденный вывод', count: 1 };

test('повтора нет — предупреждать не о чем', () => {
  assert.equal(imeiRepeatNotice('1234', [], null), null);
});

test('совпадение с резервом — зовёт взять из резерва, а не плодить запись', () => {
  const t = imeiRepeatNotice('3977', [{ label: 'Красный 13', since: '11.09' }], null)!;
  assert.ok(t.includes('уже лежит в подготовленных'));
  assert.ok(t.includes('«Красный 13»'));
  assert.ok(t.includes('с 11.09'));
  assert.ok(t.includes('Возьми его из резерва'));
  assert.ok(t.includes('дубль'));
});

test('совпадение только с умершим — как раньше, без совета про резерв', () => {
  const t = imeiRepeatNotice('3977', [], dead)!;
  assert.ok(t.includes('уже работали «13 красный»'));
  assert.ok(t.includes('вынужденный вывод'));
  assert.ok(!t.includes('резерв'));
  assert.ok(t.includes('тот же телефон или новый'));
});

test('и резерв, и умерший (случай …3977) — не советует брать в работу', () => {
  const t = imeiRepeatNotice('3977', [{ label: 'Красный 13', since: '11.09' }], dead)!;
  assert.ok(t.includes('уже лежит в подготовленных'));
  assert.ok(t.includes('уже работали'));
  assert.ok(t.includes('брать не стоит'));
  assert.ok(!t.includes('Возьми его из резерва'), 'противоречивых советов быть не должно');
});

test('несколько в резерве — перечислены все', () => {
  const t = imeiRepeatNotice('5555', [
    { label: 'Синий 12', since: '01.09' },
    { label: null, since: '05.09' },
  ], null)!;
  assert.ok(t.includes('уже 2 телефона'));
  assert.ok(t.includes('«Синий 12» — с 01.09'));
  assert.ok(t.includes('…5555 — с 05.09'));
});

test('несколько умерших — счётчик в тексте', () => {
  const t = imeiRepeatNotice('7777', [], { ...dead, count: 3 })!;
  assert.ok(t.includes('Всего таких в истории: 3'));
});
