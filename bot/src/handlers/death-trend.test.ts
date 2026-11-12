import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deathTrend } from './death-trend.js';

const at = (iso: string, hh = '12:00') => `${iso}T${hh}:00+03:00`;

test('💀 по две недели с протокола: границы отрезков по МСК, 🔐 и ⚠️ — не 💀', () => {
  const t = deathTrend(
    [
      { res: 'done', at: at('2026-08-13', '00:00') }, // первая минута протокола
      { res: 'long', at: at('2026-08-26', '23:59') }, // последняя минута первого отрезка
      { res: 'long', at: at('2026-08-27', '00:01') }, // уже второй
      { res: 'verify', at: at('2026-08-30') },
      { res: 'support', at: at('2026-08-30') },
      { res: 'long', at: at('2026-08-01') }, // до протокола — не считается
    ],
    '2026-08-13',
    new Date(at('2026-09-12')),
  );
  assert.deepEqual(
    t.map((b) => [b.from, b.to, b.n, b.deaths]),
    [
      ['2026-08-13', '2026-08-26', 2, 1],
      ['2026-08-27', '2026-09-09', 3, 1],
      ['2026-09-10', '2026-09-23', 0, 0], // неполный, пустой — ноль, а не пропуск
    ],
  );
});

test('💀: до начала протокола отрезков нет', () => {
  assert.deepEqual(deathTrend([], '2026-08-13', new Date(at('2026-08-01'))), []);
});
