// Восстановление базы из JSON-бэкапа (backup-full-*.json из группы).
//
// ПОЧЕМУ ЭТО КОД, А НЕ ИНСТРУКЦИЯ. До 07.10.2026 восстановление было описано
// только словами в docs/db-schema.md — и ни разу не проверялось. Учебный прогон
// нашёл в нём три ошибки, каждая из которых сорвала бы восстановление в день
// аварии:
//   1. Покупки вставлялись РАНЬШЕ заказов, а у покупки внешний ключ на заказ
//      (order_queue_id, миграция 0009) — упало бы на первой покупке по заказу.
//   2. Миграция 0001 сама создаёт две категории покупок со СЛУЧАЙНЫМИ id.
//      Бэкап несёт свои id — без замены покупки сослались бы в пустоту.
//   3. Обновление death_purchase_id вторым проходом срабатывает триггером
//      updated_at — и у всех умерших телефонов менялось бы время правки.
// Плюс: на Neon у владельца заблокирована панель, а восстановление «на момент
// времени» на бесплатном плане хранит только 6 часов. Бэкап — единственная
// настоящая страховка, и теперь она проверяется тестом на каждый push.
//
// Модуль НЕ импортирует db/client.ts — работает с любой базой через Exec.
// Так его можно гонять в CI на PGlite (Postgres в памяти), без секретов.

/** Минимальный интерфейс базы: PGlite подходит как есть, postgres.js — через адаптер. */
export interface Exec {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type Row = Record<string, unknown>;

export interface BackupData {
  meta?: { generatedAt?: string; counts?: Record<string, number> };
  users: Row[];
  purchase_categories: Row[];
  phones: Row[];
  purchases: Row[];
  order_queue: Row[];
  /** Журнал подсказок (миграция 0016). В дампах до 07.10.2026 его нет. */
  advice_log?: Row[];
}

/**
 * Порядок вставки — по внешним ключам:
 *   users ← purchase_categories (без FK) ← order_queue (created_by → users)
 *   ← phones (operator_id → users) ← purchases (→ phones, users, категории, заказы).
 * phones.death_purchase_id → purchases заполняется ВТОРЫМ проходом.
 * Это НЕ порядок ключа meta.tables в самом бэкапе — тот описывает выгрузку.
 */
export const RESTORE_ORDER = [
  'users',
  'purchase_categories',
  'order_queue',
  'phones',
  'purchases',
  'advice_log', // ссылается на покупки и телефоны — последним
] as const;

// Вставка массива строк одним запросом. jsonb_populate_recordset сам приводит
// типы (enum, timestamptz, numeric, jsonb).
//
// Колонки — ПЕРЕСЕЧЕНИЕ колонок таблицы и ключей бэкапа:
//   - лишние ключи отбрасываются: старые дампы с purchases.order_id (до
//     миграции 0011) восстанавливаются без ручной правки;
//   - колонки, которых в дампе ещё не было, получают значение ПО УМОЛЧАНИЮ,
//     а не NULL: иначе старый дамп упал бы на колонке NOT NULL DEFAULT,
//     добавленной позже (поймано тестом на purchase_categories.is_active).
// Имя таблицы — только из RESTORE_ORDER, имена колонок — из information_schema,
// подстановки извне нет.
async function insertRows(db: Exec, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  const inDump = new Set(rows.flatMap((r) => Object.keys(r)));
  const use = cols.rows.map((c) => String(c.column_name)).filter((c) => inDump.has(c));
  const list = use.map((c) => `"${c}"`).join(', ');
  const res = await db.query(
    `insert into ${table} (${list})
     select ${list} from jsonb_populate_recordset(null::${table}, $1::jsonb) returning 1`,
    [JSON.stringify(rows)],
  );
  return res.rows.length;
}

/**
 * Восстановить бэкап в ПУСТУЮ базу с применёнными миграциями.
 * Возвращает число вставленных строк по таблицам.
 * Бросает ошибку, если в базе уже есть данные — чтобы случайно не смешать
 * бэкап с живой базой.
 */
export async function restoreBackup(db: Exec, data: BackupData): Promise<Record<string, number>> {
  const busy = await db.query(
    `select (select count(*) from users)::int + (select count(*) from phones)::int
          + (select count(*) from purchases)::int + (select count(*) from order_queue)::int
          + (select count(*) from advice_log)::int as n`,
  );
  if (Number(busy.rows[0]?.n) > 0) {
    throw new Error('База не пустая — восстановление делается только в чистую базу.');
  }

  await db.query('begin');
  try {
    // Ловушка 2: категории из сида миграции 0001 заменяем категориями из бэкапа.
    await db.query('delete from purchase_categories');

    const done: Record<string, number> = {};
    for (const t of RESTORE_ORDER) {
      // Ловушка 3 (часть 1): ссылку на «убившую» покупку пока не ставим —
      // самих покупок ещё нет, внешний ключ не пустит.
      const rows =
        t === 'phones'
          ? data.phones.map((p) => ({ ...p, death_purchase_id: null }))
          : (data[t] ?? []); // старые дампы без advice_log — просто пусто
      done[t] = await insertRows(db, t, rows);
    }

    // Второй проход: death_purchase_id. Триггер updated_at на время правки
    // выключаем, иначе у всех умерших телефонов изменилось бы updated_at
    // и бэкап перестал бы совпадать с восстановленной базой один в один.
    const links = data.phones.filter((p) => p.death_purchase_id != null);
    if (links.length > 0) {
      await db.query('alter table phones disable trigger trg_phones_updated');
      await db.query(
        `update phones p set death_purchase_id = x.death_purchase_id
           from jsonb_to_recordset($1::jsonb) as x(id uuid, death_purchase_id uuid)
          where p.id = x.id`,
        [JSON.stringify(links.map((p) => ({ id: p.id, death_purchase_id: p.death_purchase_id })))],
      );
      await db.query('alter table phones enable trigger trg_phones_updated');
    }

    // Счётчик номеров заказов — чтобы следующий заказ получил номер после последнего.
    await db.query(
      `select setval('order_queue_num_seq', (select coalesce(max(num), 1) from order_queue))`,
    );
    // То же для журнала подсказок — иначе следующая запись упрётся в занятый id.
    await db.query(`select setval('advice_log_id_seq', (select coalesce(max(id), 1) from advice_log))`);

    await db.query('commit');
    return done;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

/**
 * Отпечаток таблицы: md5 от всех строк в фиксированном порядке.
 * Совпал у живой базы и восстановленной — восстановление один в один.
 */
export async function tableFingerprint(db: Exec, table: (typeof RESTORE_ORDER)[number]): Promise<string> {
  const r = await db.query(
    `select count(*)::text || ':' || coalesce(md5(string_agg(row_to_json(t)::text, ',' order by t.id)), '-') as f
       from ${table} t`,
  );
  return String(r.rows[0]?.f);
}
