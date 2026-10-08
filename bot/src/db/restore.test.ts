import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { restoreBackup, tableFingerprint, RESTORE_ORDER, type BackupData, type Exec } from './restore-core.js';

// Учебное восстановление в CI: все миграции → чистый Postgres в памяти (PGlite)
// → вымышленный бэкап со всеми трудными случаями → проверка каждого случая
// → выгрузка → повторное восстановление → отпечатки совпадают.
//
// Зачем: бэкап в группе — единственная настоящая страховка (панель Neon
// заблокирована, восстановление «на момент» хранит лишь 6 часов). До 07.10.2026
// процедура восстановления была только текстом и в трёх местах не сработала бы.
// Теперь любая новая миграция, ломающая восстановление, уронит CI.

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

async function freshDb(): Promise<PGlite> {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  await pg.exec("set timezone to 'UTC'");
  return pg;
}

// Выгрузка как в buildFullBackup (backup.ts): все строки, order by created_at.
// ⚠️ Через to_jsonb, а не select *: PGlite превращает timestamptz в JS Date и
// теряет микросекунды. Боевой драйвер (postgres.js) отдаёт время строкой —
// проверено 07.10.2026, — поэтому реальный бэкап точный, а тесту нужно то же.
async function dump(pg: Exec): Promise<BackupData> {
  const out: Record<string, unknown[]> = {};
  for (const t of RESTORE_ORDER) {
    const r = await pg.query(
      `select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb) j from ${t} x`,
    );
    out[t] = r.rows[0]?.j as unknown[];
  }
  return out as unknown as BackupData;
}

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const CAT_TANK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_VK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PH_ACTIVE = 'd0000000-0000-4000-8000-000000000001';
const PH_DEAD = 'd0000000-0000-4000-8000-000000000002';
const PH_VERIFY = 'd0000000-0000-4000-8000-000000000003';
const PH_PREP = 'd0000000-0000-4000-8000-000000000004';
const P_KILL = 'e0000000-0000-4000-8000-000000000001';
const P_VERIFY = 'e0000000-0000-4000-8000-000000000002';

