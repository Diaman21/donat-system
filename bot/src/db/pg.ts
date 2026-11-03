import postgres from 'postgres';
import { env } from '../config.js';

// Единственное подключение к Neon через pooler — «голый» драйвер postgres.js.
// prepare: false — обязательно для пулера (PgBouncer в transaction mode
// не поддерживает prepared statements).
//
// Отдельным файлом (03.11.2026) ради будильника слотов: драйвер грузится за
// ~15 мс, а drizzle поверх него — ещё ~330 мс процессора на каждый холодный
// вызов. Будильник ходит сюда напрямую, бот — через drizzle (client.ts) по
// ЭТОМУ ЖЕ подключению.
// ⚠️ drizzle при создании переключает разбор дат на строки, поэтому в процессе
// бота даты отсюда приходят строками, а в будильнике — Date. Читать даты
// только через new Date(...): это работает с обоими.
export const pg = postgres(env.databaseUrl, { prepare: false });
