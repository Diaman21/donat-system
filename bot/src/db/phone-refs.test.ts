import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PHONE_REFS, fkBlocker } from './phone-refs.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

test('страж: все ссылки на phones известны удалению телефона (PHONE_REFS)', async () => {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const r = await pg.query<{ tbl: string }>(`
    select distinct c.conrelid::regclass::text tbl
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'phones'::regclass and c.conrelid <> 'phones'::regclass
    order by 1`);
  // Упал? Новая таблица ссылается на телефон: впиши её в PHONE_REFS и научи
  // удаление подготовленного телефона (phones.ts) с ней обращаться.
  assert.deepEqual(r.rows.map((x) => x.tbl), Object.keys(PHONE_REFS).sort());
  await pg.close();
});

test('ошибка «на телефон ссылаются» — понятное название, и в обёртке драйвера тоже', () => {
  assert.equal(fkBlocker({ code: '23503', table_name: 'accounts' }), 'аккаунт');
  assert.equal(fkBlocker({ message: 'обёртка', cause: { code: '23503', table_name: 'purchases' } }), 'покупки');
  assert.equal(fkBlocker({ code: '23503', table_name: 'новая_таблица' }), 'связанные записи');
  assert.equal(fkBlocker(new Error('другое')), null);
  assert.equal(fkBlocker(null), null);
});
