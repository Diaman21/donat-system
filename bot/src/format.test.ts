import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pad2,
  isoOf,
  mskNow,
  mskTodayIso,
  addDaysIso,
  isoToUtcMs,
  daysBetweenIso,
  ddmmOf,
  hhmmMsk,
  fmtMsk,
  fmtMskDate,
} from './format.js';

// Тесты на календарь МСК.
//
// Зачем: на этой арифметике держатся две вещи, ошибка в которых видна не сразу —
// счётчик дней до вывода бюджета (14-й день после первой покупки) и группировка
// покупок по дням в /period. Раньше эта математика была скопирована в report.ts
// и stats.ts; после объединения тесты сторожат, что поведение не поехало.
//
// Процесс на Vercel всегда в UTC, локально — в МСК/любом другом поясе,
// поэтому все проверки сформулированы так, чтобы не зависеть от пояса машины.

// ---------- строительные кирпичи ----------

test('pad2: двузначный вид', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(9), '09');
  assert.equal(pad2(12), '12');
});

test('isoOf: месяц 0-based, как в Date', () => {
  assert.equal(isoOf(2026, 0, 1), '2026-01-01');
  assert.equal(isoOf(2026, 8, 12), '2026-09-12'); // 8 = сентябрь
  assert.equal(isoOf(2026, 11, 31), '2026-12-31');
});

// ---------- «сегодня» по Москве ----------

// Независимая сверка: en-CA в Intl даёт ровно формат YYYY-MM-DD.
// Если наша арифметика «+3 часа и читаем UTC» неверна, здесь разойдётся.
test('mskTodayIso совпадает с Intl для Europe/Moscow', () => {
  const viaIntl = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  assert.equal(mskTodayIso(), viaIntl);
});

test('mskNow согласован с mskTodayIso', () => {
  const { y, m, d } = mskNow();
  assert.equal(isoOf(y, m, d), mskTodayIso());
});

// ---------- сдвиг по суткам ----------

test('addDaysIso: вперёд и назад', () => {
  assert.equal(addDaysIso('2026-09-12', 1), '2026-09-13');
  assert.equal(addDaysIso('2026-09-12', -1), '2026-09-11');
  assert.equal(addDaysIso('2026-09-12', 0), '2026-09-12');
});

test('addDaysIso: через край месяца и года', () => {
  assert.equal(addDaysIso('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysIso('2026-10-01', -1), '2026-09-30');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysIso('2026-01-01', -1), '2025-12-31');
});

test('addDaysIso: високосный февраль', () => {
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysIso('2028-02-29', 1), '2028-03-01');
  assert.equal(addDaysIso('2027-02-28', 1), '2027-03-01'); // не високосный
});

// В России перевода часов нет, но процесс может крутиться где угодно.
// Считаем в UTC, поэтому европейский перевод часов (25.10.2026) ничего не сдвигает.
test('addDaysIso не спотыкается о европейский перевод часов', () => {
  assert.equal(addDaysIso('2026-10-24', 1), '2026-10-25');
  assert.equal(addDaysIso('2026-10-25', 1), '2026-10-26');
  assert.equal(daysBetweenIso('2026-10-24', '2026-10-26'), 2);
});

// ---------- счёт суток ----------

test('daysBetweenIso: базовые случаи', () => {
  assert.equal(daysBetweenIso('2026-09-12', '2026-09-12'), 0);
  assert.equal(daysBetweenIso('2026-09-12', '2026-09-13'), 1);
  assert.equal(daysBetweenIso('2026-09-13', '2026-09-12'), -1);
  assert.equal(daysBetweenIso('2026-08-30', '2026-09-12'), 13);
});

// Реальный сценарий алерта: телефон впервые закупился 29.08, вывод на 14-й день.
test('daysBetweenIso: счётчик дней до вывода бюджета', () => {
  const first = '2026-08-29';
  assert.equal(daysBetweenIso(first, '2026-09-09'), 11); // молчим
  assert.equal(daysBetweenIso(first, '2026-09-10'), 12); // 🟠 предупреждение
  assert.equal(daysBetweenIso(first, '2026-09-11'), 13); // 🔴 завтра
  assert.equal(daysBetweenIso(first, '2026-09-12'), 14); // 🔴🔴 просрочено
  assert.equal(addDaysIso(first, 14), '2026-09-12'); // дата вывода в тексте алерта
});

test('isoToUtcMs: полночь UTC указанной даты', () => {
  assert.equal(isoToUtcMs('2026-09-12'), Date.UTC(2026, 8, 12));
  assert.equal(new Date(isoToUtcMs('2026-09-12')).toISOString(), '2026-09-12T00:00:00.000Z');
});

// ---------- отображение ----------

test('ddmmOf: «2026-09-12» → «12.09»', () => {
  assert.equal(ddmmOf('2026-09-12'), '12.09');
  assert.equal(ddmmOf('2026-01-05'), '05.01');
});

test('hhmmMsk: UTC переводится в московское время', () => {
  // 13:21 UTC = 16:21 МСК — время реальных закупок 11.09.
  assert.equal(hhmmMsk('2026-09-11T13:21:00.000Z'), '16:21');
  assert.equal(hhmmMsk('2026-09-11T14:16:00.000Z'), '17:16');
});

test('hhmmMsk: переход через полночь', () => {
  assert.equal(hhmmMsk('2026-09-11T21:30:00.000Z'), '00:30'); // уже 12-е по МСК
  assert.equal(hhmmMsk('2026-09-11T00:00:00.000Z'), '03:00');
});

test('hhmmMsk принимает и Date, и строку', () => {
  const d = new Date('2026-09-11T13:21:00.000Z');
  assert.equal(hhmmMsk(d), hhmmMsk('2026-09-11T13:21:00.000Z'));
});

// fmtMsk/fmtMskDate идут через Intl — проверяем формат, а не арифметику.
test('fmtMsk: «ДД.ММ ЧЧ:ММ» по Москве', () => {
  assert.equal(fmtMsk(new Date('2026-09-11T13:21:00.000Z')), '11.09 16:21');
  assert.equal(fmtMskDate(new Date('2026-09-11T13:21:00.000Z')), '11.09');
});

// Два пути расчёта времени должны совпадать: Intl (fmtMsk) и ручной (hhmmMsk).
test('fmtMsk и hhmmMsk дают одно и то же время', () => {
  for (const iso of [
    '2026-01-01T00:00:00.000Z',
    '2026-06-15T12:00:00.000Z',
    '2026-10-25T01:30:00.000Z', // европейский перевод часов
    '2026-12-31T23:59:00.000Z',
  ]) {
    const viaIntl = fmtMsk(new Date(iso)).split(' ')[1];
    assert.equal(hhmmMsk(iso), viaIntl, `расхождение на ${iso}`);
  }
});