const ts = (d: string) => `2026-09-${d}T10:00:00.123456+00:00`;
const fixture: BackupData = {
  users: [
    { id: U1, telegram_id: 7897387963, username: 'boss', role: 'moderator', is_active: true, created_at: ts('01'), updated_at: ts('01') },
    { id: U2, telegram_id: 8045125459, username: 'op', role: 'operator', is_active: true, created_at: ts('01'), updated_at: ts('02') },
  ],
  purchase_categories: [
    { id: CAT_TANK, code: 'game_donate', name: 'Донаты в играх', denominations: [2, 30, 100], warmup_config: { days: 2 }, created_at: ts('01'), updated_at: ts('01') },
    { id: CAT_VK, code: 'vk_votes', name: 'Голоса VK', denominations: [4], warmup_config: { note: 'вк' }, created_at: ts('01'), updated_at: ts('01') },
  ],
  order_queue: [
    { id: ORD, num: 41, text: 'Масив вип год', status: 'done', created_by: U2, created_at: ts('05'), done_by: U2, done_at: ts('06'), updated_at: ts('06'), items: { total: 1, list: [{ game: 'Massive', label: 'вип год', amount: 100 }] } },
  ],
  phones: [
    { id: PH_ACTIVE, imei_last4: '6219', label: 'Черный 13', status: 'active', operator_id: U2, connected_at: ts('03'), died_at: null, notes: null, created_at: ts('03'), updated_at: ts('03'), death_purchase_id: null, death_reason: null },
    { id: PH_DEAD, imei_last4: '1817', label: 'Черный 12 мини', status: 'dead', operator_id: U1, connected_at: ts('02'), died_at: ts('04'), notes: null, created_at: ts('02'), updated_at: ts('04'), death_purchase_id: P_KILL, death_reason: 'error' },
    { id: PH_VERIFY, imei_last4: '9183', label: 'Зелёный 13', status: 'dead', operator_id: U2, connected_at: ts('03'), died_at: ts('06'), notes: null, created_at: ts('03'), updated_at: ts('06'), death_purchase_id: P_VERIFY, death_reason: 'verify' },
    { id: PH_PREP, imei_last4: '2295', label: 'Серый 15 про макс', status: 'prepared', operator_id: U1, connected_at: ts('04'), died_at: null, notes: null, created_at: ts('04'), updated_at: ts('04'), death_purchase_id: null, death_reason: null },
  ],
  purchases: [
    // Старый формат дампа (до 0011): лишний ключ order_id, нет idem_key.
    { id: 'e0000000-0000-4000-8000-0000000000a1', phone_id: PH_DEAD, order_id: null, operator_id: U1, category_id: CAT_TANK, amount: '30.00', result: 'done', game: 'Furious', internet: 'wifi', units: null, order_queue_id: null, purchased_at: ts('03'), notes: null, created_at: ts('03'), updated_at: ts('03') },
    { id: P_KILL, phone_id: PH_DEAD, operator_id: U1, category_id: CAT_TANK, amount: '30.00', result: 'long', game: 'Furious', internet: 'wifi', units: null, order_queue_id: null, purchased_at: ts('04'), notes: 'waiver', created_at: ts('04'), updated_at: ts('04') },
    // 🔐 по заказу — ссылка на order_queue (ловушка 1).
    { id: P_VERIFY, phone_id: PH_VERIFY, operator_id: U2, category_id: CAT_TANK, amount: '100.00', result: 'verify', game: 'Massive', internet: 'mobile', units: null, order_queue_id: ORD, idem_key: 'k1:0', purchased_at: ts('06'), notes: null, created_at: ts('06'), updated_at: ts('06') },
    { id: 'e0000000-0000-4000-8000-0000000000a3', phone_id: PH_ACTIVE, operator_id: U2, category_id: CAT_TANK, amount: '100.00', result: 'done', game: 'Massive', internet: 'mobile', units: null, order_queue_id: ORD, idem_key: 'k2:0', purchased_at: ts('06'), notes: null, created_at: ts('07'), updated_at: ts('07') },
    // ВК-мультизакуп: две строки с ключами одного потока.
    { id: 'e0000000-0000-4000-8000-0000000000a4', phone_id: PH_ACTIVE, operator_id: U2, category_id: CAT_VK, amount: '3.99', result: 'done', game: null, internet: 'wifi', units: 40, order_queue_id: null, idem_key: 'k3:0', purchased_at: ts('07'), notes: null, created_at: ts('07'), updated_at: ts('07') },
    { id: 'e0000000-0000-4000-8000-0000000000a5', phone_id: PH_ACTIVE, operator_id: U2, category_id: CAT_VK, amount: '3.99', result: 'support', game: null, internet: 'wifi', units: 40, order_queue_id: null, idem_key: 'k3:1', purchased_at: ts('07'), notes: null, created_at: ts('07'), updated_at: ts('07') },
  ],
  // Журнал подсказок (0016): одна запись с jsonb-массивом и временами.
  advice_log: [
    { id: 7, created_at: ts('06'), purchase_id: P_VERIFY, phone_id: PH_VERIFY, anomalies: [{ code: 'mobile-big', severity: 'observation' }], next_small_at: null, next_big_at: null, rules: '2026-10-06' },
  ],
};

test('восстановление: все миграции поднимаются, бэкап встаёт без ошибок', async () => {
  const pg = await freshDb();
  const done = await restoreBackup(pg, fixture);
  assert.deepEqual(done, { users: 2, purchase_categories: 2, order_queue: 1, phones: 4, purchases: 6, advice_log: 1 });
});

