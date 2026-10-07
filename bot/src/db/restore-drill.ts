// Учебное восстановление и аварийное восстановление из бэкапа.
//
//   npm run restore-drill
//       Учебный прогон. Собирает бэкап с боевой базы ТЕМ ЖЕ кодом, что
//       ежедневный крон (buildFullBackup), разворачивает его в чистый Postgres
//       в памяти (PGlite) и сверяет отпечатки всех таблиц с боевой базой.
//       Боевую базу только ЧИТАЕТ.
//
//   npm run restore-drill -- путь/к/backup-full-ГГГГ-ММ-ДД.json
//       То же, но для файла из группы: проверяет, что ИМЕННО этот бэкап
//       разворачивается. Отпечатки сравнивает, только если файл свежий.
//
//   RESTORE_TARGET_URL=postgres://… npm run restore-drill -- файл.json
//       ⚠️ АВАРИЙНОЕ восстановление в настоящую базу. Целевая база должна быть
//       пустой и с применёнными миграциями 0001…последняя. В боевую базу
//       (DATABASE_URL) скрипт писать откажется.
//
// Порядок восстановления и его ловушки — в restore-core.ts.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import postgres from 'postgres';
import { client } from './client.js';
import { env } from '../config.js';
import { buildFullBackup } from '../handlers/backup.js';
import { restoreBackup, tableFingerprint, RESTORE_ORDER, type BackupData, type Exec } from './restore-core.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

// postgres.js → Exec. unsafe() с параметрами — только наши запросы из restore-core.
function pgExec(sqlc: postgres.Sql): Exec {
  return { query: async (q, p) => ({ rows: (await sqlc.unsafe(q, (p ?? []) as never[])) as never }) };
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const t0 = Date.now();

  const json = file ? readFileSync(file, 'utf8') : (await buildFullBackup()).json;
  const data = JSON.parse(json) as BackupData;
  const src = file ? `файл ${file}` : 'свежий бэкап с боевой базы';
  console.log(`📦 ${src}: ${(Buffer.byteLength(json) / 1024).toFixed(0)} КБ, снят ${data.meta?.generatedAt ?? '—'}`);

  // ---------- аварийный режим: в настоящую базу ----------
  const target = process.env.RESTORE_TARGET_URL;
  if (target) {
    if (target === env.databaseUrl) throw new Error('RESTORE_TARGET_URL совпадает с боевой базой — отказ.');
    const t = postgres(target, { prepare: false, max: 1 });
    const done = await restoreBackup(pgExec(t), data);
    console.log('✅ восстановлено в целевую базу:', JSON.stringify(done));
    await t.end();
    return;
  }

  // ---------- учебный режим: в Postgres в памяти ----------
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  const migs = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migs) await pg.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  await pg.exec("set timezone to 'UTC'");
  console.log(`🧱 миграции: ${migs.length} шт, последняя ${migs.at(-1)}`);

  const done = await restoreBackup(pg, data);
  console.log('♻️  восстановлено:', Object.entries(done).map(([k, v]) => `${k} ${v}`).join(' · '));

  // Сверка с боевой базой — один в один по отпечаткам всех строк.
  // Время в отпечатке зависит от часового пояса сессии, поэтому UTC с обеих сторон.
  const generated = data.meta?.generatedAt ? Date.parse(data.meta.generatedAt) : NaN;
  const fresh = !file || Date.now() - generated < 10 * 60 * 1000;
  if (!fresh) {
    console.log('ℹ️  файл не свежий — с боевой базой не сравниваю (она ушла вперёд), проверено только развёртывание.');
  } else {
    let ok = true;
    await client.begin(async (tx) => {
      await tx.unsafe("set local timezone to 'UTC'");
      const live = pgExec(tx as unknown as postgres.Sql);
      for (const t of RESTORE_ORDER) {
        const [a, b] = [await tableFingerprint(live, t), await tableFingerprint(pg, t)];
        const same = a === b;
        ok &&= same;
        console.log(`   ${same ? '✅' : '❌'} ${t.padEnd(20)} ${b}${same ? '' : `  ≠ боевая ${a}`}`);
      }
    });
    console.log(ok ? '🟢 бэкап восстанавливается ОДИН В ОДИН' : '🔴 РАСХОЖДЕНИЕ — бэкап восстанавливается неточно');
    if (!ok) process.exitCode = 1;
  }
  console.log(`⏱  ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}

main()
  .catch((e) => {
    console.error('🔴 восстановление не удалось:', e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
