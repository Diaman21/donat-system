import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// Полный бэкап базы знаний в JSON.
//
// Зачем не только CSV покупок: в CSV телефон записан лишь 4 цифрами IMEI
// (они повторяются у разных аппаратов), и там НЕТ метки телефона (модели),
// death_reason (error/forced), дат жизни и методик из warmup_config.
// Без этого восстановить анализ «зелёного коридора» невозможно.
// Здесь — сырые строки всех рабочих таблиц, восстанавливаются один в один.

// Порядок важен: при восстановлении вставлять именно так (FK-зависимости).
const TABLES = ['users', 'purchase_categories', 'phones', 'purchases', 'order_queue'] as const;

// bot_sessions не бэкапим — это временное состояние ввода, ценности нет.
//
// ⚠️ Дампы, снятые ДО 12.09.2026, содержат у purchases лишнюю колонку
// order_id (наследие удалённой таблицы orders, миграция 0011). Во всех
// строках там NULL — при восстановлении старого дампа её нужно отбросить.

export interface FullBackup {
  json: string;
  counts: Record<string, number>;
  bytes: number;
}

export async function buildFullBackup(): Promise<FullBackup> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const t of TABLES) {
    // Имена таблиц — из фиксированного списка выше, подстановки извне нет.
    const rows = (await db.execute(
      sql.raw(`select * from ${t} order by created_at`),
    )) as unknown as unknown[];
    data[t] = rows;
    counts[t] = rows.length;
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Полный бэкап donat-system. Восстановление: вставлять таблицы в порядке ключа tables.',
      tables: TABLES,
      counts,
    },
    ...data,
  };

  const json = JSON.stringify(payload, null, 1);
  return { json, counts, bytes: Buffer.byteLength(json, 'utf8') };
}