test('восстановление: трудные случаи на месте', async () => {
  const pg = await freshDb();
  await restoreBackup(pg, fixture);
  const one = async (q: string) => (await pg.query(q)).rows[0] as Record<string, unknown>;

  // Ловушка 2: категории — из бэкапа, а не из сида миграции 0001.
  assert.equal((await one(`select string_agg(id::text, ',' order by code) ids from purchase_categories`)).ids, `${CAT_TANK},${CAT_VK}`);
  // Ловушка 3: ссылки на «убившие» покупки восстановлены, updated_at не тронут.
  const dead = await one(`select death_purchase_id::text d, updated_at from phones where id = '${PH_DEAD}'`);
  assert.equal(dead.d, P_KILL);
  assert.equal(new Date(dead.updated_at as string).toISOString(), '2026-09-04T10:00:00.123Z');
  assert.equal((await one(`select death_reason r from phones where id = '${PH_VERIFY}'`)).r, 'verify');
  // Резерв и активный не стали мёртвыми от триггера handle_long_result.
  assert.equal((await one(`select string_agg(status::text, ',' order by imei_last4) s from phones`)).s, 'dead,prepared,active,dead');
  // Ловушка 1: покупки по заказу привязаны.
  assert.equal((await one(`select count(*)::int n from purchases where order_queue_id = '${ORD}'`)).n, 2);
  // Старый дамп: лишний order_id проигнорирован, пустой idem_key стал NULL.
  assert.equal((await one(`select count(*)::int n from purchases where idem_key is null`)).n, 2);
  // Микросекунды времени не потерялись.
  assert.match(String((await one(`select purchased_at::text t from purchases where id = '${P_KILL}'`)).t), /\.123456/);
  // jsonb состава заказа цел.
  assert.equal((await one(`select items->'list'->0->>'label' l from order_queue`)).l, 'вип год');
  // Счётчик номеров: следующий заказ получит #42.
  assert.equal((await one(`select nextval('order_queue_num_seq')::int n`)).n, 42);
  // Журнал: jsonb цел, счётчик id после максимального.
  assert.equal((await one(`select anomalies->0->>'code' c from advice_log`)).c, 'mobile-big');
  assert.equal((await one(`select nextval('advice_log_id_seq')::int n`)).n, 8);
  // Защита от дубля работает и после восстановления.
  await assert.rejects(
    pg.query(`insert into purchases (phone_id, operator_id, category_id, amount, result, idem_key)
              values ('${PH_ACTIVE}', '${U2}', '${CAT_TANK}', 30, 'done', 'k2:0')`),
    /idem_key|unique/i,
  );
});

test('восстановление: туда-обратно один в один (отпечатки всех таблиц совпали)', async () => {
  const a = await freshDb();
  await restoreBackup(a, fixture);
  const b = await freshDb();
  await restoreBackup(b, await dump(a));
  for (const t of RESTORE_ORDER) {
    assert.equal(await tableFingerprint(b, t), await tableFingerprint(a, t), `таблица ${t} разошлась`);
  }
});

test('восстановление: в непустую базу — отказ, ничего не смешивается', async () => {
  const pg = await freshDb();
  await restoreBackup(pg, fixture);
  await assert.rejects(restoreBackup(pg, fixture), /не пустая/);
});

test('восстановление: ошибка посреди — откат целиком, база остаётся пустой', async () => {
  const pg = await freshDb();
  const broken = { ...fixture, purchases: [...fixture.purchases, { id: 'не-uuid' }] };
  await assert.rejects(restoreBackup(pg, broken));
  const n = (await pg.query(`select (select count(*) from users) + (select count(*) from phones) as n`)).rows[0];
  assert.equal(Number((n as { n: unknown }).n), 0);
});

test('восстановление: дамп до 07.10.2026 (без advice_log) встаёт без правки', async () => {
  const pg = await freshDb();
  const { advice_log: _drop, ...old } = fixture;
  const done = await restoreBackup(pg, old as BackupData);
  assert.equal(done.advice_log, 0);
  assert.equal(done.purchases, 6);
});
