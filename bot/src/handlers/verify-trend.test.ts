import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTrend, VERIFY_SINCE } from './verify-trend.js';

// Время по МСК (+03:00), как оно живёт в отчётах.
const at = (iso: string, hh = '12:00') => `${iso}T${hh}:00+03:00`;

test('🔐: до и после появления, разогрев €2 не считается', () => {
  const t = verifyTrend(
    [
      { amt: 100, res: 'done', at: at('2026-09-20') },
      { amt: 30, res: 'done', at: at('2026-10-05', '23:59') },
      { amt: 2, res: 'verify', at: at('2026-10-06') }, // разогрев — не крупная
      { amt: 100, res: 'verify', at: at('2026-10-06', '00:00') }, // первая минута 06.10 МСК — уже «после»
      { amt: 100, res: 'done', at: at('2026-10-07') },
      // До протокола — не входит в «до».
      { amt: 100, res: 'done', at: at('2026-08-01') },
    ],
    '2026-08-13',
    new Date(at('2026-10-08')),
  );
  assert.deepEqual(t.before, { n: 2, verify: 0 });
  assert.deepEqual(t.after, { n: 2, verify: 1 });
});

test('🔐: недели с 06.10, последняя неполная, пустая неделя — ноль', () => {
  const t = verifyTrend(
    [
      { amt: 100, res: 'verify', at: at('2026-10-06') },
      { amt: 100, res: 'done', at: at('2026-10-12', '23:30') }, // ещё первая неделя
      { amt: 100, res: 'verify', at: at('2026-10-13', '00:10') }, // уже вторая
      { amt: 30, res: 'done', at: at('2026-10-27') },
    ],
    '2026-08-13',
    new Date(at('2026-10-28')),
  );
  assert.equal(t.weeks[0]!.from, VERIFY_SINCE);
  assert.deepEqual(
    t.weeks.map((w) => [w.from, w.to, w.n, w.verify]),
    [
      ['2026-10-06', '2026-10-12', 2, 1],
      ['2026-10-13', '2026-10-19', 1, 1],
      ['2026-10-20', '2026-10-26', 0, 0],
      ['2026-10-27', '2026-11-02', 1, 0],
    ],
  );
});

test('🔐: до появления недель нет', () => {
  const t = verifyTrend([], '2026-08-13', new Date(at('2026-10-01')));
  assert.equal(t.weeks.length, 0);
  assert.deepEqual(t.after, { n: 0, verify: 0 });
});
