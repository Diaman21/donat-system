import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Страж: тесты не должны тянуть за собой подключение к БД.
//
// ЗАЧЕМ. `config.ts` падает, если не задан DATABASE_URL, а `db/client.ts`
// импортирует его. Поэтому любой тест, который (хотя бы транзитивно) дотянулся
// до этих модулей, локально проходит — у разработчика есть .env — и падает
// в CI, где секретов нет и быть не должно.
//
// Именно так и случилось 12.09.2026: `weekly.test.ts` импортировал `weekly.ts`
// ради одной чистой функции `isMondayMsk`, а тот ходит в базу. Функция уехала
// в `format.ts`, а этот тест сторожит, чтобы история не повторилась —
// и ловит её ЛОКАЛЬНО, до пуша.
//
// Правило простое: хочешь покрыть логику тестом — вынеси её в модуль,
// который не импортирует `db/client.js`.

const HERE = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = ['db/client.ts', 'config.ts'];

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...allFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Локальные импорты файла, приведённые к путям на диске (.js → .ts). */
function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    const spec = m[1]!;
    const asTs = spec.replace(/\.js$/, '.ts');
    const p = resolve(dirname(file), asTs);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

/** Весь граф импортов от файла (в глубину), включая сам файл. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...localImports(f));
  }
  return seen;
}

test('ни один тест не тянет за собой БД (иначе упадёт в CI без секретов)', () => {
  const tests = allFiles(HERE).filter((f) => f.endsWith('.test.ts'));
  assert.ok(tests.length >= 3, `тестовых файлов должно быть хотя бы 3, нашлось ${tests.length}`);

  const problems: string[] = [];
  for (const t of tests) {
    for (const dep of reachable(t)) {
      const rel = relative(HERE, dep).replace(/\\/g, '/');
      if (FORBIDDEN.some((f) => rel === f)) {
        problems.push(`${relative(HERE, t).replace(/\\/g, '/')} → ${rel}`);
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    'Тест дотянулся до модуля, который требует DATABASE_URL. ' +
      'Вынеси проверяемую логику в модуль без импорта db/client.js:\n  ' +
      problems.join('\n  '),
  );
});
